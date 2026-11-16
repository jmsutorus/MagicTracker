import assert from "node:assert/strict";
import { test } from "node:test";

import type { OnePieceCard } from "./client";
import {
  baseCardName,
  centsFromDollars,
  collectorNumberToInt,
  oracleTextFor,
  projectCard,
  projectSet,
  rarityName,
  statLine,
  typeLineFor,
} from "./project";

function card(overrides: Partial<OnePieceCard> = {}): OnePieceCard {
  return {
    card_name: "Kujyaku",
    card_text: "[On Play] Look at 5 cards from the top of your deck.",
    set_name: "A Fist of Divine Speed",
    set_id: "OP-11",
    rarity: "SR",
    card_set_id: "OP11-004",
    card_image_id: "OP11-004",
    card_image: "https://optcgapi.com/media/static/Card_Images/OP11-004.jpg",
    card_color: "Red",
    card_type: "Character",
    life: null,
    card_cost: "1",
    card_power: "2000",
    sub_types: "Navy SWORD",
    counter_amount: 1000,
    attribute: "Special",
    market_price: 0.77,
    inventory_price: 0.5,
    ...overrides,
  };
}

// --- prices ---------------------------------------------------------------

test("dollar floats become integer cents", () => {
  assert.equal(centsFromDollars(0.77), 77);
  assert.equal(centsFromDollars(8.5), 850);
  assert.equal(centsFromDollars(0), 0);
});

test("prices that floating point cannot hold exactly still land on cents", () => {
  // 0.29 * 100 is 28.999999999999996, and 8.5 * 100 is 849.9999999999999 on
  // some values of this shape. Going through the string spelling is what
  // makes these exact rather than nearly right, which is the difference that
  // shows up once a few thousand of them are summed.
  assert.equal(centsFromDollars(0.29), 29);
  assert.equal(centsFromDollars(8.5), 850);
  assert.equal(centsFromDollars(0.07), 7);
  assert.equal(centsFromDollars(1.1), 110);
  assert.equal(centsFromDollars(29.99), 2999);
});

test("a missing or nonsensical price is null, not zero", () => {
  // A free card is real; a card worth "unknown" is not worth nothing, and
  // the value page counts the two differently.
  assert.equal(centsFromDollars(null), null);
  assert.equal(centsFromDollars(undefined), null);
  assert.equal(centsFromDollars(-1), null);
  assert.equal(centsFromDollars(Number.NaN), null);
});

// --- names ----------------------------------------------------------------

test("an alternate art is the same card as the original", () => {
  assert.equal(baseCardName("Kujyaku (Alternate Art)"), "Kujyaku");
  assert.equal(baseCardName("Nami (Manga)"), "Nami");
  assert.equal(baseCardName("Kujyaku"), "Kujyaku");
});

test("a numeric suffix is kept, because it distinguishes two leaders", () => {
  // "Nami (041)" and "Nami (001)" are different cards with the same name.
  // Stripping the number would merge every leader a character has ever had.
  assert.equal(baseCardName("Nami (041)"), "Nami (041)");
  assert.notEqual(baseCardName("Nami (041)"), baseCardName("Nami (001)"));
});

test("a name with punctuation survives intact", () => {
  assert.equal(baseCardName("Monkey.D.Luffy"), "Monkey.D.Luffy");
  assert.equal(baseCardName("Tony Tony.Chopper"), "Tony Tony.Chopper");
});

// --- collector numbers ----------------------------------------------------

test("the last run of digits orders the set", () => {
  // The first run is the set's own number, so taking it would sort all of
  // OP-11 as 11 and leave the set in arbitrary order.
  assert.equal(collectorNumberToInt("OP11-004"), 4);
  assert.equal(collectorNumberToInt("OP11-106"), 106);
  assert.equal(collectorNumberToInt("ST01-001"), 1);
});

test("a number with no digits is null", () => {
  assert.equal(collectorNumberToInt("ABC"), null);
});

// --- rarities -------------------------------------------------------------

test("rarity letters are spelled out", () => {
  // They sit in a column beside Magic's "uncommon" and "mythic"; a bare
  // "SEC" is unreadable to anyone who does not play the game already.
  assert.equal(rarityName("SEC"), "Secret Rare");
  assert.equal(rarityName("UC"), "Uncommon");
  assert.equal(rarityName("L"), "Leader");
});

test("an unrecognised code is passed through rather than swallowed", () => {
  assert.equal(rarityName("XYZ"), "XYZ");
  assert.equal(rarityName(null), "Unknown");
});

// --- text -----------------------------------------------------------------

test("the stat line carries the numbers that have no columns", () => {
  const line = statLine(card());
  assert.ok(line?.includes("Red"));
  assert.ok(line?.includes("Cost 1"));
  assert.ok(line?.includes("Power 2000"));
  assert.ok(line?.includes("Counter 1000"));
});

test("the reprint disclaimer gets its own paragraph", () => {
  // The source appends it with no separator, so it runs straight out of the
  // last sentence: "...in any order.Disclaimer: This card is a reprint".
  const text = oracleTextFor(
    card({
      card_text:
        "[On Play] Draw a card.Disclaimer: This card is a reprint of a previous card.",
    }),
  );

  assert.ok(text?.includes("\n\nDisclaimer:"), text ?? "");
  assert.ok(!text?.includes("card.Disclaimer"));
});

test("a name printed with full stops survives the disclaimer split", () => {
  // Why the split is on one literal marker rather than on "a full stop
  // followed by a capital": that rule would cut "Monkey.D.Luffy" into three.
  const text = oracleTextFor(
    card({ card_text: "Give up to 1 of your [Monkey.D.Luffy] +1000 power." }),
  );
  assert.ok(text?.includes("Monkey.D.Luffy"), text ?? "");
});

test("a type line reads like the Magic one it shares a column with", () => {
  assert.equal(typeLineFor(card()), "Character — Navy SWORD");
  assert.equal(typeLineFor(card({ sub_types: null })), "Character");
});

// --- whole rows -----------------------------------------------------------

test("a printing is keyed on the image id, so alternate arts both survive", () => {
  // 27 of OP-11's 127 printed numbers appear twice, once as the base card
  // and once as an alternate art. Keying on card_set_id would make each
  // pair overwrite the other and lose half the set.
  const base = projectCard(card());
  const alt = projectCard(
    card({
      card_name: "Kujyaku (Alternate Art)",
      card_image_id: "OP11-004_p1",
      market_price: 8.5,
    }),
  );

  assert.notEqual(base.printing.id, alt.printing.id);
  assert.equal(base.printing.externalId, "OP11-004");
  assert.equal(alt.printing.externalId, "OP11-004_p1");

  // Same printed number, and same card — so one page, two printings.
  assert.equal(base.printing.collectorNumber, alt.printing.collectorNumber);
  assert.equal(base.oracle.oracleId, alt.oracle.oracleId);

  assert.equal(base.printing.usdCents, 77);
  assert.equal(alt.printing.usdCents, 850);
});

test("a printing keeps its full printed name", () => {
  const { printing, oracle } = projectCard(
    card({ card_name: "Kujyaku (Alternate Art)" }),
  );
  assert.equal(printing.name, "Kujyaku (Alternate Art)");
  assert.equal(oracle.name, "Kujyaku");
});

test("set codes are prefixed and the kind is recorded", () => {
  assert.equal(projectCard(card()).printing.setCode, "opc-op11");

  const booster = projectSet("OP-11", "A Fist of Divine Speed", "set", 156);
  assert.equal(booster.code, "opc-op11");
  assert.equal(booster.setType, "booster");

  const deck = projectSet("ST-01", "Starter Deck 1", "deck", 17);
  assert.equal(deck.code, "opc-st01");
  assert.equal(deck.setType, "starter deck");
});
