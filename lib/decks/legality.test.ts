import assert from "node:assert/strict";
import { test } from "node:test";

import {
  allowsPartner,
  canBeCommander,
  checkCommanderDeck,
  copyLimit,
  formatColorIdentity,
  sortColors,
  type LegalityCard,
} from "./legality";

let seq = 0;
function card(partial: Partial<LegalityCard> = {}): LegalityCard {
  seq += 1;
  return {
    oracleId: `oracle-${seq}`,
    name: `Card ${seq}`,
    typeLine: "Creature — Human",
    oracleText: "",
    colorIdentity: [],
    keywords: [],
    commanderLegality: "legal",
    board: "main",
    quantity: 1,
    ...partial,
  };
}

const COMMANDER = {
  board: "commander" as const,
  typeLine: "Legendary Creature — Rabbit Cleric",
};

/** A legal 100-card deck: one commander plus 99 distinct cards. */
function legalDeck(overrides: Partial<LegalityCard>[] = []): LegalityCard[] {
  const commander = card({ ...COMMANDER, colorIdentity: ["G", "W"] });
  const rest = Array.from({ length: 99 }, () => card());
  return [commander, ...rest, ...overrides.map((o) => card(o))];
}

function codes(cards: LegalityCard[]): string[] {
  return checkCommanderDeck(cards)
    .problems.map((p) => p.code)
    .sort();
}

// ---- copy limits ---------------------------------------------------------

test("a normal card is singleton", () =>
  assert.equal(copyLimit({ typeLine: "Creature — Elf", oracleText: "" }), 1));

test("a basic land has no limit", () =>
  assert.equal(
    copyLimit({ typeLine: "Basic Land — Forest", oracleText: "" }),
    Number.POSITIVE_INFINITY,
  ));

test("a plain 'Basic Land' with no subtype also has no limit", () =>
  assert.equal(
    copyLimit({ typeLine: "Basic Land", oracleText: "" }),
    Number.POSITIVE_INFINITY,
  ));

test("snow basics are basics too", () =>
  // Scryfall writes these as "Basic Snow Land — Forest", and there are six.
  // A startsWith("Basic Land") test calls a legal snow deck illegal.
  assert.equal(
    copyLimit({ typeLine: "Basic Snow Land — Forest", oracleText: "" }),
    Number.POSITIVE_INFINITY,
  ));

test("a Basic Creature is not a basic land", () =>
  assert.equal(
    copyLimit({ typeLine: "Basic Creature — Shapeshifter", oracleText: "" }),
    1,
  ));

test("'any number of cards named' lifts the limit", () =>
  assert.equal(
    copyLimit({
      typeLine: "Creature — Rat",
      oracleText:
        "Relentless Rats gets +1/+1 for each other creature on the battlefield named Relentless Rats.\nA deck can have any number of cards named Relentless Rats.",
    }),
    Number.POSITIVE_INFINITY,
  ));

test("'up to nine cards named' is a numeric limit", () =>
  assert.equal(
    copyLimit({
      typeLine: "Legendary Creature — Wraith",
      oracleText: "A deck can have up to nine cards named Nazgûl.",
    }),
    9,
  ));

test("'up to seven' reads as seven", () =>
  assert.equal(
    copyLimit({
      typeLine: "Creature — Dwarf",
      oracleText: "A deck can have up to seven cards named Seven Dwarves.",
    }),
    7,
  ));

test("a null oracle text does not throw", () =>
  assert.equal(copyLimit({ typeLine: null, oracleText: null }), 1));

// ---- who can be a commander ---------------------------------------------

test("a legendary creature can be a commander", () =>
  assert.equal(
    canBeCommander({
      typeLine: "Legendary Creature — Rabbit Cleric",
      oracleText: "",
    }),
    true,
  ));

test("a non-legendary creature cannot", () =>
  assert.equal(
    canBeCommander({ typeLine: "Creature — Rabbit", oracleText: "" }),
    false,
  ));

test("a legendary artifact that says so can", () =>
  assert.equal(
    canBeCommander({
      typeLine: "Legendary Artifact",
      oracleText: "The Grand Calcutron can be your commander.",
    }),
    true,
  ));

test("a planeswalker that says so can", () =>
  assert.equal(
    canBeCommander({
      typeLine: "Legendary Planeswalker — Teferi",
      oracleText: "Teferi, Temporal Archmage can be your commander.",
    }),
    true,
  ));

test("a Background can, even though it says nothing and is no creature", () =>
  // 30 of the 31 printed Backgrounds never say the phrase, so without this
  // rule every Background commander would be reported as illegal.
  assert.equal(
    canBeCommander({
      typeLine: "Legendary Enchantment — Background",
      oracleText: 'Commander creatures you own have "..."',
    }),
    true,
  ));

test("a plain legendary enchantment cannot", () =>
  assert.equal(
    canBeCommander({
      typeLine: "Legendary Enchantment",
      oracleText: "Does something.",
    }),
    false,
  ));

// ---- partners ------------------------------------------------------------

test("the Partner keyword allows a pair", () =>
  assert.equal(allowsPartner({ oracleText: "", keywords: ["Partner"] }), true));

test("Partner with allows a pair", () =>
  assert.equal(
    allowsPartner({ oracleText: "", keywords: ["Partner with"] }),
    true,
  ));

test("Doctor's companion allows a pair", () =>
  assert.equal(
    allowsPartner({ oracleText: "", keywords: ["Doctor's companion"] }),
    true,
  ));

test("Friends forever allows a pair, from the text", () =>
  assert.equal(
    allowsPartner({ oracleText: "Friends forever", keywords: [] }),
    true,
  ));

test("Ikoria's Companion keyword does NOT allow a pair", () =>
  // The nastiest false positive available here: matching "companion" by
  // substring would let any two of the 12 companion cards sit in the command
  // zone together, which is a completely different mechanic.
  assert.equal(
    allowsPartner({
      oracleText: "Companion — Your starting deck contains…",
      keywords: ["Companion"],
    }),
    false,
  ));

test("a card with no keywords at all does not allow a pair", () =>
  assert.equal(allowsPartner({ oracleText: null, keywords: null }), false));

// ---- colors --------------------------------------------------------------

test("colors sort in WUBRG order, not alphabetical", () =>
  assert.deepEqual(sortColors(["G", "B", "W"]), ["W", "B", "G"]));

test("an empty identity reads as colorless", () =>
  assert.equal(formatColorIdentity([]), "colorless"));

// ---- whole decks ---------------------------------------------------------

test("a legal 100-card deck reports legal with no problems", () => {
  const report = checkCommanderDeck(legalDeck());
  assert.deepEqual(report.problems, []);
  assert.equal(report.legal, true);
  assert.equal(report.cardCount, 100);
  assert.deepEqual(report.colorIdentity, ["W", "G"]);
});

test("99 cards is one short, and says so", () => {
  const deck = legalDeck().slice(0, 99);
  const report = checkCommanderDeck(deck);
  assert.equal(report.legal, false);
  const problem = report.problems.find((p) => p.code === "deck_size");
  assert.ok(problem);
  assert.match(problem.message, /1 card short of 100/);
});

test("101 cards is one over", () => {
  const report = checkCommanderDeck(legalDeck([{}]));
  const problem = report.problems.find((p) => p.code === "deck_size");
  assert.ok(problem);
  assert.match(problem.message, /1 over 100/);
});

test("basics counted by quantity reach 100 without 100 rows", () => {
  const commander = card({ ...COMMANDER, colorIdentity: ["G"] });
  const forest = card({
    typeLine: "Basic Land — Forest",
    name: "Forest",
    quantity: 99,
  });
  const report = checkCommanderDeck([commander, forest]);
  assert.equal(report.cardCount, 100);
  assert.deepEqual(report.problems, []);
});

test("no commander is an error", () => {
  const deck = Array.from({ length: 100 }, () => card());
  assert.ok(codes(deck).includes("no_commander"));
});

test("a missing commander does not also report 100 colour errors", () => {
  // Without a command zone there is no identity to be outside of, and
  // reporting one error per card would bury the single real problem.
  const deck = Array.from({ length: 100 }, () =>
    card({ colorIdentity: ["U"] }),
  );
  assert.deepEqual(codes(deck), ["no_commander"]);
});

test("three commanders is an error", () => {
  const deck = [
    card({ ...COMMANDER }),
    card({ ...COMMANDER }),
    card({ ...COMMANDER }),
    ...Array.from({ length: 97 }, () => card()),
  ];
  assert.ok(codes(deck).includes("too_many_commanders"));
});

test("two partners are legal", () => {
  const deck = [
    card({ ...COMMANDER, keywords: ["Partner"], colorIdentity: ["W"] }),
    card({ ...COMMANDER, keywords: ["Partner"], colorIdentity: ["U"] }),
    ...Array.from({ length: 98 }, () => card({ colorIdentity: ["U"] })),
  ];
  const report = checkCommanderDeck(deck);
  assert.deepEqual(report.problems, []);
  assert.deepEqual(report.colorIdentity, ["W", "U"]);
});

test("two unrelated legends are a warning, not an error", () => {
  // The rules keep adding pairings; calling a legal pair illegal is worse
  // than admitting the check could not verify it.
  const deck = [
    card({ ...COMMANDER }),
    card({ ...COMMANDER }),
    ...Array.from({ length: 98 }, () => card()),
  ];
  const report = checkCommanderDeck(deck);
  assert.equal(report.legal, true);
  const problem = report.problems.find((p) => p.code === "unverified_pair");
  assert.ok(problem);
  assert.equal(problem.severity, "warning");
});

test("a Background paired with a card that chooses one is legal", () => {
  const deck = [
    card({
      ...COMMANDER,
      oracleText: "Choose a Background",
      colorIdentity: ["B"],
    }),
    card({
      board: "commander",
      typeLine: "Legendary Enchantment — Background",
      colorIdentity: ["B"],
    }),
    ...Array.from({ length: 98 }, () => card({ colorIdentity: ["B"] })),
  ];
  assert.deepEqual(checkCommanderDeck(deck).problems, []);
});

test("a Background alone is an error that explains itself", () => {
  const deck = [
    card({
      board: "commander",
      typeLine: "Legendary Enchantment — Background",
      name: "Candlekeep Sage",
    }),
    ...Array.from({ length: 99 }, () => card()),
  ];
  const report = checkCommanderDeck(deck);
  assert.equal(report.legal, false);
  const problem = report.problems.find((p) => p.code === "invalid_commander");
  assert.ok(problem);
  assert.match(problem.message, /Choose a Background/);
});

test("a non-legendary commander is an error", () => {
  const deck = [
    card({ board: "commander", typeLine: "Creature — Rabbit", name: "Bunny" }),
    ...Array.from({ length: 99 }, () => card()),
  ];
  const report = checkCommanderDeck(deck);
  const problem = report.problems.find((p) => p.code === "invalid_commander");
  assert.ok(problem);
  assert.match(problem.message, /Bunny cannot be a commander/);
});

test("a banned card is an error naming it", () => {
  const deck = legalDeck();
  deck[1] = card({ name: "Black Lotus", commanderLegality: "banned" });
  const report = checkCommanderDeck(deck);
  assert.equal(report.legal, false);
  const problem = report.problems.find((p) => p.code === "banned");
  assert.ok(problem);
  assert.match(problem.message, /Black Lotus/);
  assert.deepEqual(problem.cards, [
    { oracleId: deck[1].oracleId, name: "Black Lotus" },
  ]);
});

test("a not-legal card is reported separately from a banned one", () => {
  const deck = legalDeck();
  deck[1] = card({ name: "Acorn Thing", commanderLegality: "not_legal" });
  const report = checkCommanderDeck(deck);
  const problem = report.problems.find((p) => p.code === "not_legal");
  assert.ok(problem);
  assert.ok(!report.problems.some((p) => p.code === "banned"));
});

test("two copies of a normal card breaks singleton", () => {
  const deck = legalDeck();
  deck[1] = card({ name: "Sol Ring", quantity: 2 });
  const report = checkCommanderDeck(deck);
  assert.equal(report.cardCount, 101);
  const problem = report.problems.find((p) => p.code === "singleton");
  assert.ok(problem);
  assert.match(problem.message, /2× Sol Ring \(limit 1\)/);
});

test("ten Nazgûl breaks singleton but nine does not", () => {
  const nazgul = (quantity: number) =>
    card({
      name: "Nazgûl",
      quantity,
      oracleText: "A deck can have up to nine cards named Nazgûl.",
    });

  const nine = [
    card({ ...COMMANDER }),
    nazgul(9),
    ...Array.from({ length: 90 }, () => card()),
  ];
  assert.deepEqual(checkCommanderDeck(nine).problems, []);

  const ten = [
    card({ ...COMMANDER }),
    nazgul(10),
    ...Array.from({ length: 89 }, () => card()),
  ];
  assert.ok(codes(ten).includes("singleton"));
});

test("two copies of the commander is its own error", () => {
  const deck = [
    card({ ...COMMANDER, quantity: 2, name: "Zinnia" }),
    ...Array.from({ length: 98 }, () => card()),
  ];
  const report = checkCommanderDeck(deck);
  const problem = report.problems.find((p) => p.code === "singleton");
  assert.ok(problem);
  assert.match(problem.message, /command zone/);
});

test("a card outside the commander's identity is an error", () => {
  const deck = legalDeck();
  deck[1] = card({ name: "Counterspell", colorIdentity: ["U"] });
  const report = checkCommanderDeck(deck);
  assert.equal(report.legal, false);
  const problem = report.problems.find((p) => p.code === "color_identity");
  assert.ok(problem);
  assert.match(problem.message, /Counterspell \(U\)/);
  assert.match(problem.message, /WG identity/);
});

test("a colorless card is inside every identity", () => {
  const deck = legalDeck();
  deck[1] = card({ name: "Sol Ring", colorIdentity: [] });
  assert.deepEqual(checkCommanderDeck(deck).problems, []);
});

test("a card is inside a partial match only if every color fits", () => {
  const deck = legalDeck();
  // Commander is WG; a WU card fails on the U alone.
  deck[1] = card({ name: "Hybrid Thing", colorIdentity: ["W", "U"] });
  assert.ok(codes(deck).includes("color_identity"));
});

test("a colorless commander admits only colorless cards", () => {
  const deck = [
    card({ ...COMMANDER, name: "Karn", colorIdentity: [] }),
    card({ name: "Lightning Bolt", colorIdentity: ["R"] }),
    ...Array.from({ length: 98 }, () => card({ colorIdentity: [] })),
  ];
  const report = checkCommanderDeck(deck);
  const problem = report.problems.find((p) => p.code === "color_identity");
  assert.ok(problem);
  assert.match(problem.message, /colorless identity/);
});

test("the maybeboard is the caller's to exclude, and is counted if passed", () => {
  // Documents the contract: checkCommanderDeck counts every row it is given,
  // so lib/decks/queries.ts must filter the maybeboard out before calling.
  const deck = legalDeck([{ board: "maybe" }]);
  assert.equal(checkCommanderDeck(deck).cardCount, 101);
});

test("an empty deck reports both missing things, and nothing else", () => {
  assert.deepEqual(codes([]), ["deck_size", "no_commander"]);
});
