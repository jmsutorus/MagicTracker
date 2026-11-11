/**
 * End-to-end check of the three price-aware features: `npm run wishlist:smoke`
 *
 *   - cost to finish a set (completion × the prices on `printings`)
 *   - the wishlist (storage, pricing, "you already own this")
 *   - price history for a card you own (`price_snapshots`)
 *
 * Needs a loaded card database. It writes — a location, a few collection
 * rows, wishlist rows and some dated price snapshots — and asserts that
 * everything it touched is back where it started.
 *
 * It exists because all three features are joins against data the unit tests
 * fake: a price that is null for one finish and not another, a wish that
 * names a printing versus one that doesn't, and an owned pair that has no
 * snapshot yet. Those are only wrong in the presence of the real shapes.
 */
import assert from "node:assert/strict";

import { config } from "dotenv";

config({ path: ".env.local" });

const TEST_LOCATION = "Wishlist Smoke Shelf";
/** Printed in a lot of sets, cheap, and exists in both finishes. */
const CARD = "Llanowar Elves";
const OTHER_CARD = "Giant Growth";

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
    wishQueries,
    wishMutations,
    completion,
    prices,
    collection,
    colQueries,
    exportBuild,
  ] = await Promise.all([
    import("../lib/db"),
    import("drizzle-orm"),
    import("../lib/wishlist/queries"),
    import("../lib/wishlist/mutations"),
    import("../lib/completion/queries"),
    import("../lib/prices/queries"),
    import("../lib/collection/mutations"),
    import("../lib/collection/queries"),
    import("../lib/export/build"),
  ]);

  const db = getDb();

  // --- starting state, to restore and assert against at the end ------------

  const startingCounts = await counts();
  async function counts() {
    const { rows } = await db.execute<{
      items: string;
      copies: string;
      wishes: string;
      locations: string;
      snapshots: string;
    }>(sql`
      SELECT (SELECT count(*) FROM collection_items)::text              AS items,
             (SELECT coalesce(sum(quantity), 0) FROM collection_items)::text AS copies,
             (SELECT count(*) FROM wishlist_items)::text                AS wishes,
             (SELECT count(*) FROM locations)::text                     AS locations,
             (SELECT count(*) FROM price_snapshots)::text               AS snapshots
    `);
    return rows[0]!;
  }

  console.log(
    `starting: ${startingCounts.items} items, ${startingCounts.copies} copies, ` +
      `${startingCounts.wishes} wishes, ${startingCounts.snapshots} snapshots`,
  );

  // --- the fixtures ---------------------------------------------------------

  const { rows: printingRows } = await db.execute<{
    scryfall_id: string;
    oracle_id: string;
    set_code: string;
    collector_number: string;
    usd_cents: number | null;
    usd_foil_cents: number | null;
  }>(sql`
    SELECT scryfall_id::text AS scryfall_id,
           oracle_id::text   AS oracle_id,
           set_code, collector_number, usd_cents, usd_foil_cents
      FROM printings
     WHERE name = ${CARD}
       AND lang = 'en'
       AND usd_cents IS NOT NULL
     ORDER BY usd_cents ASC
     LIMIT 3
  `);
  assert.ok(
    printingRows.length >= 2,
    `need at least two priced printings of ${CARD}; the card ingest may not have run since the price columns were added`,
  );

  const cheapest = printingRows[0]!;
  const dearer = printingRows[printingRows.length - 1]!;

  const { rows: otherRows } = await db.execute<{
    oracle_id: string;
    scryfall_id: string;
  }>(sql`
    SELECT oracle_id::text AS oracle_id, scryfall_id::text AS scryfall_id
      FROM printings
     WHERE name = ${OTHER_CARD} AND lang = 'en'
     LIMIT 1
  `);
  const other = otherRows[0]!;
  assert.ok(other, `no printing found for ${OTHER_CARD}`);

  const location = await collection.createLocation(TEST_LOCATION, "box");
  assert.ok(location.ok, "could not create the test location");
  const locationId = location.ok ? location.id : "";

  try {
    // --- the wishlist -----------------------------------------------------

    const added = await wishMutations.addWish({ oracleId: cheapest.oracle_id });
    check("a card can be wished for", () => assert.ok(added.ok));

    let list = await wishQueries.listWishlist();
    const anyPrinting = list.rows.find(
      (r) => r.oracleId === cheapest.oracle_id && r.printingId === null,
    );
    check("the wish comes back as any printing", () => {
      assert.ok(anyPrinting);
      assert.equal(anyPrinting!.printingId, null);
      assert.equal(anyPrinting!.finish, null);
      assert.equal(anyPrinting!.quantity, 1);
    });

    check("an any-printing wish is priced at the cheapest printing", () => {
      assert.notEqual(anyPrinting!.priceCents, null);
      assert.ok(
        anyPrinting!.priceCents! <= cheapest.usd_cents!,
        `expected the any-printing price (${anyPrinting!.priceCents}) to be no more than the cheapest priced printing (${cheapest.usd_cents})`,
      );
    });

    // Same card again: the quantity goes up rather than a second row.
    await wishMutations.addWish({ oracleId: cheapest.oracle_id, quantity: 2 });
    list = await wishQueries.listWishlist();
    const merged = list.rows.filter(
      (r) => r.oracleId === cheapest.oracle_id && r.printingId === null,
    );
    check("wishing for the same thing twice raises the quantity", () => {
      assert.equal(merged.length, 1);
      assert.equal(merged[0]!.quantity, 3);
    });

    // A specific printing is a different wish, NULLS NOT DISTINCT or not.
    await wishMutations.addWish({
      oracleId: dearer.oracle_id,
      printingId: dearer.scryfall_id,
      finish: "nonfoil",
      note: "  the   nice  one  ",
    });
    list = await wishQueries.listWishlist();
    const specific = list.rows.find(
      (r) => r.printingId === dearer.scryfall_id && r.finish === "nonfoil",
    );
    check("a specific printing is a separate row", () => {
      assert.ok(specific);
      assert.equal(specific!.setCode, dearer.set_code);
      assert.equal(specific!.collectorNumber, dearer.collector_number);
    });
    check("a note is collapsed and trimmed", () =>
      assert.equal(specific!.note, "the nice one"),
    );
    check("a specific printing is priced at that printing", () =>
      assert.equal(specific!.priceCents, dearer.usd_cents),
    );

    check("the total multiplies price by quantity", () => {
      const expected = list.rows.reduce(
        (n, r) => n + (r.priceCents ?? 0) * r.quantity,
        0,
      );
      assert.equal(list.totalCents, expected);
      assert.ok(list.totalCents > 0);
    });

    // --- bad input --------------------------------------------------------

    const badFinish = await wishMutations.addWish({
      oracleId: cheapest.oracle_id,
      finish: "shiny",
    });
    check("an invalid finish is refused", () =>
      assert.equal(badFinish.ok, false),
    );

    const badQuantity = await wishMutations.addWish({
      oracleId: cheapest.oracle_id,
      quantity: 0,
    });
    check("a zero quantity is refused", () =>
      assert.equal(badQuantity.ok, false),
    );

    const badCard = await wishMutations.addWish({ oracleId: "not-a-uuid" });
    check("a non-uuid card id is refused", () =>
      assert.equal(badCard.ok, false),
    );

    const unknownCard = await wishMutations.addWish({
      oracleId: "00000000-0000-4000-8000-000000000000",
    });
    check("a card not in the database is refused, not inserted", () =>
      assert.equal(unknownCard.ok, false),
    );

    // --- owning what you wished for ---------------------------------------

    const owned = await collection.addCopies({
      printingId: cheapest.scryfall_id,
      locationId,
      finish: "nonfoil",
      condition: "NM",
      quantity: 1,
    });
    assert.ok(owned.ok, "could not add the owned copy");

    list = await wishQueries.listWishlist();
    const nowOwned = list.rows.find(
      (r) => r.oracleId === cheapest.oracle_id && r.printingId === null,
    )!;
    check("an any-printing wish notices a copy arriving", () =>
      assert.equal(nowOwned.ownedCopies, 1),
    );
    check("but stays on the list, because three were wanted", () =>
      assert.equal(nowOwned.quantity, 3),
    );
    check("the summary counts rows you now own", () =>
      assert.ok(list.ownedRows >= 1),
    );

    // The specific-printing wish is for a different printing, so it is not
    // satisfied by the copy just added.
    const stillWanted = list.rows.find(
      (r) => r.printingId === dearer.scryfall_id,
    )!;
    check("a wish for another printing is not satisfied by this one", () =>
      assert.equal(stillWanted.ownedCopies, 0),
    );

    // --- clearing what you own --------------------------------------------

    await wishMutations.setWishQuantity(nowOwned.id, 1);
    const cleared = await wishMutations.clearOwnedWishes();
    check("clearing removes only the satisfied wish", () =>
      assert.equal(cleared.removed, 1),
    );

    list = await wishQueries.listWishlist();
    check("the unsatisfied wish survives the clear", () => {
      assert.ok(list.rows.some((r) => r.printingId === dearer.scryfall_id));
      assert.ok(
        !list.rows.some(
          (r) => r.oracleId === cheapest.oracle_id && r.printingId === null,
        ),
      );
    });

    // --- the export -------------------------------------------------------

    const exported = await exportBuild.buildExport();
    check("the export carries the wishlist", () => {
      assert.equal(exported.formatVersion, 3);
      assert.equal(exported.counts.wishes, list.rows.length);
      const wish = exported.wishlist.find(
        (w) => w.printingId === dearer.scryfall_id,
      );
      assert.ok(wish, "the specific wish is missing from the export");
      assert.equal(wish!.name, CARD);
      assert.equal(wish!.note, "the nice one");
    });

    // --- cost to finish a set ---------------------------------------------

    const progress = await completion.listSetProgress();
    const thisSet = progress.find((p) => p.code === cheapest.set_code);
    check("the set shows up now that a card from it is owned", () =>
      assert.ok(thisSet, `expected ${cheapest.set_code} in the progress list`),
    );
    check("missing is target minus owned", () =>
      assert.equal(thisSet!.missing, thisSet!.target - thisSet!.owned),
    );
    check("priced missing never exceeds missing", () =>
      assert.ok(thisSet!.missingPriced <= thisSet!.missing),
    );
    check("a set with priced missing cards has a cost", () => {
      if (thisSet!.missingPriced > 0) {
        assert.ok(
          thisSet!.missingCents > 0,
          "priced missing cards but a zero total",
        );
      } else {
        assert.equal(thisSet!.missingCents, 0);
      }
    });

    const missingList = await completion.listMissingPrintings(
      cheapest.set_code,
    );
    check("the missing list and the progress row agree on the count", () =>
      assert.equal(missingList.length, thisSet!.missing),
    );
    check("the missing list totals to the progress row's cost", () => {
      const summed = missingList.reduce((n, m) => n + (m.priceCents ?? 0), 0);
      assert.equal(summed, thisSet!.missingCents);
    });
    check("a missing card with no price is null, never zero", () => {
      for (const card of missingList) {
        assert.ok(
          card.priceCents === null || card.priceCents > 0,
          `${card.name} priced at ${card.priceCents}`,
        );
      }
    });

    // --- price history ----------------------------------------------------

    const noHistory = await prices.getOwnedPriceHistory(cheapest.oracle_id);
    check("an owned card with no snapshots has a pair but no points", () => {
      const pair = noHistory.find(
        (s) => s.printingId === cheapest.scryfall_id && s.finish === "nonfoil",
      );
      assert.ok(pair, "the owned pair should be listed");
      assert.equal(pair!.points.length, 0);
      assert.equal(pair!.latestCents, null);
      assert.equal(pair!.changeCents, null);
    });

    // Two dated snapshots, so the chart has something to be a line.
    await db.execute(sql`
      INSERT INTO price_snapshots (printing_id, finish, source, snapshot_date, price_cents)
      VALUES
        (${cheapest.scryfall_id}::uuid, 'nonfoil', 'scryfall-usd', DATE '2000-01-01', 100),
        (${cheapest.scryfall_id}::uuid, 'nonfoil', 'scryfall-usd', DATE '2000-01-08', 175)
    `);

    const history = await prices.getOwnedPriceHistory(cheapest.oracle_id);
    const series = history.find(
      (s) => s.printingId === cheapest.scryfall_id && s.finish === "nonfoil",
    )!;
    check("history comes back oldest first", () => {
      assert.equal(series.points.length, 2);
      assert.equal(series.points[0]!.date, "2000-01-01");
      assert.equal(series.points[1]!.date, "2000-01-08");
    });
    check("the latest price is the last point", () =>
      assert.equal(series.latestCents, 175),
    );
    check("the change is last minus first", () =>
      assert.equal(series.changeCents, 75),
    );
    check("the series knows how many copies it covers", () =>
      assert.equal(series.copies, 1),
    );

    const foreign = await prices.getOwnedPriceHistory(other.oracle_id);
    check("a card you do not own has no history at all", () =>
      assert.equal(foreign.length, 0),
    );
  } finally {
    // --- put everything back ----------------------------------------------

    await db.execute(sql`
      DELETE FROM price_snapshots
       WHERE snapshot_date IN (DATE '2000-01-01', DATE '2000-01-08')
    `);
    await db.execute(sql`
      DELETE FROM wishlist_items
       WHERE oracle_id IN (${cheapest.oracle_id}::uuid, ${dearer.oracle_id}::uuid)
    `);
    await db.execute(sql`
      DELETE FROM collection_items
       WHERE location_id IN (SELECT id FROM locations WHERE name = ${TEST_LOCATION})
    `);
    await db.execute(sql`DELETE FROM locations WHERE name = ${TEST_LOCATION}`);
  }

  const endingCounts = await counts();
  check("the collection is back exactly where it started", () => {
    assert.deepEqual(endingCounts, startingCounts);
  });

  // Belt and braces: the queries agree with the raw counts.
  const finalList = await wishQueries.listWishlist();
  const finalTotals = await colQueries.getCollectionTotals();
  check("the queries agree the database is back", () => {
    assert.equal(finalList.rows.length, Number(startingCounts.wishes));
    assert.equal(finalTotals.totalCopies, Number(startingCounts.copies));
  });

  console.log(`\n${passed} checks passed.`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
