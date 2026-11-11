/**
 * End-to-end check of cube decks: `npm run cube:smoke`
 *
 * Needs a loaded card database. It creates two decks, exercises the cube
 * path end to end, and asserts the database is back exactly where it
 * started.
 *
 * lib/decks/cube.test.ts covers the arithmetic against fixtures. What it
 * cannot cover is the half that only exists in SQL and in the format column:
 * that a cube is stored as one, that `getDeck` hands back a cube verdict
 * rather than a Commander one, that resizing refuses a Commander deck, and
 * that the distributions are computed from real `colors`, `cmc` and
 * `type_line` values rather than from hand-written rows. Those fail against
 * a real database or not at all.
 */
import assert from "node:assert/strict";

import { config } from "dotenv";

config({ path: ".env.local" });

const TEST_CUBE = "Cube Smoke Pool";
const TEST_DECK = "Cube Smoke Commander Deck";
const IMPORTED_CUBE = "Cube Smoke Imported";

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
    constants,
    cube,
    importer,
    exportBuild,
    share,
  ] = await Promise.all([
    import("../lib/db"),
    import("drizzle-orm"),
    import("../lib/decks/queries"),
    import("../lib/decks/mutations"),
    import("../lib/decks/constants"),
    import("../lib/decks/cube"),
    import("../lib/import/mutations"),
    import("../lib/export/build"),
    import("../lib/decks/share"),
  ]);

  const db = getDb();

  type Deck = NonNullable<Awaited<ReturnType<typeof queries.getDeck>>>;

  /** The cube report, asserting that is what this deck has. */
  function report(deck: Deck) {
    if (deck.verdict.kind !== "cube") {
      throw new Error(`${deck.name} is not a cube`);
    }
    return deck.verdict.report;
  }

  function bucket(
    buckets: { key: string; cards: number }[],
    key: string,
  ): number {
    return buckets.find((b) => b.key === key)?.cards ?? 0;
  }

  // ---- pre-clean anything an interrupted run left behind ------------------
  await db.execute(
    sql`DELETE FROM decks WHERE name IN (${TEST_CUBE}, ${TEST_DECK}, ${IMPORTED_CUBE})`,
  );

  const startCounts = await counts();

  /* -- cards to build with ------------------------------------------------- */

  /**
   * Four real cards, each chosen for the bucket it has to land in: a
   * mono-coloured creature, a basic land, a multicolour spell and a
   * colourless artifact. Looked up by name so the assertions below are about
   * this database's own `colors`, `cmc` and `type_line` values.
   */
  const { rows: picked } = await db.execute<{
    oracle_id: string;
    name: string;
    type_line: string | null;
    colors: string[] | null;
    cmc: number | null;
  }>(sql`
    SELECT DISTINCT ON (o.name)
           o.oracle_id::text AS oracle_id, o.name, o.type_line, o.colors, o.cmc
      FROM oracle_cards o
     WHERE o.name IN ('Llanowar Elves', 'Forest', 'Sol Ring', 'Mystic Monastery')
     ORDER BY o.name
  `);

  const byName = new Map(picked.map((r) => [r.name, r]));
  for (const name of ["Llanowar Elves", "Forest", "Sol Ring"]) {
    assert.ok(byName.get(name), `${name} is not in the card database`);
  }

  const elves = byName.get("Llanowar Elves")!;
  const forest = byName.get("Forest")!;
  const solRing = byName.get("Sol Ring")!;

  /* -- creating a cube ----------------------------------------------------- */

  const created = await mutations.createDeck(TEST_CUBE, {
    format: "cube",
    targetSize: 360,
  });
  assert.ok(created.ok, "could not create the cube");
  const cubeId = created.id;

  try {
    const commanderDeck = await mutations.createDeck(TEST_DECK);
    assert.ok(commanderDeck.ok, "could not create the Commander deck");

    const { rows: formats } = await db.execute<{
      name: string;
      format: string;
      target_size: number | null;
    }>(sql`
      SELECT name, format, target_size FROM decks
       WHERE name IN (${TEST_CUBE}, ${TEST_DECK}) ORDER BY name
    `);
    const stored = new Map(formats.map((r) => [r.name, r]));

    check("the cube is stored as a cube, with its size", () => {
      assert.equal(stored.get(TEST_CUBE)?.format, "cube");
      assert.equal(stored.get(TEST_CUBE)?.target_size, 360);
    });

    check("a Commander deck stores no size — 100 is the rule", () => {
      assert.equal(stored.get(TEST_DECK)?.format, "commander");
      assert.equal(stored.get(TEST_DECK)?.target_size, null);
    });

    const badFormat = await mutations.createDeck("Cube Smoke Bad Format", {
      format: "pauper",
    });
    check("an unknown format is refused", () => {
      assert.equal(badFormat.ok, false);
    });

    const tooBig = await mutations.createDeck("Cube Smoke Too Big", {
      format: "cube",
      targetSize: 99_999,
    });
    check("a cube cannot be absurdly large", () => {
      assert.equal(tooBig.ok, false);
    });

    const tooSmall = await mutations.createDeck("Cube Smoke Too Small", {
      format: "cube",
      targetSize: 0,
    });
    check("a cube cannot be empty by definition", () => {
      assert.equal(tooSmall.ok, false);
    });

    /* -- the list ---------------------------------------------------------- */

    for (const card of [elves, forest, solRing]) {
      const added = await mutations.addDeckCard({
        deckId: cubeId,
        oracleId: card.oracle_id,
        board: "main",
      });
      assert.ok(added.ok, `could not add ${card.name}`);
    }

    const threeCards = await queries.getDeck(cubeId);
    assert.ok(threeCards, "the cube disappeared");

    check("getDeck hands back a cube verdict, not a Commander one", () => {
      assert.equal(threeCards.verdict.kind, "cube");
      assert.equal(threeCards.format, "cube");
      assert.equal(threeCards.targetSize, 360);
    });

    check("the cube is short of its target, and says by how much", () => {
      const r = report(threeCards);
      assert.equal(r.cardCount, 3);
      assert.equal(r.difference, -357);
      assert.equal(r.ready, false);
      assert.equal(r.drafters, 8, "360 seats eight");
    });

    check("the distributions come from the real card rows", () => {
      const r = report(threeCards);
      // Llanowar Elves is mono-green, Sol Ring colourless, Forest a land
      // with no colours of its own.
      assert.equal(bucket(r.colors, "G"), 1);
      assert.equal(bucket(r.colors, "colorless"), 2);
      assert.equal(r.lands, 1);
      assert.equal(bucket(r.types, "land"), 1);
      assert.equal(bucket(r.types, "creature"), 1);
      assert.equal(bucket(r.types, "artifact"), 1);
      // The land is not in the curve; the other two are 1-drops.
      assert.equal(bucket(r.curve, "1"), 2);
      assert.equal(bucket(r.curve, "0"), 0);
    });

    check("no Commander rules are applied to a cube", () => {
      const r = report(threeCards);
      // A three-card Commander deck would report no_commander and deck_size.
      assert.deepEqual(r.problems, []);
    });

    /* -- resizing ---------------------------------------------------------- */

    const resized = await mutations.setDeckTargetSize(cubeId, 3);
    assert.ok(resized.ok, "could not resize the cube");

    const atSize = await queries.getDeck(cubeId);
    assert.ok(atSize);
    check("a cube at its size is ready to draft", () => {
      const r = report(atSize);
      assert.equal(r.targetSize, 3);
      assert.equal(r.difference, 0);
      assert.equal(r.ready, true);
      assert.equal(r.drafters, null, "3 is not a whole number of packs");
    });

    const resizedCommander = await mutations.setDeckTargetSize(
      commanderDeck.id,
      360,
    );
    check("a Commander deck refuses to be resized", () => {
      assert.equal(resizedCommander.ok, false);
    });

    const badResize = await mutations.setDeckTargetSize(cubeId, -5);
    check("a nonsense size is refused", () => {
      assert.equal(badResize.ok, false);
    });

    /* -- the two things a cube report flags -------------------------------- */

    const dupe = await mutations.addDeckCard({
      deckId: cubeId,
      oracleId: solRing.oracle_id,
      board: "main",
    });
    assert.ok(dupe.ok);

    const withDupe = await queries.getDeck(cubeId);
    assert.ok(withDupe);
    check("a second Sol Ring is a warning, and still counts", () => {
      const r = report(withDupe);
      assert.equal(r.cardCount, 4);
      const problem = r.problems.find((p) => p.code === "duplicate");
      assert.ok(problem, "no duplicate warning");
      assert.equal(problem.severity, "warning");
      assert.match(problem.message, /2× Sol Ring/);
    });

    const extraForest = await mutations.addDeckCard({
      deckId: cubeId,
      oracleId: forest.oracle_id,
      board: "main",
      quantity: 9,
    });
    assert.ok(extraForest.ok);

    const withBasics = await queries.getDeck(cubeId);
    assert.ok(withBasics);
    check("ten Forests raise nothing", () => {
      const r = report(withBasics);
      assert.equal(r.cardCount, 13);
      assert.deepEqual(
        r.problems.map((p) => p.code),
        ["duplicate"],
        "only the Sol Ring is flagged",
      );
    });

    const toCommandZone = await mutations.addDeckCard({
      deckId: cubeId,
      oracleId: elves.oracle_id,
      board: "commander",
    });
    assert.ok(toCommandZone.ok);

    const withCommandZone = await queries.getDeck(cubeId);
    assert.ok(withCommandZone);
    check("a card left in the command zone is reported, not hidden", () => {
      const r = report(withCommandZone);
      assert.equal(r.cardCount, 14, "it still counts toward the size");
      const problem = r.problems.find((p) => p.code === "command_zone");
      assert.ok(problem, "no command-zone warning");
      assert.match(problem.message, /Llanowar Elves is in the command zone/);
    });

    /* -- sharing ----------------------------------------------------------- */

    const link = await share.createShareLink(cubeId);
    assert.ok(link.ok, "could not share the cube");

    const shared = await share.getSharedDeck(link.token);
    assert.ok(shared, "the share link does not resolve");

    check("a shared cube is shared as a cube", () => {
      assert.equal(shared.format, "cube");
      assert.equal(shared.targetSize, 3);
      assert.equal(shared.verdict.kind, "cube");
      if (shared.verdict.kind !== "cube") return;
      assert.equal(shared.verdict.report.cardCount, 14);
      assert.ok(shared.verdict.report.colors.length > 0);
    });

    const serialised = JSON.stringify(shared);
    check("a shared cube still says nothing about what you own", () => {
      // Same assertions as the deck share, because the cube report travels
      // with it and is the newest thing that could have leaked.
      assert.ok(!serialised.includes("available"));
      assert.ok(!serialised.includes('"owned"'));
      assert.ok(!serialised.includes("isAllocated"));
      assert.ok(!serialised.includes("locationId"));
      assert.ok(!serialised.includes(link.token));
    });

    /* -- pasting a cube in ------------------------------------------------- */

    const imported = await importer.applyImport(
      [
        { oracleId: elves.oracle_id, quantity: 1, board: "main" },
        { oracleId: solRing.oracle_id, quantity: 1, board: "main" },
      ],
      {
        kind: "new-deck",
        name: IMPORTED_CUBE,
        format: "cube",
        targetSize: 540,
      },
    );
    assert.ok(imported.ok, "could not import into a new cube");
    const importedId = imported.deckId;
    assert.ok(importedId);

    const importedDeck = await queries.getDeck(importedId);
    assert.ok(importedDeck);
    check("a pasted list can arrive as a cube, with its size", () => {
      assert.equal(importedDeck.format, "cube");
      assert.equal(importedDeck.targetSize, 540);
      assert.equal(report(importedDeck).cardCount, 2);
      assert.equal(report(importedDeck).drafters, 12);
    });

    const badImport = await importer.applyImport(
      [{ oracleId: elves.oracle_id, quantity: 1, board: "main" }],
      {
        kind: "new-deck",
        name: "Cube Smoke Bad Import",
        format: "cube",
        targetSize: 0,
      },
    );
    check("an import with a nonsense cube size is refused", () => {
      assert.equal(badImport.ok, false);
    });
    const { rows: leaked } = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM decks WHERE name = 'Cube Smoke Bad Import'`,
    );
    check("the refused import left no deck behind", () => {
      assert.equal(leaked[0].n, 0);
    });

    /* -- the list page and the export -------------------------------------- */

    const listed = await queries.listDecks();
    check("the deck list carries each deck's format and target", () => {
      const row = listed.find((d) => d.name === TEST_CUBE);
      assert.ok(row, "the cube is missing from the list");
      assert.equal(row.format, "cube");
      assert.equal(row.targetSize, 3);
      assert.equal(row.cardCount, 14);
      assert.deepEqual(row.commanderNames, ["Llanowar Elves"]);

      const commanderRow = listed.find((d) => d.name === TEST_DECK);
      assert.ok(commanderRow);
      assert.equal(commanderRow.format, "commander");
      assert.equal(
        commanderRow.targetSize,
        constants.COMMANDER_DECK_SIZE,
        "a Commander deck is measured against 100",
      );
    });

    const data = await exportBuild.buildExport();
    check("the export carries the cube's size so a restore keeps it", () => {
      assert.equal(data.formatVersion, exportBuild.EXPORT_FORMAT_VERSION);
      const row = data.decks.find((d) => d.name === TEST_CUBE);
      assert.ok(row, "the cube is missing from the export");
      assert.equal(row.format, "cube");
      assert.equal(row.targetSize, 3);

      const commanderRow = data.decks.find((d) => d.name === TEST_DECK);
      assert.ok(commanderRow);
      assert.equal(commanderRow.targetSize, null);
    });

    check("describeDraft spells out the pod the target seats", () => {
      assert.equal(cube.describeDraft(540), "12 drafters at 3 packs of 15");
      assert.equal(cube.describeDraft(3), null);
    });
  } finally {
    await db.execute(
      sql`DELETE FROM decks WHERE name IN (${TEST_CUBE}, ${TEST_DECK}, ${IMPORTED_CUBE})`,
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
      cubes: number;
    }>(sql`
      SELECT (SELECT count(*) FROM decks)::int AS decks,
             (SELECT count(*) FROM deck_cards)::int AS deck_cards,
             (SELECT count(*) FROM collection_items)::int AS items,
             (SELECT count(*) FROM decks WHERE format = 'cube')::int AS cubes
    `);
    return rows[0];
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\ncube smoke failed:", error);
    process.exit(1);
  });
