import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  CARD_CONDITIONS,
  CARD_FINISHES,
  type CardCondition,
  type CardFinish,
  type CollectionSort,
  type LocationKind,
} from "@/lib/collection/constants";

export type LocationRow = {
  id: string;
  name: string;
  kind: LocationKind;
  sortOrder: number;
  /** Distinct collection rows filed here — the guard for deleting a location. */
  itemCount: number;
  /** Total physical cards filed here. */
  cardCount: number;
};

export type EntrySet = {
  code: string;
  name: string;
  releasedAt: string | null;
  /** Printings eligible for entry: paper, English, not an art series or token. */
  printingCount: number;
};

export type EntryPrinting = {
  scryfallId: string;
  oracleId: string;
  name: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  rarity: string;
  finishes: CardFinish[];
  lang: string;
  isExtra: boolean;
  releasedAt: string | null;
  /** Copies already owned across every finish, condition and location. */
  ownedQuantity: number;
};

/**
 * Copies of one printing that are alike in the ways a collector cares about.
 *
 * Locations are summed away: two NM foils are two NM foils whether they sit
 * in one binder or two, and "where" is the collection page's question, not
 * the card page's.
 */
export type OwnedCopies = {
  printingId: string;
  finish: CardFinish;
  condition: CardCondition;
  quantity: number;
};

export type CollectionTotals = {
  totalCopies: number;
  distinctPrintings: number;
  distinctCards: number;
  distinctSets: number;
  foilCopies: number;
};

export type CollectionRow = {
  itemId: string;
  quantity: number;
  finish: CardFinish;
  condition: CardCondition;
  locationId: string;
  locationName: string;
  printingId: string;
  oracleId: string;
  name: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  rarity: string;
  manaCost: string | null;
  typeLine: string | null;
  /**
   * The latest snapshot price for this printing and finish, for one copy.
   * Null when the weekly job has never priced it.
   */
  priceCents: number | null;
};

export type BrowseFilters = {
  q?: string;
  setCode?: string;
  locationId?: string;
  finish?: string;
  rarity?: string;
  sort?: CollectionSort;
  limit?: number;
  offset?: number;
};

export type BrowseResult = {
  rows: CollectionRow[];
  /** Rows matching the filters, ignoring limit/offset. */
  matchingRows: number;
  /** Physical cards matching the filters. */
  matchingCopies: number;
};

/** Escapes LIKE wildcards so a query of "%" does not match everything. */
function escapeLikePattern(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1");
}

export async function listLocations(): Promise<LocationRow[]> {
  const db = getDb();

  const { rows } = await db.execute<{
    id: string;
    name: string;
    kind: LocationKind;
    sort_order: number;
    item_count: number;
    card_count: number;
  }>(sql`
    SELECT l.id::text         AS id,
           l.name,
           l.kind,
           l.sort_order,
           count(c.id)::int                      AS item_count,
           coalesce(sum(c.quantity), 0)::int     AS card_count
      FROM locations l
      LEFT JOIN collection_items c ON c.location_id = l.id
     GROUP BY l.id, l.name, l.kind, l.sort_order
     ORDER BY l.sort_order ASC, l.name ASC
  `);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    sortOrder: r.sort_order,
    itemCount: r.item_count,
    cardCount: r.card_count,
  }));
}

/**
 * Sets worth pinning for collector-number entry.
 *
 * Token and memorabilia sets, and sets whose every printing is an art series
 * card, are excluded: you cannot open a pack of them, so they would only pad
 * a picker that wants to be fast. Digital sets are excluded because they
 * cannot be in a physical collection at all.
 */
export async function listEntrySets(): Promise<EntrySet[]> {
  const db = getDb();

  const { rows } = await db.execute<{
    code: string;
    name: string;
    released_at: string | null;
    printing_count: number;
  }>(sql`
    SELECT s.code,
           s.name,
           s.released_at::text AS released_at,
           count(p.scryfall_id)::int AS printing_count
      FROM sets s
      JOIN printings p
        ON p.set_code = s.code
       AND p.lang = 'en'
       AND NOT p.is_extra
     WHERE NOT s.digital
     GROUP BY s.code, s.name, s.released_at
     HAVING count(p.scryfall_id) > 0
     ORDER BY s.released_at DESC NULLS LAST, s.name ASC
  `);

  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    releasedAt: r.released_at,
    printingCount: r.printing_count,
  }));
}

/**
 * Printings in a set with this collector number.
 *
 * Returns a list rather than one row on purpose. `(set_code,
 * collector_number, lang)` is deliberately not a unique index — see the
 * comment on `printings` — so if the data really holds two candidates, the
 * entry screen should show both rather than pick one silently.
 *
 * Matching is case-insensitive because "123A" and "123a" are the same card,
 * and the set_code equality keeps that cheap.
 */
export async function findPrintingsByCollectorNumber(
  setCode: string,
  collectorNumber: string,
): Promise<EntryPrinting[]> {
  const db = getDb();

  const { rows } = await db.execute<EntryPrintingRow>(sql`
    ${entryPrintingSelect}
     WHERE p.set_code = lower(${setCode})
       AND lower(p.collector_number) = lower(${collectorNumber})
     ORDER BY p.lang = 'en' DESC, p.is_extra ASC, p.lang ASC
  `);

  return rows.map(toEntryPrinting);
}

/** Every printing of one card, newest first — the name-mode printing picker. */
export async function listPrintingsForOracle(
  oracleId: string,
): Promise<EntryPrinting[]> {
  const db = getDb();

  const { rows } = await db.execute<EntryPrintingRow>(sql`
    ${entryPrintingSelect}
     WHERE p.oracle_id = ${oracleId}::uuid
     ORDER BY p.is_extra ASC,
              p.released_at DESC NULLS LAST,
              p.set_code ASC,
              p.collector_number_num ASC NULLS LAST,
              p.collector_number ASC
  `);

  return rows.map(toEntryPrinting);
}

/**
 * What is owned of each printing of one card, split by finish and condition.
 *
 * Grouped in SQL but *ordered* in TypeScript, against the constants that
 * define these domains: "nonfoil, foil, etched" and "NM through DMG" are
 * meaningful sequences, and reproducing either as a CASE in SQL would be a
 * second copy of an order that already has one definition.
 *
 * Returns [] for a card you own no copy of, which is the common case on a
 * card page, so it costs one indexed lookup and nothing more.
 */
export async function listOwnedCopiesForOracle(
  oracleId: string,
): Promise<OwnedCopies[]> {
  const db = getDb();

  const { rows } = await db.execute<{
    printing_id: string;
    finish: CardFinish;
    condition: CardCondition;
    quantity: number;
  }>(sql`
    SELECT c.printing_id::text AS printing_id,
           c.finish,
           c.condition,
           sum(c.quantity)::int AS quantity
      FROM collection_items c
      JOIN printings p ON p.scryfall_id = c.printing_id
     WHERE p.oracle_id = ${oracleId}::uuid
     GROUP BY c.printing_id, c.finish, c.condition
  `);

  return rows
    .map((r) => ({
      printingId: r.printing_id,
      finish: r.finish,
      condition: r.condition,
      quantity: r.quantity,
    }))
    .sort(
      (a, b) =>
        CARD_FINISHES.indexOf(a.finish) - CARD_FINISHES.indexOf(b.finish) ||
        CARD_CONDITIONS.indexOf(a.condition) -
          CARD_CONDITIONS.indexOf(b.condition),
    );
}

type EntryPrintingRow = {
  scryfall_id: string;
  oracle_id: string;
  name: string;
  set_code: string;
  set_name: string;
  collector_number: string;
  rarity: string;
  finishes: string[] | null;
  lang: string;
  is_extra: boolean;
  released_at: string | null;
  owned_quantity: number;
};

/**
 * The shared SELECT for both printing lookups. `owned_quantity` is a
 * correlated subquery rather than a join so that a printing owned in three
 * places still comes back as one row.
 */
const entryPrintingSelect = sql`
    SELECT p.scryfall_id::text AS scryfall_id,
           p.oracle_id::text   AS oracle_id,
           p.name,
           p.set_code,
           s.name AS set_name,
           p.collector_number,
           p.rarity,
           p.finishes,
           p.lang,
           p.is_extra,
           p.released_at::text AS released_at,
           coalesce((
             SELECT sum(c.quantity)
               FROM collection_items c
              WHERE c.printing_id = p.scryfall_id
           ), 0)::int AS owned_quantity
      FROM printings p
      JOIN sets s ON s.code = p.set_code
`;

function toEntryPrinting(r: EntryPrintingRow): EntryPrinting {
  return {
    scryfallId: r.scryfall_id,
    oracleId: r.oracle_id,
    name: r.name,
    setCode: r.set_code,
    setName: r.set_name,
    collectorNumber: r.collector_number,
    rarity: r.rarity,
    finishes: (r.finishes ?? []) as CardFinish[],
    lang: r.lang,
    isExtra: r.is_extra,
    releasedAt: r.released_at,
    ownedQuantity: r.owned_quantity,
  };
}

export async function getCollectionTotals(): Promise<CollectionTotals> {
  const db = getDb();

  const { rows } = await db.execute<{
    total_copies: number;
    distinct_printings: number;
    distinct_cards: number;
    distinct_sets: number;
    foil_copies: number;
  }>(sql`
    SELECT coalesce(sum(c.quantity), 0)::int            AS total_copies,
           count(DISTINCT c.printing_id)::int           AS distinct_printings,
           count(DISTINCT p.oracle_id)::int             AS distinct_cards,
           count(DISTINCT p.set_code)::int              AS distinct_sets,
           coalesce(sum(
             CASE WHEN c.finish <> 'nonfoil' THEN c.quantity ELSE 0 END
           ), 0)::int                                   AS foil_copies
      FROM collection_items c
      JOIN printings p ON p.scryfall_id = c.printing_id
  `);

  const row = rows[0];
  return {
    totalCopies: row?.total_copies ?? 0,
    distinctPrintings: row?.distinct_printings ?? 0,
    distinctCards: row?.distinct_cards ?? 0,
    distinctSets: row?.distinct_sets ?? 0,
    foilCopies: row?.foil_copies ?? 0,
  };
}

/** Sets present in the collection, for the browse filter dropdown. */
export async function listCollectedSets(): Promise<
  { code: string; name: string; copies: number }[]
> {
  const db = getDb();

  const { rows } = await db.execute<{
    code: string;
    name: string;
    copies: number;
  }>(sql`
    SELECT s.code, s.name, sum(c.quantity)::int AS copies
      FROM collection_items c
      JOIN printings p ON p.scryfall_id = c.printing_id
      JOIN sets s ON s.code = p.set_code
     GROUP BY s.code, s.name
     ORDER BY s.name ASC
  `);

  return rows;
}

/**
 * What one copy of this row is worth.
 *
 * The price of a card depends on its finish — a foil and a nonfoil of the
 * same printing are different money — and the numbers live on `printings`,
 * refreshed by the card ingest. `price_snapshots` is the *history* behind
 * the value chart and is deliberately not used here: it only has rows for
 * dates the weekly job ran, so a card added yesterday would read as
 * unpriced. Same CASE as lib/completion/queries.ts, for the same reason.
 */
const PRICE_FOR_FINISH = sql`
  CASE c.finish
    WHEN 'nonfoil' THEN p.usd_cents
    WHEN 'foil'    THEN p.usd_foil_cents
    WHEN 'etched'  THEN p.usd_etched_cents
    ELSE LEAST(p.usd_cents, p.usd_foil_cents, p.usd_etched_cents)
  END
`;

export async function browseCollection(
  filters: BrowseFilters = {},
): Promise<BrowseResult> {
  const db = getDb();

  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);

  const q = filters.q?.trim();
  const namePattern = q ? `%${escapeLikePattern(q)}%` : null;

  // Each filter contributes a fragment or nothing, so one query serves every
  // combination without string-building SQL.
  const conditions = [
    namePattern ? sql`AND p.name ILIKE ${namePattern} ESCAPE '\\'` : sql``,
    filters.setCode ? sql`AND p.set_code = ${filters.setCode}` : sql``,
    filters.locationId
      ? sql`AND c.location_id = ${filters.locationId}::uuid`
      : sql``,
    filters.finish ? sql`AND c.finish = ${filters.finish}` : sql``,
    filters.rarity ? sql`AND p.rarity = ${filters.rarity}` : sql``,
  ];
  const where = sql.join(conditions, sql` `);

  /*
   * Rarity has an order, and it is not alphabetical: "mythic" before "rare"
   * before "uncommon" is the whole point of sorting by it, and `ORDER BY
   * rarity` gives bonus, common, mythic, rare, special, uncommon — which is
   * worse than no sort at all.
   */
  const rarityRank = sql`array_position(
    ARRAY['mythic','rare','special','bonus','uncommon','common']::text[], p.rarity
  )`;

  /*
   * One hand-written fragment per allowed sort. Nothing from the query
   * string reaches the ORDER BY — `sort` is narrowed to the union by
   * isCollectionSort before it arrives, and anything else lands on the
   * default. Each ends in a stable tiebreak so paging cannot show the same
   * row twice.
   */
  const tiebreak = sql`p.name ASC, p.set_code ASC, c.id ASC`;
  const orderBy = {
    name: sql`p.name ASC, p.set_code ASC, p.collector_number_num ASC NULLS LAST, c.finish ASC, c.condition ASC`,
    "name-desc": sql`p.name DESC, ${tiebreak}`,
    set: sql`p.set_code ASC, p.collector_number_num ASC NULLS LAST, ${tiebreak}`,
    quantity: sql`c.quantity DESC, ${tiebreak}`,
    rarity: sql`${rarityRank} ASC NULLS LAST, ${tiebreak}`,
    /*
     * By the value of the *stack*, not of one card: ten copies at a dollar
     * is more of the collection's worth than one at five, and "most
     * valuable" on a collection page means what is worth most.
     *
     * Nulls last — an unpriced card is unknown, not worthless, so it does
     * not belong at the top of the list pretending to be $0.
     */
    value: sql`(${PRICE_FOR_FINISH}) * c.quantity DESC NULLS LAST, ${tiebreak}`,
    added: sql`c.created_at DESC, ${tiebreak}`,
  }[filters.sort ?? "name"];

  const { rows } = await db.execute<{
    item_id: string;
    quantity: number;
    finish: CardFinish;
    condition: CardCondition;
    location_id: string;
    location_name: string;
    printing_id: string;
    oracle_id: string;
    name: string;
    set_code: string;
    set_name: string;
    collector_number: string;
    rarity: string;
    mana_cost: string | null;
    type_line: string | null;
    price_cents: number | null;
  }>(sql`
    SELECT c.id::text          AS item_id,
           c.quantity,
           c.finish,
           c.condition,
           c.location_id::text AS location_id,
           l.name              AS location_name,
           c.printing_id::text AS printing_id,
           p.oracle_id::text   AS oracle_id,
           p.name,
           p.set_code,
           s.name              AS set_name,
           p.collector_number,
           p.rarity,
           o.mana_cost,
           o.type_line,
           ${PRICE_FOR_FINISH} AS price_cents
      FROM collection_items c
      JOIN printings p    ON p.scryfall_id = c.printing_id
      JOIN sets s         ON s.code = p.set_code
      JOIN locations l    ON l.id = c.location_id
      JOIN oracle_cards o ON o.oracle_id = p.oracle_id
     WHERE true ${where}
     ORDER BY ${orderBy}
     LIMIT ${limit} OFFSET ${offset}
  `);

  const { rows: countRows } = await db.execute<{
    matching_rows: number;
    matching_copies: number;
  }>(sql`
    SELECT count(*)::int                        AS matching_rows,
           coalesce(sum(c.quantity), 0)::int    AS matching_copies
      FROM collection_items c
      JOIN printings p ON p.scryfall_id = c.printing_id
     WHERE true ${where}
  `);

  return {
    rows: rows.map((r) => ({
      itemId: r.item_id,
      quantity: r.quantity,
      finish: r.finish,
      condition: r.condition,
      locationId: r.location_id,
      locationName: r.location_name,
      printingId: r.printing_id,
      oracleId: r.oracle_id,
      name: r.name,
      setCode: r.set_code,
      setName: r.set_name,
      collectorNumber: r.collector_number,
      rarity: r.rarity,
      manaCost: r.mana_cost,
      typeLine: r.type_line,
      priceCents: r.price_cents,
    })),
    matchingRows: countRows[0]?.matching_rows ?? 0,
    matchingCopies: countRows[0]?.matching_copies ?? 0,
  };
}
