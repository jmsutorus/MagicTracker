/**
 * End-to-end check of sealed-product add: `npm run products:smoke`
 *
 * Needs the product catalog ingested, and it writes to the real collection
 * (then takes it back out). It exists because the add is a single hundred-row
 * SQL statement against the one table in this database that cannot be
 * regenerated — if it over-counts, under-counts or fails halfway, the damage
 * is to the record of cards you physically own.
 *
 * Asserts the collection is back exactly where it started at the end. Every
 * write goes to a location this script creates and deletes, so cards already
 * in the collection cannot be touched.
 */
import assert from "node:assert/strict";

import { config } from "dotenv";

config({ path: ".env.local" });

const TEST_LOCATION = "Products Smoke Shelf";

/** A Bloomburrow Commander precon: a foil commander plus a 99-card deck. */
const PRODUCT = "FamilyMatters_BLC";

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
    queries,
    mutations,
    contents,
    collection,
    colQueries,
  ] = await Promise.all([
    import("../lib/db"),
    import("drizzle-orm"),
    import("../lib/products/queries"),
    import("../lib/products/mutations"),
    import("../lib/products/contents"),
    import("../lib/collection/mutations"),
    import("../lib/collection/queries"),
  ]);

  const db = getDb();

  // Clear anything an interrupted earlier run left behind.
  const { rows: stale } = await db.execute<{ id: string }>(
    sql`SELECT id::text AS id FROM locations WHERE name = ${TEST_LOCATION}`,
  );
  for (const row of stale) {
    await db.execute(
      sql`DELETE FROM collection_items WHERE location_id = ${row.id}::uuid`,
    );
    await db.execute(sql`DELETE FROM locations WHERE id = ${row.id}::uuid`);
  }

  const startTotals = await colQueries.getCollectionTotals();

  // ---- the catalog --------------------------------------------------------
  console.log("catalog");

  const types = await queries.listProductTypes();
  check("the catalog is loaded and typed", () => {
    const total = types.reduce((n, t) => n + t.count, 0);
    assert.ok(total > 3000, `only ${total} products — run ingest:products`);
    const commander = types.find((t) => t.productType === "Commander Deck");
    assert.ok(commander, "no Commander Deck products");
    assert.equal(commander.count, 206);
  });

  const blc = await queries.listProducts({
    q: "BLC",
    productType: "Commander Deck",
  });
  check("the four Bloomburrow Commander decks are all there", () => {
    assert.equal(blc.total, 4);
    assert.deepEqual(blc.rows.map((r) => r.fileName).sort(), [
      "AnimatedArmy_BLC",
      "FamilyMatters_BLC",
      "PeaceOffering_BLC",
      "SquirreledAway_BLC",
    ]);
  });

  check("a product's Scryfall set is resolved by the live join", () => {
    for (const row of blc.rows) {
      assert.equal(row.mtgjsonSetCode, "BLC");
      assert.equal(row.setCode, "blc");
      assert.equal(row.setName, "Bloomburrow Commander");
    }
  });

  const { rows: unlinkedRows } = await db.execute<{
    n: number;
    file_name: string;
    set_code: string;
  }>(sql`
    SELECT count(*) OVER ()::int AS n,
           p.file_name,
           p.mtgjson_set_code AS set_code
      FROM precon_products p
      LEFT JOIN sets s ON s.mtgjson_code = p.mtgjson_set_code
     WHERE s.code IS NULL
     ORDER BY p.file_name
     LIMIT 1
  `);
  const unlinked = unlinkedRows[0];

  check("products with no Scryfall set still exist", () => {
    // MTGJSON's Q01-Q08 Challenger-deck codes match no Scryfall set. The
    // join is LEFT precisely so these are not hidden; an inner join here
    // would drop them and nothing would say so.
    assert.ok(unlinked.n > 0, "expected products with no matching set");
  });

  // Searched by MTGJSON set code, which is how you would actually find one
  // of these: the picker searches the product name, the set code and the
  // Scryfall set name, but not file names — those are identifiers, not
  // something a person would type.
  const unlinkedListed = await queries.listProducts({ q: unlinked.set_code });
  check(`the picker lists one of them (${unlinked.file_name})`, () => {
    const row = unlinkedListed.rows.find(
      (r) => r.fileName === unlinked.file_name,
    );
    assert.ok(row, "an unlinked product is missing from the picker");
    assert.equal(row.setCode, null);
    assert.equal(row.setName, null);
  });

  const searchByName = await queries.listProducts({ q: "Family Matters" });
  check("search matches on product name", () =>
    assert.ok(searchByName.rows.some((r) => r.fileName === PRODUCT)),
  );

  /*
   * The name as printed on the box. The catalog splits that across two
   * columns — name "Family Matters", product type "Commander Deck" — so a
   * whole-string match finds nothing and the product looks absent.
   */
  const boxName = await queries.listProducts({
    q: "Family Matters Commander Deck",
  });
  check("search matches the name as printed on the box", () =>
    assert.ok(boxName.rows.some((r) => r.fileName === PRODUCT)),
  );

  const mixedCols = await queries.listProducts({ q: "blc commander" });
  check("words may match different columns", () =>
    assert.ok(mixedCols.rows.some((r) => r.fileName === PRODUCT)),
  );

  const everyWord = await queries.listProducts({
    q: "Family Matters zzzznotaproduct",
  });
  check("every word still has to match something", () =>
    assert.equal(everyWord.total, 0),
  );

  const spacey = await queries.listProducts({ q: "   Family    Matters   " });
  check("runs of whitespace are not empty search terms", () =>
    assert.ok(spacey.rows.some((r) => r.fileName === PRODUCT)),
  );

  const noMatch = await queries.listProducts({ q: "zzzznotaproduct" });
  check("a search with no match returns nothing, not everything", () =>
    assert.equal(noMatch.total, 0),
  );

  const wildcard = await queries.listProducts({ q: "%" });
  check("a literal % is searched for, not treated as a wildcard", () =>
    assert.equal(wildcard.total, 0),
  );

  // ---- contents, fetched on demand ---------------------------------------
  console.log("\ncontents");

  const first = await contents.ensureProductContents(PRODUCT);
  assert.equal(first.ok, true, JSON.stringify(first));
  if (!first.ok) return;

  check("the card list loads and is a whole Commander deck", () => {
    assert.equal(first.cardCount, 100);
    assert.equal(first.unidentifiedCount, 0);
    assert.ok(first.distinctCount > 50 && first.distinctCount <= 100);
  });

  const second = await contents.ensureProductContents(PRODUCT);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  check("a second read is served from the cache, with no fetch", () => {
    assert.equal(second.fetched, false);
    assert.equal(second.cardCount, first.cardCount);
  });

  const unknownProduct =
    await contents.ensureProductContents("NotAProduct_ZZZ");
  check("an unknown product is refused rather than fetched", () =>
    assert.equal(unknownProduct.ok, false),
  );

  const cards = await queries.listProductCards(PRODUCT);
  check("every card resolved to a printing", () => {
    assert.equal(cards.length, first.distinctCount);
    assert.equal(
      cards.filter((c) => c.printingId === null).length,
      0,
      "some cards did not resolve",
    );
  });

  check("quantities sum to the deck's size", () =>
    assert.equal(
      cards.reduce((n, c) => n + c.quantity, 0),
      100,
    ),
  );

  check("the commander comes first and ships foil", () => {
    assert.equal(cards[0].board, "commander");
    assert.equal(cards[0].isFoil, true);
    assert.equal(cards[0].quantity, 1);
  });

  check("the finish an add would use is a finish the printing has", () => {
    for (const card of cards) {
      assert.ok(card.wantFinish, `${card.cardName} resolved to no finish`);
      assert.ok(
        card.finishes?.includes(card.wantFinish),
        `${card.cardName}: ${card.wantFinish} not in ${card.finishes?.join()}`,
      );
    }
  });

  // ---- validation, before anything is written ----------------------------
  console.log("\nrefusals");

  const location = await collection.createLocation(TEST_LOCATION, "deck");
  assert.equal(location.ok, true, JSON.stringify(location));
  if (!location.ok) return;

  const badBoard = await mutations.addProductToCollection({
    fileName: PRODUCT,
    locationId: location.id,
    condition: "NM",
    boards: ["main", "graveyard"],
  });
  check("an invalid board is refused", () => assert.equal(badBoard.ok, false));

  const noBoards = await mutations.addProductToCollection({
    fileName: PRODUCT,
    locationId: location.id,
    condition: "NM",
    boards: [],
  });
  check("adding no boards is refused rather than adding nothing", () =>
    assert.equal(noBoards.ok, false),
  );

  const badCondition = await mutations.addProductToCollection({
    fileName: PRODUCT,
    locationId: location.id,
    condition: "MINT",
    boards: ["main"],
  });
  check("an invalid condition is refused", () =>
    assert.equal(badCondition.ok, false),
  );

  const badLocation = await mutations.addProductToCollection({
    fileName: PRODUCT,
    locationId: "00000000-0000-4000-8000-000000000000",
    condition: "NM",
    boards: ["main"],
  });
  check("a location that does not exist is refused by name, not by FK", () => {
    assert.equal(badLocation.ok, false);
    if (!badLocation.ok) assert.match(badLocation.error, /location/i);
  });

  const unknownAdd = await mutations.addProductToCollection({
    fileName: "NotAProduct_ZZZ",
    locationId: location.id,
    condition: "NM",
    boards: ["main"],
  });
  check("an unknown product adds nothing", () =>
    assert.equal(unknownAdd.ok, false),
  );

  const midTotals = await colQueries.getCollectionTotals();
  check("none of those refusals wrote anything", () =>
    assert.equal(midTotals.totalCopies, startTotals.totalCopies),
  );

  // ---- the add ------------------------------------------------------------
  console.log("\nadding the product");

  const boards = ["commander", "main"];
  const added = await mutations.addProductToCollection({
    fileName: PRODUCT,
    locationId: location.id,
    condition: "NM",
    boards,
  });
  assert.equal(added.ok, true, JSON.stringify(added));
  if (!added.ok) return;

  check("the whole deck went in, in one statement", () => {
    assert.equal(added.copies, 100);
    assert.equal(added.skipped, 0);
    assert.equal(added.rows, cards.length);
  });

  const afterAdd = await colQueries.getCollectionTotals();
  check("the collection grew by exactly the deck's size", () =>
    assert.equal(afterAdd.totalCopies, startTotals.totalCopies + 100),
  );

  const { rows: placed } = await db.execute<{
    copies: number;
    rows: number;
  }>(sql`
    SELECT coalesce(sum(quantity), 0)::int AS copies, count(*)::int AS rows
      FROM collection_items
     WHERE location_id = ${location.id}::uuid
  `);
  check("all of it landed in the chosen location", () => {
    assert.equal(placed[0].copies, 100);
    assert.equal(placed[0].rows, cards.length);
  });

  const { rows: commanderRow } = await db.execute<{
    finish: string;
    quantity: number;
  }>(sql`
    SELECT c.finish, c.quantity
      FROM collection_items c
      JOIN precon_cards pc ON pc.scryfall_id = c.printing_id
     WHERE c.location_id = ${location.id}::uuid
       AND pc.file_name = ${PRODUCT}
       AND pc.board = 'commander'
  `);
  check("the foil commander was stored as foil", () => {
    assert.equal(commanderRow.length, 1);
    assert.equal(commanderRow[0].finish, "foil");
    assert.equal(commanderRow[0].quantity, 1);
  });

  const { rows: badFinishRows } = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n
      FROM collection_items c
      JOIN printings p ON p.scryfall_id = c.printing_id
     WHERE c.location_id = ${location.id}::uuid
       AND NOT (c.finish = ANY(p.finishes))
  `);
  check("no copy was stored in a finish its printing was never made in", () =>
    assert.equal(badFinishRows[0].n, 0),
  );

  const ownedCards = await queries.listProductCards(PRODUCT);
  check("the product page now shows the deck as owned", () => {
    for (const card of ownedCards) {
      assert.ok(
        card.ownedInFinish >= card.quantity,
        `${card.cardName}: owned ${card.ownedInFinish} of ${card.quantity}`,
      );
    }
  });

  const listedAfter = await queries.listProducts({ q: "Family Matters" });
  check("the picker reports it as owned", () => {
    const row = listedAfter.rows.find((r) => r.fileName === PRODUCT);
    assert.ok(row);
    assert.ok(row.ownedCopies >= 100);
    assert.equal(row.ownedDistinct, cards.length);
  });

  // ---- adding twice -------------------------------------------------------
  console.log("\nadding it a second time");

  const again = await mutations.addProductToCollection({
    fileName: PRODUCT,
    locationId: location.id,
    condition: "NM",
    boards,
  });
  assert.equal(again.ok, true);
  if (!again.ok) return;

  const afterTwice = await colQueries.getCollectionTotals();
  check("two boxes means two copies of each card, not an error", () => {
    assert.equal(again.copies, 100);
    assert.equal(afterTwice.totalCopies, startTotals.totalCopies + 200);
  });

  // ---- taking it back out -------------------------------------------------
  console.log("\nundo");

  const removedOnce = await mutations.removeProductFromCollection({
    fileName: PRODUCT,
    locationId: location.id,
    condition: "NM",
    boards,
  });
  assert.equal(removedOnce.ok, true, JSON.stringify(removedOnce));
  if (!removedOnce.ok) return;

  const afterRemoveOne = await colQueries.getCollectionTotals();
  check("removing once takes out one copy of each, leaving the other", () => {
    assert.equal(removedOnce.copies, 100);
    assert.equal(afterRemoveOne.totalCopies, startTotals.totalCopies + 100);
  });

  const removedTwice = await mutations.removeProductFromCollection({
    fileName: PRODUCT,
    locationId: location.id,
    condition: "NM",
    boards,
  });
  assert.equal(removedTwice.ok, true);
  if (!removedTwice.ok) return;

  const afterRemoveTwo = await colQueries.getCollectionTotals();
  check("removing again empties the location", () => {
    assert.equal(removedTwice.copies, 100);
    assert.equal(afterRemoveTwo.totalCopies, startTotals.totalCopies);
  });

  const emptyRemove = await mutations.removeProductFromCollection({
    fileName: PRODUCT,
    locationId: location.id,
    condition: "NM",
    boards,
  });
  check("removing from an empty location removes nothing and says so", () => {
    assert.equal(emptyRemove.ok, true);
    if (emptyRemove.ok) assert.equal(emptyRemove.copies, 0);
  });

  // ---- undo does not take cards it did not add ---------------------------
  console.log("\nundo leaves what was already there");

  const single = cards[1];
  assert.ok(single.printingId && single.wantFinish);
  const preexisting = await collection.addCopies({
    printingId: single.printingId,
    finish: single.wantFinish,
    condition: "NM",
    locationId: location.id,
    quantity: 1,
  });
  assert.equal(preexisting.ok, true, JSON.stringify(preexisting));

  const addOverTop = await mutations.addProductToCollection({
    fileName: PRODUCT,
    locationId: location.id,
    condition: "NM",
    boards,
  });
  assert.equal(addOverTop.ok, true);

  const removeOverTop = await mutations.removeProductFromCollection({
    fileName: PRODUCT,
    locationId: location.id,
    condition: "NM",
    boards,
  });
  assert.equal(removeOverTop.ok, true);

  const { rows: survivor } = await db.execute<{ quantity: number }>(sql`
    SELECT quantity FROM collection_items
     WHERE location_id = ${location.id}::uuid
       AND printing_id = ${single.printingId}::uuid
       AND finish = ${single.wantFinish}
  `);
  check("a copy owned before the add survives the undo", () => {
    // The undo subtracts what the product contributed, never more. The card
    // that was in the box first is still in the box.
    assert.equal(survivor.length, 1);
    assert.equal(survivor[0].quantity, 1);
  });

  const { rows: leftover } = await db.execute<{ copies: number }>(sql`
    SELECT coalesce(sum(quantity), 0)::int AS copies
      FROM collection_items WHERE location_id = ${location.id}::uuid
  `);
  check("and nothing else is left behind", () =>
    assert.equal(leftover[0].copies, 1),
  );

  // ---- cleanup ------------------------------------------------------------
  console.log("\ncleanup");

  await db.execute(
    sql`DELETE FROM collection_items WHERE location_id = ${location.id}::uuid`,
  );
  const locationGone = await collection.deleteLocation(location.id);
  assert.equal(locationGone.ok, true, JSON.stringify(locationGone));

  const endTotals = await colQueries.getCollectionTotals();
  check("the collection is back exactly where it started", () =>
    assert.equal(endTotals.totalCopies, startTotals.totalCopies),
  );

  const { rows: cacheKept } = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM precon_cards WHERE file_name = ${PRODUCT}`,
  );
  check("the cached card list is kept — it is machine data, not mine", () =>
    assert.equal(cacheKept[0].n, cards.length),
  );

  console.log(`\n${passed} checks passed.`);
}

main()
  .catch((error) => {
    console.error("\nFAILED\n", error);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
