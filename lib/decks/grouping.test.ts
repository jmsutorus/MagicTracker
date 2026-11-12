import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanCategory, UNCATEGORISED } from "./constants";
import { groupDeckCards, typeBucket, type GroupableCard } from "./grouping";

function card(over: Partial<GroupableCard> = {}): GroupableCard {
  return {
    name: "Card",
    typeLine: "Creature — Elf",
    manaCost: "{G}",
    cmc: 1,
    colorIdentity: ["G"],
    category: null,
    quantity: 1,
    ...over,
  };
}

test("an artifact creature groups as a creature, not an artifact", () => {
  assert.equal(typeBucket("Artifact Creature — Golem"), "Creature");
});

test("a land creature groups as a creature", () => {
  assert.equal(typeBucket("Land Creature — Forest Dryad"), "Creature");
});

test("only the front face decides the type of a double-faced card", () => {
  // Agadeem's Awakening // Agadeem, the Undercrypt is a spell you cast.
  assert.equal(typeBucket("Sorcery // Land"), "Sorcery");
});

test("an unknown type line falls in Other rather than throwing", () => {
  assert.equal(typeBucket(null), "Other");
  assert.equal(typeBucket("Dungeon"), "Other");
});

test("type groups come out in reading order with lands last", () => {
  const groups = groupDeckCards(
    [
      card({ typeLine: "Land" }),
      card({ typeLine: "Instant" }),
      card({ typeLine: "Creature — Elf" }),
    ],
    "type",
  );
  assert.deepEqual(
    groups.map((g) => g.label),
    ["Creature", "Instant", "Land"],
  );
});

test("Other sorts before Land, not after it", () => {
  const groups = groupDeckCards(
    [card({ typeLine: "Land" }), card({ typeLine: "Dungeon" })],
    "type",
  );
  assert.deepEqual(
    groups.map((g) => g.label),
    ["Other", "Land"],
  );
});

test("copies are counted, not rows", () => {
  const groups = groupDeckCards(
    [
      card({ typeLine: "Land", name: "Forest", quantity: 10 }),
      card({ typeLine: "Land", name: "Island", quantity: 5 }),
    ],
    "type",
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].copies, 15);
  assert.equal(groups[0].cards.length, 2);
});

test("uncategorised cards sort last, not alphabetically under U", () => {
  const groups = groupDeckCards(
    [
      card({ category: null }),
      card({ category: "Ramp" }),
      card({ category: "Card draw" }),
    ],
    "category",
  );
  assert.deepEqual(
    groups.map((g) => g.label),
    ["Card draw", "Ramp", UNCATEGORISED],
  );
});

test("mana value groups sort numerically, with lands after every value", () => {
  const groups = groupDeckCards(
    [
      card({ typeLine: "Land", cmc: 0 }),
      card({ typeLine: "Sorcery", cmc: 10 }),
      card({ typeLine: "Instant", cmc: 2 }),
    ],
    "cmc",
  );
  assert.deepEqual(
    groups.map((g) => g.label),
    ["2 mana", "10 mana", "Lands"],
  );
});

test("colours come out in WUBRG order, then gold, then colourless", () => {
  const groups = groupDeckCards(
    [
      card({ colorIdentity: [] }),
      card({ colorIdentity: ["G"] }),
      card({ colorIdentity: ["W", "U"] }),
      card({ colorIdentity: ["W"] }),
    ],
    "color",
  );
  assert.deepEqual(
    groups.map((g) => g.label),
    ["White", "Green", "Multicolor", "Colorless"],
  );
});

test("grouping by nothing returns one unlabelled group holding everything", () => {
  const groups = groupDeckCards([card(), card({ quantity: 3 })], "none");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].cards.length, 2);
  assert.equal(groups[0].copies, 4);
});

test("a blank or whitespace category is null, not its own group", () => {
  assert.equal(cleanCategory(""), null);
  assert.equal(cleanCategory("   "), null);
  assert.equal(cleanCategory(null), null);
  assert.equal(cleanCategory("  Ramp  "), "Ramp");
  // Inner whitespace is collapsed so "Card  draw" and "Card draw" are one.
  assert.equal(cleanCategory("Card  draw"), "Card draw");
});

test("a category longer than the column allows is cut, not rejected", () => {
  const long = "x".repeat(80);
  assert.equal(cleanCategory(long)?.length, 40);
});
