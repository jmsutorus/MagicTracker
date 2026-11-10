import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_COMPLETION_SCOPE } from "@/lib/collection/constants";

import {
  describeScope,
  formatWantList,
  isCompletionFinish,
  isDefaultScope,
  normalizeScope,
  wantListFilename,
} from "./scope";

const ALL_APPLICABLE = {
  boosterOnly: true,
  includePromos: true,
  includeExtras: true,
};

test("accepts a well-formed scope", () => {
  assert.deepEqual(
    normalizeScope({
      boosterOnly: false,
      includePromos: true,
      includeExtras: false,
      finish: "foil",
    }),
    {
      boosterOnly: false,
      includePromos: true,
      includeExtras: false,
      finish: "foil",
    },
  );
});

test("rejects a scope with a missing field rather than defaulting it", () => {
  // Silently filling in a default would change what "complete" means without
  // saying so.
  assert.equal(
    normalizeScope({
      boosterOnly: true,
      includePromos: false,
      finish: "any",
    }),
    null,
  );
});

test("rejects non-boolean flags, including the strings a form would send", () => {
  assert.equal(
    normalizeScope({
      boosterOnly: "true",
      includePromos: false,
      includeExtras: false,
      finish: "any",
    }),
    null,
  );
});

test("rejects an unknown finish", () => {
  assert.equal(
    normalizeScope({
      boosterOnly: true,
      includePromos: false,
      includeExtras: false,
      finish: "gilded",
    }),
    null,
  );
});

test("rejects things that are not objects", () => {
  assert.equal(normalizeScope(null), null);
  assert.equal(normalizeScope("booster"), null);
  assert.equal(normalizeScope(undefined), null);
  assert.equal(normalizeScope(42), null);
});

test("isCompletionFinish knows the four values and nothing else", () => {
  assert.equal(isCompletionFinish("any"), true);
  assert.equal(isCompletionFinish("nonfoil"), true);
  assert.equal(isCompletionFinish("foil"), true);
  assert.equal(isCompletionFinish("etched"), true);
  assert.equal(isCompletionFinish("glitter"), false);
  assert.equal(isCompletionFinish(null), false);
});

test("isDefaultScope recognises the default and nothing near it", () => {
  assert.equal(isDefaultScope(DEFAULT_COMPLETION_SCOPE), true);
  assert.equal(
    isDefaultScope({ ...DEFAULT_COMPLETION_SCOPE, finish: "foil" }),
    false,
  );
  assert.equal(
    isDefaultScope({ ...DEFAULT_COMPLETION_SCOPE, boosterOnly: false }),
    false,
  );
});

test("describeScope reports the default as booster-only, any finish", () => {
  const described = describeScope(DEFAULT_COMPLETION_SCOPE, ALL_APPLICABLE);
  assert.match(described, /booster-obtainable cards only/);
  assert.match(described, /excluding promos/);
  assert.match(described, /any finish/);
});

test("describeScope does not claim booster-only on a set with no booster cards", () => {
  // This is the Bloomburrow Commander case: no card in the set comes from a
  // booster, so the flag is ignored and saying otherwise would be a lie.
  const described = describeScope(DEFAULT_COMPLETION_SCOPE, {
    boosterOnly: false,
    includePromos: true,
    includeExtras: false,
  });
  assert.match(described, /every card in the set/);
  assert.doesNotMatch(described, /booster-obtainable/);
});

test("describeScope omits a promo clause when the set is all promos", () => {
  const described = describeScope(DEFAULT_COMPLETION_SCOPE, {
    boosterOnly: false,
    includePromos: false,
    includeExtras: false,
  });
  assert.doesNotMatch(described, /promos/);
});

test("describeScope names a non-any finish explicitly", () => {
  assert.match(
    describeScope(
      { ...DEFAULT_COMPLETION_SCOPE, finish: "etched" },
      ALL_APPLICABLE,
    ),
    /etched copies only/,
  );
});

test("formatWantList emits the format Moxfield and Archidekt import", () => {
  assert.equal(
    formatWantList("2ed", [
      { name: "Lightning Bolt", collectorNumber: "162" },
      { name: "Birds of Paradise", collectorNumber: "93" },
    ]),
    "1 Lightning Bolt (2ED) 162\n1 Birds of Paradise (2ED) 93",
  );
});

test("formatWantList keeps a collector number that is not a number", () => {
  assert.equal(
    formatWantList("blb", [{ name: "Mabel", collectorNumber: "304a" }]),
    "1 Mabel (BLB) 304a",
  );
});

test("formatWantList of nothing is empty, not a stray newline", () => {
  assert.equal(formatWantList("blb", []), "");
});

test("wantListFilename is safe to put in a Content-Disposition header", () => {
  assert.equal(wantListFilename("blb"), "blb-wantlist.txt");
  assert.equal(wantListFilename("BLB"), "blb-wantlist.txt");
  // A code that is nothing but punctuation must still yield a usable name.
  assert.equal(wantListFilename('../../etc/"passwd'), "etcpasswd-wantlist.txt");
  assert.equal(wantListFilename(""), "set-wantlist.txt");
});
