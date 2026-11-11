/**
 * End-to-end check of the price layer: `npm run prices:smoke`
 *
 * Needs a loaded card database and network access to Scryfall. It writes (the
 * collection, price snapshots and value snapshots) and asserts everything is
 * back where it started.
 *
 * The unit tests in lib/prices/project.test.ts cover the parsing. What they
 * cannot cover is everything that only exists as SQL or as a real HTTP call:
 * that `POST /cards/collection` still returns the shape this depends on, that
 * a snapshot is idempotent per day, and that the movers query compares the
 * right two dates when the job's cadence never lands exactly on the window.
 *
 * It fabricates two older snapshot dates rather than waiting a month for real
 * ones. That is the only way to test "what moved" at all, and the dates it
 * writes are for its own printings and are deleted at the end.
 */
import assert from "node:assert/strict";

import { config } from "dotenv";

config({ path: ".env.local" });

const TEST_LOCATION = "Prices Smoke Shelf";

let passed = 0;
function check(label: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok  ${label}`);
}

async function main() {
  const [
    { getDb },
    { sql },
    snapshot,
    queries,
    constants,
    collection,
    colQueries,
  ] = await Promise.all([
    import("../lib/db"),
    import("drizzle-orm"),
    import("../lib/prices/snapshot"),
    import("../lib/prices/queries"),
    import("../lib/prices/constants"),
    import("../lib/collection/mutations"),
    import("../lib/collection/queries"),
  ]);

  const db = getDb();
  const SOURCE = constants.DEFAULT_PRICE_SOURCE;

  // ---- pre-clean anything an interrupted run left behind ------------------
  const { rows: staleLocations } = await db.execute<{ id: string }>(
    sql`SELECT id::text AS id FROM locations WHERE name = ${TEST_LOCATION}`,
  );
  for (const row of staleLocations) {
    await db.execute(
      sql`DELETE FROM collection_items WHERE location_id = ${row.id}::uuid`,
    );
    await db.execute(sql`DELETE FROM locations WHERE id = ${row.id}::uuid`);
  }

  const startTotals = await colQueries.getCollectionTotals();

  /* -- pick real, priced printings ---------------------------------------- */

  // Cards Scryfall is near-certain to have a usd price for: heavily reprinted
  // staples. Chosen from the database rather than hardcoded so this keeps
  // working as the card data moves on.
  const { rows: picks } = await db.execute<{
    id: string;
    name: string;
    set_code: string;
    collector_number: string;
  }>(sql`
    SELECT p.scryfall_id::text AS id, o.name, p.set_code, p.collector_number
      FROM printings p
      JOIN oracle_cards o ON o.oracle_id = p.oracle_id
      JOIN sets s ON s.code = p.set_code
     WHERE o.edhrec_rank IS NOT NULL
       AND NOT p.is_extra AND NOT p.is_promo AND NOT s.digital
       AND p.collector_number ~ '^[0-9]+$'
       AND 'nonfoil' = ANY(p.finishes)
     ORDER BY o.edhrec_rank ASC, p.released_at DESC NULLS LAST
     LIMIT 3
  `);
  assert.equal(
    picks.length,
    3,
    "no priced printings found — is the card database loaded?",
  );
  console.log(
    `\nusing ${picks.map((p) => `${p.name} (${p.set_code.toUpperCase()} #${p.collector_number})`).join(", ")}\n`,
  );

  /* -- 1. an empty collection still records a zero ------------------------ */

  const empty = await snapshot.takeSnapshot({ snapshotDate: "2001-01-01" });
  check("an empty collection records a zero rather than nothing", () => {
    // A missing row and a zero mean different things to a chart: "the job
    // never ran" versus "it ran and you owned nothing".
    assert.equal(empty.owned, 0);
    assert.equal(empty.totalCents, 0);
  });

  const { rows: zeroRow } = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM value_snapshots
     WHERE snapshot_date = '2001-01-01'::date AND source = ${SOURCE}
  `);
  check("the zero is stored", () => assert.equal(zeroRow[0].n, 1));

  /* -- 2. a real snapshot over owned cards -------------------------------- */

  const locationResult = await collection.createLocation(TEST_LOCATION, "box");
  assert.equal(locationResult.ok, true, JSON.stringify(locationResult));
  if (!locationResult.ok) throw new Error("unreachable");
  const locationId = locationResult.id;

  // Two copies of the first, one each of the others — so the total is a real
  // multiplication rather than a sum of ones.
  const quantities = [2, 1, 1];
  for (const [i, pick] of picks.entries()) {
    const added = await collection.addCopies({
      printingId: pick.id,
      finish: "nonfoil",
      condition: "NM",
      locationId,
      quantity: quantities[i],
    });
    assert.equal(added.ok, true, JSON.stringify(added));
  }

  const today = await snapshot.takeSnapshot();

  check("every owned printing/finish pair was looked up", () =>
    assert.equal(today.owned, 3),
  );
  check("Scryfall recognised all three printings", () =>
    assert.deepEqual(today.notFound, []),
  );
  check("all three were priced", () => {
    // If this fails on a specific card rather than on all three, Scryfall has
    // simply stopped pricing it; the unpriced list names which.
    assert.equal(today.priced, 3, JSON.stringify(today.unpriced));
  });
  check("the total is quantity-weighted, not a count of cards", () => {
    assert.equal(today.pricedCopies, 4);
    assert.ok(today.totalCents > 0, "a total of zero means no price applied");
  });

  const { rows: storedRows } = await db.execute<{
    n: number;
    sum: number;
  }>(sql`
    SELECT count(*)::int AS n, coalesce(sum(price_cents), 0)::int AS sum
      FROM price_snapshots
     WHERE snapshot_date = ${today.snapshotDate}::date AND source = ${SOURCE}
  `);
  check("one price row per owned pair", () => assert.equal(storedRows[0].n, 3));

  /* -- 3. idempotence ----------------------------------------------------- */

  const again = await snapshot.takeSnapshot();
  const { rows: afterAgain } = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM price_snapshots
     WHERE snapshot_date = ${today.snapshotDate}::date AND source = ${SOURCE}
  `);
  check(
    "running twice in a day updates rather than duplicating or failing",
    () => {
      // The primary key would reject a second insert outright; a retry after a
      // half-finished run has to be safe.
      assert.equal(afterAgain[0].n, 3);
      assert.equal(again.totalCents, today.totalCents);
    },
  );

  const { rows: valueDayRows } = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM value_snapshots
     WHERE snapshot_date = ${today.snapshotDate}::date AND source = ${SOURCE}
  `);
  check("and the day has exactly one value row", () =>
    assert.equal(valueDayRows[0].n, 1),
  );

  /* -- 4. the read side --------------------------------------------------- */

  const totals = await queries.getValueTotals();
  check("the totals read back the latest snapshot", () => {
    assert.equal(totals.asOf, today.snapshotDate);
    assert.equal(totals.totalCents, today.totalCents);
    assert.equal(totals.pricedCopies, 4);
  });

  const valuable = await queries.getMostValuable();
  check("the most valuable holdings are quantity-weighted and sorted", () => {
    assert.ok(valuable.length >= 3, JSON.stringify(valuable));
    const mine = valuable.filter((v) => picks.some((p) => p.name === v.name));
    assert.ok(mine.length >= 3);
    for (const row of mine) {
      assert.equal(row.totalCents, row.unitCents * row.quantity);
    }
    const sorted = [...valuable].sort((a, b) => b.totalCents - a.totalCents);
    assert.deepEqual(
      valuable.map((v) => v.totalCents),
      sorted.map((v) => v.totalCents),
    );
  });

  /* -- 5. movers, against fabricated history ------------------------------ */

  /*
   * Two older dates, both outside the movers window, with the *older* one
   * closer to the real price. The query must use the newer of the two — the
   * most recent snapshot at or before the cutoff — because a weekly job never
   * lands exactly on the cutoff date. Picking the wrong one, or testing for
   * equality with the cutoff, is the mistake this is here to catch.
   */
  const window = constants.MOVERS_WINDOW_DAYS;
  const first = picks[0];

  await db.execute(sql`
    INSERT INTO price_snapshots
      (printing_id, finish, source, snapshot_date, price_cents)
    VALUES
      (${first.id}::uuid, 'nonfoil', ${SOURCE},
       ${today.snapshotDate}::date - ${window + 40}::int, 1),
      (${first.id}::uuid, 'nonfoil', ${SOURCE},
       ${today.snapshotDate}::date - ${window + 3}::int, 50)
    ON CONFLICT (printing_id, finish, source, snapshot_date) DO UPDATE
      SET price_cents = EXCLUDED.price_cents
  `);

  const { gainers, losers } = await queries.getMovers();
  const moved = [...gainers, ...losers].find((m) => m.name === first.name);

  check(
    "a mover compares against the newest snapshot inside the window",
    () => {
      assert.ok(moved, "the card with fabricated history is not in the movers");
      // 50 cents, from the nearer of the two old dates — not 1 cent from the
      // older one, and not nothing from an exact-date match.
      assert.equal(moved.fromCents, 50);
    },
  );

  check("a mover's holding delta is multiplied by the copies owned", () => {
    assert.ok(moved);
    assert.equal(moved.quantity, 2);
    assert.equal(
      moved.holdingDeltaCents,
      (moved.toCents - moved.fromCents) * 2,
    );
  });

  check("the gain or loss lands in the right list", () => {
    assert.ok(moved);
    const inGainers = gainers.some((g) => g.name === first.name);
    assert.equal(inGainers, moved.holdingDeltaCents > 0);
  });

  /* -- 6. history and acquisition ----------------------------------------- */

  const history = await queries.getValueHistory();
  check("the history is oldest-first and includes the fabricated zero", () => {
    assert.ok(history.length >= 2);
    const dates = history.map((h) => h.date);
    assert.deepEqual(dates, [...dates].sort());
    assert.ok(dates.includes("2001-01-01"));
  });

  const beforePrice = await queries.getAcquisitionSummary();
  check("nothing is compared against market until a price was recorded", () =>
    // Every copy here was entered without an acquisition price.
    assert.equal(beforePrice.knownCopies, 0),
  );

  // Record what one of them "cost", then re-ask.
  await db.execute(sql`
    UPDATE collection_items SET acquired_price_cents = 100
     WHERE location_id = ${locationId}::uuid
       AND printing_id = ${first.id}::uuid
  `);

  const acquisition = await queries.getAcquisitionSummary();
  check("spent against market covers only rows that have both numbers", () => {
    // Two copies at a dollar. The other cards have no acquisition price and
    // must not be counted as free — that would read as pure profit.
    assert.equal(acquisition.knownCopies, 2);
    assert.equal(acquisition.spentCents, 200);
    assert.ok(acquisition.marketCents > 0);
    assert.equal(acquisition.unknownCopies, 2);
  });

  /* -- 7. clean up and prove nothing was left behind ---------------------- */

  await db.execute(sql`
    DELETE FROM price_snapshots
     WHERE printing_id IN (
       SELECT c.printing_id FROM collection_items c
        WHERE c.location_id = ${locationId}::uuid
     )
  `);
  await db.execute(sql`
    DELETE FROM value_snapshots
     WHERE snapshot_date IN ('2001-01-01'::date, ${today.snapshotDate}::date)
  `);
  await db.execute(
    sql`DELETE FROM collection_items WHERE location_id = ${locationId}::uuid`,
  );

  const locationGone = await collection.deleteLocation(locationId);
  assert.equal(locationGone.ok, true, JSON.stringify(locationGone));

  const endTotals = await colQueries.getCollectionTotals();

  /*
   * Asserted against the rows this run wrote, not against a global count.
   * A global before/after equality is wrong twice over: an interrupted run
   * leaves snapshots behind and makes the *next* run's arithmetic fail for a
   * reason that has nothing to do with the code, and a real weekly snapshot
   * taken between the two counts would do the same.
   */
  const ids = sql.join(
    picks.map((p) => sql`${p.id}::uuid`),
    sql`, `,
  );
  const { rows: endSnapRows } = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM price_snapshots
     WHERE printing_id IN (${ids})
  `);

  check("no price snapshots left behind for this run's cards", () =>
    assert.equal(endSnapRows[0].n, 0),
  );
  check("the collection is back exactly where it started", () =>
    assert.equal(endTotals.totalCopies, startTotals.totalCopies),
  );

  console.log(`\n${passed} checks passed.`);
}

main()
  .catch((error) => {
    console.error("\nFAILED\n", error);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
