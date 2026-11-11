/**
 * End-to-end check of the deck layer: `npm run decks:smoke`
 *
 * Needs a loaded card database and the product catalog. It writes (decks, and
 * briefly the collection) and asserts everything is back where it started.
 *
 * It exists for two reasons. The availability subtraction — owned minus other
 * decks' claims — is the kind of query that is wrong in a way no unit test
 * can see, because it is only wrong when two decks want the same card. And
 * "this deck is legal" is advice someone acts on, so the rules are checked
 * against a real precon rather than only against fixtures.
 */
import assert from "node:assert/strict";

import { config } from "dotenv";

config({ path: ".env.local" });

const DECK_A = "Decks Smoke Alpha";
const DECK_B = "Decks Smoke Beta";
const TEST_LOCATION = "Decks Smoke Shelf";
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
    legality,
    products,
    productMutations,
    collection,
    colQueries,
  ] = await Promise.all([
    import("../lib/db"),
    import("drizzle-orm"),
    import("../lib/decks/queries"),
    import("../lib/decks/mutations"),
    import("../lib/decks/legality"),
    import("../lib/products/contents"),
    import("../lib/products/mutations"),
    import("../lib/collection/mutations"),
    import("../lib/collection/queries"),
  ]);

  const db = getDb();

  type Deck = NonNullable<Awaited<ReturnType<typeof queries.getDeck>>>;

  /**
   * The Commander verdict, asserting that is what this deck has.
   *
   * `getDeck` returns a tagged verdict since cubes exist (see
   * lib/decks/queries.ts), so reaching for the Commander report is a claim
   * about the deck — and one worth failing on rather than narrowing away
   * with a cast, since every assertion below depends on it.
   */
  function report(deck: Deck) {
    if (deck.verdict.kind !== "commander") {
      throw new Error(`${deck.name} is not a Commander deck`);
    }
    return deck.verdict.report;
  }

  // ---- pre-clean anything an interrupted run left behind ------------------
  await db.execute(sql`
    DELETE FROM decks WHERE name IN (${DECK_A}, ${DECK_B}, ${`${DECK_A} renamed`})
  `);
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
  const { rows: startDeckRows } = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM decks`,
  );
  const startDecks = startDeckRows[0].n;

  // ---- deck CRUD ----------------------------------------------------------
  console.log("deck CRUD");

  const created = await mutations.createDeck(DECK_A);
  assert.equal(created.ok, true, JSON.stringify(created));
  if (!created.ok) return;

  check("a deck is created", () => assert.ok(created.id));

  const duplicate = await mutations.createDeck(DECK_A.toLowerCase());
  check("a duplicate name is refused, case-insensitively", () => {
    assert.equal(duplicate.ok, false);
    if (!duplicate.ok) assert.match(duplicate.error, /already have a deck/);
  });

  const noName = await mutations.createDeck("   ");
  check("an empty name is refused", () => assert.equal(noName.ok, false));

  const renamed = await mutations.renameDeck(created.id, `${DECK_A} renamed`);
  assert.equal(renamed.ok, true);
  const renamedBack = await mutations.renameDeck(created.id, DECK_A);
  check("a deck can be renamed", () => assert.equal(renamedBack.ok, true));

  const unknownRename = await mutations.renameDeck(
    "00000000-0000-4000-8000-000000000000",
    "Nope",
  );
  check("renaming a deck that does not exist is refused", () =>
    assert.equal(unknownRename.ok, false),
  );

  // ---- an empty deck ------------------------------------------------------
  console.log("\nan empty deck");

  const empty = await queries.getDeck(created.id);
  assert.ok(empty);
  check("an empty deck reports both missing things and nothing else", () => {
    assert.equal(report(empty).legal, false);
    assert.deepEqual(
      report(empty)
        .problems.map((p) => p.code)
        .sort(),
      ["deck_size", "no_commander"],
    );
    assert.equal(empty.cards.length, 0);
    assert.deepEqual(empty.missing, []);
  });

  const unknownDeck = await queries.getDeck(
    "00000000-0000-4000-8000-000000000000",
  );
  check("an unknown deck id returns null rather than throwing", () =>
    assert.equal(unknownDeck, null),
  );

  // ---- a deck built from a precon ----------------------------------------
  console.log("\nbuilt from a precon");

  const contents = await products.ensureProductContents(PRODUCT);
  assert.equal(contents.ok, true, JSON.stringify(contents));

  const location = await collection.createLocation(TEST_LOCATION, "deck");
  assert.equal(location.ok, true);
  if (!location.ok) return;

  const fromProduct = await mutations.createDeckFromProduct(
    PRODUCT,
    DECK_B,
    location.id,
  );
  assert.equal(fromProduct.ok, true, JSON.stringify(fromProduct));
  if (!fromProduct.ok) return;

  const precon = await queries.getDeck(fromProduct.id);
  assert.ok(precon);

  check("the precon copied across as exactly 100 cards", () =>
    assert.equal(report(precon).cardCount, 100),
  );

  check("it has one commander, and it is a legendary creature", () => {
    const commanders = precon.cards.filter((c) => c.board === "commander");
    assert.equal(commanders.length, 1);
    assert.match(commanders[0].typeLine ?? "", /^Legendary Creature/);
  });

  check("a real precon is reported legal — every rule, real data", () => {
    assert.deepEqual(
      report(precon).problems,
      [],
      `unexpected problems: ${report(precon)
        .problems.map((p) => p.message)
        .join(" | ")}`,
    );
    assert.equal(report(precon).legal, true);
  });

  check("its colour identity came from the commander", () => {
    assert.ok(report(precon).colorIdentity.length > 0);
    const commander = precon.cards.find((c) => c.board === "commander");
    assert.ok(commander);
    assert.deepEqual(
      report(precon).colorIdentity,
      legality.sortColors(commander.colorIdentity),
    );
  });

  check("every card is inside that identity", () => {
    for (const card of precon.cards) {
      for (const color of card.colorIdentity) {
        assert.ok(
          report(precon).colorIdentity.includes(color),
          `${card.name} is ${color}`,
        );
      }
    }
  });

  check("basics came across as one row with a quantity", () => {
    const basics = precon.cards.filter((c) => c.typeLine?.startsWith("Basic"));
    assert.ok(basics.length > 0, "no basics in the precon");
    assert.ok(
      basics.some((b) => b.quantity > 1),
      "expected a stacked basic row",
    );
  });

  check("the deck is linked to the location it was built into", () => {
    assert.equal(precon.locationId, location.id);
    assert.equal(precon.locationName, TEST_LOCATION);
  });

  check("the precon's printings were pinned, not just the cards", () => {
    const pinned = precon.cards.filter((c) => c.printingId !== null);
    assert.equal(pinned.length, precon.cards.length);
    const commander = precon.cards.find((c) => c.board === "commander");
    assert.equal(commander?.printingSetCode, "blc");
  });

  const duplicateProduct = await mutations.createDeckFromProduct(
    PRODUCT,
    DECK_B,
    null,
  );
  check("building the same deck name twice is refused", () =>
    assert.equal(duplicateProduct.ok, false),
  );

  const unknownProduct = await mutations.createDeckFromProduct(
    "NotAProduct_ZZZ",
    "Decks Smoke Nope",
    null,
  );
  check("building from an unknown product is refused", () =>
    assert.equal(unknownProduct.ok, false),
  );

  // ---- the buy list -------------------------------------------------------
  console.log("\nbuy list");

  check("owning nothing means the whole deck is on the buy list", () => {
    // The collection starts empty of these; every card is needed.
    assert.equal(precon.missing.length, precon.cards.length);
    const need = precon.missing.reduce((n, m) => n + m.need, 0);
    assert.equal(need, 100);
  });

  const buyList = queries.formatBuyList(precon.missing.slice(0, 3));
  check("the buy list is importable text with no set codes", () => {
    const lines = buyList.split("\n");
    assert.equal(lines.length, 3);
    for (const line of lines) assert.match(line, /^\d+ .+$/);
    assert.ok(!buyList.includes("("));
  });

  check("the filename is a slug", () =>
    assert.equal(
      queries.buyListFilename("Family Matters!"),
      "family-matters-buy-list.txt",
    ),
  );

  // ---- owning the cards ---------------------------------------------------
  console.log("\nowning the cards");

  const addedProduct = await productMutations.addProductToCollection({
    fileName: PRODUCT,
    locationId: location.id,
    condition: "NM",
    boards: ["commander", "main"],
  });
  assert.equal(addedProduct.ok, true, JSON.stringify(addedProduct));

  const owned = await queries.getDeck(fromProduct.id);
  assert.ok(owned);
  check("buying the product empties the buy list", () =>
    assert.deepEqual(
      owned.missing,
      [],
      `still missing: ${owned.missing.map((m) => m.name).join(", ")}`,
    ),
  );

  check("every card now reads as available", () => {
    for (const card of owned.cards) {
      assert.ok(
        card.available >= card.quantity,
        `${card.name}: ${card.available} available, needs ${card.quantity}`,
      );
    }
  });

  // ---- allocation, and not double-counting -------------------------------
  console.log("\nallocation");

  const allocated = await mutations.setDeckAllocation(fromProduct.id, true);
  assert.equal(allocated.ok, true, JSON.stringify(allocated));
  if (!allocated.ok) return;

  check("allocating claims every card it can supply", () => {
    assert.equal(allocated.cards, owned.cards.length);
    assert.equal(allocated.skipped, 0);
  });

  const selfAfterAllocation = await queries.getDeck(fromProduct.id);
  assert.ok(selfAfterAllocation);
  check("a deck's own claim does not count against itself", () => {
    // Without excluding this deck from the subtraction, allocating would
    // make every card in it immediately read as unavailable.
    for (const card of selfAfterAllocation.cards) {
      assert.ok(
        card.available >= card.quantity,
        `${card.name} became unavailable to its own deck`,
      );
    }
    assert.deepEqual(selfAfterAllocation.missing, []);
  });

  // A second deck wanting the same cards must see them as taken.
  const commanderCard = owned.cards.find((c) => c.board === "commander");
  assert.ok(commanderCard);

  const addedToA = await mutations.addDeckCard({
    deckId: created.id,
    oracleId: commanderCard.oracleId,
    board: "commander",
  });
  assert.equal(addedToA.ok, true, JSON.stringify(addedToA));

  /*
   * Measured against what is there, not against 1.
   *
   * This suite used to assert "the collection holds exactly one" of the
   * commander, which was true only while the database was empty of anything
   * but its own fixtures. Owning the same precon yourself made it fail on a
   * correct app. What the claim actually promises is a difference: one more
   * copy spoken for, and the collection itself unchanged.
   */
  const unclaimed = await mutations.setDeckAllocation(fromProduct.id, false);
  assert.equal(unclaimed.ok, true);

  const deckABefore = await queries.getDeck(created.id);
  assert.ok(deckABefore);
  const rowBefore = deckABefore.cards.find(
    (c) => c.oracleId === commanderCard.oracleId,
  );
  assert.ok(rowBefore);
  const ownedCopies = rowBefore.owned;
  const freeBefore = rowBefore.available;
  assert.ok(freeBefore >= 1, "the suite's own copy should be free here");

  const reclaimed = await mutations.setDeckAllocation(fromProduct.id, true);
  assert.equal(reclaimed.ok, true);

  const deckA = await queries.getDeck(created.id);
  assert.ok(deckA);
  check("a card claimed by another built deck is not available here", () => {
    const row = deckA.cards.find((c) => c.oracleId === commanderCard.oracleId);
    assert.ok(row);
    assert.equal(row.owned, ownedCopies, "claiming moves nothing you own");
    assert.equal(row.available, freeBefore - 1, "one copy is spoken for");
    assert.deepEqual(
      deckA.missing,
      row.available >= row.quantity
        ? []
        : [{ oracleId: row.oracleId, name: row.name, need: 1 }],
    );
  });

  const releaseAll = await mutations.setDeckAllocation(fromProduct.id, false);
  assert.equal(releaseAll.ok, true);

  const deckAFree = await queries.getDeck(created.id);
  assert.ok(deckAFree);
  check("releasing the other deck makes it available again", () => {
    const row = deckAFree.cards.find(
      (c) => c.oracleId === commanderCard.oracleId,
    );
    assert.ok(row);
    assert.equal(row.available, freeBefore);
    assert.deepEqual(deckAFree.missing, []);
  });

  const allocateUnowned = await mutations.setDeckAllocation(created.id, true);
  assert.equal(allocateUnowned.ok, true);
  if (!allocateUnowned.ok) return;
  check("allocating claims only what the collection can supply", () => {
    assert.equal(allocateUnowned.cards, 1);
    assert.equal(allocateUnowned.skipped, 0);
  });

  await mutations.setDeckAllocation(created.id, false);

  // ---- editing a deck -----------------------------------------------------
  console.log("\nediting");

  const solRing = await queries.searchDeckCards(created.id, "Sol Ring", 5);
  check("search finds a card and says whether it is owned", () => {
    const row = solRing.find((c) => c.name === "Sol Ring");
    assert.ok(row, "Sol Ring not found");
    assert.equal(typeof row.owned, "number");
    assert.equal(typeof row.available, "number");
  });

  check("an exact name ranks first", () =>
    assert.equal(solRing[0]?.name, "Sol Ring"),
  );

  const emptySearch = await queries.searchDeckCards(created.id, "   ");
  check("an empty search returns nothing rather than everything", () =>
    assert.equal(emptySearch.length, 0),
  );

  const wildcardSearch = await queries.searchDeckCards(created.id, "%");
  check("a literal % is searched for, not treated as a wildcard", () =>
    assert.equal(wildcardSearch.length, 0),
  );

  /*
   * A card outside the commander's identity — found rather than named.
   *
   * The first draft hardcoded Counterspell and failed: this precon's
   * commander is R/U/W, so a blue card is perfectly legal in it. Picking the
   * card from the identity the deck actually has keeps the test correct
   * whichever precon it runs against.
   */
  const offColorCandidates = [
    "Llanowar Elves",
    "Dark Ritual",
    "Counterspell",
    "Lightning Bolt",
    "Giant Growth",
  ];

  let offColor:
    Awaited<ReturnType<typeof queries.searchDeckCards>>[number] | null = null;
  for (const name of offColorCandidates) {
    const found = (await queries.searchDeckCards(created.id, name, 5)).find(
      (c) => c.name === name,
    );
    if (found && !found.inIdentity) {
      offColor = found;
      break;
    }
  }

  assert.ok(
    offColor,
    `no off-identity card found among ${offColorCandidates.join(", ")}`,
  );

  check(`search flags ${offColor.name} as outside the identity`, () =>
    assert.equal(offColor.inIdentity, false),
  );

  const addedOffColor = await mutations.addDeckCard({
    deckId: created.id,
    oracleId: offColor.oracleId,
  });
  assert.equal(addedOffColor.ok, true);

  const withOffColor = await queries.getDeck(created.id);
  assert.ok(withOffColor);
  check("and the deck reports it as an identity error", () => {
    const problem = report(withOffColor).problems.find(
      (p) => p.code === "color_identity",
    );
    assert.ok(problem, "no identity problem reported");
    assert.ok(problem.message.includes(offColor.name));
  });

  // A banned card.
  const bannedSearch = await queries.searchDeckCards(
    created.id,
    "Black Lotus",
    5,
  );
  const blackLotus = bannedSearch.find((c) => c.name === "Black Lotus");
  assert.ok(blackLotus, "Black Lotus not found");
  check("search reports commander legality", () =>
    assert.equal(blackLotus.commanderLegality, "banned"),
  );

  await mutations.addDeckCard({
    deckId: created.id,
    oracleId: blackLotus.oracleId,
  });
  const withBanned = await queries.getDeck(created.id);
  assert.ok(withBanned);
  check("a banned card is reported by name", () => {
    const problem = report(withBanned).problems.find(
      (p) => p.code === "banned",
    );
    assert.ok(problem);
    assert.match(problem.message, /Black Lotus/);
  });

  // Quantities.
  const lotusRow = withBanned.cards.find(
    (c) => c.oracleId === blackLotus.oracleId,
  );
  assert.ok(lotusRow);

  const bumped = await mutations.adjustDeckCard(lotusRow.id, 1);
  assert.equal(bumped.ok, true);
  if (!bumped.ok) return;
  check("a quantity can be bumped", () => assert.equal(bumped.quantity, 2));

  const withTwo = await queries.getDeck(created.id);
  assert.ok(withTwo);
  check("two copies breaks singleton", () =>
    assert.ok(report(withTwo).problems.some((p) => p.code === "singleton")),
  );

  const toZero = await mutations.adjustDeckCard(lotusRow.id, -2);
  assert.equal(toZero.ok, true);
  if (!toZero.ok) return;
  check("dropping to zero removes the row rather than storing a zero", () => {
    assert.equal(toZero.quantity, 0);
    assert.equal(toZero.deleted, true);
  });

  const { rows: zeroRows } = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM deck_cards WHERE quantity <= 0`,
  );
  check("no zero-quantity row exists anywhere", () =>
    assert.equal(zeroRows[0].n, 0),
  );

  const gone = await mutations.adjustDeckCard(lotusRow.id, -1);
  check("adjusting a row that is gone is refused", () =>
    assert.equal(gone.ok, false),
  );

  // Promote to the command zone, which is a board move.
  const afterLotus = await queries.getDeck(created.id);
  assert.ok(afterLotus);
  const counterRow = afterLotus.cards.find(
    (c) => c.oracleId === offColor.oracleId,
  );
  assert.ok(counterRow);

  const promoted = await mutations.setDeckCardBoard(counterRow.id, "commander");
  assert.equal(promoted.ok, true);

  const withTwoCommanders = await queries.getDeck(created.id);
  assert.ok(withTwoCommanders);
  check("promoting a card moves it to the command zone", () =>
    assert.equal(
      withTwoCommanders.cards.filter((c) => c.board === "commander").length,
      2,
    ),
  );

  check("a non-commander in the command zone is an error", () => {
    const problem = report(withTwoCommanders).problems.find(
      (p) => p.code === "invalid_commander",
    );
    assert.ok(problem, `${offColor.name} was accepted as a commander`);
    assert.ok(problem.message.includes(offColor.name));
  });

  const demoted = await mutations.setDeckCardBoard(counterRow.id, "maybe");
  assert.equal(demoted.ok, true);

  const withMaybe = await queries.getDeck(created.id);
  assert.ok(withMaybe);
  check("the maybeboard counts toward nothing", () => {
    const maybes = withMaybe.cards.filter((c) => c.board === "maybe");
    assert.equal(maybes.length, 1);
    // One commander remains, so the count is 1 rather than 2.
    assert.equal(report(withMaybe).cardCount, 1);
    assert.ok(
      !report(withMaybe).problems.some((p) => p.code === "color_identity"),
      "a maybeboard card was checked against colour identity",
    );
    assert.ok(!withMaybe.missing.some((m) => m.name === offColor.name));
  });

  const badBoard = await mutations.setDeckCardBoard(counterRow.id, "graveyard");
  check("an invalid board is refused", () => assert.equal(badBoard.ok, false));

  const removedCard = await mutations.removeDeckCard(counterRow.id);
  check("a card can be removed outright", () =>
    assert.equal(removedCard.ok, true),
  );

  // ---- the deck list ------------------------------------------------------
  console.log("\ndeck list");

  const list = await queries.listDecks();
  check("both decks are listed with their counts", () => {
    assert.equal(list.length, startDecks + 2);
    const beta = list.find((d) => d.name === DECK_B);
    assert.ok(beta);
    assert.equal(beta.cardCount, 100);
    assert.equal(beta.commanderNames.length, 1);
    assert.equal(beta.locationName, TEST_LOCATION);
    assert.ok(beta.colorIdentity.length > 0);
  });

  check("the list's owned count agrees with the detail page", () => {
    const beta = list.find((d) => d.name === DECK_B);
    assert.ok(beta);
    assert.equal(beta.ownedCopies, 100);
    assert.equal(beta.allocatedCopies, 0);
  });

  // ---- location handling --------------------------------------------------
  console.log("\nlocations");

  const unlinked = await mutations.setDeckLocation(fromProduct.id, null);
  assert.equal(unlinked.ok, true);
  const afterUnlink = await queries.getDeck(fromProduct.id);
  check("a deck can be unlinked from its location", () =>
    assert.equal(afterUnlink?.locationId, null),
  );

  const badLocation = await mutations.setDeckLocation(
    fromProduct.id,
    "00000000-0000-4000-8000-000000000000",
  );
  check("linking to a location that does not exist is refused", () =>
    assert.equal(badLocation.ok, false),
  );

  // ---- cleanup ------------------------------------------------------------
  console.log("\ncleanup");

  const removedProduct = await productMutations.removeProductFromCollection({
    fileName: PRODUCT,
    locationId: location.id,
    condition: "NM",
    boards: ["commander", "main"],
  });
  assert.equal(removedProduct.ok, true);

  assert.equal((await mutations.deleteDeck(created.id)).ok, true);
  assert.equal((await mutations.deleteDeck(fromProduct.id)).ok, true);

  const locationGone = await collection.deleteLocation(location.id);
  assert.equal(locationGone.ok, true, JSON.stringify(locationGone));

  const { rows: endDeckRows } = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM decks`,
  );
  const endTotals = await colQueries.getCollectionTotals();

  check("no decks left behind", () =>
    assert.equal(endDeckRows[0].n, startDecks),
  );
  const { rows: orphanRows } = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM deck_cards dc
     WHERE NOT EXISTS (SELECT 1 FROM decks d WHERE d.id = dc.deck_id)
  `);
  check("no orphaned deck cards", () => assert.equal(orphanRows[0].n, 0));
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
