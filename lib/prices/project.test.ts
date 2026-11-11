import assert from "node:assert/strict";
import { test } from "node:test";

import { formatCents, formatCentsDelta } from "./constants";
import {
  formatPercent,
  parsePriceToCents,
  percentChange,
  priceForFinish,
  projectPrices,
} from "./project";

/**
 * Tests for the price projection.
 *
 * The cases that matter are the ones where a plausible shortcut is wrong:
 * parsing money through a float, treating a missing price as free, and
 * reading a foil price for an etched card.
 */

/* -- parsing -------------------------------------------------------------- */

test("two decimal places, exactly", () => {
  assert.equal(parsePriceToCents("1.25"), 125);
  assert.equal(parsePriceToCents("12.78"), 1278);
  assert.equal(parsePriceToCents("0.02"), 2);
  assert.equal(parsePriceToCents("1234.56"), 123456);
});

test("the values a float would get wrong", () => {
  // 0.29 * 100 is 28.999999999999996 in binary floating point. Parsing the
  // digits cannot drift, however many of these get summed.
  assert.equal(parsePriceToCents("0.29"), 29);
  assert.equal(parsePriceToCents("1.15"), 115);
  assert.equal(parsePriceToCents("8.57"), 857);
  assert.equal(parsePriceToCents("29.97"), 2997);
});

test("a bare integer is dollars, not cents", () => {
  assert.equal(parsePriceToCents("5"), 500);
  assert.equal(parsePriceToCents("0"), 0);
});

test("one decimal place pads on the right", () => {
  // "1.5" is a dollar fifty. Padding on the left would make it $1.05.
  assert.equal(parsePriceToCents("1.5"), 150);
});

test("a missing price is null, never zero", () => {
  // Zero would silently value an unpriced card at nothing and quietly shrink
  // the collection total; null makes it countable as "unpriced".
  assert.equal(parsePriceToCents(null), null);
  assert.equal(parsePriceToCents(undefined), null);
  assert.equal(parsePriceToCents(""), null);
  assert.equal(parsePriceToCents("   "), null);
});

test("nonsense is rejected rather than coerced", () => {
  assert.equal(parsePriceToCents("free"), null);
  assert.equal(parsePriceToCents("1.2.3"), null);
  assert.equal(parsePriceToCents("$1.25"), null);
  assert.equal(parsePriceToCents("-1.25"), null);
  assert.equal(parsePriceToCents("1,25"), null);
  assert.equal(parsePriceToCents("1.256"), null);
});

test("a price too large for the column is rejected", () => {
  assert.equal(parsePriceToCents("99999999.99"), null);
});

/* -- picking the finish --------------------------------------------------- */

test("each finish reads its own key", () => {
  const prices = {
    usd: "1.00",
    usd_foil: "5.00",
    usd_etched: "9.00",
    eur: "2.00",
  };
  assert.equal(priceForFinish(prices, "nonfoil"), 100);
  assert.equal(priceForFinish(prices, "foil"), 500);
  assert.equal(priceForFinish(prices, "etched"), 900);
});

test("etched does not fall back to foil", () => {
  // An etched foil usually exists alongside the regular foil at a different
  // price. Reading one for the other would misvalue both.
  assert.equal(
    priceForFinish({ usd: "1.00", usd_foil: "5.00" }, "etched"),
    null,
  );
});

test("a finish that exists with no price is null", () => {
  // Real case: Sol Ring TRC #499 lists finishes ["nonfoil","foil"] and
  // Scryfall has usd_foil: null for it.
  assert.equal(priceForFinish({ usd: "1.25", usd_foil: null }, "foil"), null);
});

test("an unknown finish is null, not a guess", () => {
  assert.equal(priceForFinish({ usd: "1.00" }, "glossy"), null);
});

/* -- projecting a batch --------------------------------------------------- */

const CARD = {
  id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  name: "Sol Ring",
  set: "ltc",
  collector_number: "284",
  finishes: ["nonfoil", "foil"],
  prices: { usd: "1.25", usd_foil: null },
};

test("an owned pair with a price becomes a row", () => {
  const { priced, unpriced } = projectPrices(
    [{ printingId: CARD.id, finish: "nonfoil" }],
    [CARD],
  );
  assert.deepEqual(priced, [
    { printingId: CARD.id, finish: "nonfoil", priceCents: 125 },
  ]);
  assert.equal(unpriced.length, 0);
});

test("an owned pair Scryfall cannot price is reported, not dropped", () => {
  const { priced, unpriced } = projectPrices(
    [{ printingId: CARD.id, finish: "foil" }],
    [CARD],
  );
  assert.equal(priced.length, 0);
  assert.deepEqual(unpriced, [
    { printingId: CARD.id, finish: "foil", reason: "no-price-for-finish" },
  ]);
});

test("a printing Scryfall has never heard of is reported separately", () => {
  // A stale printing id — the two reasons are kept apart because one means
  // "no price" and the other means "this card may no longer exist".
  const { priced, unpriced } = projectPrices(
    [{ printingId: "11111111-2222-4333-8444-555555555555", finish: "nonfoil" }],
    [CARD],
  );
  assert.equal(priced.length, 0);
  assert.equal(unpriced[0].reason, "not-in-scryfall");
});

test("ids match regardless of case", () => {
  const { priced } = projectPrices(
    [{ printingId: CARD.id.toUpperCase(), finish: "nonfoil" }],
    [CARD],
  );
  assert.equal(priced.length, 1);
});

test("one printing owned in two finishes gets a row for each priced one", () => {
  const both = {
    ...CARD,
    prices: { usd: "1.25", usd_foil: "4.50", usd_etched: null },
  };
  const { priced, unpriced } = projectPrices(
    [
      { printingId: CARD.id, finish: "nonfoil" },
      { printingId: CARD.id, finish: "foil" },
      { printingId: CARD.id, finish: "etched" },
    ],
    [both],
  );
  assert.equal(priced.length, 2);
  assert.equal(unpriced.length, 1);
  assert.equal(unpriced[0].finish, "etched");
});

/* -- change and formatting ------------------------------------------------ */

test("percentage change", () => {
  assert.equal(percentChange(100, 150), 50);
  assert.equal(percentChange(200, 100), -50);
  assert.equal(percentChange(100, 100), 0);
});

test("a rise from nothing has no percentage", () => {
  // From free to a dollar is not a percentage rise, and both "+Infinity%" and
  // "0%" would be lies. The cash delta is the honest number there.
  assert.equal(percentChange(0, 100), null);
  assert.equal(percentChange(-5, 100), null);
  assert.equal(formatPercent(null), "—");
});

test("percentages are signed to one decimal", () => {
  // Deliberately not a .x5 tie: -3.05 is -3.0499… in binary, so toFixed gives
  // "-3.0". That is a display rounding detail on a label, not something worth
  // carrying arbitrary-precision arithmetic to fix — the cash delta beside it
  // is the exact number.
  assert.equal(formatPercent(12.44), "+12.4%");
  assert.equal(formatPercent(-3.06), "-3.1%");
  assert.equal(formatPercent(0), "0.0%");
});

test("cents format as money", () => {
  assert.equal(formatCents(0), "$0.00");
  assert.equal(formatCents(5), "$0.05");
  assert.equal(formatCents(125), "$1.25");
  assert.equal(formatCents(123456), "$1,234.56");
  assert.equal(formatCents(-125), "-$1.25");
});

test("a delta shows its sign", () => {
  assert.equal(formatCentsDelta(125), "+$1.25");
  assert.equal(formatCentsDelta(-125), "-$1.25");
  assert.equal(formatCentsDelta(0), "$0.00");
});
