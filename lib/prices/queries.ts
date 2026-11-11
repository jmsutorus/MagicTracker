import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";

import {
  DEFAULT_PRICE_SOURCE,
  MOVERS_LIMIT,
  MOVERS_WINDOW_DAYS,
  type PriceSource,
} from "./constants";

/**
 * Reading the value of a collection.
 *
 * Everything here is "at the latest snapshot", never "live": prices come from
 * a weekly job, so the honest thing is to report the date they were taken
 * alongside every number. A page that showed a total with no date would imply
 * it was current.
 */

export type ValueTotals = {
  /** The date of the most recent snapshot, or null if none has run. */
  asOf: string | null;
  totalCents: number;
  /** Copies with a price at that snapshot, and copies without. */
  pricedCopies: number;
  unpricedCopies: number;
  /** Distinct (printing, finish) pairs with no price. */
  unpricedItems: number;
  /** The previous snapshot, for the headline change. */
  previousDate: string | null;
  previousCents: number | null;
};

export async function getValueTotals(
  source: PriceSource = DEFAULT_PRICE_SOURCE,
): Promise<ValueTotals> {
  const db = getDb();

  const { rows } = await db.execute<{
    snapshot_date: string;
    total_cents: number;
    priced_copies: number;
    unpriced_copies: number;
    unpriced_items: number;
    previous_date: string | null;
    previous_cents: number | null;
  }>(sql`
    WITH ordered AS (
      SELECT snapshot_date::text AS snapshot_date,
             total_cents, priced_copies, unpriced_copies, unpriced_items,
             /*
              * The previous row by date, not "the row 7 days ago": the job is
              * weekly but a missed or manual run would make a fixed offset
              * compare against nothing.
              */
             lag(total_cents) OVER (ORDER BY snapshot_date) AS previous_cents,
             lag(snapshot_date::text) OVER (ORDER BY snapshot_date)
               AS previous_date
        FROM value_snapshots
       WHERE source = ${source}
    )
    SELECT * FROM ordered ORDER BY snapshot_date DESC LIMIT 1
  `);

  const row = rows[0];
  if (!row) {
    return {
      asOf: null,
      totalCents: 0,
      pricedCopies: 0,
      unpricedCopies: 0,
      unpricedItems: 0,
      previousDate: null,
      previousCents: null,
    };
  }

  return {
    asOf: row.snapshot_date,
    totalCents: row.total_cents,
    pricedCopies: row.priced_copies,
    unpricedCopies: row.unpriced_copies,
    unpricedItems: row.unpriced_items,
    previousDate: row.previous_date,
    previousCents: row.previous_cents,
  };
}

export type ValuePoint = { date: string; cents: number };

/**
 * The value history, oldest first.
 *
 * Read straight out of `value_snapshots` rather than recomputed from
 * `price_snapshots`, and that distinction is the point: recomputing would
 * multiply *today's* quantities by each past week's prices, which answers
 * "what would what I own now have cost then" — a different question that
 * drifts further from the truth with every card added.
 */
export async function getValueHistory(
  source: PriceSource = DEFAULT_PRICE_SOURCE,
  limit = 260,
): Promise<ValuePoint[]> {
  const db = getDb();
  const { rows } = await db.execute<{ date: string; cents: number }>(sql`
    SELECT snapshot_date::text AS date, total_cents AS cents
      FROM (
        SELECT snapshot_date, total_cents
          FROM value_snapshots
         WHERE source = ${source}
         ORDER BY snapshot_date DESC
         LIMIT ${limit}
      ) recent
     ORDER BY snapshot_date ASC
  `);
  return rows;
}

export type MoverRow = {
  printingId: string;
  oracleId: string;
  name: string;
  setCode: string;
  collectorNumber: string;
  finish: string;
  quantity: number;
  /** Price per copy, then and now. */
  fromCents: number;
  toCents: number;
  /** Change per copy, and across the copies owned. */
  deltaCents: number;
  holdingDeltaCents: number;
  fromDate: string;
  toDate: string;
};

/**
 * What moved, over roughly the last MOVERS_WINDOW_DAYS.
 *
 * Ordered by the change across the copies owned, not by the change per copy:
 * thirty basic lands going up a nickel matters more to a collection's value
 * than one card going up a dollar, and this page is about the collection.
 */
export async function getMovers(
  source: PriceSource = DEFAULT_PRICE_SOURCE,
  limit = MOVERS_LIMIT,
): Promise<{ gainers: MoverRow[]; losers: MoverRow[] }> {
  const db = getDb();

  const { rows } = await db.execute<{
    printing_id: string;
    oracle_id: string;
    name: string;
    set_code: string;
    collector_number: string;
    finish: string;
    quantity: number;
    from_cents: number;
    to_cents: number;
    delta_cents: number;
    holding_delta_cents: number;
    from_date: string;
    to_date: string;
  }>(sql`
    WITH latest AS (
      SELECT max(snapshot_date) AS d FROM value_snapshots WHERE source = ${source}
    ),
    /*
     * The newest snapshot at or before the cutoff, per card — not the
     * snapshot exactly N days ago. A weekly job never lands on the cutoff,
     * and a card bought last week has no row that far back, so an equality
     * test would return almost nothing.
     */
    now_prices AS (
      SELECT s.printing_id, s.finish, s.price_cents, s.snapshot_date
        FROM price_snapshots s, latest
       WHERE s.source = ${source} AND s.snapshot_date = latest.d
    ),
    then_prices AS (
      SELECT DISTINCT ON (s.printing_id, s.finish)
             s.printing_id, s.finish, s.price_cents, s.snapshot_date
        FROM price_snapshots s, latest
       WHERE s.source = ${source}
         -- ::int, because a bare parameter next to a date is ambiguous:
         -- Postgres resolves date-minus-unknown as date-minus-date, which
         -- yields an integer and then fails against a date column.
         -- (No backticks in this comment: the whole query is a template
         -- literal, as in lib/cards/search.ts.)
         AND s.snapshot_date <= latest.d - ${MOVERS_WINDOW_DAYS}::int
       ORDER BY s.printing_id, s.finish, s.snapshot_date DESC
    ),
    owned AS (
      SELECT c.printing_id, c.finish, sum(c.quantity)::int AS quantity
        FROM collection_items c
       GROUP BY c.printing_id, c.finish
    )
    SELECT n.printing_id::text AS printing_id,
           p.oracle_id::text   AS oracle_id,
           o.name,
           p.set_code,
           p.collector_number,
           n.finish,
           owned.quantity,
           t.price_cents AS from_cents,
           n.price_cents AS to_cents,
           (n.price_cents - t.price_cents) AS delta_cents,
           (n.price_cents - t.price_cents) * owned.quantity
             AS holding_delta_cents,
           t.snapshot_date::text AS from_date,
           n.snapshot_date::text AS to_date
      FROM now_prices n
      JOIN then_prices t ON t.printing_id = n.printing_id
                        AND t.finish = n.finish
      JOIN owned ON owned.printing_id = n.printing_id
                AND owned.finish = n.finish
      JOIN printings p ON p.scryfall_id = n.printing_id
      JOIN oracle_cards o ON o.oracle_id = p.oracle_id
     WHERE n.price_cents <> t.price_cents
     ORDER BY abs((n.price_cents - t.price_cents) * owned.quantity) DESC
     LIMIT ${limit * 2}
  `);

  const all: MoverRow[] = rows.map((r) => ({
    printingId: r.printing_id,
    oracleId: r.oracle_id,
    name: r.name,
    setCode: r.set_code,
    collectorNumber: r.collector_number,
    finish: r.finish,
    quantity: r.quantity,
    fromCents: r.from_cents,
    toCents: r.to_cents,
    deltaCents: r.delta_cents,
    holdingDeltaCents: r.holding_delta_cents,
    fromDate: r.from_date,
    toDate: r.to_date,
  }));

  return {
    gainers: all
      .filter((m) => m.holdingDeltaCents > 0)
      .sort((a, b) => b.holdingDeltaCents - a.holdingDeltaCents)
      .slice(0, limit),
    losers: all
      .filter((m) => m.holdingDeltaCents < 0)
      .sort((a, b) => a.holdingDeltaCents - b.holdingDeltaCents)
      .slice(0, limit),
  };
}

export type AcquisitionSummary = {
  /** Copies whose purchase price was recorded, and what was paid. */
  knownCopies: number;
  spentCents: number;
  /** What those same copies are worth now. */
  marketCents: number;
  /** Copies with no recorded price — the rest of the collection. */
  unknownCopies: number;
};

/**
 * Spent against market, over the copies where both are known.
 *
 * Restricted to rows that have *both* numbers on purpose. Comparing
 * everything-spent against everything-owned would read as a profit figure
 * while silently treating every card with no recorded price as free, which
 * for a collection entered without prices means the whole thing.
 */
export async function getAcquisitionSummary(
  source: PriceSource = DEFAULT_PRICE_SOURCE,
): Promise<AcquisitionSummary> {
  const db = getDb();

  const { rows } = await db.execute<{
    known_copies: number;
    spent_cents: number;
    market_cents: number;
    unknown_copies: number;
  }>(sql`
    WITH latest AS (
      SELECT max(snapshot_date) AS d FROM value_snapshots WHERE source = ${source}
    ),
    priced AS (
      SELECT c.quantity, c.acquired_price_cents, s.price_cents
        FROM collection_items c
        LEFT JOIN latest ON true
        LEFT JOIN price_snapshots s
               ON s.printing_id = c.printing_id
              AND s.finish = c.finish
              AND s.source = ${source}
              AND s.snapshot_date = latest.d
    )
    SELECT coalesce(sum(quantity) FILTER (
             WHERE acquired_price_cents IS NOT NULL AND price_cents IS NOT NULL
           ), 0)::int AS known_copies,
           coalesce(sum(quantity * acquired_price_cents) FILTER (
             WHERE acquired_price_cents IS NOT NULL AND price_cents IS NOT NULL
           ), 0)::int AS spent_cents,
           coalesce(sum(quantity * price_cents) FILTER (
             WHERE acquired_price_cents IS NOT NULL AND price_cents IS NOT NULL
           ), 0)::int AS market_cents,
           coalesce(sum(quantity) FILTER (
             WHERE acquired_price_cents IS NULL
           ), 0)::int AS unknown_copies
      FROM priced
  `);

  return {
    knownCopies: rows[0]?.known_copies ?? 0,
    spentCents: rows[0]?.spent_cents ?? 0,
    marketCents: rows[0]?.market_cents ?? 0,
    unknownCopies: rows[0]?.unknown_copies ?? 0,
  };
}

export type ValuableRow = {
  oracleId: string;
  name: string;
  setCode: string;
  collectorNumber: string;
  finish: string;
  quantity: number;
  unitCents: number;
  totalCents: number;
};

/** The most valuable holdings at the latest snapshot. */
export async function getMostValuable(
  source: PriceSource = DEFAULT_PRICE_SOURCE,
  limit = 15,
): Promise<ValuableRow[]> {
  const db = getDb();

  const { rows } = await db.execute<{
    oracle_id: string;
    name: string;
    set_code: string;
    collector_number: string;
    finish: string;
    quantity: number;
    unit_cents: number;
    total_cents: number;
  }>(sql`
    WITH latest AS (
      SELECT max(snapshot_date) AS d FROM value_snapshots WHERE source = ${source}
    )
    SELECT p.oracle_id::text AS oracle_id,
           o.name,
           p.set_code,
           p.collector_number,
           c.finish,
           sum(c.quantity)::int AS quantity,
           s.price_cents AS unit_cents,
           (sum(c.quantity) * s.price_cents)::int AS total_cents
      FROM collection_items c
      JOIN latest ON true
      JOIN price_snapshots s
             ON s.printing_id = c.printing_id
            AND s.finish = c.finish
            AND s.source = ${source}
            AND s.snapshot_date = latest.d
      JOIN printings p ON p.scryfall_id = c.printing_id
      JOIN oracle_cards o ON o.oracle_id = p.oracle_id
     GROUP BY p.oracle_id, o.name, p.set_code, p.collector_number, c.finish,
              s.price_cents
     ORDER BY total_cents DESC, o.name ASC
     LIMIT ${limit}
  `);

  return rows.map((r) => ({
    oracleId: r.oracle_id,
    name: r.name,
    setCode: r.set_code,
    collectorNumber: r.collector_number,
    finish: r.finish,
    quantity: r.quantity,
    unitCents: r.unit_cents,
    totalCents: r.total_cents,
  }));
}

/** When the price job last ran, for the "as of" line and the dashboard. */
export async function getLastPriceRun(): Promise<{
  startedAt: string;
  status: string;
  rowCount: number | null;
} | null> {
  const db = getDb();
  const { rows } = await db.execute<{
    started_at: string;
    status: string;
    row_count: number | null;
  }>(sql`
    SELECT started_at::text AS started_at, status, row_count
      FROM ingest_runs
     WHERE source = 'prices'
     ORDER BY started_at DESC
     LIMIT 1
  `);

  const row = rows[0];
  return row
    ? { startedAt: row.started_at, status: row.status, rowCount: row.row_count }
    : null;
}

export type PriceHistorySeries = {
  printingId: string;
  setCode: string;
  collectorNumber: string;
  finish: string;
  /** Copies of this exact (printing, finish) in the collection. */
  copies: number;
  /** Oldest first, one point per weekly snapshot. */
  points: ValuePoint[];
  latestCents: number | null;
  /** Change from the first recorded point to the latest, in cents. */
  changeCents: number | null;
};

/**
 * Price history for the copies of one card you actually own.
 *
 * Only owned printings have history: `price_snapshots` is written from the
 * collection, so asking for a card you do not own correctly returns nothing
 * rather than an empty chart implying the data went missing.
 *
 * Returned per (printing, finish) and never summed across them. A foil and a
 * nonfoil of the same card are two different markets, and averaging them
 * would draw a line that no copy ever traded at.
 */
export async function getOwnedPriceHistory(
  oracleId: string,
  source: PriceSource = DEFAULT_PRICE_SOURCE,
  limit = 3,
): Promise<PriceHistorySeries[]> {
  const db = getDb();

  const { rows } = await db.execute<{
    printing_id: string;
    set_code: string;
    collector_number: string;
    finish: string;
    copies: number;
    date: string | null;
    cents: number | null;
  }>(sql`
    WITH owned AS (
      SELECT c.printing_id, c.finish, sum(c.quantity)::int AS copies
        FROM collection_items c
        JOIN printings p ON p.scryfall_id = c.printing_id
       WHERE p.oracle_id = ${oracleId}::uuid
       GROUP BY c.printing_id, c.finish
    )
    SELECT o.printing_id::text AS printing_id,
           p.set_code,
           p.collector_number,
           o.finish,
           o.copies,
           ps.snapshot_date::text AS date,
           ps.price_cents AS cents
      FROM owned o
      JOIN printings p ON p.scryfall_id = o.printing_id
      LEFT JOIN price_snapshots ps
             ON ps.printing_id = o.printing_id
            AND ps.finish = o.finish
            AND ps.source = ${source}
     ORDER BY o.copies DESC,
              p.set_code ASC,
              p.collector_number ASC,
              o.finish ASC,
              ps.snapshot_date ASC
  `);

  const byPair = new Map<string, PriceHistorySeries>();

  for (const row of rows) {
    const key = `${row.printing_id}:${row.finish}`;
    let series = byPair.get(key);
    if (!series) {
      series = {
        printingId: row.printing_id,
        setCode: row.set_code,
        collectorNumber: row.collector_number,
        finish: row.finish,
        copies: row.copies,
        points: [],
        latestCents: null,
        changeCents: null,
      };
      byPair.set(key, series);
    }
    // A LEFT JOIN row with no snapshot is an owned card the price job has
    // not covered yet: the pair is real, the history is empty.
    if (row.date !== null && row.cents !== null) {
      series.points.push({ date: row.date, cents: row.cents });
    }
  }

  const all = [...byPair.values()];
  for (const series of all) {
    const first = series.points[0];
    const last = series.points[series.points.length - 1];
    series.latestCents = last ? last.cents : null;
    series.changeCents =
      first && last && series.points.length > 1 ? last.cents - first.cents : null;
  }

  return all.slice(0, limit);
}
