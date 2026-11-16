import assert from "node:assert/strict";
import { test } from "node:test";

import {
  finishesForGame,
  gameForSetCode,
  isGameSlug,
  parseGame,
  setCodeFor,
} from "./constants";

// --- set codes ------------------------------------------------------------

test("Magic set codes are stored bare", () => {
  // Load-bearing: 1,068 sets, 110,963 printings and every /sets/<code> URL
  // already use these. Prefixing them would be a rename of the primary key.
  assert.equal(setCodeFor("mtg", "blb"), "blb");
  assert.equal(setCodeFor("mtg", "BLB"), "blb");
});

test("other games' set codes are prefixed and lowercased", () => {
  assert.equal(setCodeFor("pokemon", "sv8"), "pkm-sv8");
  assert.equal(setCodeFor("pokemon", "SWSHP"), "pkm-swshp");
});

test("hyphens inside the native code are squeezed out", () => {
  // Otherwise One Piece's OP-01 reads as `opc-op-01`, which looks like it
  // has two prefixes and sorts oddly beside `opc-st01`.
  assert.equal(setCodeFor("onepiece", "OP-01"), "opc-op01");
  assert.equal(setCodeFor("onepiece", "ST-36"), "opc-st36");
  assert.equal(setCodeFor("onepiece", "OP15-EB04"), "opc-op15eb04");
});

test("a prefixed code can never collide with a Magic one", () => {
  // Checked against all 1,068 Magic codes in the database: every one is
  // lowercase alphanumeric and at most six characters. A hyphen is therefore
  // the one character that cannot appear in a Magic code, which is what lets
  // `sets.code` stay a single primary key shared by every game.
  for (const code of [
    setCodeFor("pokemon", "sv8"),
    setCodeFor("onepiece", "OP-01"),
  ]) {
    assert.match(code, /-/);
    assert.equal(code, code.toLowerCase());
  }
});

test("gameForSetCode reads the game back out of the code", () => {
  assert.equal(gameForSetCode("pkm-sv8"), "pokemon");
  assert.equal(gameForSetCode("PKM-SV8"), "pokemon");
  assert.equal(gameForSetCode("opc-op01"), "onepiece");
  assert.equal(gameForSetCode("blb"), "mtg");
});

test("setCodeFor and gameForSetCode round-trip", () => {
  const cases = [
    ["mtg", "blb"],
    ["pokemon", "sv8"],
    ["onepiece", "OP-01"],
  ] as const;

  for (const [game, native] of cases) {
    assert.equal(gameForSetCode(setCodeFor(game, native)), game);
  }
});

// --- slugs ----------------------------------------------------------------

test("isGameSlug rejects anything not in the list", () => {
  assert.equal(isGameSlug("mtg"), true);
  assert.equal(isGameSlug("pokemon"), true);
  assert.equal(isGameSlug("yugioh"), false);
  assert.equal(isGameSlug(""), false);
  assert.equal(isGameSlug(undefined), false);
});

test("parseGame turns a query-string value into a slug or null", () => {
  // Null, not a throw and not a default: a stale bookmark naming a game that
  // no longer exists should show the whole collection, not an error page.
  assert.equal(parseGame("onepiece"), "onepiece");
  assert.equal(parseGame("weiss"), null);
  assert.equal(parseGame(["mtg"]), null);
});

// --- finishes -------------------------------------------------------------

test("each game is offered only the finishes it has", () => {
  assert.deepEqual(finishesForGame("mtg"), ["nonfoil", "foil", "etched"]);
  assert.deepEqual(finishesForGame("pokemon"), ["nonfoil", "reverse", "foil"]);
  assert.deepEqual(finishesForGame("onepiece"), ["nonfoil", "foil"]);
});

test("nonfoil is offered everywhere, so a game switch always has a fallback", () => {
  // The entry screen resets the sticky finish to nonfoil when the selected
  // one is not available for the new game; that only works if nonfoil
  // always is.
  for (const game of ["mtg", "pokemon", "onepiece"] as const) {
    assert.ok(finishesForGame(game).includes("nonfoil"));
  }
});
