import assert from "node:assert/strict";
import { test } from "node:test";

import {
  STANDARD_COPY_LIMIT,
  STANDARD_MAX_SIDEBOARD,
  STANDARD_MIN_DECK_SIZE,
  boardInFormat,
  boardsFor,
  countedBoardsFor,
  legalityKeyFor,
  meetsTargetSize,
  sizeRuleFor,
  targetSizeFor,
} from "./constants";
import {
  checkStandardDeck,
  standardCopyLimit,
  type StandardCard,
  type StandardProblem,
} from "./standard";

let seq = 0;
function card(partial: Partial<StandardCard> = {}): StandardCard {
  seq += 1;
  return {
    oracleId: `oracle-${seq}`,
    name: `Card ${seq}`,
    typeLine: "Creature — Human",
    oracleText: "",
    standardLegality: "legal",
    board: "main",
    quantity: 1,
    ...partial,
  };
}

/** A 60-card legal deck, with the given cards substituted at the front. */
function legalDeck(overrides: Partial<StandardCard>[] = []): StandardCard[] {
  const deck = Array.from({ length: STANDARD_MIN_DECK_SIZE }, () => card());
  overrides.forEach((override, index) => {
    deck[index] = card(override);
  });
  return deck;
}

function problem(
  problems: StandardProblem[],
  code: StandardProblem["code"],
): StandardProblem {
  const found = problems.find((p) => p.code === code);
  assert.ok(found, `expected a "${code}" problem, got ${codes(problems)}`);
  return found;
}

function codes(problems: StandardProblem[]): string {
  return problems.length === 0
    ? "none"
    : problems.map((p) => p.code).join(", ");
}

function assertNo(problems: StandardProblem[], code: StandardProblem["code"]) {
  assert.equal(
    problems.some((p) => p.code === code),
    false,
    `unexpected "${code}" in ${codes(problems)}`,
  );
}

// ---- size ----------------------------------------------------------------

test("sixty cards with nothing wrong is legal", () => {
  const report = checkStandardDeck(legalDeck());
  assert.equal(report.cardCount, STANDARD_MIN_DECK_SIZE);
  assert.equal(report.sideboardCount, 0);
  assert.equal(report.legal, true, codes(report.problems));
  assert.deepEqual(report.problems, []);
});

test("under sixty says how many short", () => {
  const report = checkStandardDeck(legalDeck().slice(0, 58));
  assert.equal(report.legal, false);
  assert.match(problem(report.problems, "deck_size").message, /2 short of 60/);
});

/*
 * The rule Commander's check would have got wrong: 100 is exact, 60 is a
 * floor. A 63-card deck is legal and is a real choice people make.
 */
test("over sixty is not a problem at all", () => {
  const deck = [...legalDeck(), card(), card(), card()];
  const report = checkStandardDeck(deck);
  assert.equal(report.cardCount, 63);
  assert.equal(report.legal, true, codes(report.problems));
  assertNo(report.problems, "deck_size");
});

test("copies count, not rows", () => {
  const deck = [
    card({ name: "Mountain", typeLine: "Basic Land — Mountain", quantity: 24 }),
    card({ quantity: 4 }),
    card({ quantity: 4 }),
    ...Array.from({ length: 28 }, () => card()),
  ];
  const report = checkStandardDeck(deck);
  assert.equal(report.cardCount, 60);
  assert.equal(report.legal, true, codes(report.problems));
});

// ---- the sideboard -------------------------------------------------------

test("no sideboard is a legal sideboard", () => {
  const report = checkStandardDeck(legalDeck());
  assert.equal(report.sideboardCount, 0);
  assertNo(report.problems, "sideboard_size");
});

test("fifteen in the sideboard is legal, sixteen is not", () => {
  const fifteen = [
    ...legalDeck(),
    ...Array.from({ length: STANDARD_MAX_SIDEBOARD }, () =>
      card({ board: "side" }),
    ),
  ];
  const ok = checkStandardDeck(fifteen);
  assert.equal(ok.sideboardCount, 15);
  assert.equal(ok.legal, true, codes(ok.problems));

  const over = checkStandardDeck([...fifteen, card({ board: "side" })]);
  assert.equal(over.sideboardCount, 16);
  assert.equal(over.legal, false);
  assert.match(problem(over.problems, "sideboard_size").message, /1 over/);
});

test("the sideboard is not part of the sixty", () => {
  const deck = [
    ...legalDeck().slice(0, 55),
    ...Array.from({ length: 10 }, () => card({ board: "side" })),
  ];
  const report = checkStandardDeck(deck);
  assert.equal(report.cardCount, 55);
  assert.equal(report.sideboardCount, 10);
  // 65 cards in total, and still five short of a legal deck.
  assert.match(problem(report.problems, "deck_size").message, /5 short/);
});

// ---- the four-copy limit -------------------------------------------------

test("four copies is the limit and four copies is fine", () => {
  const deck = legalDeck([
    { name: "Llanowar Elves", quantity: STANDARD_COPY_LIMIT },
  ]).slice(0, 57);
  const report = checkStandardDeck(deck);
  assertNo(report.problems, "copies");
});

test("five copies on one board is too many", () => {
  const deck = legalDeck([{ name: "Llanowar Elves", quantity: 5 }]);
  const report = checkStandardDeck(deck);
  assert.equal(report.legal, false);
  assert.match(
    problem(report.problems, "copies").message,
    /5× Llanowar Elves \(limit 4\)/,
  );
});

/*
 * The rule a per-row check cannot see. Main and side are two rows in
 * `deck_cards` — the unique key is (deck, board, card) — so nothing in
 * storage objects to four here and two there, and six copies is illegal.
 */
test("four in the deck plus two in the sideboard is six copies", () => {
  const elves = { oracleId: "elves", name: "Llanowar Elves" };
  const deck = [
    ...legalDeck().slice(0, 56),
    card({ ...elves, quantity: 4 }),
    card({ ...elves, quantity: 2, board: "side" }),
  ];
  const report = checkStandardDeck(deck);
  assert.equal(report.legal, false);
  const copies = problem(report.problems, "copies");
  assert.match(copies.message, /6× Llanowar Elves \(limit 4\)/);
  // Named once, not once per board.
  assert.equal(copies.cards.length, 1);
  assert.match(copies.message, /deck and the sideboard together/);
});

test("basic lands are exempt, by type line", () => {
  const deck = [
    card({
      name: "Mountain",
      typeLine: "Basic Land — Mountain",
      quantity: 24,
    }),
    ...Array.from({ length: 36 }, () => card()),
  ];
  const report = checkStandardDeck(deck);
  assertNo(report.problems, "copies");
});

test("snow basics are exempt too — the type line is not a prefix test", () => {
  assert.equal(
    standardCopyLimit({
      typeLine: "Basic Snow Land — Forest",
      oracleText: "({T}: Add {G}.)",
    }),
    Number.POSITIVE_INFINITY,
  );
});

test('"any number" cards are exempt, read off the card', () => {
  const deck = [
    card({
      name: "Persistent Petitioners",
      oracleText:
        "A deck can have any number of cards named Persistent Petitioners.",
      quantity: 30,
    }),
    ...Array.from({ length: 30 }, () => card()),
  ];
  const report = checkStandardDeck(deck);
  assertNo(report.problems, "copies");
});

test("a card's own number outranks the format's four", () => {
  const seven = {
    typeLine: "Creature — Dwarf",
    oracleText: "A deck can have up to seven cards named Seven Dwarves.",
  };
  assert.equal(standardCopyLimit(seven), 7);

  const deck = legalDeck([{ name: "Seven Dwarves", ...seven, quantity: 7 }]);
  assertNo(checkStandardDeck(deck).problems, "copies");

  const eight = legalDeck([{ name: "Seven Dwarves", ...seven, quantity: 8 }]);
  assert.match(
    problem(checkStandardDeck(eight).problems, "copies").message,
    /8× Seven Dwarves \(limit 7\)/,
  );
});

test("an ordinary card is four, not one", () => {
  assert.equal(
    standardCopyLimit({ typeLine: "Creature — Human", oracleText: "" }),
    STANDARD_COPY_LIMIT,
  );
});

// ---- the card pool -------------------------------------------------------

test("a banned card is an error naming the card", () => {
  const deck = legalDeck([
    { name: "Cauldron Familiar", standardLegality: "banned" },
  ]);
  const report = checkStandardDeck(deck);
  assert.equal(report.legal, false);
  assert.match(
    problem(report.problems, "banned").message,
    /Banned in Standard: Cauldron Familiar/,
  );
});

test("a rotated card is not legal, and says why it might not be", () => {
  const deck = legalDeck([
    { name: "Lightning Bolt", standardLegality: "not_legal" },
  ]);
  const report = checkStandardDeck(deck);
  assert.equal(report.legal, false);
  assert.match(
    problem(report.problems, "not_legal").message,
    /Not in Standard: Lightning Bolt[\s\S]*rotated/,
  );
});

test("a banned card in the sideboard is still banned", () => {
  const deck = [
    ...legalDeck(),
    card({
      name: "Cauldron Familiar",
      standardLegality: "banned",
      board: "side",
    }),
  ];
  assert.equal(checkStandardDeck(deck).legal, false);
});

test("a card over two boards is named once in the pool problems", () => {
  const bolt = {
    oracleId: "bolt",
    name: "Lightning Bolt",
    standardLegality: "not_legal",
  };
  const deck = [
    ...legalDeck().slice(0, 58),
    card({ ...bolt, quantity: 2 }),
    card({ ...bolt, quantity: 2, board: "side" }),
  ];
  const notLegal = problem(checkStandardDeck(deck).problems, "not_legal");
  assert.equal(notLegal.cards.length, 1);
});

// ---- a stranded command zone --------------------------------------------

/*
 * Standard has no command zone, but a pasted Commander list can leave a card
 * in one. It counts toward the deck rather than disappearing from the total,
 * and the warning explains the row instead of hiding it — the same judgment
 * the cube report makes.
 */
test("a card in the command zone counts and warns", () => {
  const deck = [
    ...legalDeck().slice(0, 59),
    card({ name: "Atraxa", board: "commander" }),
  ];
  const report = checkStandardDeck(deck);
  assert.equal(report.cardCount, 60);
  assert.equal(report.legal, true, codes(report.problems));
  const warning = problem(report.problems, "command_zone");
  assert.equal(warning.severity, "warning");
  assert.match(warning.message, /Standard has no commander/);
});

// ---- what the rest of the app reads off a format -------------------------

test("sixty is a floor, a hundred is exact, a cube is a target", () => {
  assert.equal(sizeRuleFor("standard"), "at_least");
  assert.equal(sizeRuleFor("commander"), "exact");
  assert.equal(sizeRuleFor("cube"), "target");

  assert.equal(meetsTargetSize("standard", 63, 60), true);
  assert.equal(meetsTargetSize("standard", 59, 60), false);
  assert.equal(meetsTargetSize("commander", 101, 100), false);
  assert.equal(meetsTargetSize("cube", 358, 360), false);
});

test("a Standard deck is measured against sixty, whatever is stored", () => {
  assert.equal(targetSizeFor("standard", null), STANDARD_MIN_DECK_SIZE);
  assert.equal(targetSizeFor("standard", 360), STANDARD_MIN_DECK_SIZE);
});

test("Standard has a sideboard and no command zone", () => {
  assert.deepEqual(boardsFor("standard"), ["main", "side", "maybe"]);
  assert.deepEqual(boardsFor("commander"), ["commander", "main", "maybe"]);
  assert.deepEqual(boardsFor("cube"), ["main", "maybe"]);
});

/*
 * The sideboard has to reach the rules engine or the four-copy rule cannot
 * be checked across it, which is the one thing about this format that is
 * easy to get wrong.
 */
test("the sideboard counts toward the verdict; the maybeboard never does", () => {
  const counted = countedBoardsFor("standard");
  assert.ok(counted.includes("side"));
  assert.equal(counted.includes("maybe"), false);
  assert.equal(countedBoardsFor("commander").includes("side"), false);
});

test("each format is judged by its own legality column, or by none", () => {
  assert.equal(legalityKeyFor("standard"), "standard");
  assert.equal(legalityKeyFor("commander"), "commander");
  assert.equal(legalityKeyFor("cube"), null);
});

/*
 * The rule that keeps a row from being owned, claimed and bought while being
 * invisible to the only panel that explains the deck.
 */
test("a board a format does not count becomes the one that counts nothing", () => {
  assert.equal(boardInFormat("side", "commander"), "maybe");
  assert.equal(boardInFormat("side", "cube"), "maybe");
  assert.equal(boardInFormat("side", "standard"), "side");

  // A stranded commander stays put in every format, because every format's
  // report counts the command zone and names what is sitting in it.
  assert.equal(boardInFormat("commander", "standard"), "commander");
  assert.equal(boardInFormat("commander", "cube"), "commander");

  assert.equal(boardInFormat("main", "standard"), "main");
  assert.equal(boardInFormat("maybe", "standard"), "maybe");
});
