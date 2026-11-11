import { sql, type SQL } from "drizzle-orm";

import { getDb } from "@/lib/db";

import { PRECON_BOARDS, type PreconBoard } from "./constants";

/**
 * Reads for the sealed-product pages.
 *
 * Two joins carry all of this, and both are LEFT joins on purpose:
 *
 *  - `precon_products` → `sets` on `mtgjson_code`. 298 of the 304 deck set
 *    codes match a Scryfall set; `Q01`-`Q08` (MTGJSON's Challenger decks)
 *    match nothing, so an inner join would hide six real products.
 *  - `precon_cards` → `printings` on `scryfall_id`. An unmatched card is a
 *    product MTGJSON published before Scryfall did, and it must show as
 *    unresolved rather than vanish from the list and make the deck look
 *    complete.
 */

/**
 * The finish an added copy lands in: the one the product ships, clamped to a
 * finish the printing was actually made in.
 *
 * Without the clamp, one line could fail the whole add. MTGJSON marks a
 * precon commander `isFoil`, and if Scryfall holds that printing as
 * nonfoil-only then `collection_items.finish = 'foil'` is a copy that does
 * not exist — rejected by the same check that protects manual entry. The
 * fallback order is: as shipped, then nonfoil, then whatever the printing has
 * (NULL for a printing with no finishes at all, which the writes skip).
 *
 * Defined once and reused by every read and write, so the "already owned"
 * column, the preview and the add can never disagree about which row an added
 * copy lands in. It assumes `precon_cards pc` and `printings p` are in scope.
 */
export const finishExpr: SQL = sql`
  CASE
    WHEN pc.is_etched AND 'etched' = ANY(p.finishes) THEN 'etched'
    WHEN pc.is_foil   AND 'foil'   = ANY(p.finishes) THEN 'foil'
    WHEN 'nonfoil' = ANY(p.finishes)                 THEN 'nonfoil'
    ELSE p.finishes[1]
  END
`;

/** Board display order, as a SQL array for `array_position`. */
const boardOrder: SQL = sql`ARRAY[${sql.join(
  PRECON_BOARDS.map((b) => sql`${b}`),
  sql`, `,
)}]::text[]`;

export type ProductListRow = {
  fileName: string;
  name: string;
  productType: string;
  mtgjsonSetCode: string;
  /** Null for the Challenger-deck codes with no Scryfall set. */
  setCode: string | null;
  setName: string | null;
  releasedAt: string | null;
  cardCount: number | null;
  distinctCount: number | null;
  /** Copies of this product's cards already in the collection, anywhere. */
  ownedCopies: number;
  /** Distinct printings of this product owned at least once. */
  ownedDistinct: number;
};

export type ProductTypeCount = { productType: string; count: number };

/** The product types, most numerous first, for the picker's filter. */
export async function listProductTypes(): Promise<ProductTypeCount[]> {
  const db = getDb();
  const { rows } = await db.execute<{ product_type: string; n: number }>(sql`
    SELECT product_type, count(*)::int AS n
      FROM precon_products
     GROUP BY product_type
     ORDER BY count(*) DESC, product_type
  `);
  return rows.map((r) => ({ productType: r.product_type, count: r.n }));
}

/**
 * The product picker.
 *
 * Owned counts come from correlated subqueries over `precon_cards` rather
 * than a join, so a product whose contents have not been fetched yet reports
 * zero instead of dropping out of the list. They count copies anywhere in the
 * collection rather than in one location: "do I already have this precon's
 * cards" does not depend on which binder they are in.
 */
export async function listProducts(options: {
  q?: string;
  productType?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: ProductListRow[]; total: number }> {
  const db = getDb();

  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);

  const filters: SQL[] = [];

  const q = options.q?.trim();
  if (q) {
    // Escaped because a literal % or _ in the search text would otherwise
    // widen the search instead of narrowing it.
    const pattern = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    filters.push(
      sql`(p.name ILIKE ${pattern} ESCAPE '\\'
           OR p.mtgjson_set_code ILIKE ${pattern} ESCAPE '\\'
           OR s.name ILIKE ${pattern} ESCAPE '\\')`,
    );
  }

  if (options.productType) {
    filters.push(sql`p.product_type = ${options.productType}`);
  }

  const where =
    filters.length > 0 ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;

  const { rows } = await db.execute<{
    file_name: string;
    name: string;
    product_type: string;
    mtgjson_set_code: string;
    set_code: string | null;
    set_name: string | null;
    released_at: string | null;
    card_count: number | null;
    distinct_count: number | null;
    owned_copies: number;
    owned_distinct: number;
    total: number;
  }>(sql`
    SELECT p.file_name,
           p.name,
           p.product_type,
           p.mtgjson_set_code,
           s.code AS set_code,
           s.name AS set_name,
           p.released_at::text AS released_at,
           p.card_count,
           p.distinct_count,
           coalesce((
             SELECT sum(c.quantity)
               FROM precon_cards pc
               JOIN collection_items c ON c.printing_id = pc.scryfall_id
              WHERE pc.file_name = p.file_name
           ), 0)::int AS owned_copies,
           coalesce((
             SELECT count(DISTINCT pc.scryfall_id)
               FROM precon_cards pc
              WHERE pc.file_name = p.file_name
                AND EXISTS (
                  SELECT 1 FROM collection_items c
                   WHERE c.printing_id = pc.scryfall_id
                )
           ), 0)::int AS owned_distinct,
           count(*) OVER ()::int AS total
      FROM precon_products p
      LEFT JOIN sets s ON s.mtgjson_code = p.mtgjson_set_code
      ${where}
     ORDER BY p.released_at DESC NULLS LAST, p.name
     LIMIT ${limit} OFFSET ${offset}
  `);

  return {
    total: rows[0]?.total ?? 0,
    rows: rows.map((r) => ({
      fileName: r.file_name,
      name: r.name,
      productType: r.product_type,
      mtgjsonSetCode: r.mtgjson_set_code,
      setCode: r.set_code,
      setName: r.set_name,
      releasedAt: r.released_at,
      cardCount: r.card_count,
      distinctCount: r.distinct_count,
      ownedCopies: r.owned_copies,
      ownedDistinct: r.owned_distinct,
    })),
  };
}

export type ProductDetail = {
  fileName: string;
  name: string;
  productType: string;
  mtgjsonSetCode: string;
  setCode: string | null;
  setName: string | null;
  releasedAt: string | null;
  source: string | null;
  cardCount: number | null;
  distinctCount: number | null;
  unidentifiedCount: number | null;
  contentsVersion: string | null;
  contentsFetchedAt: string | null;
};

export async function getProduct(
  fileName: string,
): Promise<ProductDetail | null> {
  const db = getDb();

  const { rows } = await db.execute<{
    file_name: string;
    name: string;
    product_type: string;
    mtgjson_set_code: string;
    set_code: string | null;
    set_name: string | null;
    released_at: string | null;
    source: string | null;
    card_count: number | null;
    distinct_count: number | null;
    unidentified_count: number | null;
    contents_version: string | null;
    contents_fetched_at: string | null;
  }>(sql`
    SELECT p.file_name, p.name, p.product_type, p.mtgjson_set_code,
           s.code AS set_code, s.name AS set_name,
           p.released_at::text AS released_at,
           p.source, p.card_count, p.distinct_count, p.unidentified_count,
           p.contents_version,
           p.contents_fetched_at::text AS contents_fetched_at
      FROM precon_products p
      LEFT JOIN sets s ON s.mtgjson_code = p.mtgjson_set_code
     WHERE p.file_name = ${fileName}
  `);

  const r = rows[0];
  if (!r) return null;

  return {
    fileName: r.file_name,
    name: r.name,
    productType: r.product_type,
    mtgjsonSetCode: r.mtgjson_set_code,
    setCode: r.set_code,
    setName: r.set_name,
    releasedAt: r.released_at,
    source: r.source,
    cardCount: r.card_count,
    distinctCount: r.distinct_count,
    unidentifiedCount: r.unidentified_count,
    contentsVersion: r.contents_version,
    contentsFetchedAt: r.contents_fetched_at,
  };
}

export type ProductCardRow = {
  board: PreconBoard;
  cardName: string;
  collectorNumber: string | null;
  quantity: number;
  isFoil: boolean;
  isEtched: boolean;
  /** Null when the card did not resolve to a printing we hold. */
  printingId: string | null;
  oracleId: string | null;
  setCode: string | null;
  rarity: string | null;
  manaCost: string | null;
  /** The finish an add would use, clamp included. Null if nothing fits. */
  wantFinish: string | null;
  /** Which finishes the printing exists in, to explain a clamp. */
  finishes: string[] | null;
  /** Copies already owned in the finish the add would use. */
  ownedInFinish: number;
  /** Copies owned in any finish. */
  ownedAnyFinish: number;
};

/**
 * One product's card list, with what the collection already holds.
 *
 * `ownedInFinish` is computed with the same clamped finish the add will use,
 * so the owned column and the add agree. Using the raw shipped finish instead
 * would show a foil commander as unowned forever whenever its printing has no
 * foil version.
 */
export async function listProductCards(
  fileName: string,
): Promise<ProductCardRow[]> {
  const db = getDb();

  const { rows } = await db.execute<{
    board: string;
    card_name: string;
    collector_number: string | null;
    quantity: number;
    is_foil: boolean;
    is_etched: boolean;
    printing_id: string | null;
    oracle_id: string | null;
    set_code: string | null;
    rarity: string | null;
    mana_cost: string | null;
    want_finish: string | null;
    finishes: string[] | null;
    owned_in_finish: number;
    owned_any_finish: number;
  }>(sql`
    WITH lines AS (
      SELECT pc.id,
             pc.board,
             pc.scryfall_id,
             pc.card_name,
             pc.collector_number,
             pc.quantity,
             pc.is_foil,
             pc.is_etched,
             ${finishExpr} AS want_finish
        FROM precon_cards pc
        LEFT JOIN printings p ON p.scryfall_id = pc.scryfall_id
       WHERE pc.file_name = ${fileName}
    )
    SELECT l.board,
           l.card_name,
           l.collector_number,
           l.quantity,
           l.is_foil,
           l.is_etched,
           l.want_finish,
           p.scryfall_id::text AS printing_id,
           p.oracle_id::text   AS oracle_id,
           p.set_code,
           p.rarity,
           o.mana_cost,
           p.finishes,
           coalesce((
             SELECT sum(c.quantity) FROM collection_items c
              WHERE c.printing_id = l.scryfall_id
                AND c.finish = l.want_finish
           ), 0)::int AS owned_in_finish,
           coalesce((
             SELECT sum(c.quantity) FROM collection_items c
              WHERE c.printing_id = l.scryfall_id
           ), 0)::int AS owned_any_finish
      FROM lines l
      LEFT JOIN printings p    ON p.scryfall_id = l.scryfall_id
      LEFT JOIN oracle_cards o ON o.oracle_id   = p.oracle_id
     ORDER BY array_position(${boardOrder}, l.board),
              p.collector_number_num NULLS LAST,
              l.card_name
  `);

  return rows.map((r) => ({
    board: r.board as PreconBoard,
    cardName: r.card_name,
    collectorNumber: r.collector_number,
    quantity: r.quantity,
    isFoil: r.is_foil,
    isEtched: r.is_etched,
    printingId: r.printing_id,
    oracleId: r.oracle_id,
    setCode: r.set_code,
    rarity: r.rarity,
    manaCost: r.mana_cost,
    wantFinish: r.want_finish,
    finishes: r.finishes,
    ownedInFinish: r.owned_in_finish,
    ownedAnyFinish: r.owned_any_finish,
  }));
}
