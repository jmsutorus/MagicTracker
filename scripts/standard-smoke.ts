/**
 * End-to-end check of Standard decks: `npm run standard:smoke`
 *
 * Needs a loaded card database. It creates two decks, exercises the Standard
 * path end to end, and asserts the database is back exactly where it
 * started.
 *
 * lib/decks/standard.test.ts covers the rules against fixtures. What it
 * cannot cover is the half that only exists in SQL and in the format column:
 * that a Standard deck is stored as one, that `getDeck` hands back a
 * Standard verdict rather than a Commander one, that each deck's rows are
 * read with *its own* legality column, that the sideboard is a real board
 * the writes will accept, that a command zone is refused on a deck that has
 * none, and that a pasted sideboard lands in the sideboard. Those fail
 * against a real database or not at all.
 */
import assert from "node:assert/strict";

import { config } from "dotenv";

config({ path: ".env.local" });

const TEST_DECK = "Standard Smoke Deck";
const TEST_COMMANDER = "Standard Smoke Commander Deck";
const IMPORTED_DECK = "Standard Smoke Imported";

let passed = 0;
function check(label: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok  ${label}`);
}

async function main() {
  const [{ getDb }, { sql }, queries, mutations, constants, importer, share] =
    await Promise.all([
      import("../lib/db"),
      import("drizzle-orm"),
      import("../lib/decks/queries"),
      import("../lib/decks/mutations"),
      import("../lib/decks/constants"),
      import("../lib/import/mutations"),
      import("../lib/decks/share"),
    ]);

  const db = getDb();

  type Deck = NonNullable<Awaited<ReturnType<typeof queries.getDeck>>>;

  /** The Standard report, asserting that is what this deck has. */
  function report(deck: Deck) {
    if (deck.verdict.kind !== "standard") {
      throw new Error(`${deck.name} is not a Standard deck`);
    }
    return deck.verdict.report;
  }

  function hasProblem(deck: Deck, code: string): boolean {
    return report(deck).problems.some((p) => p.code === code);
  }

  // ---- pre-clean anything an interrupted run left behind ------------------
  await db.execute(
    sql`DELETE FROM decks
         WHERE name IN (${TEST_DECK}, ${TEST_COMMANDER}, ${IMPORTED_DECK})`,
  );

  const startCounts = await counts();

  /* -- cards to build with ------------------------------------------------- */

  /*
   * Real cards, chosen for what this database says about them rather than
   * for what they are: one Standard-legal card, one that certainly is not
   * (Lightning Bolt has not been in Standard for a very long time), and a
   * basic land, which is the exemption to the four-copy rule. Looked up by
   * name so every assertion below is about real `legalities` values.
   */
  const { rows: picked } = await db.execute<{
    oracle_id: string;
    name: string;
    standard: string | null;
    commander: string | null;
  }>(sql`
    SELECT DISTINCT ON (o.name)
           o.oracle_id::text AS oracle_id,
           o.name,
           o.legalities->>'standard'  AS standard,
           o.legalities->>'commander' AS commander
      FROM oracle_cards o
     WHERE o.name IN ('Lightning Bolt', 'Mountain')
     ORDER BY o.name
  `);

  const byName = new Map(picked.map((r) => [r.name, r]));
  const bolt = byName.get("Lightning Bolt");
  const mountain = byName.get("Mountain");
  assert.ok(bolt, "Lightning Bolt is not in the card database");
  assert.ok(mountain, "Mountain is not in the card database");

  /**
   * A card that is legal in Standard *today*, read out of the database
   * rather than named here: Standard rotates, so any card this script named
   * would eventually rotate out and turn a passing check into a failing one
   * for no reason anybody changed.
   */
  const { rows: legalRows } = await db.execute<{
    oracle_id: string;
    name: string;
  }>(sql`
    SELECT o.oracle_id::text AS oracle_id, o.name
      FROM oracle_cards o
     WHERE o.legalities->>'standard' = 'legal'
       AND o.layout = 'normal'
     ORDER BY o.name
     LIMIT 1
  `);
  const legalCard = legalRows[0];
  assert.ok(legalCard, "no Standard-legal card in the database");

  /* -- creating a Standard deck -------------------------------------------- */

  const created = await mutations.createDeck(TEST_DECK, {
    format: "standard",
  });
  assert.ok(created.ok, "could not create the Standard deck");
  const deckId = created.id;

  try {
    const commanderDeck = await mutations.createDeck(TEST_COMMANDER);
    assert.ok(commanderDeck.ok, "could not create the Commander deck");

    const { rows: formats } = await db.execute<{
      name: string;
      format: string;
      target_size: number | null;
    }>(sql`
      SELECT name, format, target_size FROM decks
       WHERE name IN (${TEST_DECK}, ${TEST_COMMANDER}) ORDER BY name
    `);
    const stored = new Map(formats.map((r) => [r.name, r]));

    check("a Standard deck is stored as one, and stores no size", () => {
      assert.equal(stored.get(TEST_DECK)?.format, "standard");
      // 60 is the rule and there is no maximum, so there is no number a row
      // could hold that would not be redundant or wrong.
      assert.equal(stored.get(TEST_DECK)?.target_size, null);
    });

    const resize = await mutations.setDeckTargetSize(deckId, 75);
    check("resizing refuses a Standard deck — only a cube has a size", () => {
      assert.equal(resize.ok, false);
    });

    /* -- the boards a Standard deck has -------------------------------- */

    const toSideboard = await mutations.addDeckCard({
      deckId,
      oracleId: legalCard.oracle_id,
      board: "side",
    });
    check("the sideboard is a board the writes accept", () =>
      assert.ok(toSideboard.ok, "could not add to the sideboard"),
    );

    /*
     * A sideboard on a Commander deck is refused at the write, not just
     * hidden in the editor: no Commander verdict counts that board, while
     * ownership and the buy list both would.
     */
    const sideboardOnCommander = await mutations.addDeckCard({
      deckId: commanderDeck.id,
      oracleId: legalCard.oracle_id,
      board: "side",
    });
    check("a sideboard is refused on a Commander deck", () => {
      assert.equal(sideboardOnCommander.ok, false);
      assert.match(
        sideboardOnCommander.ok ? "" : sideboardOnCommander.error,
        /no sideboard/i,
      );
    });

    /*
     * A commander in a Standard deck is the opposite case and is allowed:
     * the Standard report counts it and names it, so the row is explained
     * rather than invisible. Same judgment the cube report makes.
     */
    const strandedCommander = await mutations.addDeckCard({
      deckId,
      oracleId: legalCard.oracle_id,
      board: "commander",
    });
    assert.ok(strandedCommander.ok, "a stranded commander should be storable");

    const stranded = await queries.getDeck(deckId);
    assert.ok(stranded);
    check("a card left in a command zone counts and is reported", () => {
      assert.equal(report(stranded).cardCount, 1, "it counts toward the deck");
      assert.ok(hasProblem(stranded, "command_zone"));
    });

    const commanderRow = stranded.cards.find((c) => c.board === "commander");
    assert.ok(commanderRow);
    await mutations.removeDeckCard(commanderRow.id);

    /* -- the verdict ----------------------------------------------------- */

    const early = await queries.getDeck(deckId);
    assert.ok(early, "the deck disappeared");

    check("getDeck hands back a Standard verdict, not a Commander one", () => {
      assert.equal(early.verdict.kind, "standard");
      assert.equal(early.format, "standard");
      assert.equal(early.targetSize, constants.STANDARD_MIN_DECK_SIZE);
    });

    check("the sideboard is counted apart from the sixty", () => {
      const r = report(early);
      assert.equal(r.cardCount, 0, "one card, and it is in the sideboard");
      assert.equal(r.sideboardCount, 1);
      assert.equal(r.legal, false, "nowhere near sixty cards");
    });

    // 60 copies of a basic land: a legal deck, and the exemption to the
    // four-copy rule proved against a real type line.
    const mountains = await mutations.addDeckCard({
      deckId,
      oracleId: mountain.oracle_id,
      board: "main",
      quantity: 60,
    });
    assert.ok(mountains.ok, "could not add the Mountains");

    const sixty = await queries.getDeck(deckId);
    assert.ok(sixty);

    check("sixty basics is a legal deck, by the card's own type line", () => {
      const r = report(sixty);
      assert.equal(r.cardCount, 60);
      assert.equal(r.sideboardCount, 1);
      assert.equal(r.legal, true, JSON.stringify(r.problems));
    });

    check("the deck's own count is the sixty, not the sixty-one", () => {
      assert.equal(sixty.cardCount, 60);
    });

    /* -- the card pool --------------------------------------------------- */

    check("this database agrees Lightning Bolt is not in Standard", () => {
      assert.equal(bolt.standard, "not_legal");
      assert.equal(bolt.commander, "legal", "...but it is in Commander");
    });

    const addBolt = await mutations.addDeckCard({
      deckId,
      oracleId: bolt.oracle_id,
      board: "main",
    });
    assert.ok(addBolt.ok, "could not add Lightning Bolt");

    const withBolt = await queries.getDeck(deckId);
    assert.ok(withBolt);

    check("a card outside Standard makes the deck illegal", () => {
      assert.equal(report(withBolt).legal, false);
      assert.ok(hasProblem(withBolt, "not_legal"));
    });

    /*
     * The same card, in the deck next door, judged by that deck's format.
     * This is the check that would fail if one hard-coded legality column
     * were read for every deck.
     */
    const boltInCommander = await mutations.addDeckCard({
      deckId: commanderDeck.id,
      oracleId: bolt.oracle_id,
      board: "main",
    });
    assert.ok(boltInCommander.ok);

    const commanderView = await queries.getDeck(commanderDeck.id);
    assert.ok(commanderView);

    check("each deck reads the legality column of its own format", () => {
      const boltRow = withBolt.cards.find((c) => c.name === "Lightning Bolt");
      assert.equal(boltRow?.formatLegality, "not_legal", "in Standard");

      const commanderRow = commanderView.cards.find(
        (c) => c.name === "Lightning Bolt",
      );
      assert.equal(commanderRow?.formatLegality, "legal", "in Commander");
      assert.equal(commanderView.verdict.kind, "commander");
    });

    const search = await queries.searchDeckCards(deckId, "Lightning Bolt", 5);
    const searched = search.find((c) => c.name === "Lightning Bolt");
    check("the card search judges by the deck's format too", () => {
      assert.ok(searched, "Lightning Bolt not found");
      assert.equal(searched.formatLegality, "not_legal");
    });

    const commanderSearch = await queries.searchDeckCards(
      commanderDeck.id,
      "Lightning Bolt",
      5,
    );
    check("...and says the opposite in the Commander deck", () => {
      assert.equal(
        commanderSearch.find((c) => c.name === "Lightning Bolt")
          ?.formatLegality,
        "legal",
      );
    });

    /* -- the four-copy limit, across both boards ------------------------- */

    // Remove the Mountains so the limit can be tested on a real card
    // without the deck being 60 lands.
    const mountainRow = withBolt.cards.find((c) => c.name === "Mountain");
    assert.ok(mountainRow);
    await mutations.removeDeckCard(mountainRow.id);

    // One Bolt is already there, so three more make a playset.
    const boltRow = withBolt.cards.find((c) => c.name === "Lightning Bolt");
    assert.ok(boltRow);
    await mutations.adjustDeckCard(boltRow.id, 3);

    const fourMain = await queries.getDeck(deckId);
    assert.ok(fourMain);
    check("four copies on one board is within the limit", () => {
      assert.equal(
        report(fourMain).problems.some((p) => p.code === "copies"),
        false,
      );
    });

    // ...and the same card in the sideboard pushes the total over it, which
    // no per-row check could see: these are two rows by design.
    const addSide = await mutations.addDeckCard({
      deckId,
      oracleId: bolt.oracle_id,
      board: "side",
      quantity: 2,
    });
    assert.ok(addSide.ok);

    const sixCopies = await queries.getDeck(deckId);
    assert.ok(sixCopies);

    check("four in the deck plus two in the sideboard is six copies", () => {
      const copies = report(sixCopies).problems.find(
        (p) => p.code === "copies",
      );
      assert.ok(copies, "the combined limit was not checked");
      assert.match(copies.message, /6× Lightning Bolt/);
    });

    /* -- the deck list and the share page -------------------------------- */

    const listed = await queries.listDecks();
    check("the deck list separates the sideboard from the sixty", () => {
      const row = listed.find((d) => d.name === TEST_DECK);
      assert.ok(row, "the deck is missing from the list");
      assert.equal(row.format, "standard");
      assert.equal(row.targetSize, constants.STANDARD_MIN_DECK_SIZE);
      assert.equal(row.cardCount, 4, "four Lightning Bolts in the deck");
      assert.equal(row.sideboardCount, 3, "two Bolts and one other card");
    });

    const link = await share.createShareLink(deckId);
    assert.ok(link.ok, "could not share the deck");

    const shared = await share.getSharedDeck(link.token);
    check("a shared Standard deck carries its own verdict", () => {
      assert.ok(shared, "the share link did not resolve");
      assert.equal(shared.format, "standard");
      assert.equal(shared.verdict.kind, "standard");
      assert.equal(shared.targetSize, constants.STANDARD_MIN_DECK_SIZE);
    });

    check("the shared list keeps the sideboard as its own board", () => {
      const boards = shared!.boards.map((b) => b.board);
      assert.ok(boards.includes("side"), `boards were ${boards.join(", ")}`);
      // The owner's business stays the owner's: nothing about ownership,
      // price or location travels with a shared deck.
      const serialised = JSON.stringify(shared);
      for (const leak of ["available", "owned", "locationName", "notes"]) {
        assert.equal(
          serialised.includes(leak),
          false,
          `"${leak}" leaked into the shared payload`,
        );
      }
    });

    /* -- a pasted sideboard ---------------------------------------------- */

    /*
     * The import's half of the format question: a "Sideboard" heading means
     * a real sideboard when the destination has one, and the maybeboard when
     * it does not.
     */
    const pasted = await importer.applyImport(
      [
        { oracleId: legalCard.oracle_id, quantity: 4, board: "main" },
        { oracleId: legalCard.oracle_id, quantity: 2, board: "side" },
      ],
      { kind: "new-deck", name: IMPORTED_DECK, format: "standard" },
    );
    assert.ok(pasted.ok, "the import failed");

    const importedDeck = await queries.getDeck(pasted.deckId!);
    assert.ok(importedDeck);

    check("an imported Standard deck keeps its sideboard as one", () => {
      assert.equal(importedDeck.format, "standard");
      const side = importedDeck.cards.filter((c) => c.board === "side");
      assert.equal(side.length, 1);
      assert.equal(side[0].quantity, 2);
      assert.equal(report(importedDeck).sideboardCount, 2);
      assert.equal(report(importedDeck).cardCount, 4);
    });

    check("six copies over two boards is caught on the imported deck too", () =>
      assert.ok(hasProblem(importedDeck, "copies")),
    );

    /*
     * ...and the same payload sent at a Commander deck, which has no
     * sideboard. The cards are kept — a paste never loses cards — on the
     * board that counts toward nothing, rather than becoming rows the
     * Commander verdict cannot see.
     */
    const strayed = await importer.applyImport(
      [{ oracleId: legalCard.oracle_id, quantity: 2, board: "side" }],
      { kind: "deck", deckId: commanderDeck.id },
    );
    assert.ok(strayed.ok, "the import failed");

    const commanderAfter = await queries.getDeck(commanderDeck.id);
    assert.ok(commanderAfter);

    check(
      "a sideboard imported into a Commander deck lands on the maybeboard",
      () => {
        assert.equal(
          commanderAfter.cards.some((c) => c.board === "side"),
          false,
          "a sideboard row survived on a deck with no sideboard",
        );
        const maybe = commanderAfter.cards.find((c) => c.board === "maybe");
        assert.ok(maybe, "the cards were dropped instead of re-filed");
        assert.equal(maybe.quantity, 2);
      },
    );
  } finally {
    await db.execute(
      sql`DELETE FROM decks
           WHERE name IN (${TEST_DECK}, ${TEST_COMMANDER}, ${IMPORTED_DECK})`,
    );
  }

  const endCounts = await counts();
  check("the database is back exactly where it started", () => {
    assert.deepEqual(endCounts, startCounts);
  });

  console.log(`\n${passed} checks passed.`);

  async function counts() {
    const { rows } = await db.execute<{
      decks: number;
      deck_cards: number;
      items: number;
      standard: number;
    }>(sql`
      SELECT (SELECT count(*) FROM decks)::int AS decks,
             (SELECT count(*) FROM deck_cards)::int AS deck_cards,
             (SELECT count(*) FROM collection_items)::int AS items,
             (SELECT count(*) FROM decks WHERE format = 'standard')::int
               AS standard
    `);
    return rows[0];
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nstandard smoke failed:", error);
    process.exit(1);
  });
