import { type SQL, sql } from "drizzle-orm";

import {
  DEFAULT_COMPLETION_SCOPE,
  type CompletionFinish,
  type CompletionScope,
} from "@/lib/collection/constants";
import { getDb } from "@/lib/db";

export type SetProgress = {
  code: string;
  name: string;
  setType: string;
  releasedAt: string | null;
  iconSvgUri: string | null;
  /** Printings in scope — the denominator. */
  target: number;
  /** Distinct in-scope printings owned — the numerator. */
  owned: number;
  /** 0-100, rounded. 100 only when owned === target and target > 0. */
  percent: number;
  /**
   * What the missing cards cost, in cents, counting only the ones that have a
   * price. Zero when nothing is missing *and* when nothing missing is priced,
   * which is why `missingPriced` travels with it: a $0 total means "no idea"
   * as often as it means "nothing left to buy", and the UI must be able to
   * tell those apart.
   */
  missingCents: number;
  /** Missing printings in scope. */
  missing: number;
  /** How many of those have a price — the honesty check on `missingCents`. */
  missingPriced: number;
};

/**
 * The price of one printing for a completion finish, in SQL.
 *
 * `any` takes the cheapest finish that exists: the scope says any copy ticks
 * the box, so the cost of ticking it is the cheapest one you could buy.
 * `LEAST` ignores nulls, which is exactly right — a printing with no foil
 * price still has a nonfoil one.
 */
const PRICE_FOR_SCOPE = sql`
  CASE e.finish
    WHEN 'nonfoil' THEN e.usd_cents
    WHEN 'foil'    THEN e.usd_foil_cents
    WHEN 'etched'  THEN e.usd_etched_cents
    ELSE LEAST(e.usd_cents, e.usd_foil_cents, e.usd_etched_cents)
  END
`;

export type CompletionBucket = {
  label: string;
  target: number;
  owned: number;
  percent: number;
};

export type SetCompletion = {
  code: string;
  name: string;
  setType: string;
  releasedAt: string | null;
  iconSvgUri: string | null;
  parentSetCode: string | null;
  scope: CompletionScope;
  /** Whether each flag actually narrows this set — see `scopeFragment`. */
  applicable: {
    boosterOnly: boolean;
    includePromos: boolean;
    includeExtras: boolean;
  };
  /** Printings in the set before any scope flag is applied. */
  setSize: number;
  target: number;
  owned: number;
  percent: number;
  byRarity: CompletionBucket[];
  byColor: CompletionBucket[];
};

export type MissingPrinting = {
  scryfallId: string;
  oracleId: string;
  name: string;
  collectorNumber: string;
  rarity: string;
  manaCost: string | null;
  colorIdentity: string[];
  /**
   * What this printing costs for the finish the scope asks for, in cents, or
   * null when Scryfall has no price for it. Null rather than 0, because a
   * missing price must not read as a free card in a total.
   */
  priceCents: number | null;
};

const RARITY_ORDER = ["common", "uncommon", "rare", "mythic", "special", "bonus"];
const COLOR_ORDER = [
  "White",
  "Blue",
  "Black",
  "Red",
  "Green",
  "Multicolor",
  "Colorless",
];

/**
 * The scope predicate, as a reusable fragment.
 *
 * The three `OR NOT has_*` clauses are the important part: **an exclusion is
 * ignored when it would empty the set.** Of roughly 971 non-digital sets with
 * cards, most contain no booster-obtainable printings at all — every commander
 * deck, every duel deck, 277 of 278 promo sets — so applying `booster_only`
 * unconditionally would report a completion target of zero cards for most of
 * the sets anyone actually owns, Bloomburrow Commander included.
 *
 * Reading it as "narrow this set, but never erase it" is both more useful and
 * closer to what someone means by the toggle.
 */
function scopeFragment(): SQL {
  return sql`
         AND (NOT scope.booster_only   OR NOT caps.has_booster  OR p.is_booster)
         AND (    scope.include_promos OR NOT caps.has_nonpromo OR NOT p.is_promo)
         AND (    scope.include_extras OR NOT caps.has_nonextra OR NOT p.is_extra)
  `;
}

/**
 * Per-set capability flags. `bool_or` over no rows is NULL rather than false,
 * so each is coalesced — otherwise a set with no printings would make every
 * predicate NULL and quietly return nothing.
 */
function capsFragment(setCode: SQL | string): SQL {
  return sql`
    caps AS (
      SELECT coalesce(bool_or(is_booster), false)  AS has_booster,
             coalesce(bool_or(NOT is_promo), false) AS has_nonpromo,
             coalesce(bool_or(NOT is_extra), false) AS has_nonextra
        FROM printings
       WHERE set_code = ${setCode} AND lang = 'en'
    )
  `;
}

/** The stored scope for a set, falling back to the default when unset. */
function scopeCte(setCode: SQL | string): SQL {
  return sql`
    scope AS (
      SELECT coalesce(t.booster_only,   ${DEFAULT_COMPLETION_SCOPE.boosterOnly})   AS booster_only,
             coalesce(t.include_promos, ${DEFAULT_COMPLETION_SCOPE.includePromos}) AS include_promos,
             coalesce(t.include_extras, ${DEFAULT_COMPLETION_SCOPE.includeExtras}) AS include_extras,
             coalesce(t.finish,         ${DEFAULT_COMPLETION_SCOPE.finish})        AS finish
        FROM (SELECT 1) AS anchor
        LEFT JOIN completion_targets t ON t.set_code = ${setCode}
    )
  `;
}

/**
 * Printings owned in this set, honoring the finish rule.
 *
 * `finish = 'any'` matches any copy. The others match literally: owning an
 * etched foil does not satisfy a `foil` target, because etched is a separate
 * treatment that usually exists alongside the regular foil.
 */
function ownedCte(setCode: SQL | string): SQL {
  return sql`
    owned AS (
      SELECT c.printing_id, sum(c.quantity)::int AS copies
        FROM collection_items c
        JOIN printings op ON op.scryfall_id = c.printing_id
        CROSS JOIN scope
       WHERE op.set_code = ${setCode}
         AND (scope.finish = 'any' OR c.finish = scope.finish)
       GROUP BY c.printing_id
    )
  `;
}

const colorBucket = sql`
  CASE
    WHEN o.color_identity IS NULL OR cardinality(o.color_identity) = 0 THEN 'Colorless'
    WHEN cardinality(o.color_identity) > 1 THEN 'Multicolor'
    WHEN o.color_identity[1] = 'W' THEN 'White'
    WHEN o.color_identity[1] = 'U' THEN 'Blue'
    WHEN o.color_identity[1] = 'B' THEN 'Black'
    WHEN o.color_identity[1] = 'R' THEN 'Red'
    WHEN o.color_identity[1] = 'G' THEN 'Green'
    ELSE 'Colorless'
  END
`;

function percentOf(owned: number, target: number): number {
  if (target <= 0) return 0;
  return Math.round((owned / target) * 100);
}

/**
 * Completion for every set you own at least one card from.
 *
 * Deliberately not every set: there are over a thousand, and a page of
 * "0 of 281" rows for sets you have never opened is noise. The detail page
 * works for any set code, so a set can still be inspected before you own
 * anything from it.
 */
export async function listSetProgress(): Promise<SetProgress[]> {
  const db = getDb();

  const { rows } = await db.execute<{
    code: string;
    name: string;
    set_type: string;
    released_at: string | null;
    icon_svg_uri: string | null;
    target: number;
    owned: number;
    missing_cents: string;
    missing_priced: number;
  }>(sql`
    WITH owned_sets AS (
      SELECT DISTINCT p.set_code
        FROM collection_items c
        JOIN printings p ON p.scryfall_id = c.printing_id
    ),
    caps AS (
      SELECT set_code,
             coalesce(bool_or(is_booster), false)   AS has_booster,
             coalesce(bool_or(NOT is_promo), false) AS has_nonpromo,
             coalesce(bool_or(NOT is_extra), false) AS has_nonextra
        FROM printings
       WHERE lang = 'en'
       GROUP BY set_code
    ),
    scope AS (
      SELECT os.set_code,
             coalesce(t.booster_only,   ${DEFAULT_COMPLETION_SCOPE.boosterOnly})   AS booster_only,
             coalesce(t.include_promos, ${DEFAULT_COMPLETION_SCOPE.includePromos}) AS include_promos,
             coalesce(t.include_extras, ${DEFAULT_COMPLETION_SCOPE.includeExtras}) AS include_extras,
             coalesce(t.finish,         ${DEFAULT_COMPLETION_SCOPE.finish})        AS finish
        FROM owned_sets os
        LEFT JOIN completion_targets t ON t.set_code = os.set_code
    ),
    eligible AS (
      SELECT p.set_code, p.scryfall_id, scope.finish,
             p.usd_cents, p.usd_foil_cents, p.usd_etched_cents
        FROM printings p
        JOIN scope ON scope.set_code = p.set_code
        JOIN caps  ON caps.set_code  = p.set_code
       WHERE p.lang = 'en'
         AND (NOT scope.booster_only   OR NOT caps.has_booster  OR p.is_booster)
         AND (    scope.include_promos OR NOT caps.has_nonpromo OR NOT p.is_promo)
         AND (    scope.include_extras OR NOT caps.has_nonextra OR NOT p.is_extra)
    ),
    scored AS (
      SELECT e.set_code,
             EXISTS (
               SELECT 1 FROM collection_items c
                WHERE c.printing_id = e.scryfall_id
                  AND (e.finish = 'any' OR c.finish = e.finish)
             ) AS owned,
             ${PRICE_FOR_SCOPE} AS price_cents
        FROM eligible e
    )
    SELECT s.code,
           s.name,
           s.set_type,
           s.released_at::text AS released_at,
           s.icon_svg_uri,
           count(*)::int AS target,
           count(*) FILTER (WHERE e.owned)::int AS owned,
           coalesce(
             sum(e.price_cents) FILTER (WHERE NOT e.owned), 0
           )::text AS missing_cents,
           count(*) FILTER (
             WHERE NOT e.owned AND e.price_cents IS NOT NULL
           )::int AS missing_priced
      FROM scored e
      JOIN sets s ON s.code = e.set_code
     GROUP BY s.code, s.name, s.set_type, s.released_at, s.icon_svg_uri
     ORDER BY s.released_at DESC NULLS LAST, s.name ASC
  `);

  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    setType: r.set_type,
    releasedAt: r.released_at,
    iconSvgUri: r.icon_svg_uri,
    target: r.target,
    owned: r.owned,
    percent: percentOf(r.owned, r.target),
    missingCents: Number(r.missing_cents),
    missing: Math.max(r.target - r.owned, 0),
    missingPriced: r.missing_priced,
  }));
}

/** Full completion detail for one set. Returns null for an unknown code. */
export async function getSetCompletion(
  setCode: string,
): Promise<SetCompletion | null> {
  const db = getDb();
  const code = setCode.toLowerCase();

  const { rows: setRows } = await db.execute<{
    code: string;
    name: string;
    set_type: string;
    released_at: string | null;
    icon_svg_uri: string | null;
    parent_set_code: string | null;
    set_size: number;
    has_booster: boolean;
    has_nonpromo: boolean;
    has_nonextra: boolean;
    booster_only: boolean;
    include_promos: boolean;
    include_extras: boolean;
    finish: CompletionFinish;
  }>(sql`
    WITH ${capsFragment(code)}, ${scopeCte(code)}
    SELECT s.code, s.name, s.set_type,
           s.released_at::text AS released_at,
           s.icon_svg_uri, s.parent_set_code,
           (SELECT count(*)::int FROM printings
             WHERE set_code = s.code AND lang = 'en') AS set_size,
           caps.has_booster, caps.has_nonpromo, caps.has_nonextra,
           scope.booster_only, scope.include_promos,
           scope.include_extras, scope.finish
      FROM sets s, caps, scope
     WHERE s.code = ${code}
  `);

  const info = setRows[0];
  if (!info) return null;

  const { rows: totals } = await db.execute<{ target: number; owned: number }>(sql`
    WITH ${capsFragment(code)}, ${scopeCte(code)}, ${ownedCte(code)}
    SELECT count(*)::int AS target,
           count(owned.printing_id)::int AS owned
      FROM printings p
      CROSS JOIN scope
      CROSS JOIN caps
      LEFT JOIN owned ON owned.printing_id = p.scryfall_id
     WHERE p.set_code = ${code}
       AND p.lang = 'en'
       ${scopeFragment()}
  `);

  const { rows: rarityRows } = await db.execute<{
    label: string;
    target: number;
    owned: number;
  }>(sql`
    WITH ${capsFragment(code)}, ${scopeCte(code)}, ${ownedCte(code)}
    SELECT p.rarity AS label,
           count(*)::int AS target,
           count(owned.printing_id)::int AS owned
      FROM printings p
      CROSS JOIN scope
      CROSS JOIN caps
      LEFT JOIN owned ON owned.printing_id = p.scryfall_id
     WHERE p.set_code = ${code}
       AND p.lang = 'en'
       ${scopeFragment()}
     GROUP BY p.rarity
  `);

  const { rows: colorRows } = await db.execute<{
    label: string;
    target: number;
    owned: number;
  }>(sql`
    WITH ${capsFragment(code)}, ${scopeCte(code)}, ${ownedCte(code)}
    SELECT ${colorBucket} AS label,
           count(*)::int AS target,
           count(owned.printing_id)::int AS owned
      FROM printings p
      JOIN oracle_cards o ON o.oracle_id = p.oracle_id
      CROSS JOIN scope
      CROSS JOIN caps
      LEFT JOIN owned ON owned.printing_id = p.scryfall_id
     WHERE p.set_code = ${code}
       AND p.lang = 'en'
       ${scopeFragment()}
     GROUP BY 1
  `);

  const target = totals[0]?.target ?? 0;
  const owned = totals[0]?.owned ?? 0;

  const toBucket = (r: { label: string; target: number; owned: number }) => ({
    label: r.label,
    target: r.target,
    owned: r.owned,
    percent: percentOf(r.owned, r.target),
  });

  const byRarity = rarityRows.map(toBucket).sort((a, b) => {
    const ai = RARITY_ORDER.indexOf(a.label);
    const bi = RARITY_ORDER.indexOf(b.label);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });

  const byColor = colorRows
    .map(toBucket)
    .sort((a, b) => COLOR_ORDER.indexOf(a.label) - COLOR_ORDER.indexOf(b.label));

  return {
    code: info.code,
    name: info.name,
    setType: info.set_type,
    releasedAt: info.released_at,
    iconSvgUri: info.icon_svg_uri,
    parentSetCode: info.parent_set_code,
    scope: {
      boosterOnly: info.booster_only,
      includePromos: info.include_promos,
      includeExtras: info.include_extras,
      finish: info.finish,
    },
    // A flag is only "applicable" if the set has something for it to exclude.
    applicable: {
      boosterOnly: info.has_booster,
      includePromos: info.has_nonpromo,
      includeExtras: info.has_nonextra,
    },
    setSize: info.set_size,
    target,
    owned,
    percent: percentOf(owned, target),
    byRarity,
    byColor,
  };
}

/**
 * In-scope printings of this set that no owned copy satisfies — the want list.
 *
 * This is the anti-join the whole stack was chosen for: a LEFT JOIN with an
 * IS NULL test, which a document store cannot express without reading the
 * entire set and the entire collection into application memory first.
 */
export async function listMissingPrintings(
  setCode: string,
): Promise<MissingPrinting[]> {
  const db = getDb();
  const code = setCode.toLowerCase();

  const { rows } = await db.execute<{
    scryfall_id: string;
    oracle_id: string;
    name: string;
    collector_number: string;
    rarity: string;
    mana_cost: string | null;
    color_identity: string[] | null;
    price_cents: number | null;
  }>(sql`
    WITH ${capsFragment(code)}, ${scopeCte(code)}, ${ownedCte(code)}
    SELECT p.scryfall_id::text AS scryfall_id,
           p.oracle_id::text   AS oracle_id,
           p.name,
           p.collector_number,
           p.rarity,
           o.mana_cost,
           o.color_identity,
           CASE scope.finish
             WHEN 'nonfoil' THEN p.usd_cents
             WHEN 'foil'    THEN p.usd_foil_cents
             WHEN 'etched'  THEN p.usd_etched_cents
             ELSE LEAST(p.usd_cents, p.usd_foil_cents, p.usd_etched_cents)
           END AS price_cents
      FROM printings p
      JOIN oracle_cards o ON o.oracle_id = p.oracle_id
      CROSS JOIN scope
      CROSS JOIN caps
      LEFT JOIN owned ON owned.printing_id = p.scryfall_id
     WHERE p.set_code = ${code}
       AND p.lang = 'en'
       ${scopeFragment()}
       AND owned.printing_id IS NULL
     ORDER BY p.collector_number_num ASC NULLS LAST, p.collector_number ASC
  `);

  return rows.map((r) => ({
    scryfallId: r.scryfall_id,
    oracleId: r.oracle_id,
    name: r.name,
    collectorNumber: r.collector_number,
    rarity: r.rarity,
    manaCost: r.mana_cost,
    colorIdentity: r.color_identity ?? [],
    priceCents: r.price_cents,
  }));
}

/** Sets matching a search, for jumping to one you own nothing from yet. */
export async function searchSets(
  query: string,
  limit = 20,
): Promise<{ code: string; name: string; releasedAt: string | null }[]> {
  const q = query.trim();
  if (q.length === 0) return [];

  const db = getDb();
  const pattern = `%${q.replace(/([\\%_])/g, "\\$1")}%`;

  const { rows } = await db.execute<{
    code: string;
    name: string;
    released_at: string | null;
  }>(sql`
    SELECT s.code, s.name, s.released_at::text AS released_at
      FROM sets s
     WHERE NOT s.digital
       AND (s.name ILIKE ${pattern} ESCAPE '\\' OR s.code ILIKE ${pattern} ESCAPE '\\')
       AND EXISTS (SELECT 1 FROM printings p WHERE p.set_code = s.code AND p.lang = 'en')
     ORDER BY (lower(s.code) = lower(${q})) DESC,
              s.released_at DESC NULLS LAST
     LIMIT ${limit}
  `);

  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    releasedAt: r.released_at,
  }));
}
