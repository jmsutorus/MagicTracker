/**
 * End-to-end check of the one-press precon add: `npm run precon:smoke`
 *
 * `addPrecon` is four writes behind one button — a location, a hundred
 * collection rows, a deck, and the claim on those rows — and the button
 * promises a single Undo that takes all four back. This checks that promise
 * against the real database, including the case where a later step fails and
 * the earlier ones have to unwind on their own.
 *
 * It writes to the real collection and then takes it back out, asserting the
 * collection, the decks and the locations are all exactly where they started.
 * Every write goes to a deck and a box this script names, so nothing you own
 * can be caught up in it.
 */
import assert from "node:assert/strict";

import { config } from "dotenv";

config({ path: ".env.local" });

const BOX = "Precon Smoke Box";
const SHELF = "Precon Smoke Shelf";
const DECK = "Precon Smoke Deck";

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
    contents,
    precon,
    collection,
    colQueries,
  ] = await Promise.all([
    import("../lib/db"),
    import("drizzle-orm"),
    import("../lib/products/queries"),
    import("../lib/products/contents"),
    import("../lib/products/precon"),
    import("../lib/collection/mutations"),
    import("../lib/collection/queries"),
  ]);

  const db = getDb();

  // ---- clear anything an interrupted earlier run left behind --------------
  await db.execute(sql`DELETE FROM decks WHERE name LIKE ${`${DECK}%`}`);
  const { rows: stale } = await db.execute<{ id: string }>(sql`
    SELECT id::text AS id FROM locations WHERE name IN (${BOX}, ${SHELF})
  `);
  for (const row of stale) {
    await db.execute(
      sql`DELETE FROM collection_items WHERE location_id = ${row.id}::uuid`,
    );
    await db.execute(sql`DELETE FROM locations WHERE id = ${row.id}::uuid`);
  }

  const startTotals = await colQueries.getCollectionTotals();
  const startCounts = await counts(db, sql);

  const loaded = await contents.ensureProductContents(PRODUCT);
  assert.equal(loaded.ok, true, JSON.stringify(loaded));
  const cards = await queries.listProductCards(PRODUCT);

  const deckBoards = cards.filter(
    (c) =>
      (c.board === "commander" || c.board === "main") &&
      c.printingId !== null &&
      c.wantFinish !== null,
  );
  const expectedCopies = deckBoards.reduce((n, c) => n + c.quantity, 0);
  const expectedDeckRows = new Set(
    deckBoards.map((c) => `${c.board}:${c.oracleId}`),
  ).size;

  // ---- one press ----------------------------------------------------------
  console.log("the one press");

  const first = await precon.addPrecon({
    fileName: PRODUCT,
    locationId: null,
    locationName: BOX,
    condition: "NM",
    boards: ["commander", "main"],
    buildDeck: true,
    deckName: DECK,
  });
  assert.equal(first.ok, true, JSON.stringify(first));
  if (!first.ok) return;

  check("it puts the whole box in, in one call", () => {
    assert.equal(first.copies, expectedCopies);
    assert.equal(first.skipped, 0);
  });

  check("it makes the box it was asked for", () => {
    assert.equal(first.location.name, BOX);
    assert.equal(first.location.created, true);
  });

  check("it builds the deck and claims the cards", () => {
    assert.ok(first.deck, "no deck was built");
    assert.equal(first.deck.name, DECK);
    assert.equal(
      first.deck.allocated + first.deck.unavailable,
      expectedDeckRows,
    );
    assert.equal(first.deck.unavailable, 0);
  });

  const { rows: deckState } = await db.execute<{
    rows: number;
    allocated: number;
    location: string | null;
    format: string;
  }>(sql`
    SELECT count(dc.id)::int                                   AS rows,
           count(dc.id) FILTER (WHERE dc.is_allocated)::int    AS allocated,
           max(d.location_id::text)                            AS location,
           max(d.format)                                       AS format
      FROM decks d
      LEFT JOIN deck_cards dc ON dc.deck_id = d.id
     WHERE d.id = ${first.deck?.id}::uuid
  `);

  check("every card in the deck is claimed, in the database", () => {
    assert.equal(deckState[0].rows, expectedDeckRows);
    assert.equal(deckState[0].allocated, expectedDeckRows);
  });

  check("and the deck is filed in the box the cards went into", () => {
    assert.equal(deckState[0].location, first.location.id);
    assert.equal(deckState[0].format, "commander");
  });

  const { rows: boxState } = await db.execute<{ copies: number }>(sql`
    SELECT coalesce(sum(quantity), 0)::int AS copies
      FROM collection_items WHERE location_id = ${first.location.id}::uuid
  `);
  check("the cards really are in the box", () =>
    assert.equal(boxState[0].copies, expectedCopies),
  );

  // ---- a second copy of the same box --------------------------------------
  console.log("\na second copy");

  const second = await precon.addPrecon({
    fileName: PRODUCT,
    locationId: null,
    locationName: BOX,
    condition: "NM",
    boards: ["commander", "main"],
    buildDeck: true,
    deckName: DECK,
  });
  assert.equal(second.ok, true, JSON.stringify(second));
  if (!second.ok) return;

  check("the box of that name is reused, not duplicated", () => {
    assert.equal(second.location.id, first.location.id);
    assert.equal(second.location.created, false);
  });

  check("the deck name moves aside rather than failing", () => {
    assert.ok(second.deck);
    assert.equal(second.deck.name, `${DECK} (2)`);
  });

  check("the second deck cannot claim what the first one holds", () => {
    // The claim is per oracle id across every built deck, and two copies of
    // one precon are two copies of each card — so the second deck claims the
    // second copy of each, and nothing is left unavailable.
    assert.ok(second.deck);
    assert.equal(second.deck.unavailable, 0);
    assert.equal(second.deck.allocated, expectedDeckRows);
  });

  // ---- the undo -----------------------------------------------------------
  console.log("\nthe undo");

  const undoSecond = await precon.removePrecon(second.undo);
  assert.equal(undoSecond.ok, true, JSON.stringify(undoSecond));
  if (!undoSecond.ok) return;

  check("undoing the second copy takes back exactly its cards", () =>
    assert.equal(undoSecond.copies, expectedCopies),
  );
  check("it deletes that deck", () =>
    assert.equal(undoSecond.deckDeleted, true),
  );
  check("and leaves the box alone, because the first copy is still in it", () =>
    assert.equal(undoSecond.locationDeleted, false),
  );

  const { rows: afterSecond } = await db.execute<{ copies: number }>(sql`
    SELECT coalesce(sum(quantity), 0)::int AS copies
      FROM collection_items WHERE location_id = ${first.location.id}::uuid
  `);
  check("the first copy is untouched", () =>
    assert.equal(afterSecond[0].copies, expectedCopies),
  );

  const undoFirst = await precon.removePrecon(first.undo);
  assert.equal(undoFirst.ok, true, JSON.stringify(undoFirst));
  if (!undoFirst.ok) return;

  check("undoing the first copy empties the box", () =>
    assert.equal(undoFirst.copies, expectedCopies),
  );
  check("and removes the box this add created", () =>
    assert.equal(undoFirst.locationDeleted, true),
  );

  const { rows: boxGone } = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM locations WHERE name = ${BOX}`,
  );
  check("so no box of that name is left behind", () =>
    assert.equal(boxGone[0].n, 0),
  );

  // ---- cards only, into a box that was already there ----------------------
  console.log("\njust the cards");

  const shelf = await collection.createLocation(SHELF, "box");
  assert.equal(shelf.ok, true, JSON.stringify(shelf));
  if (!shelf.ok) return;

  const cardsOnly = await precon.addPrecon({
    fileName: PRODUCT,
    locationId: shelf.id,
    locationName: "ignored",
    condition: "LP",
    boards: ["commander", "main"],
    buildDeck: false,
    deckName: DECK,
  });
  assert.equal(cardsOnly.ok, true, JSON.stringify(cardsOnly));
  if (!cardsOnly.ok) return;

  check("no deck is built when it was not asked for", () => {
    assert.equal(cardsOnly.deck, null);
    assert.equal(cardsOnly.location.id, shelf.id);
    assert.equal(cardsOnly.location.created, false);
    assert.equal(cardsOnly.copies, expectedCopies);
  });

  const undoCardsOnly = await precon.removePrecon(cardsOnly.undo);
  assert.equal(undoCardsOnly.ok, true, JSON.stringify(undoCardsOnly));
  if (!undoCardsOnly.ok) return;

  check("undoing it keeps the box, which this add did not create", () => {
    assert.equal(undoCardsOnly.copies, expectedCopies);
    assert.equal(undoCardsOnly.deckDeleted, false);
    assert.equal(undoCardsOnly.locationDeleted, false);
  });

  const shelfGone = await collection.deleteLocation(shelf.id);
  assert.equal(shelfGone.ok, true, JSON.stringify(shelfGone));

  // ---- a step that fails takes the earlier ones with it -------------------
  console.log("\nthe unwind");

  const halfway = await precon.addPrecon({
    fileName: PRODUCT,
    locationId: null,
    locationName: BOX,
    condition: "NM",
    boards: ["commander", "main"],
    buildDeck: true,
    // Rejected by the deck step, which runs after the box is made and the
    // cards are in: the add has to put both back on its own.
    deckName: "   ",
  });

  check("a refused deck name fails the whole add", () =>
    assert.equal(halfway.ok, false),
  );

  const { rows: unwound } = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM locations WHERE name = ${BOX}`,
  );
  check("and the box it had already made is gone again", () =>
    assert.equal(unwound[0].n, 0),
  );

  // ---- what it refuses ----------------------------------------------------
  console.log("\nwhat it refuses");

  const base = {
    fileName: PRODUCT,
    locationId: null,
    locationName: BOX,
    condition: "NM",
    boards: ["commander", "main"] as string[],
    buildDeck: false,
    deckName: DECK,
  };

  const refusals: [string, Awaited<ReturnType<typeof precon.addPrecon>>][] = [
    ["an unknown product", await precon.addPrecon({ ...base, fileName: "no" })],
    [
      "a condition that is not a grade",
      await precon.addPrecon({ ...base, condition: "MINT" }),
    ],
    [
      "a board that does not exist",
      await precon.addPrecon({ ...base, boards: ["sideboard"] }),
    ],
    ["no boards at all", await precon.addPrecon({ ...base, boards: [] })],
    [
      "a nameless new box",
      await precon.addPrecon({ ...base, locationName: "  " }),
    ],
    [
      "a location id that is not a uuid",
      await precon.addPrecon({ ...base, locationId: "nope" }),
    ],
  ];

  for (const [label, result] of refusals) {
    check(`it refuses ${label}`, () => {
      assert.equal(result.ok, false);
      if (!result.ok) assert.ok(result.error.length > 0);
    });
  }

  // ---- everything back where it started -----------------------------------
  console.log("\ncleanup");

  const endTotals = await colQueries.getCollectionTotals();
  const endCounts = await counts(db, sql);

  check("the collection is back exactly where it started", () =>
    assert.equal(endTotals.totalCopies, startTotals.totalCopies),
  );
  check("no deck, deck card or location is left behind", () =>
    assert.deepEqual(endCounts, startCounts),
  );

  const { rows: cacheKept } = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM precon_cards WHERE file_name = ${PRODUCT}`,
  );
  check("the cached card list is kept — it is machine data, not mine", () =>
    assert.equal(cacheKept[0].n, cards.length),
  );

  console.log(`\n${passed} checks passed.`);
}

/** Row counts that an add must leave exactly as it found them. */
async function counts(
  db: ReturnType<typeof import("../lib/db").getDb>,
  sql: typeof import("drizzle-orm").sql,
): Promise<{ decks: number; deckCards: number; locations: number }> {
  const { rows } = await db.execute<{
    decks: number;
    deck_cards: number;
    locations: number;
  }>(sql`
    SELECT (SELECT count(*) FROM decks)::int        AS decks,
           (SELECT count(*) FROM deck_cards)::int   AS deck_cards,
           (SELECT count(*) FROM locations)::int    AS locations
  `);
  return {
    decks: rows[0].decks,
    deckCards: rows[0].deck_cards,
    locations: rows[0].locations,
  };
}

main()
  .catch((error) => {
    console.error("\nFAILED\n", error);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
