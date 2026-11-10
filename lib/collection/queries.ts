import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import type { CardCondition, CardFinish, LocationKind } from "@/lib/collection/constants";

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
};

export type BrowseFilters = {
  q?: string;
  setCode?: string;
  locationId?: string;
  finish?: string;
  rarity?: string;
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
           o.type_line
      FROM collection_items c
      JOIN printings p    ON p.scryfall_id = c.printing_id
      JOIN sets s         ON s.code = p.set_code
      JOIN locations l    ON l.id = c.location_id
      JOIN oracle_cards o ON o.oracle_id = p.oracle_id
     WHERE true ${where}
     ORDER BY p.name ASC,
              p.set_code ASC,
              p.collector_number_num ASC NULLS LAST,
              c.finish ASC,
              c.condition ASC
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
    })),
    matchingRows: countRows[0]?.matching_rows ?? 0,
    matchingCopies: countRows[0]?.matching_copies ?? 0,
  };
}
