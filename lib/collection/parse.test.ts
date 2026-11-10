import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_ENTRY_QUANTITY,
  describeParseFailure,
  formatPrintingLabel,
  nextQuantity,
  normalizeCollectorNumber,
  parseCollectorNumberEntry,
} from "./parse";

/** Asserts a successful parse, so the tests read as one line each. */
function parsed(input: string) {
  const result = parseCollectorNumberEntry(input);
  assert.equal(result.ok, true, `expected "${input}" to parse`);
  if (!result.ok) throw new Error("unreachable");
  return { quantity: result.quantity, collectorNumber: result.collectorNumber };
}

function failed(input: string) {
  const result = parseCollectorNumberEntry(input);
  assert.equal(result.ok, false, `expected "${input}" to be rejected`);
  if (result.ok) throw new Error("unreachable");
  return result.reason;
}

test("a bare number is one copy", () => {
  assert.deepEqual(parsed("123"), { quantity: 1, collectorNumber: "123" });
});

test("surrounding whitespace is ignored", () => {
  assert.deepEqual(parsed("  87  "), { quantity: 1, collectorNumber: "87" });
});

test("the # printed on the card is not part of the number", () => {
  assert.deepEqual(parsed("#123"), { quantity: 1, collectorNumber: "123" });
  assert.deepEqual(parsed("# 123"), { quantity: 1, collectorNumber: "123" });
});

test("a leading quantity is read when a space settles it", () => {
  assert.deepEqual(parsed("4x 123"), { quantity: 4, collectorNumber: "123" });
  assert.deepEqual(parsed("2X 7"), { quantity: 2, collectorNumber: "7" });
  assert.deepEqual(parsed("12x  250"), {
    quantity: 12,
    collectorNumber: "250",
  });
});

test("the multiplication sign works as well as the letter x", () => {
  assert.deepEqual(parsed("3× 50"), { quantity: 3, collectorNumber: "50" });
});

test("no space is needed when the collector number is not a bare number", () => {
  // "123a" cannot be mistaken for a quantity, so there is nothing to resolve.
  assert.deepEqual(parsed("4x123a"), { quantity: 4, collectorNumber: "123a" });
  assert.deepEqual(parsed("2x★15"), { quantity: 2, collectorNumber: "★15" });
  assert.deepEqual(parsed("3xA-45"), { quantity: 3, collectorNumber: "A-45" });
});

test("digits on both sides of the x are rejected, not guessed", () => {
  // This is the whole point: read either of these the wrong way round and you
  // silently enter 123 copies of card #4.
  assert.equal(failed("123x4"), "ambiguous");
  assert.equal(failed("4x123"), "ambiguous");
  assert.equal(failed("123 x4"), "ambiguous");
});

test("letters and symbols are part of the collector number", () => {
  assert.deepEqual(parsed("123a"), { quantity: 1, collectorNumber: "123a" });
  assert.deepEqual(parsed("★15"), { quantity: 1, collectorNumber: "★15" });
  // Alchemy rebalances really are capitalised this way.
  assert.deepEqual(parsed("A-45"), { quantity: 1, collectorNumber: "A-45" });
});

test("empty input is rejected", () => {
  assert.equal(failed(""), "empty");
  assert.equal(failed("   "), "empty");
});

test("zero and over-large quantities are rejected", () => {
  assert.equal(failed("0x 123"), "bad-quantity");
  assert.equal(failed(`${MAX_ENTRY_QUANTITY + 1}x 5`), "bad-quantity");
  assert.deepEqual(parsed(`${MAX_ENTRY_QUANTITY}x 5`), {
    quantity: MAX_ENTRY_QUANTITY,
    collectorNumber: "5",
  });
});

test("a dangling quantity is treated as a collector number, not a quantity", () => {
  // "4x" has no number after the x, so there is no playset being asked for.
  // It becomes a collector number, and the set lookup is what reports that no
  // such card exists - a better place to find out than a guess here.
  assert.deepEqual(parsed("4x"), { quantity: 1, collectorNumber: "4x" });
  assert.deepEqual(parsed("x"), { quantity: 1, collectorNumber: "x" });
});

test("every failure reason has a message that names the fix", () => {
  assert.match(describeParseFailure("ambiguous"), /space/);
  assert.match(describeParseFailure("bad-quantity"), /1 and 999/);
  assert.ok(describeParseFailure("empty").length > 0);
});

test("normalizeCollectorNumber strips hashes and internal spaces", () => {
  assert.equal(normalizeCollectorNumber("  #123 "), "123");
  assert.equal(normalizeCollectorNumber("1 2 3"), "123");
  assert.equal(normalizeCollectorNumber("##7"), "7");
});

test("normalizeCollectorNumber preserves case", () => {
  assert.equal(normalizeCollectorNumber("A-45"), "A-45");
  assert.equal(normalizeCollectorNumber("123A"), "123A");
});

test("formatPrintingLabel upper-cases the set and prefixes the number", () => {
  assert.equal(
    formatPrintingLabel({
      name: "Lightning Bolt",
      setCode: "2ed",
      collectorNumber: "162",
    }),
    "Lightning Bolt · 2ED #162",
  );
});

test("nextQuantity clamps at zero rather than going negative", () => {
  assert.equal(nextQuantity(1, -1), 0);
  assert.equal(nextQuantity(1, -5), 0);
  assert.equal(nextQuantity(3, -1), 2);
});

test("nextQuantity clamps at the maximum", () => {
  assert.equal(nextQuantity(MAX_ENTRY_QUANTITY, 1), MAX_ENTRY_QUANTITY);
  assert.equal(nextQuantity(5, 2), 7);
});
