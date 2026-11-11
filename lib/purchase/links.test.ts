import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatBuyListText,
  manapoolCardUrl,
  manapoolPrintingUrl,
  massEntryUrl,
  tcgplayerCardUrl,
  type BuyListEntry,
} from "./links";

test("a TCGplayer id gives the product page", () => {
  assert.equal(
    tcgplayerCardUrl("Sol Ring", 726040),
    "https://www.tcgplayer.com/product/726040",
  );
});

test("no TCGplayer id falls back to a name search", () => {
  const url = tcgplayerCardUrl("Urza, Lord High Artificer", null);
  assert.match(url, /^https:\/\/www\.tcgplayer\.com\/search\/magic\/product\?/);
  assert.ok(url.includes("q=Urza%2C%20Lord%20High%20Artificer"));
});

test("a zero id is not an id", () => {
  // tcgplayer_id is an integer column; 0 would be a bad row, not product 0.
  assert.match(tcgplayerCardUrl("Sol Ring", 0), /\/search\//);
});

test("Mana Pool search encodes the name", () => {
  assert.equal(
    manapoolCardUrl("Fable of the Mirror-Breaker"),
    "https://manapool.com/cards?q=Fable%20of%20the%20Mirror-Breaker",
  );
});

test("a Mana Pool printing URL is set, number, slug", () => {
  assert.equal(
    manapoolPrintingUrl("SLD", "1011", "Sol Ring"),
    "https://manapool.com/card/sld/1011/sol-ring",
  );
});

test("punctuation in a name becomes single hyphens", () => {
  assert.equal(
    manapoolPrintingUrl("mh1", "75", "Urza, Lord High Artificer"),
    "https://manapool.com/card/mh1/75/urza-lord-high-artificer",
  );
  assert.equal(
    manapoolPrintingUrl("neo", "141", "Fable of the Mirror-Breaker"),
    "https://manapool.com/card/neo/141/fable-of-the-mirror-breaker",
  );
});

test("a collector number with a letter survives", () => {
  assert.equal(
    manapoolPrintingUrl("war", "1★", "Gideon Blackblade"),
    "https://manapool.com/card/war/1%E2%98%85/gideon-blackblade",
  );
});

test("a name with nothing sluggable still makes a URL", () => {
  assert.equal(
    manapoolPrintingUrl("sld", "1", "///"),
    "https://manapool.com/card/sld/1/card",
  );
});

test("a deck buy list is quantity and name only", () => {
  const entries: BuyListEntry[] = [
    { quantity: 1, name: "Sol Ring" },
    { quantity: 4, name: "Llanowar Elves" },
  ];
  assert.equal(formatBuyListText(entries), "1 Sol Ring\n4 Llanowar Elves");
});

test("a want list carries the set code and collector number", () => {
  assert.equal(
    formatBuyListText([
      {
        quantity: 1,
        name: "Lightning Bolt",
        setCode: "sld",
        collectorNumber: "84",
      },
    ]),
    "1 Lightning Bolt [SLD] 84",
  );
});

test("a set code without a collector number is still useful", () => {
  assert.equal(
    formatBuyListText([{ quantity: 2, name: "Plains", setCode: "m20" }]),
    "2 Plains [M20]",
  );
});

test("a collector number without a set code is dropped", () => {
  // On its own the number reads as part of the card name and matches nothing.
  assert.equal(
    formatBuyListText([
      { quantity: 1, name: "Plains", setCode: null, collectorNumber: "261" },
    ]),
    "1 Plains",
  );
});

test("an empty list is an empty string, not a stray newline", () => {
  assert.equal(formatBuyListText([]), "");
});

test("both stores have a bulk page", () => {
  assert.equal(
    massEntryUrl("tcgplayer"),
    "https://www.tcgplayer.com/massentry",
  );
  assert.equal(massEntryUrl("manapool"), "https://manapool.com/add-deck");
});
