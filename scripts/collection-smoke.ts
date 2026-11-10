/**
 * End-to-end check of the collection layer: `npx tsx scripts/collection-smoke.ts`
 *
 * Not a unit test — it needs a loaded database, and it writes. It exists
 * because the mutations are multi-statement CTEs (an adjust that deletes at
 * zero, a move that merges into an existing row) which typecheck perfectly
 * while being wrong, and because the browse filters compose `sql` fragments
 * that only fail at execution.
 *
 * It cleans up everything it creates and asserts the collection is back to its
 * starting state at the end, so it is safe to run against the real database.
 */
import assert from "node:assert/strict";

import { config } from "dotenv";

config({ path: ".env.local" });

const TEST_LOCATION = "Smoke Test Shelf";
const TEST_LOCATION_B = "Smoke Test Shelf B";

let passed = 0;
function check(label: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok  ${label}`);
}

async function main() {
  const [{ getDb }, queries, mutations] = await Promise.all([
    import("../lib/db"),
    import("../lib/collection/queries"),
    import("../lib/collection/mutations"),
  ]);

  const db = getDb();

  // A previous run that was interrupted (a closed pipe is enough) can leave
  // its locations behind, which would make creating them fail. They only ever
  // hold this script's own rows, so clearing them is safe.
  const { rows: leftovers } = await db.execute<{ id: string; name: string }>(
    (await import("drizzle-orm")).sql`
      SELECT id::text AS id, name FROM locations
       WHERE name IN (${TEST_LOCATION}, ${TEST_LOCATION_B})
    `,
  );
  for (const stale of leftovers) {
    await db.execute(
      (await import("drizzle-orm"))
        .sql`DELETE FROM collection_items WHERE location_id = ${stale.id}::uuid`,
    );
    await db.execute(
      (await import("drizzle-orm"))
        .sql`DELETE FROM locations WHERE id = ${stale.id}::uuid`,
    );
    console.log(`  (cleared leftover location "${stale.name}" from an earlier run)`);
  }

  const before = await queries.getCollectionTotals();
  console.log(
    `starting state: ${before.totalCopies} copies across ${before.distinctPrintings} printings\n`,
  );

  // --- locations ------------------------------------------------------------
  console.log("locations");

  const created = await mutations.createLocation(TEST_LOCATION, "binder");
  assert.equal(created.ok, true, `createLocation failed: ${JSON.stringify(created)}`);
  if (!created.ok) return;
  check("creates a location", () => assert.ok(created.id));

  const dupe = await mutations.createLocation(TEST_LOCATION.toLowerCase(), "box");
  check("rejects a duplicate name case-insensitively", () => {
    assert.equal(dupe.ok, false);
    // Asserting the message, not just the failure: drizzle wraps driver
    // errors so the SQLSTATE is on `.cause`, and reading only the top level
    // silently downgraded this to the generic "could not" fallback.
    if (!dupe.ok) assert.match(dupe.error, /already have a location called/);
  });

  const badKind = await mutations.createLocation("Smoke Test Bad Kind", "vault");
  check("rejects an invalid location kind", () =>
    assert.equal(badKind.ok, false),
  );

  const createdB = await mutations.createLocation(TEST_LOCATION_B, "box");
  assert.equal(createdB.ok, true);
  if (!createdB.ok) return;

  // --- finding a printing by collector number -------------------------------
  console.log("\ncollector-number lookup");

  // Pick a real set and a real collector number from the data rather than
  // hardcoding one, so this does not break when the card database moves on.
  const { rows: sampleRows } = await db.execute<{
    set_code: string;
    collector_number: string;
    name: string;
    finishes: string[];
  }>(
    (await import("drizzle-orm")).sql`
      SELECT set_code, collector_number, name, finishes
        FROM printings
       WHERE lang = 'en' AND NOT is_extra AND 'nonfoil' = ANY(finishes)
       ORDER BY released_at DESC NULLS LAST, collector_number_num ASC
       LIMIT 1
    `,
  );
  const sample = sampleRows[0];
  assert.ok(sample, "no printings in the database — run the ingest first");

  const found = await queries.findPrintingsByCollectorNumber(
    sample.set_code,
    sample.collector_number,
  );
  check("finds the printing by set and collector number", () =>
    assert.ok(found.some((p) => p.name === sample.name)),
  );

  const foundUpper = await queries.findPrintingsByCollectorNumber(
    sample.set_code.toUpperCase(),
    sample.collector_number.toUpperCase(),
  );
  check("lookup is case-insensitive on both set and number", () =>
    assert.equal(foundUpper.length, found.length),
  );

  const missing = await queries.findPrintingsByCollectorNumber(
    sample.set_code,
    "999999",
  );
  check("returns nothing for a number not in the set", () =>
    assert.equal(missing.length, 0),
  );

  const printingId = found[0].scryfallId;

  // --- adding ---------------------------------------------------------------
  console.log("\nadding copies");

  const add1 = await mutations.addCopies({
    printingId,
    finish: "nonfoil",
    condition: "NM",
    locationId: created.id,
    quantity: 2,
  });
  assert.equal(add1.ok, true, `addCopies failed: ${JSON.stringify(add1)}`);
  if (!add1.ok) return;
  check("adds two copies", () => assert.equal(add1.quantity, 2));

  const add2 = await mutations.addCopies({
    printingId,
    finish: "nonfoil",
    condition: "NM",
    locationId: created.id,
    quantity: 3,
  });
  assert.equal(add2.ok, true);
  if (!add2.ok) return;
  check("merges into the existing row rather than making a second", () => {
    assert.equal(add2.quantity, 5);
    assert.equal(add2.itemId, add1.itemId);
  });

  const badFinish = await mutations.addCopies({
    printingId,
    finish: "glitter",
    condition: "NM",
    locationId: created.id,
    quantity: 1,
  });
  check("rejects a finish that is not a real finish", () =>
    assert.equal(badFinish.ok, false),
  );

  // A finish this printing was never made in must be refused even though it
  // is a valid finish in general.
  if (!sample.finishes.includes("etched")) {
    const unavailable = await mutations.addCopies({
      printingId,
      finish: "etched",
      condition: "NM",
      locationId: created.id,
      quantity: 1,
    });
    check("rejects a finish this printing was not printed in", () =>
      assert.equal(unavailable.ok, false),
    );
  }

  const badQuantity = await mutations.addCopies({
    printingId,
    finish: "nonfoil",
    condition: "NM",
    locationId: created.id,
    quantity: 0,
  });
  check("rejects a quantity of zero", () =>
    assert.equal(badQuantity.ok, false),
  );

  const badPrinting = await mutations.addCopies({
    printingId: "not-a-uuid",
    finish: "nonfoil",
    condition: "NM",
    locationId: created.id,
    quantity: 1,
  });
  check("rejects a malformed printing id without reaching a cast", () =>
    assert.equal(badPrinting.ok, false),
  );

  // --- adjusting ------------------------------------------------------------
  console.log("\nadjusting quantity");

  const down = await mutations.adjustQuantity(add1.itemId, -2);
  assert.equal(down.ok, true);
  if (!down.ok) return;
  check("decrements", () => {
    assert.equal(down.quantity, 3);
    assert.equal(down.deleted, false);
  });

  const up = await mutations.adjustQuantity(add1.itemId, 1);
  assert.equal(up.ok, true);
  if (!up.ok) return;
  check("increments", () => assert.equal(up.quantity, 4));

  // --- browsing -------------------------------------------------------------
  console.log("\nbrowsing");

  const all = await queries.browseCollection({});
  check("the row shows up unfiltered", () =>
    assert.ok(all.rows.some((r) => r.itemId === add1.itemId)),
  );

  const bySet = await queries.browseCollection({ setCode: sample.set_code });
  check("filters by set", () =>
    assert.ok(bySet.rows.some((r) => r.itemId === add1.itemId)),
  );

  const byLocation = await queries.browseCollection({
    locationId: created.id,
  });
  check("filters by location", () =>
    assert.ok(byLocation.rows.some((r) => r.itemId === add1.itemId)),
  );

  const byName = await queries.browseCollection({ q: sample.name.slice(0, 4) });
  check("filters by name fragment", () =>
    assert.ok(byName.rows.some((r) => r.itemId === add1.itemId)),
  );

  const byWildcard = await queries.browseCollection({ q: "%" });
  check("a bare % does not match everything", () =>
    assert.equal(byWildcard.matchingRows, 0),
  );

  const byFoil = await queries.browseCollection({ finish: "foil" });
  check("filters by finish", () =>
    assert.ok(!byFoil.rows.some((r) => r.itemId === add1.itemId)),
  );

  const combined = await queries.browseCollection({
    setCode: sample.set_code,
    locationId: created.id,
    finish: "nonfoil",
    q: sample.name.slice(0, 3),
  });
  check("every filter composes into one query", () =>
    assert.ok(combined.rows.some((r) => r.itemId === add1.itemId)),
  );

  const totalsNow = await queries.getCollectionTotals();
  check("totals count the copies, not the rows", () =>
    assert.equal(totalsNow.totalCopies, before.totalCopies + 4),
  );

  // --- deleting a location that is in use -----------------------------------
  console.log("\nlocation guards");

  const blocked = await mutations.deleteLocation(created.id);
  check("refuses to delete a location holding cards", () => {
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.match(blocked.error, /still holds 4 cards/);
  });

  // --- moving ---------------------------------------------------------------
  console.log("\nmoving");

  const moved = await mutations.moveItem(add1.itemId, createdB.id);
  assert.equal(moved.ok, true, `moveItem failed: ${JSON.stringify(moved)}`);

  const afterMove = await queries.browseCollection({ locationId: createdB.id });
  check("relocates to an empty destination", () => {
    assert.equal(afterMove.rows.length, 1);
    assert.equal(afterMove.rows[0].quantity, 4);
  });

  const sourceEmpty = await queries.browseCollection({ locationId: created.id });
  check("the source location is left empty", () =>
    assert.equal(sourceEmpty.rows.length, 0),
  );

  // Now put one copy back in the first location and move it onto the other,
  // which must MERGE rather than violate the unique key.
  const readd = await mutations.addCopies({
    printingId,
    finish: "nonfoil",
    condition: "NM",
    locationId: created.id,
    quantity: 1,
  });
  assert.equal(readd.ok, true);
  if (!readd.ok) return;

  const mergeMove = await mutations.moveItem(readd.itemId, createdB.id);
  check("a move into an occupied slot merges instead of failing", () =>
    assert.equal(mergeMove.ok, true),
  );

  const afterMerge = await queries.browseCollection({ locationId: createdB.id });
  check("the merge sums the quantities into one row", () => {
    assert.equal(afterMerge.rows.length, 1);
    assert.equal(afterMerge.rows[0].quantity, 5);
  });

  const mergedAwayGone = await queries.browseCollection({
    locationId: created.id,
  });
  check("the merged-away row is deleted, not duplicated", () =>
    assert.equal(mergedAwayGone.rows.length, 0),
  );

  // --- deleting down to zero ------------------------------------------------
  console.log("\ndeleting at zero");

  const survivingId = afterMerge.rows[0].itemId;

  const toZero = await mutations.adjustQuantity(survivingId, -5);
  assert.equal(toZero.ok, true);
  if (!toZero.ok) return;
  check("reaching zero deletes the row rather than storing a 0", () => {
    assert.equal(toZero.quantity, 0);
    assert.equal(toZero.deleted, true);
  });

  const gone = await mutations.adjustQuantity(survivingId, -1);
  check("adjusting a row that no longer exists is an error, not a crash", () =>
    assert.equal(gone.ok, false),
  );

  // --- cleanup --------------------------------------------------------------
  console.log("\ncleanup");

  const deletedA = await mutations.deleteLocation(created.id);
  check("deletes the now-empty location", () =>
    assert.equal(deletedA.ok, true),
  );
  const deletedB = await mutations.deleteLocation(createdB.id);
  check("deletes the second location", () => assert.equal(deletedB.ok, true));

  const after = await queries.getCollectionTotals();
  check("the collection is back exactly where it started", () => {
    assert.equal(after.totalCopies, before.totalCopies);
    assert.equal(after.distinctPrintings, before.distinctPrintings);
  });

  console.log(`\n${passed} checks passed.`);
}

main()
  .catch((error) => {
    console.error("\nFAILED\n", error);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
