/**
 * End-to-end check of set completion: `npm run completion:smoke`
 *
 * Needs a loaded database, and it writes (then cleans up). It exists because
 * the completion queries are the most intricate SQL in the project — three
 * conditional exclusions, a finish rule, and an anti-join — and because the
 * rule that matters most ("an exclusion never empties a set") is only
 * observable against real set data.
 *
 * Asserts the collection and the scope table are back to their starting state
 * at the end, so it is safe against the real database.
 */
import assert from "node:assert/strict";

import { config } from "dotenv";

config({ path: ".env.local" });

const TEST_LOCATION = "Completion Smoke Shelf";

let passed = 0;
function check(label: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok  ${label}`);
}

async function main() {
  const [{ getDb }, { sql }, queries, mutations, scope, collection] =
    await Promise.all([
      import("../lib/db"),
      import("drizzle-orm"),
      import("../lib/completion/queries"),
      import("../lib/completion/mutations"),
      import("../lib/completion/scope"),
      import("../lib/collection/mutations"),
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

  const startTotals = await (
    await import("../lib/collection/queries")
  ).getCollectionTotals();

  // ---- the capability rule: exclusions narrow a set, never empty it -------
  console.log("scope defaults against real sets");

  const blb = await queries.getSetCompletion("blb");
  assert.ok(blb, "blb missing — run the ingest");
  check("Bloomburrow defaults to the booster-obtainable cards", () => {
    assert.equal(blb.scope.boosterOnly, true);
    assert.equal(blb.applicable.boosterOnly, true);
    assert.equal(blb.target, 281);
    assert.equal(blb.setSize, 397);
  });

  const blc = await queries.getSetCompletion("blc");
  assert.ok(blc);
  check("Bloomburrow Commander is the whole product, not zero cards", () => {
    // No card in blc comes from a booster. Applying booster_only literally
    // would make "complete" mean zero cards, so that flag is inert here.
    assert.equal(blc.scope.boosterOnly, true);
    assert.equal(blc.applicable.boosterOnly, false);
    // The promo exclusion DOES still apply, because blc has non-promo cards
    // for it to narrow to: 356 printings, one of them promo-stamped, so the
    // default target is 355. Only an exclusion that would empty the set is
    // ignored -- not every exclusion.
    assert.equal(blc.applicable.includePromos, true);
    assert.equal(blc.setSize, 356);
    assert.equal(blc.target, 355);
  });

  const pblb = await queries.getSetCompletion("pblb");
  assert.ok(pblb);
  check("an all-promo set is not emptied by excluding promos", () => {
    assert.equal(pblb.scope.includePromos, false);
    assert.equal(pblb.applicable.includePromos, false);
    assert.equal(pblb.target, pblb.setSize);
    assert.equal(pblb.target, 160);
  });

  const { rows: tokenSetRows } = await db.execute<{ code: string; n: number }>(sql`
    SELECT p.set_code AS code, count(*)::int AS n
      FROM printings p JOIN sets s ON s.code = p.set_code
     WHERE p.lang = 'en' AND s.set_type = 'token'
     GROUP BY p.set_code
     HAVING bool_and(p.is_extra)
     ORDER BY count(*) DESC LIMIT 1
  `);
  const tokenSet = tokenSetRows[0];
  if (tokenSet) {
    const tok = await queries.getSetCompletion(tokenSet.code);
    assert.ok(tok);
    check(`an all-extras set (${tokenSet.code}) is not emptied either`, () => {
      assert.equal(tok.applicable.includeExtras, false);
      assert.equal(tok.target, tok.setSize);
    });
  }

  check("describeScope does not claim booster-only where it is inert", () => {
    assert.match(
      scope.describeScope(blc.scope, blc.applicable),
      /every card in the set/,
    );
    assert.match(
      scope.describeScope(blb.scope, blb.applicable),
      /booster-obtainable/,
    );
  });

  // ---- buckets ------------------------------------------------------------
  console.log("\nbreakdowns");

  check("rarity buckets sum to the target", () =>
    assert.equal(
      blb.byRarity.reduce((n, b) => n + b.target, 0),
      blb.target,
    ),
  );
  check("color buckets sum to the target", () =>
    assert.equal(
      blb.byColor.reduce((n, b) => n + b.target, 0),
      blb.target,
    ),
  );
  check("rarity buckets are in print order, not alphabetical", () => {
    const labels = blb.byRarity.map((b) => b.label);
    assert.equal(labels[0], "common");
    assert.ok(labels.indexOf("rare") < labels.indexOf("mythic"));
  });

  // ---- scope changes recalculate -----------------------------------------
  console.log("\nchanging the scope");

  const widened = await mutations.saveScope("blb", {
    boosterOnly: false,
    includePromos: true,
    includeExtras: false,
    finish: "any",
  });
  assert.equal(widened.ok, true, JSON.stringify(widened));

  const blbWide = await queries.getSetCompletion("blb");
  assert.ok(blbWide);
  check("turning off booster-only widens the target to the whole set", () =>
    assert.equal(blbWide.target, 397),
  );

  const badScope = await mutations.saveScope("blb", {
    boosterOnly: true,
    includePromos: false,
    finish: "any",
  });
  check("a scope missing a field is refused, not half-applied", () =>
    assert.equal(badScope.ok, false),
  );

  const badFinish = await mutations.saveScope("blb", {
    boosterOnly: true,
    includePromos: false,
    includeExtras: false,
    finish: "gilded",
  });
  check("an invalid finish is refused", () =>
    assert.equal(badFinish.ok, false),
  );

  const unknownSet = await mutations.saveScope("zzzz", {
    boosterOnly: true,
    includePromos: false,
    includeExtras: false,
    finish: "any",
  });
  check("saving a scope for a set that does not exist is refused", () =>
    assert.equal(unknownSet.ok, false),
  );

  const reset = await mutations.resetScope("blb");
  assert.equal(reset.ok, true);
  const blbReset = await queries.getSetCompletion("blb");
  assert.ok(blbReset);
  check("resetting returns to the default by deleting the row", () => {
    assert.equal(blbReset.target, 281);
    assert.equal(scope.isDefaultScope(blbReset.scope), true);
  });

  // ---- owning things ------------------------------------------------------
  console.log("\nowned counting");

  const location = await collection.createLocation(TEST_LOCATION, "binder");
  assert.equal(location.ok, true);
  if (!location.ok) return;

  const missingBefore = await queries.listMissingPrintings("blb");
  check("every in-scope card starts out missing", () =>
    assert.equal(missingBefore.length, 281),
  );
  check("the missing list is in collector-number order", () => {
    const nums = missingBefore
      .map((m) => Number.parseInt(m.collectorNumber, 10))
      .filter((n) => Number.isFinite(n));
    const sorted = [...nums].sort((a, b) => a - b);
    assert.deepEqual(nums, sorted);
  });

  const target = missingBefore[0];
  const added = await collection.addCopies({
    printingId: target.scryfallId,
    finish: "nonfoil",
    condition: "NM",
    locationId: location.id,
    quantity: 1,
  });
  assert.equal(added.ok, true, JSON.stringify(added));

  const afterOwn = await queries.getSetCompletion("blb");
  assert.ok(afterOwn);
  check("owning one card moves the numerator by exactly one", () => {
    assert.equal(afterOwn.owned, blbReset.owned + 1);
    assert.equal(afterOwn.target, 281);
  });

  const missingAfter = await queries.listMissingPrintings("blb");
  check("the owned card drops off the missing list", () => {
    assert.equal(missingAfter.length, missingBefore.length - 1);
    assert.ok(!missingAfter.some((m) => m.scryfallId === target.scryfallId));
  });

  check("the rarity bucket for that card also moved", () => {
    const before = blbReset.byRarity.find((b) => b.label === target.rarity);
    const after = afterOwn.byRarity.find((b) => b.label === target.rarity);
    assert.ok(before && after);
    assert.equal(after.owned, before.owned + 1);
  });

  // ---- the finish rule ----------------------------------------------------
  console.log("\nfinish rule");

  const foilScope = await mutations.saveScope("blb", {
    boosterOnly: true,
    includePromos: false,
    includeExtras: false,
    finish: "foil",
  });
  assert.equal(foilScope.ok, true);

  const underFoil = await queries.getSetCompletion("blb");
  assert.ok(underFoil);
  check("a nonfoil copy does not satisfy a foil target", () =>
    assert.equal(underFoil.owned, 0),
  );

  const stillMissing = await queries.listMissingPrintings("blb");
  check("and the card is back on the missing list", () =>
    assert.ok(stillMissing.some((m) => m.scryfallId === target.scryfallId)),
  );

  const etchedScope = await mutations.saveScope("blb", {
    boosterOnly: true,
    includePromos: false,
    includeExtras: false,
    finish: "nonfoil",
  });
  assert.equal(etchedScope.ok, true);
  const underNonfoil = await queries.getSetCompletion("blb");
  assert.ok(underNonfoil);
  check("a nonfoil target counts the nonfoil copy", () =>
    assert.equal(underNonfoil.owned, 1),
  );

  // ---- want list ----------------------------------------------------------
  console.log("\nwant list");

  const list = scope.formatWantList("blb", stillMissing.slice(0, 3));
  check("the want list is importable text", () => {
    const lines = list.split("\n");
    assert.equal(lines.length, 3);
    for (const line of lines) {
      assert.match(line, /^1 .+ \(BLB\) \S+$/);
    }
  });

  // ---- index page ---------------------------------------------------------
  console.log("\nset index");

  const progress = await queries.listSetProgress();
  check("the set we own a card from appears in the index", () => {
    const row = progress.find((p) => p.code === "blb");
    assert.ok(row, "blb not listed");
    assert.equal(row.target, 281);
    assert.equal(row.owned, 1);
  });
  // Not async: check() takes a sync function, and an async body would have
  // its rejection swallowed rather than failing the run.
  check("the index honors the stored scope, not the default", () => {
    // Scope is currently nonfoil; the index must agree with the detail page.
    const row = progress.find((p) => p.code === "blb");
    assert.ok(row);
    assert.equal(row.owned, underNonfoil.owned);
  });

  const unknown = await queries.getSetCompletion("zzzznotaset");
  check("an unknown set code returns null rather than throwing", () =>
    assert.equal(unknown, null),
  );

  // ---- cleanup ------------------------------------------------------------
  console.log("\ncleanup");

  await mutations.resetScope("blb");
  const removed = await collection.removeItem(added.itemId);
  assert.equal(removed.ok, true);
  const locationGone = await collection.deleteLocation(location.id);
  assert.equal(locationGone.ok, true);

  const { rows: leftoverScopes } = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM completion_targets`,
  );
  const endTotals = await (
    await import("../lib/collection/queries")
  ).getCollectionTotals();

  check("no scope rows left behind", () =>
    assert.equal(leftoverScopes[0].n, 0),
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
