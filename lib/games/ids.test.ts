import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeCardName, oracleId, printingId } from "./ids";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// --- shape ----------------------------------------------------------------

test("a derived printing id is a well-formed UUID", () => {
  assert.match(printingId("pokemon", "sv8-1"), UUID_RE);
  assert.match(printingId("onepiece", "OP11-004_p1"), UUID_RE);
});

test("the version and variant bits say version 5, RFC 4122", () => {
  // These are not cosmetic. Postgres's `uuid` type accepts any 32 hex
  // digits, so nothing downstream would complain if they were wrong — the
  // id would simply be a hash pretending to be a UUID.
  const id = printingId("pokemon", "sv8-1");
  assert.equal(id[14], "5", "version nibble");
  assert.ok("89ab".includes(id[19]), `variant nibble was ${id[19]}`);
});

// --- determinism ----------------------------------------------------------

test("the same card always derives the same id", () => {
  // The whole basis of the ingest being an upsert rather than a duplicator.
  assert.equal(printingId("pokemon", "sv8-1"), printingId("pokemon", "sv8-1"));
  assert.equal(
    oracleId("onepiece", "Monkey.D.Luffy"),
    oracleId("onepiece", "Monkey.D.Luffy"),
  );
});

test("different cards derive different ids", () => {
  assert.notEqual(printingId("pokemon", "sv8-1"), printingId("pokemon", "sv8-2"));
});

test("the same string in two games derives different ids", () => {
  // Why the game is part of the hashed name: two catalogs are free to reuse
  // an identifier, and a collision would merge two unrelated cards into one
  // row — silently, since the second ingest would upsert over the first.
  assert.notEqual(
    printingId("pokemon", "OP11-004"),
    printingId("onepiece", "OP11-004"),
  );
});

test("a printing id and an oracle id never collide", () => {
  // They are distinct namespaces within one UUID space, and both end up in
  // the same database: `printings.scryfall_id` and `oracle_cards.oracle_id`.
  assert.notEqual(printingId("pokemon", "sv8-1"), oracleId("pokemon", "sv8-1"));
});

// --- Magic is excluded ----------------------------------------------------

test("deriving an id for a Magic card throws", () => {
  // A Magic printing already has a UUID — Scryfall's — and 110,963 rows plus
  // every collection row that points at one are keyed on it. Deriving a
  // second id would not fail loudly, it would quietly create a parallel set
  // of cards nobody owns, so the guard is here rather than in review.
  assert.throws(() => printingId("mtg", "abc"), /Scryfall id/);
  assert.throws(() => oracleId("mtg", "Lightning Bolt"), /Scryfall/);
});

// --- name normalization ---------------------------------------------------

test("case and run-together whitespace do not split one card in two", () => {
  assert.equal(
    oracleId("pokemon", "Professor's Research"),
    oracleId("pokemon", "  professor's   research "),
  );
});

test("punctuation is kept, because the printed name has it", () => {
  // "Mr. Mime" and "Mr Mime" are not the same string upstream, and folding
  // them would merge genuinely distinct cards more often than it would join
  // two spellings of one.
  assert.notEqual(
    oracleId("pokemon", "Mr. Mime"),
    oracleId("pokemon", "Mr Mime"),
  );
});

test("normalizeCardName collapses whitespace and lowercases", () => {
  assert.equal(normalizeCardName("  Monkey.D.Luffy  "), "monkey.d.luffy");
  assert.equal(normalizeCardName("Tony Tony.Chopper"), "tony tony.chopper");
  assert.equal(normalizeCardName("A\t\tB"), "a b");
});
