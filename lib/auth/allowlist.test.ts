import assert from "node:assert/strict";
import { test } from "node:test";

import { matchesAllowlist, parseAllowlist } from "./allowlist";

test("allows an exact match", () => {
  assert.equal(matchesAllowlist("me@example.com", "me@example.com"), true);
});

test("is case insensitive on both sides", () => {
  assert.equal(matchesAllowlist("Me@Example.COM", "me@example.com"), true);
  assert.equal(matchesAllowlist("me@example.com", "ME@EXAMPLE.COM"), true);
});

test("tolerates whitespace and multiple entries", () => {
  assert.equal(
    matchesAllowlist("b@example.com", " a@example.com , b@example.com "),
    true,
  );
});

test("rejects an email that is not listed", () => {
  assert.equal(matchesAllowlist("other@example.com", "me@example.com"), false);
});

test("fails closed on an empty allowlist", () => {
  assert.equal(matchesAllowlist("me@example.com", ""), false);
  assert.equal(matchesAllowlist("me@example.com", "   "), false);
  assert.equal(matchesAllowlist("me@example.com", ","), false);
  assert.equal(matchesAllowlist("me@example.com", undefined), false);
  assert.equal(matchesAllowlist("me@example.com", null), false);
});

test("rejects a missing or empty email", () => {
  assert.equal(matchesAllowlist(undefined, "me@example.com"), false);
  assert.equal(matchesAllowlist(null, "me@example.com"), false);
  assert.equal(matchesAllowlist("", "me@example.com"), false);
});

test("requires an exact match, not a prefix or suffix", () => {
  // The attack this guards against: a lookalike domain that merely *contains*
  // the allowed address.
  assert.equal(
    matchesAllowlist("me@example.com.attacker.test", "me@example.com"),
    false,
  );
  assert.equal(matchesAllowlist("notme@example.com", "me@example.com"), false);
  assert.equal(matchesAllowlist("me@example.co", "me@example.com"), false);
});

test("parseAllowlist drops empties and normalizes", () => {
  assert.deepEqual(parseAllowlist("A@b.com,,  c@d.com  ,"), [
    "a@b.com",
    "c@d.com",
  ]);
  assert.deepEqual(parseAllowlist(undefined), []);
});
