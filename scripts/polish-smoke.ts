/**
 * End-to-end check of Phase 8's two database-touching pieces:
 * `npm run polish:smoke`
 *
 *   - share links: minting, rotating, revoking, and what a visitor can see
 *   - the export: that it contains the data that cannot be regenerated, and
 *     nothing that should not leave
 *
 * Needs a loaded card database. It creates one deck, exercises both, and
 * asserts the database is back exactly where it started.
 *
 * The leak assertions are the point of this file. "Does the share page show
 * the right cards" is visible on screen; "does it quietly include the deck's
 * notes, its location, or the token itself" is the kind of thing that is
 * invisible until it matters, so both are checked against the serialised
 * output rather than field by field.
 */
import assert from "node:assert/strict";

import { config } from "dotenv";

config({ path: ".env.local" });

const TEST_DECK = "Polish Smoke Deck";
const SECRET_NOTE = "private-note-do-not-share-7f3a";

let passed = 0;
function check(label: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok  ${label}`);
}

async function main() {
  const [{ getDb }, { sql }, mutations, share, exportBuild] = await Promise.all(
    [
      import("../lib/db"),
      import("drizzle-orm"),
      import("../lib/decks/mutations"),
      import("../lib/decks/share"),
      import("../lib/export/build"),
    ],
  );

  const db = getDb();

  // ---- pre-clean anything an interrupted run left behind ------------------
  await db.execute(sql`DELETE FROM decks WHERE name = ${TEST_DECK}`);

  const startCounts = await counts();

  /* -- a deck to share ----------------------------------------------------- */

  const { rows: commanders } = await db.execute<{
    oracle_id: string;
    name: string;
  }>(sql`
    SELECT o.oracle_id::text AS oracle_id, o.name
      FROM oracle_cards o
     WHERE o.type_line LIKE 'Legendary Creature%'
       AND o.legalities->>'commander' = 'legal'
       AND o.edhrec_rank IS NOT NULL
     ORDER BY o.edhrec_rank ASC
     LIMIT 1
  `);
  const { rows: staples } = await db.execute<{
    oracle_id: string;
    name: string;
  }>(sql`
    SELECT o.oracle_id::text AS oracle_id, o.name
      FROM oracle_cards o
     WHERE o.name = 'Sol Ring'
     LIMIT 1
  `);

  assert.ok(commanders[0], "no legendary creature in the card database");
  assert.ok(staples[0], "Sol Ring is not in the card database");

  const created = await mutations.createDeck(TEST_DECK);
  assert.ok(created.ok, "could not create the test deck");
  const deckId = created.id;

  try {
    await mutations.addDeckCard({
      deckId,
      oracleId: commanders[0].oracle_id,
      board: "commander",
      quantity: 1,
    });
    await mutations.addDeckCard({
      deckId,
      oracleId: staples[0].oracle_id,
      board: "main",
      quantity: 1,
    });
    await mutations.setDeckNotes(deckId, SECRET_NOTE);

    /* -- before sharing ---------------------------------------------------- */

    const before = await share.getShareState(deckId);
    check("a new deck has no share link", () => {
      assert.equal(before.token, null);
      assert.equal(before.createdAt, null);
    });

    check("a token has to look like a token", () => {
      assert.equal(share.isShareToken("short"), false);
      assert.equal(share.isShareToken("has spaces in it here"), false);
      assert.equal(share.isShareToken("../../etc/passwd"), false);
      assert.equal(share.isShareToken("a".repeat(22)), true);
    });

    // Deliberately shaped like a real token: this has to miss on the value,
    // not on the format test above.
    const unissued = await share.getSharedDeck("Zm9vYmFyYmF6cXV4MTIzNA");
    check("an unissued token resolves to nothing", () => {
      assert.equal(unissued, null);
    });

    const malformed = await share.getSharedDeck("nope");
    check("a malformed token never reaches the database", () => {
      assert.equal(malformed, null);
    });

    /* -- sharing ----------------------------------------------------------- */

    const link = await share.createShareLink(deckId);
    assert.ok(link.ok, "could not create a share link");
    const token = link.token;

    check("the token is URL-safe and long enough to be unguessable", () => {
      assert.match(token, /^[A-Za-z0-9_-]{22}$/);
    });

    const state = await share.getShareState(deckId);
    check("the owner can see the link and when it was made", () => {
      assert.equal(state.token, token);
      assert.ok(state.createdAt);
    });

    const shared = await share.getSharedDeck(token);
    assert.ok(shared, "the share link does not resolve to the deck");

    check("a visitor gets the deck's name and list", () => {
      assert.equal(shared.name, TEST_DECK);
      assert.equal(shared.format, "commander");
      const names = shared.boards.flatMap((b) => b.cards.map((c) => c.name));
      assert.ok(names.includes(commanders[0].name));
      assert.ok(names.includes("Sol Ring"));
    });

    check("the commander is on its own board, first", () => {
      assert.equal(shared.boards[0].board, "commander");
      assert.equal(shared.boards[0].cards.length, 1);
    });

    check("the verdict travels with the list", () => {
      assert.equal(shared.verdict.kind, "commander");
      if (shared.verdict.kind !== "commander") return;
      assert.equal(shared.verdict.report.cardCount, 2);
      assert.equal(shared.verdict.report.legal, false); // two cards is not 100
      assert.ok(shared.verdict.report.colorIdentity.length >= 0);
    });

    const serialised = JSON.stringify(shared);
    check("a visitor cannot see the deck's notes", () => {
      assert.ok(!serialised.includes(SECRET_NOTE));
    });
    check("a visitor cannot see where the deck is kept", () => {
      assert.ok(!serialised.includes("locationId"));
      assert.ok(!serialised.includes("location"));
    });
    check("a visitor cannot see what you own", () => {
      // The owner's view carries `available` and `owned` per row. Neither is
      // a fact about the deck, so neither is in here.
      assert.ok(!serialised.includes("available"));
      assert.ok(!serialised.includes('"owned"'));
      assert.ok(!serialised.includes("isAllocated"));
    });
    check("the token is not echoed back in the payload", () => {
      assert.ok(!serialised.includes(token));
    });

    /* -- rotating and revoking --------------------------------------------- */

    const second = await share.createShareLink(deckId);
    assert.ok(second.ok, "could not replace the share link");
    check("replacing a link mints a different token", () => {
      assert.notEqual(second.token, token);
    });

    const oldLink = await share.getSharedDeck(token);
    check("the replaced link is dead immediately", () => {
      assert.equal(oldLink, null);
    });

    const revoked = await share.revokeShareLink(deckId);
    assert.ok(revoked.ok, "could not revoke the share link");

    const afterRevoke = await share.getSharedDeck(second.token);
    check("a revoked link resolves to nothing", () => {
      assert.equal(afterRevoke, null);
    });

    const clearedState = await share.getShareState(deckId);
    check("revoking clears the owner's view of the link too", () => {
      assert.equal(clearedState.token, null);
      assert.equal(clearedState.createdAt, null);
    });

    const bogus = await share.createShareLink(
      "00000000-0000-4000-8000-000000000000",
    );
    check("sharing a deck that does not exist is an error, not a crash", () => {
      assert.equal(bogus.ok, false);
    });
    const badId = await share.createShareLink("not-a-uuid");
    check("a malformed deck id is rejected before SQL sees it", () => {
      assert.equal(badId.ok, false);
    });

    /* -- the export --------------------------------------------------------- */

    // Share it again, so the export has a shared deck to describe.
    const third = await share.createShareLink(deckId);
    assert.ok(third.ok, "could not re-share for the export check");

    const data = await exportBuild.buildExport();

    check("the export names itself and its format", () => {
      assert.equal(data.app, "MagicTracker");
      assert.equal(data.formatVersion, exportBuild.EXPORT_FORMAT_VERSION);
      assert.match(data.exportedAt, /^\d{4}-\d{2}-\d{2}T/);
    });

    const exportedDeck = data.decks.find((d) => d.name === TEST_DECK);
    assert.ok(exportedDeck, "the test deck is missing from the export");

    check("the export carries the deck and its cards", () => {
      assert.equal(exportedDeck.cards.length, 2);
      const names = exportedDeck.cards.map((c) => c.name);
      assert.ok(names.includes("Sol Ring"));
    });

    check("the export keeps the owner's notes — it is your copy", () => {
      assert.equal(exportedDeck.notes, SECRET_NOTE);
    });

    check(
      "the export says a deck is shared without exporting the token",
      () => {
        assert.equal(exportedDeck.shared, true);
        assert.ok(!JSON.stringify(data).includes(third.token));
      },
    );

    check("the counts in the header match the arrays under it", () => {
      assert.equal(data.counts.decks, data.decks.length);
      assert.equal(data.counts.collectionItems, data.collection.length);
      assert.equal(data.counts.locations, data.locations.length);
      assert.equal(
        data.counts.deckCards,
        data.decks.reduce((n, d) => n + d.cards.length, 0),
      );
      assert.equal(
        data.counts.collectionCopies,
        data.collection.reduce((n, i) => n + i.quantity, 0),
      );
    });

    const { rows: dbCounts } = await db.execute<{
      items: number;
      copies: number;
      locations: number;
      targets: number;
    }>(sql`
      SELECT (SELECT count(*) FROM collection_items)::int AS items,
             (SELECT coalesce(sum(quantity), 0) FROM collection_items)::int AS copies,
             (SELECT count(*) FROM locations)::int AS locations,
             (SELECT count(*) FROM completion_targets)::int AS targets
    `);

    check("the export matches what is actually in the database", () => {
      assert.equal(data.counts.collectionItems, dbCounts[0].items);
      assert.equal(data.counts.collectionCopies, dbCounts[0].copies);
      assert.equal(data.counts.locations, dbCounts[0].locations);
      assert.equal(data.counts.completionTargets, dbCounts[0].targets);
    });

    check("every collection row carries a readable identity", () => {
      for (const item of data.collection) {
        assert.ok(item.name.length > 0, "a row has no card name");
        assert.ok(item.setCode.length > 0, "a row has no set code");
        assert.ok(item.location.length > 0, "a row has no location name");
      }
    });

    check("the card database is not in the export", () => {
      // The whole point: this file is the un-regenerable part. If a future
      // change starts dumping 110k printings in here, the size test is the
      // one that will notice.
      const size = JSON.stringify(data).length;
      assert.ok(
        size < 5_000_000,
        `the export is ${size} bytes — something is dumping card data into it`,
      );
    });

    check("the filename is dated", () => {
      assert.match(
        exportBuild.exportFilename(new Date("2026-03-04T05:06:07Z")),
        /^magictracker-2026-03-04\.json$/,
      );
    });
  } finally {
    await db.execute(sql`DELETE FROM decks WHERE id = ${deckId}::uuid`);
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
      shared: number;
    }>(sql`
      SELECT (SELECT count(*) FROM decks)::int AS decks,
             (SELECT count(*) FROM deck_cards)::int AS deck_cards,
             (SELECT count(*) FROM collection_items)::int AS items,
             (SELECT count(*) FROM decks WHERE share_token IS NOT NULL)::int
               AS shared
    `);
    return rows[0];
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\npolish smoke failed:", error);
    process.exit(1);
  });
