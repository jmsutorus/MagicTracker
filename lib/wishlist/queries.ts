import { sql } from "drizzle-orm";

import { representativePrinting } from "@/lib/cards/art";
import { getDb } from "@/lib/db";

/**
 * Reading the wishlist.
 *
 * Every row answers three questions at once, because they are the three you
 * ask while looking at it: what does it cost, do I already own one, and which
 * printing did I mean. The last two are why this is a join rather than a
 * select: a wishlist that doesn't notice you bought the card is a list you
 * stop trusting.
 */

export type WishlistRow = {
  id: string;
  oracleId: string;
  name: string;
  typeLine: string | null;
  manaCost: string | null;
  quantity: number;
  note: string | null;
  createdAt: string;

  /** Null when the row means "any printing". */
  printingId: string | null;

  /**
   * A printing to draw the row's art from — never null for a real card.
   *
   * Separate from `printingId` because that one is a statement about what you
   * want ("any Sol Ring" is a different want from "the Secret Lair one") and
   * this one is only about which picture to show. Collapsing them would turn
   * rendering a thumbnail into a claim about the row.
   */
  artPrintingId: string | null;
  setCode: string | null;
  setName: string | null;
  collectorNumber: string | null;
  tcgplayerId: number | null;

  /** Null when the row means "any finish". */
  finish: string | null;

  /**
   * The price of one copy, in cents: the named printing's price when there is
   * one, otherwise the cheapest printing of the card. Null when nothing in
   * the database has a price for it.
   */
  priceCents: number | null;

  /** Copies of this card already in the collection — the "you have it" flag. */
  ownedCopies: number;
};

export type WishlistSummary = {
  rows: WishlistRow[];
  /** Copies wanted across every row. */
  wantedCopies: number;
  /** What the priced rows would cost for the quantities wanted. */
  totalCents: number;
  /** Rows with no price anywhere — the honesty check on the total. */
  unpricedRows: number;
  /** Rows you now own at least one copy of. */
  ownedRows: number;
};

/**
 * The price of one copy for a wishlist row.
 *
 * A row naming a printing is priced at that printing and nothing else — the
 * point of naming it was that the others will not do. A row that names no
 * printing is priced at the cheapest English printing of the card, which is
 * what "any printing" costs. `LEAST` ignores nulls, so a card that exists
 * only in foil is still priced.
 */
const PRICE_EXPR = sql`
  CASE
    WHEN w.printing_id IS NOT NULL THEN
      CASE w.finish
        WHEN 'nonfoil' THEN pr.usd_cents
        WHEN 'foil'    THEN pr.usd_foil_cents
        WHEN 'etched'  THEN pr.usd_etched_cents
        ELSE LEAST(pr.usd_cents, pr.usd_foil_cents, pr.usd_etched_cents)
      END
    ELSE (
      SELECT min(
        CASE w.finish
          WHEN 'nonfoil' THEN p2.usd_cents
          WHEN 'foil'    THEN p2.usd_foil_cents
          WHEN 'etched'  THEN p2.usd_etched_cents
          ELSE LEAST(p2.usd_cents, p2.usd_foil_cents, p2.usd_etched_cents)
        END
      )
        FROM printings p2
       WHERE p2.oracle_id = w.oracle_id
         AND p2.lang = 'en'
    )
  END
`;

/**
 * Copies owned that satisfy the row.
 *
 * A row naming a printing is satisfied only by that printing; a row that
 * names none is satisfied by any printing of the card, which is the same
 * asymmetry the price uses.
 */
const OWNED_EXPR = sql`
  coalesce((
    SELECT sum(c.quantity)::int
      FROM collection_items c
      JOIN printings cp ON cp.scryfall_id = c.printing_id
     WHERE cp.oracle_id = w.oracle_id
       AND (w.printing_id IS NULL OR c.printing_id = w.printing_id)
       AND (w.finish IS NULL OR c.finish = w.finish)
  ), 0)
`;

export async function listWishlist(): Promise<WishlistSummary> {
  const db = getDb();

  const { rows } = await db.execute<{
    id: string;
    oracle_id: string;
    name: string;
    type_line: string | null;
    mana_cost: string | null;
    quantity: number;
    note: string | null;
    created_at: string;
    printing_id: string | null;
    art_printing_id: string | null;
    set_code: string | null;
    set_name: string | null;
    collector_number: string | null;
    tcgplayer_id: number | null;
    finish: string | null;
    price_cents: number | null;
    owned_copies: number;
  }>(sql`
    SELECT w.id::text            AS id,
           w.oracle_id::text     AS oracle_id,
           o.name,
           o.type_line,
           o.mana_cost,
           w.quantity,
           w.note,
           w.created_at::text    AS created_at,
           w.printing_id::text   AS printing_id,
           coalesce(
             w.printing_id,
             ${representativePrinting(sql`w.oracle_id`)}
           )::text               AS art_printing_id,
           pr.set_code,
           s.name                AS set_name,
           pr.collector_number,
           pr.tcgplayer_id,
           w.finish,
           ${PRICE_EXPR}         AS price_cents,
           ${OWNED_EXPR}         AS owned_copies
      FROM wishlist_items w
      JOIN oracle_cards o ON o.oracle_id = w.oracle_id
      LEFT JOIN printings pr ON pr.scryfall_id = w.printing_id
      LEFT JOIN sets s ON s.code = pr.set_code
     ORDER BY w.created_at DESC, o.name ASC
  `);

  const mapped: WishlistRow[] = rows.map((r) => ({
    id: r.id,
    oracleId: r.oracle_id,
    name: r.name,
    typeLine: r.type_line,
    manaCost: r.mana_cost,
    quantity: r.quantity,
    note: r.note,
    createdAt: r.created_at,
    printingId: r.printing_id,
    artPrintingId: r.art_printing_id,
    setCode: r.set_code,
    setName: r.set_name,
    collectorNumber: r.collector_number,
    tcgplayerId: r.tcgplayer_id,
    finish: r.finish,
    priceCents: r.price_cents,
    ownedCopies: r.owned_copies,
  }));

  return {
    rows: mapped,
    wantedCopies: mapped.reduce((n, r) => n + r.quantity, 0),
    totalCents: mapped.reduce(
      (n, r) => n + (r.priceCents ?? 0) * r.quantity,
      0,
    ),
    unpricedRows: mapped.filter((r) => r.priceCents === null).length,
    ownedRows: mapped.filter((r) => r.ownedCopies > 0).length,
  };
}

/** Whether this card is already wished for, to label a button. */
export async function isWished(oracleId: string): Promise<boolean> {
  const db = getDb();
  const { rows } = await db.execute<{ hit: number }>(sql`
    SELECT 1 AS hit FROM wishlist_items
     WHERE oracle_id = ${oracleId}::uuid
     LIMIT 1
  `);
  return rows.length > 0;
}

export async function countWishlist(): Promise<number> {
  const db = getDb();
  const { rows } = await db.execute<{ count: string }>(sql`
    SELECT count(*)::text AS count FROM wishlist_items
  `);
  return Number(rows[0]?.count ?? 0);
}
