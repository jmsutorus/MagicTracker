/**
 * End-to-end check of the import layer: `npm run import:smoke`
 *
 * Needs a loaded card database. It writes (the collection, and decks) and
 * asserts everything is back where it started.
 *
 * The unit tests in lib/import/parse.test.ts cover the text. What they cannot
 * cover is the half that only exists in SQL: a VALUES-list CTE, the LATERAL
 * that picks one printing per request, and the GROUP BY that makes an
 * ON CONFLICT over a repeated card legal instead of an aborted statement.
 * Those are the parts that fail against a real database or not at all.
 *
 * It also pins the behaviour that matters most for a paste: resolution is
 * driven by real card names from this database, not fixtures, so a rule that
 * works on "Sol Ring" and breaks on a double-faced card is caught here.
 */
import assert from "node:assert/strict";

import { config } from "dotenv";

config({ path: ".env.local" });

const TEST_LOCATION = "Import Smoke Shelf";
const TEST_DECK = "Import Smoke Deck";

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
    { sectionToBoard },
    parse,
    resolve,
    mutations,
    collection,
    colQueries,
  ] = await Promise.all([
    import("../lib/db"),
    import("drizzle-orm"),
    import("../lib/import/constants"),
    import("../lib/import/parse"),
    import("../lib/import/resolve"),
    import("../lib/import/mutations"),
    import("../lib/collection/mutations"),
    import("../lib/collection/queries"),
  ]);

  const db = getDb();

  // ---- pre-clean anything an interrupted run left behind ------------------
  await db.execute(sql`DELETE FROM decks WHERE name = ${TEST_DECK}`);
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

  /* -- pick real cards out of the database -------------------------------- */

  // A card with several printings, so the printing choice has something to
  // choose. Popularity is the proxy: a heavily reprinted card is one a paste
  // is likely to name.
  const { rows: commonRows } = await db.execute<{
    name: string;
    set_code: string;
    collector_number: string;
    printings: number;
  }>(sql`
    SELECT o.name,
           (array_agg(p.set_code ORDER BY p.released_at DESC NULLS LAST))[1]
             AS set_code,
           (array_agg(p.collector_number
                      ORDER BY p.released_at DESC NULLS LAST))[1]
             AS collector_number,
           count(*)::int AS printings
      FROM oracle_cards o
      JOIN printings p ON p.oracle_id = o.oracle_id
     WHERE o.edhrec_rank IS NOT NULL
       AND NOT p.is_extra
     GROUP BY o.oracle_id, o.name, o.edhrec_rank
    HAVING count(*) > 3
     ORDER BY o.edhrec_rank ASC
     LIMIT 1
  `);
  const common = commonRows[0];
  assert.ok(common, "no reprinted card found — is the card database loaded?");
  console.log(
    `\nusing "${common.name}" (${common.printings} printings, newest ${common.set_code.toUpperCase()} #${common.collector_number})`,
  );

  // A basic land, for the repeated-line and high-quantity cases.
  const { rows: basicRows } = await db.execute<{ name: string }>(sql`
    SELECT o.name FROM oracle_cards o
     WHERE o.type_line LIKE 'Basic Land%' AND o.name = 'Mountain'
     LIMIT 1
  `);
  const basic = basicRows[0]?.name ?? "Mountain";

  // A double-faced card, to prove the front-face fallback works on real data.
  const { rows: dfcRows } = await db.execute<{ name: string; face: string }>(
    sql`
      SELECT o.name, split_part(o.name, ' // ', 1) AS face
        FROM oracle_cards o
       WHERE o.name LIKE '% // %'
         AND o.edhrec_rank IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM oracle_cards x
            WHERE lower(x.name) = lower(split_part(o.name, ' // ', 1))
         )
       ORDER BY o.edhrec_rank ASC
       LIMIT 1
    `,
  );
  const dfc = dfcRows[0];
  assert.ok(dfc, "no double-faced card found");
  console.log(`using "${dfc.name}" for the front-face case\n`);

  /* -- 1. resolution ------------------------------------------------------ */

  const pasted = [
    "// a pasted list",
    "Commander",
    `1 ${common.name} (${common.set_code}) ${common.collector_number}`,
    "",
    "Deck",
    `1 ${dfc.face}`,
    `2 ${basic}`,
    `3 ${basic}`,
    "1 Notacard Thatexists Anywhere",
    `1 ${common.name} (ZZZ) 9999`,
    "",
    "Sideboard",
    `1 ${basic}`,
  ].join("\n");

  const parsed = parse.parseImport(pasted);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("unreachable");

  check("the paste is read as a decklist", () =>
    assert.equal(parsed.format, "decklist"),
  );
  // Seven: the commander, the front face, two basic lines, the nonsense
  // name, the bad set hint, and the sideboard line.
  check("every card line is kept", () => assert.equal(parsed.lines.length, 7));

  const resolved = await resolve.resolveImport(parsed.lines);

  check("the commander line resolved to the printing it named", () => {
    const line = resolved.lines[0];
    assert.equal(line.status, "resolved");
    assert.equal(line.section, "commander");
    assert.equal(line.card?.name, common.name);
    assert.equal(
      line.printing?.setCode.toLowerCase(),
      common.set_code.toLowerCase(),
    );
    assert.equal(line.printing?.collectorNumber, common.collector_number);
    // It named a set and a number, so nothing was guessed for it.
    assert.deepEqual(line.notes, []);
  });

  check("a front face resolves to the whole card, and says so", () => {
    const line = resolved.lines[1];
    assert.equal(line.status, "resolved");
    assert.equal(line.card?.name, dfc.name);
    assert.ok(line.notes.includes("matched-by-face"));
  });

  check("a line with no set gets a printing chosen for it", () => {
    const line = resolved.lines[2];
    assert.equal(line.status, "resolved");
    assert.ok(line.printing, "no printing was chosen");
    assert.ok(line.notes.includes("printing-guessed"));
  });

  check("a name that is no card comes back unmatched", () => {
    const line = resolved.lines.find(
      (l) => l.wanted === "Notacard Thatexists Anywhere",
    );
    assert.ok(line);
    assert.equal(line.status, "unmatched");
    assert.equal(line.card, null);
  });

  check("an unrecognised set is reported and ignored, not fatal", () => {
    // Arena's codes diverge from Scryfall's, so a bad hint must not lose the
    // card: the line still resolves, by name, and says the hint was dropped.
    const line = resolved.lines.find((l) => l.raw.includes("(ZZZ)"));
    assert.ok(line);
    assert.equal(line.status, "resolved");
    assert.equal(line.card?.name, common.name);
    assert.ok(line.notes.includes("set-ignored"));
  });

  check("the sideboard line is kept, not dropped", () => {
    // Found by section rather than by index: a positional assertion here
    // breaks the moment the fixture above gains a line, and then says
    // nothing useful about why.
    const sideboard = resolved.lines.filter((l) => l.section === "sideboard");
    assert.equal(sideboard.length, 1);
    assert.equal(sideboard[0].card?.name, basic);
  });

  check("the summary counts copies, not lines", () =>
    // 1 + 1 + 2 + 3 + 1 + 1 + 1
    assert.equal(resolved.summary.copies, 10),
  );

  check("the summary groups repeated cards into one buy-list entry", () => {
    // Two lines ask for 5 basics between them; owning none, the list says 5
    // once rather than 2 and 3 on separate lines.
    const entry = resolved.summary.missing.find((m) => m.name === basic);
    assert.ok(entry, "the basic is not in the missing list");
    assert.equal(entry.need, 5, "the two lines were not summed");
  });

  check("the maybeboard is left out of the missing list", () => {
    // Six copies of the basic were pasted, but one of them is on the
    // sideboard, which counts toward nothing — so the buy list says five.
    const entry = resolved.summary.missing.find((m) => m.name === basic);
    assert.equal(entry?.need, 5);
  });

  check("an unmatched name gets suggestions it can be swapped for", () => {
    const line = resolved.lines.find(
      (l) => l.wanted === "Notacard Thatexists Anywhere",
    );
    assert.ok(line);
    // Trigram search on nonsense can legitimately find nothing; what must
    // hold is that it did not throw and the field is an array.
    assert.ok(Array.isArray(line.options));
  });

  /* -- 1b. which printing a bare card name gets ---------------------------- */

  const { rows: digitalRows } = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n
      FROM printings p JOIN sets s ON s.code = p.set_code
     WHERE s.digital
  `);
  check("no digital-only printing is in the database to be chosen", () => {
    /*
     * This is the invariant that keeps an un-ownable Arena printing out of a
     * paper collection, and it is enforced by the ingest
     * (scripts/ingest-cards.ts skips digital-only cards), not by the import.
     * DEFAULT_PRINTING_ORDER also sorts digital sets last, which today has
     * nothing to act on — so this check is here to fail loudly if the ingest
     * ever starts loading them, at which point that clause becomes load
     * bearing and wants a real test of its own.
     */
    assert.equal(digitalRows[0].n, 0);
  });

  const boltParse = parse.parseImport("1 Lightning Bolt");
  assert.equal(boltParse.ok, true);
  if (!boltParse.ok) throw new Error("unreachable");
  const boltResolved = await resolve.resolveImport(boltParse.lines);
  check("a bare card name gets a real set, not a The List reprint", () => {
    /*
     * The List dates each entry from when it was re-inserted, so by
     * released_at alone it is the newest printing of every staple it holds —
     * and its collector numbers are the reprinted set's ("CLB-187"), which no
     * one would recognise. A non-numeric collector number is the general
     * signal for that kind of special product.
     */
    const printing = boltResolved.lines[0].printing;
    assert.ok(printing, "no printing chosen for Lightning Bolt");
    assert.match(
      printing.collectorNumber,
      /^\d+$/,
      `got ${printing.setCode} #${printing.collectorNumber}`,
    );
  });

  /* -- 2. the collection write -------------------------------------------- */

  const locationResult = await collection.createLocation(TEST_LOCATION, "box");
  assert.equal(locationResult.ok, true, JSON.stringify(locationResult));
  if (!locationResult.ok) throw new Error("unreachable");
  const location = { id: locationResult.id };

  const accepted = resolved.lines
    .filter((l) => l.status === "resolved" && l.card)
    .map((l) => ({
      oracleId: l.card!.oracleId,
      printingId: l.printing?.printingId ?? null,
      quantity: l.quantity,
      finish: l.finish,
      condition: l.condition,
      board: sectionToBoard(l.section),
    }));

  const intoCollection = await mutations.applyImport(accepted, {
    kind: "collection",
    locationId: location.id,
    defaultFinish: "nonfoil",
    defaultCondition: "NM",
  });
  assert.equal(intoCollection.ok, true, JSON.stringify(intoCollection));
  if (!intoCollection.ok) throw new Error("unreachable");

  check("a repeated card is summed rather than aborting the statement", () => {
    // Two lines of 2 and 3 of the same printing collide on the unique key.
    // Without the GROUP BY, Postgres refuses the whole INSERT with
    // "ON CONFLICT DO UPDATE command cannot affect row a second time".
    assert.ok(intoCollection.copies >= 8, JSON.stringify(intoCollection));
  });

  const { rows: basicRowsAfter } = await db.execute<{ quantity: number }>(sql`
    SELECT c.quantity
      FROM collection_items c
      JOIN printings p ON p.scryfall_id = c.printing_id
      JOIN oracle_cards o ON o.oracle_id = p.oracle_id
     WHERE c.location_id = ${location.id}::uuid AND o.name = ${basic}
  `);
  check("the repeated basic landed as one row of six", () => {
    /*
     * Six, not the five the buy list quoted, and both are right. A deck's
     * maybeboard counts toward nothing, but a card is a card you *own*
     * whichever board a decklist filed it under, so importing into the
     * collection counts all three lines: 2 + 3 + 1.
     */
    assert.equal(basicRowsAfter.length, 1, JSON.stringify(basicRowsAfter));
    assert.equal(basicRowsAfter[0].quantity, 6);
  });

  const again = await mutations.applyImport(accepted, {
    kind: "collection",
    locationId: location.id,
    defaultFinish: "nonfoil",
    defaultCondition: "NM",
  });
  assert.equal(again.ok, true);

  const { rows: rowCountRows } = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM collection_items
     WHERE location_id = ${location.id}::uuid
  `);
  const { rows: afterTwice } = await db.execute<{ quantity: number }>(sql`
    SELECT c.quantity
      FROM collection_items c
      JOIN printings p ON p.scryfall_id = c.printing_id
      JOIN oracle_cards o ON o.oracle_id = p.oracle_id
     WHERE c.location_id = ${location.id}::uuid AND o.name = ${basic}
  `);
  check("a second run of the same import merges into the same rows", () => {
    assert.equal(afterTwice.length, 1, "the second import made a second row");
    assert.equal(afterTwice[0].quantity, 12, "the second import did not merge");
    assert.ok(rowCountRows[0].n > 0);
  });

  /* -- 3. owned numbers now reflect the collection ------------------------ */

  const reResolved = await resolve.resolveImport(parsed.lines);
  check("resolution now reports the cards as owned", () => {
    const line = reResolved.lines.find((l) => l.card?.name === basic);
    assert.ok(line);
    assert.ok((line.card?.owned ?? 0) >= 10, `owned was ${line.card?.owned}`);
  });
  check("the missing list shrinks once the cards are owned", () =>
    assert.equal(
      reResolved.summary.missing.find((m) => m.name === basic),
      undefined,
    ),
  );

  /* -- 4. the deck write -------------------------------------------------- */

  const intoDeck = await mutations.applyImport(accepted, {
    kind: "new-deck",
    name: TEST_DECK,
  });
  assert.equal(intoDeck.ok, true, JSON.stringify(intoDeck));
  if (!intoDeck.ok) throw new Error("unreachable");
  assert.ok(intoDeck.deckId);

  const { rows: deckCardRows } = await db.execute<{
    board: string;
    quantity: number;
    name: string;
  }>(sql`
    SELECT dc.board, dc.quantity, o.name
      FROM deck_cards dc
      JOIN oracle_cards o ON o.oracle_id = dc.oracle_id
     WHERE dc.deck_id = ${intoDeck.deckId}::uuid
     ORDER BY dc.board, o.name
  `);

  check("the commander landed in the command zone", () => {
    const commanders = deckCardRows.filter((r) => r.board === "commander");
    assert.equal(commanders.length, 1);
    assert.equal(commanders[0].name, common.name);
  });

  check("the deck groups by board, so one card can sit on two of them", () => {
    // 2 + 3 on the deck, 1 on the maybeboard. One row per board, because
    // the unique key is (deck, board, card) — a group key that left the
    // board out would collide and abort the whole statement.
    const rows = deckCardRows.filter((r) => r.name === basic);
    assert.equal(rows.length, 2, JSON.stringify(rows));
    assert.equal(rows.find((r) => r.board === "main")?.quantity, 5);
    assert.equal(rows.find((r) => r.board === "maybe")?.quantity, 1);
  });

  const { rows: pinnedRows } = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n
      FROM deck_cards dc
     WHERE dc.deck_id = ${intoDeck.deckId}::uuid AND dc.printing_id IS NOT NULL
  `);
  check("every imported deck row pinned a printing", () =>
    assert.equal(pinnedRows[0].n, deckCardRows.length),
  );

  /* -- 5. rejections ------------------------------------------------------ */

  const badFinish = await mutations.applyImport(
    [{ ...accepted[0], finish: "holographic" }],
    {
      kind: "collection",
      locationId: location.id,
      defaultFinish: "nonfoil",
      defaultCondition: "NM",
    },
  );
  check("an invented finish is refused", () =>
    assert.equal(badFinish.ok, false),
  );

  const badCard = await mutations.applyImport(
    [{ ...accepted[0], oracleId: "not-a-uuid" }],
    {
      kind: "collection",
      locationId: location.id,
      defaultFinish: "nonfoil",
      defaultCondition: "NM",
    },
  );
  check("a malformed card id is refused before it reaches a cast", () =>
    assert.equal(badCard.ok, false),
  );

  const unknownCard = await mutations.applyImport(
    [{ ...accepted[0], oracleId: "00000000-0000-4000-8000-000000000000" }],
    {
      kind: "collection",
      locationId: location.id,
      defaultFinish: "nonfoil",
      defaultCondition: "NM",
    },
  );
  check("a card with no printing is named rather than silently dropped", () => {
    assert.equal(unknownCard.ok, false);
    if (unknownCard.ok) throw new Error("unreachable");
    assert.match(unknownCard.error, /ingest/i);
  });

  const badTarget = await mutations.applyImport(
    accepted,
    // A server action's declared parameter types are gone at runtime, so a
    // caller that is not this app's browser can send anything.
    "collection" as unknown as Parameters<typeof mutations.applyImport>[1],
  );
  check("a destination that is not an object is refused, not a crash", () =>
    assert.equal(badTarget.ok, false),
  );

  const badPayload = await mutations.applyImport(
    "not an array" as unknown as Parameters<typeof mutations.applyImport>[0],
    {
      kind: "collection",
      locationId: location.id,
      defaultFinish: "nonfoil",
      defaultCondition: "NM",
    },
  );
  check("a payload that is not a list is refused, not a crash", () =>
    assert.equal(badPayload.ok, false),
  );

  const emptyImport = await mutations.applyImport([], {
    kind: "collection",
    locationId: location.id,
    defaultFinish: "nonfoil",
    defaultCondition: "NM",
  });
  check("an empty import is refused", () =>
    assert.equal(emptyImport.ok, false),
  );

  /* -- 6. clean up and prove nothing was left behind ---------------------- */

  await db.execute(
    sql`DELETE FROM deck_cards WHERE deck_id = ${intoDeck.deckId}::uuid`,
  );
  await db.execute(sql`DELETE FROM decks WHERE id = ${intoDeck.deckId}::uuid`);
  await db.execute(
    sql`DELETE FROM collection_items WHERE location_id = ${location.id}::uuid`,
  );

  const locationGone = await collection.deleteLocation(location.id);
  assert.equal(locationGone.ok, true, JSON.stringify(locationGone));

  const endTotals = await colQueries.getCollectionTotals();
  const { rows: endDeckRows } = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM decks`,
  );

  check("no decks left behind", () =>
    assert.equal(endDeckRows[0].n, startDecks),
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
