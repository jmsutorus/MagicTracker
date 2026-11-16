import assert from "node:assert/strict";
import { test } from "node:test";

import type { PokemonCard, PokemonSet } from "./client";
import {
  collectorNumberToInt,
  finishesFor,
  oracleTextFor,
  projectCard,
  projectSet,
  toIsoDate,
  typeLineFor,
} from "./project";

function card(overrides: Partial<PokemonCard> = {}): PokemonCard {
  return {
    id: "sv8-1",
    name: "Exeggcute",
    supertype: "Pokémon",
    subtypes: ["Basic"],
    hp: "30",
    types: ["Grass"],
    number: "1",
    rarity: "Common",
    images: {
      small: "https://images.pokemontcg.io/sv8/1.png",
      large: "https://images.pokemontcg.io/sv8/1_hires.png",
    },
    ...overrides,
  };
}

function set(overrides: Partial<PokemonSet> = {}): PokemonSet {
  return {
    id: "sv8",
    name: "Surging Sparks",
    series: "Scarlet & Violet",
    total: 252,
    releaseDate: "2024/11/08",
    images: { symbol: "https://images.pokemontcg.io/sv8/symbol.png" },
    ...overrides,
  };
}

// --- dates ----------------------------------------------------------------

test("slash-separated dates become ISO dates", () => {
  assert.equal(toIsoDate("2026/11/06"), "2026-11-06");
  assert.equal(toIsoDate("2026-11-06"), "2026-11-06");
});

test("an unexpected date shape is null rather than a guess", () => {
  // A wrong release date silently reorders every set picker in the app,
  // which is harder to notice than a set that sorts with the undated ones.
  assert.equal(toIsoDate(undefined), null);
  assert.equal(toIsoDate(""), null);
  assert.equal(toIsoDate("November 2026"), null);
  assert.equal(toIsoDate("26/11/06"), null);
});

// --- collector numbers ----------------------------------------------------

test("digits are taken from wherever they start", () => {
  // Pokémon numbers letter-prefix far more than Magic's: TG12, GG01,
  // SWSH001. Collapsing all of those to null would pile them at one end of
  // the set in arbitrary order.
  assert.equal(collectorNumberToInt("1"), 1);
  assert.equal(collectorNumberToInt("252"), 252);
  assert.equal(collectorNumberToInt("TG12"), 12);
  assert.equal(collectorNumberToInt("SWSH001"), 1);
  assert.equal(collectorNumberToInt("H5"), 5);
});

test("a number with no digits at all is null", () => {
  assert.equal(collectorNumberToInt(""), null);
  assert.equal(collectorNumberToInt("???"), null);
});

// --- finishes -------------------------------------------------------------

test("ordinary rarities offer plain, reverse and holo", () => {
  // Deliberately generous: this array is what the finish picker is built
  // from, so being too narrow means a card somebody is holding cannot be
  // recorded, while being too wide means an option nobody picks.
  assert.deepEqual(finishesFor("Common", "2024-11-08"), [
    "nonfoil",
    "reverse",
    "foil",
  ]);
  assert.deepEqual(finishesFor("Rare", "2024-11-08"), [
    "nonfoil",
    "reverse",
    "foil",
  ]);
});

test("a chase rarity is foil only", () => {
  for (const rarity of [
    "Rare Holo",
    "Illustration Rare",
    "Special Illustration Rare",
    "Double Rare",
    "Hyper Rare",
    "ACE SPEC Rare",
    "Mega Hyper Rare",
  ]) {
    assert.deepEqual(finishesFor(rarity, "2024-11-08"), ["foil"], rarity);
  }
});

test("an unknown rarity is assumed foil", () => {
  // New Pokémon rarities are nearly always chase cards, so this guess is
  // right far more often than the alternative.
  assert.deepEqual(finishesFor("Quantum Rare", "2024-11-08"), ["foil"]);
});

test("sets older than reverse holos offer only plain", () => {
  // Reverse holos began with Legendary Collection in May 2002; before that
  // a common had exactly one finish.
  assert.deepEqual(finishesFor("Common", "1999-01-09"), ["nonfoil"]);
  assert.deepEqual(finishesFor("Common", "2002-05-24"), [
    "nonfoil",
    "reverse",
    "foil",
  ]);
});

test("an undated set is treated as modern", () => {
  assert.ok(finishesFor("Common", null).includes("reverse"));
});

// --- type lines -----------------------------------------------------------

test("a type line reads like the Magic one it shares a column with", () => {
  assert.equal(typeLineFor(card()), "Basic Pokémon — Grass");
  assert.equal(
    typeLineFor(card({ supertype: "Trainer", subtypes: ["Supporter"], types: undefined })),
    "Supporter Trainer",
  );
});

test("a card with nothing to say has a null type line", () => {
  assert.equal(
    typeLineFor(card({ supertype: undefined, subtypes: [], types: [] })),
    null,
  );
});

// --- oracle text ----------------------------------------------------------

test("attacks, abilities and rules are joined into one block", () => {
  const text = oracleTextFor(
    card({
      abilities: [{ type: "Ability", name: "Shady Dealings", text: "Draw." }],
      attacks: [
        {
          name: "Precocious Evolution",
          cost: ["Colorless"],
          damage: "20",
          text: "Search your deck.",
        },
      ],
      rules: ["Put this in the discard pile."],
    }),
  );

  assert.ok(text?.includes("Shady Dealings"));
  assert.ok(text?.includes("Precocious Evolution"));
  assert.ok(text?.includes("Put this in the discard pile"));
});

test("the attack cost does not fuse into the attack's name", () => {
  // ["Fire","Fire"] joined bare reads "FireFire Burning Darkness", which is
  // one word that does not exist followed by a name it is stuck to.
  const text = oracleTextFor(
    card({
      attacks: [
        { name: "Burning Darkness", cost: ["Fire", "Fire"], damage: "180+" },
      ],
    }),
  );

  assert.ok(text?.includes("{Fire, Fire} Burning Darkness 180+"), text ?? "");
  assert.ok(!text?.includes("FireFire"));
});

test("an attack with no cost has no empty braces", () => {
  const text = oracleTextFor(
    card({ attacks: [{ name: "Struggle", cost: [], damage: "10" }] }),
  );
  assert.equal(text, "Struggle 10");
});

test("a card with no text at all is null, not an empty string", () => {
  assert.equal(oracleTextFor(card()), null);
});

// --- whole rows -----------------------------------------------------------

test("a projected printing carries the catalog's own id and image", () => {
  const { printing } = projectCard(card(), set());

  assert.equal(printing.externalId, "sv8-1");
  assert.equal(printing.setCode, "pkm-sv8");
  assert.equal(printing.collectorNumber, "1");
  assert.equal(printing.imageUrl, "https://images.pokemontcg.io/sv8/1_hires.png");
  assert.equal(printing.releasedAt, "2024-11-08");
  // This catalog publishes no prices; a zero would be a lie about the card.
  assert.equal(printing.usdCents, null);
  // And no art crop, so list rows fall back to the full card.
  assert.equal(printing.artUrl, null);
});

test("every printing of a name shares one oracle id", () => {
  const a = projectCard(card({ id: "sv8-1" }), set());
  const b = projectCard(
    card({ id: "base1-2", number: "2" }),
    set({ id: "base1", name: "Base", releaseDate: "1999/01/09" }),
  );

  assert.equal(a.oracle.oracleId, b.oracle.oracleId);
  assert.notEqual(a.printing.id, b.printing.id);
});

test("a set's series becomes its set type", () => {
  const row = projectSet(set());
  assert.equal(row.code, "pkm-sv8");
  assert.equal(row.game, "pokemon");
  assert.equal(row.setType, "Scarlet & Violet");
  assert.equal(row.releasedAt, "2024-11-08");
});
