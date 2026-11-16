import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { getCardsByIds } from "@/lib/scryfall/client";

import { DEFAULT_PRICE_SOURCE, type PriceSource } from "./constants";
import { projectPrices, type PriceRow, type UnpricedRow } from "./project";

/**
 * Taking a price snapshot.
 *
 * Only the (printing, finish) pairs somebody owns are priced. PLAN.md §6 is
 * blunt about why: 110k printings times a weekly snapshot would exhaust the
 * 1 GB plan within months, and nobody needs a price history for a card they
 * do not have. At this collection's size that is a few hundred rows a week.
 *
 * The run is idempotent for a given date. Re-running it the same day updates
 * that day's rows rather than failing or appending, so a retry after a
 * half-finished run is safe and a manual run on top of the scheduled one
 * costs nothing.
 */

export type SnapshotResult = {
  snapshotDate: string;
  /** Distinct (printing, finish) pairs owned. */
  owned: number;
  priced: number;
  unpriced: UnpricedRow[];
  /** Printing ids Scryfall did not recognise at all. */
  notFound: string[];
  totalCents: number;
  pricedCopies: number;
  unpricedCopies: number;
};

export type OwnedPair = { printingId: string; finish: string };

/**
 * The (printing, finish) pairs to price.
 *
 * Distinct, because `collection_items` is keyed on condition and location as
 * well: four rows of the same card in different boxes are one price lookup,
 * not four.
 */
export async function listOwnedPairs(): Promise<OwnedPair[]> {
  const db = getDb();
  const { rows } = await db.execute<{ printing_id: string; finish: string }>(
    sql`
      SELECT DISTINCT c.printing_id::text AS printing_id, c.finish
        FROM collection_items c
        JOIN printings p ON p.scryfall_id = c.printing_id
       /*
        * Magic only, because this list is handed to Scryfall's collection
        * endpoint and nothing else in it has a Scryfall id. The other games'
        * printing ids are UUIDs this app derived (lib/games/ids.ts) — asking
        * Scryfall about them would mean a weekly request full of identifiers
        * that cannot exist, answered with a not_found list as long as the
        * non-Magic part of the collection.
        *
        * Those games are priced by writeCatalogPriceSnapshots() below, from
        * the prices their own catalogs publish.
        */
       WHERE p.game = 'mtg'
       -- The output names, not c.printing_id: under SELECT DISTINCT an
       -- ORDER BY expression has to be in the select list, and the cast to
       -- text means the bare column is not.
       ORDER BY printing_id, finish
    `,
  );
  return rows.map((r) => ({ printingId: r.printing_id, finish: r.finish }));
}

/**
 * Price rows for the games whose own catalogs carry prices.
 *
 * One Piece publishes a daily market price per card, which its ingest writes
 * into `printings.usd_cents`. So there is nothing to fetch: the number is
 * already in the row, and the snapshot copies it into the history under the
 * date it was true. That is what keeps those cards in the value chart rather
 * than only in the "what is it worth right now" figure.
 *
 * Pokémon's bulk data carries no prices at all, so Pokémon cards produce no
 * rows here and are counted as unpriced — which the value page already
 * reports in as many words, and which is better than inventing a zero.
 *
 * One INSERT ... SELECT because, unlike the Scryfall path, there is no
 * network call in the middle: source and destination are the same database.
 */
export async function writeCatalogPriceSnapshots(
  snapshotDate: string,
  source: PriceSource,
): Promise<number> {
  const db = getDb();

  const result = await db.execute(sql`
    INSERT INTO price_snapshots
      (printing_id, finish, source, snapshot_date, price_cents)
    SELECT DISTINCT c.printing_id, c.finish, ${source},
           ${snapshotDate}::date, p.usd_cents
      FROM collection_items c
      JOIN printings p ON p.scryfall_id = c.printing_id
     WHERE p.game <> 'mtg'
       AND p.usd_cents IS NOT NULL
    ON CONFLICT (printing_id, finish, source, snapshot_date) DO UPDATE
      SET price_cents = EXCLUDED.price_cents
  `);

  return result.rowCount ?? 0;
}

/**
 * Prices everything owned and records both snapshots.
 *
 * Returns what it found rather than only logging it, so the script can report
 * coverage and the smoke test can assert on it.
 */
export async function takeSnapshot(options?: {
  source?: PriceSource;
  /** Overrides today's date. Only the smoke test passes this. */
  snapshotDate?: string;
}): Promise<SnapshotResult> {
  const source = options?.source ?? DEFAULT_PRICE_SOURCE;
  const db = getDb();

  const owned = await listOwnedPairs();

  // The database's date, not this machine's: the job runs in a container in
  // whatever region Cloud Run put it, and a snapshot dated "yesterday" by a
  // UTC-offset difference would make two rows for one run.
  const snapshotDate =
    options?.snapshotDate ??
    (
      await db.execute<{ today: string }>(
        sql`SELECT current_date::text AS today`,
      )
    ).rows[0].today;

  /*
   * The games that price themselves go first, and unconditionally.
   *
   * It is a database-only statement, so it costs nothing when there is
   * nothing to write — and running it before the early return below is what
   * keeps a collection holding no Magic at all from being recorded as worth
   * zero. `owned` is Magic's pairs now, so its emptiness says nothing about
   * whether the collection is empty.
   */
  const catalogPriced = await writeCatalogPriceSnapshots(snapshotDate, source);

  if (owned.length === 0) {
    // An empty collection is not an error, and it still deserves a row: a
    // zero in the history is the difference between "worth nothing" and "the
    // job never ran", which is exactly what the chart needs to tell apart.
    const totals = await writeValueSnapshotFromPrices(snapshotDate, source);
    return {
      snapshotDate,
      owned: 0,
      priced: catalogPriced,
      unpriced: [],
      notFound: [],
      ...totals,
    };
  }

  const ids = [...new Set(owned.map((p) => p.printingId))];
  const { cards, notFound } = await getCardsByIds(ids);

  const { priced, unpriced } = projectPrices(owned, cards);

  if (priced.length > 0)
    await writePriceSnapshots(snapshotDate, source, priced);

  const totals = await writeValueSnapshotFromPrices(snapshotDate, source);

  return {
    snapshotDate,
    owned: owned.length,
    priced: priced.length + catalogPriced,
    unpriced,
    notFound,
    ...totals,
  };
}

/** Upserts one day's price rows in a single statement. */
async function writePriceSnapshots(
  snapshotDate: string,
  source: PriceSource,
  rows: PriceRow[],
): Promise<void> {
  const db = getDb();

  /*
   * Chunked, because this is the one query here whose size follows the
   * collection. Each row is four bound parameters and Postgres caps a
   * statement at 65535, so a collection past ~16k distinct printing-finish
   * pairs would fail on a limit that has nothing to do with the data.
   */
  const CHUNK = 2_000;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    const values = sql.join(
      batch.map(
        (r) =>
          sql`(${r.printingId}::uuid, ${r.finish}, ${source}, ${snapshotDate}::date, ${r.priceCents})`,
      ),
      sql`, `,
    );

    await db.execute(sql`
      INSERT INTO price_snapshots
        (printing_id, finish, source, snapshot_date, price_cents)
      VALUES ${values}
      ON CONFLICT (printing_id, finish, source, snapshot_date) DO UPDATE
        SET price_cents = EXCLUDED.price_cents
    `);
  }
}

/**
 * Computes and stores the collection's total value for the date.
 *
 * The total is computed in SQL from the rows just written, joined against the
 * quantities as they are *now* — which is the whole point of storing it. A
 * month from now, multiplying today's prices by then-current quantities would
 * answer a different question, and there is no quantity history to recover
 * this one from.
 */
async function writeValueSnapshotFromPrices(
  snapshotDate: string,
  source: PriceSource,
): Promise<{
  totalCents: number;
  pricedCopies: number;
  unpricedCopies: number;
  unpricedItems: number;
}> {
  const db = getDb();

  const { rows } = await db.execute<{
    total_cents: number;
    priced_copies: number;
    unpriced_copies: number;
    unpriced_items: number;
  }>(sql`
    SELECT coalesce(sum(c.quantity * s.price_cents), 0)::int AS total_cents,
           coalesce(sum(c.quantity) FILTER (WHERE s.price_cents IS NOT NULL), 0)::int
             AS priced_copies,
           coalesce(sum(c.quantity) FILTER (WHERE s.price_cents IS NULL), 0)::int
             AS unpriced_copies,
           /*
            * Counted here rather than passed in.
            *
            * It used to be the length of the list Scryfall had no price for,
            * which was the same number while Magic was the only game. It no
            * longer is: a Pokémon card has no price from anywhere, and it
            * never reaches Scryfall to be counted as missing one. Deriving
            * it from the same join as the copies keeps the two consistent,
            * whatever the cards are.
            */
           count(DISTINCT (c.printing_id, c.finish))
             FILTER (WHERE s.price_cents IS NULL)::int AS unpriced_items
      FROM collection_items c
      LEFT JOIN price_snapshots s
             ON s.printing_id = c.printing_id
            AND s.finish = c.finish
            AND s.source = ${source}
            AND s.snapshot_date = ${snapshotDate}::date
  `);

  const totals = {
    totalCents: rows[0]?.total_cents ?? 0,
    pricedCopies: rows[0]?.priced_copies ?? 0,
    unpricedCopies: rows[0]?.unpriced_copies ?? 0,
    unpricedItems: rows[0]?.unpriced_items ?? 0,
  };

  await writeValueSnapshot(snapshotDate, source, totals);

  return totals;
}

async function writeValueSnapshot(
  snapshotDate: string,
  source: PriceSource,
  totals: {
    totalCents: number;
    pricedCopies: number;
    unpricedCopies: number;
    unpricedItems: number;
  },
): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    INSERT INTO value_snapshots
      (snapshot_date, source, total_cents, priced_copies, unpriced_copies,
       unpriced_items)
    VALUES (${snapshotDate}::date, ${source}, ${totals.totalCents},
            ${totals.pricedCopies}, ${totals.unpricedCopies},
            ${totals.unpricedItems})
    ON CONFLICT (snapshot_date, source) DO UPDATE
      SET total_cents     = EXCLUDED.total_cents,
          priced_copies   = EXCLUDED.priced_copies,
          unpriced_copies = EXCLUDED.unpriced_copies,
          unpriced_items  = EXCLUDED.unpriced_items
  `);
}
