import assert from "node:assert/strict";
import { test } from "node:test";

import { draftersFor, targetSizeFor } from "./constants";
import {
  checkCube,
  describeDraft,
  type CubeBucket,
  type CubeCard,
} from "./cube";

let seq = 0;
function card(partial: Partial<CubeCard> = {}): CubeCard {
  seq += 1;
  return {
    oracleId: `oracle-${seq}`,
    name: `Card ${seq}`,
    typeLine: "Creature — Human",
    oracleText: "",
    colors: ["W"],
    colorIdentity: ["W"],
    cmc: 2,
    board: "main",
    quantity: 1,
    ...partial,
  };
}

function bucket(buckets: CubeBucket[], key: string): CubeBucket {
  const found = buckets.find((b) => b.key === key);
  assert.ok(found, `no bucket "${key}"`);
  return found;
}

// ---- size and draft arithmetic -------------------------------------------

test("a cube at its target size is ready", () => {
  const report = checkCube(
    Array.from({ length: 10 }, () => card()),
    10,
  );
  assert.equal(report.cardCount, 10);
  assert.equal(report.difference, 0);
  assert.equal(report.ready, true);
});

test("short and over are the same field, signed", () => {
  const short = checkCube([card(), card()], 10);
  assert.equal(short.difference, -8);
  assert.equal(short.ready, false);

  const over = checkCube(
    Array.from({ length: 12 }, () => card()),
    10,
  );
  assert.equal(over.difference, 2);
  assert.equal(over.ready, false);
});

test("quantity counts, so a cube is copies and not rows", () => {
  const report = checkCube([card({ quantity: 4 })], 4);
  assert.equal(report.cardCount, 4, "four copies is four slots filled");
  // Still ready: the duplicate is flagged as a warning, and a cube with four
  // copies of something on purpose is a real cube. Only an error blocks.
  assert.equal(report.ready, true);
  assert.deepEqual(
    report.problems.map((p) => p.code),
    ["duplicate"],
  );
});

test("the standard cube sizes seat whole pods", () => {
  assert.equal(draftersFor(360), 8);
  assert.equal(draftersFor(540), 12);
  assert.equal(draftersFor(450), 10);
  assert.equal(draftersFor(180), 4);
  // 400 is a perfectly good cube; it just does not divide into 45s.
  assert.equal(draftersFor(400), null);
  assert.equal(draftersFor(0), null);
  assert.equal(draftersFor(-45), null);
  assert.equal(draftersFor(45.5), null);
});

test("the draft line is spelled out, or absent", () => {
  assert.equal(describeDraft(360), "8 drafters at 3 packs of 15");
  assert.equal(describeDraft(45), "1 drafter at 3 packs of 15");
  assert.equal(describeDraft(400), null);
});

test("a format's target size comes from one place", () => {
  assert.equal(targetSizeFor("commander", null), 100);
  // A stored size cannot override Commander's own rule.
  assert.equal(targetSizeFor("commander", 360), 100);
  assert.equal(targetSizeFor("cube", null), 360);
  assert.equal(targetSizeFor("cube", 540), 540);
});

// ---- duplicates ----------------------------------------------------------

test("a duplicate is a warning, not an error", () => {
  const report = checkCube([card({ name: "Sol Ring", quantity: 2 })], 1);
  const problem = report.problems.find((p) => p.code === "duplicate");
  assert.ok(problem);
  assert.equal(problem.severity, "warning");
  assert.match(problem.message, /2× Sol Ring/);
  assert.equal(problem.cards.length, 1);
});

test("a warning does not stop a cube being ready", () => {
  const report = checkCube(
    [card({ name: "Sol Ring", quantity: 2 }), card()],
    3,
  );
  assert.equal(report.cardCount, 3);
  assert.equal(report.ready, true);
  assert.equal(report.problems.length, 1);
});

test("basics and any-number cards are not duplicates", () => {
  const report = checkCube(
    [
      card({ name: "Forest", typeLine: "Basic Land — Forest", quantity: 12 }),
      card({
        name: "Relentless Rats",
        oracleText:
          "A deck can have any number of cards named Relentless Rats.",
        quantity: 8,
      }),
    ],
    20,
  );
  assert.deepEqual(
    report.problems.map((p) => p.code),
    [],
  );
});

// ---- the command zone ----------------------------------------------------

test("cards left in the command zone are reported, and still count", () => {
  const report = checkCube(
    [card({ name: "Zinnia", board: "commander" }), card()],
    2,
  );
  assert.equal(report.cardCount, 2, "a command-zone card is still a card");
  const problem = report.problems.find((p) => p.code === "command_zone");
  assert.ok(problem);
  assert.match(problem.message, /Zinnia is in the command zone/);
});

test("two in the command zone read as plural", () => {
  const report = checkCube(
    [card({ board: "commander" }), card({ board: "commander" })],
    2,
  );
  const problem = report.problems.find((p) => p.code === "command_zone");
  assert.ok(problem);
  assert.match(problem.message, /are in the command zone/);
  assert.match(problem.message, /move them/);
});

// ---- colour -------------------------------------------------------------

test("colour buckets use the card's colours, not its identity", () => {
  // Bloodghast's identity is BR; its colours are B. A cube counts what you
  // cast it with.
  const report = checkCube(
    [card({ name: "Bloodghast", colors: ["B"], colorIdentity: ["B", "R"] })],
    1,
  );
  assert.equal(bucket(report.colors, "B").cards, 1);
  assert.equal(bucket(report.colors, "R").cards, 0);
  assert.equal(bucket(report.colors, "multi").cards, 0);
});

test("two colours is multicolour, none is colourless", () => {
  const report = checkCube(
    [
      card({ colors: ["U", "R"] }),
      card({ colors: [] }),
      card({ colors: null, colorIdentity: [] }),
    ],
    3,
  );
  assert.equal(bucket(report.colors, "multi").cards, 1);
  assert.equal(bucket(report.colors, "colorless").cards, 2);
});

test("a missing colours column falls back to identity", () => {
  // Null means "the ingest did not have it", not "colourless" — guessing
  // colourless would quietly mis-file every such card.
  const report = checkCube([card({ colors: null, colorIdentity: ["G"] })], 1);
  assert.equal(bucket(report.colors, "G").cards, 1);
  assert.equal(bucket(report.colors, "colorless").cards, 0);
});

test("colour percentages are of the whole cube", () => {
  const report = checkCube(
    [card({ colors: ["W"] }), card({ colors: ["U"] })],
    2,
  );
  assert.equal(bucket(report.colors, "W").percent, 50);
  assert.equal(bucket(report.colors, "U").percent, 50);
  assert.equal(bucket(report.colors, "B").percent, 0);
});

// ---- curve and types ----------------------------------------------------

test("the curve leaves lands out and caps at 7+", () => {
  const report = checkCube(
    [
      card({ typeLine: "Land", cmc: 0 }),
      card({ cmc: 0 }),
      card({ cmc: 3 }),
      card({ cmc: 9 }),
    ],
    4,
  );
  assert.equal(report.lands, 1);
  assert.equal(bucket(report.curve, "0").cards, 1, "the land is not a 0-drop");
  assert.equal(bucket(report.curve, "3").cards, 1);
  assert.equal(bucket(report.curve, "7").cards, 1);
  // Percentages are of the nonland cards, which is what a curve is read as.
  assert.equal(bucket(report.curve, "0").percent, 33);
});

test("a fractional mana value lands in a whole column", () => {
  const report = checkCube([card({ cmc: 0.5 })], 1);
  assert.equal(bucket(report.curve, "0").cards, 1);
});

test("a missing mana value is treated as zero rather than dropped", () => {
  const report = checkCube([card({ cmc: null })], 1);
  assert.equal(bucket(report.curve, "0").cards, 1);
});

test("each card is counted under exactly one type", () => {
  const cards = [
    card({ typeLine: "Artifact Creature — Dragon" }),
    card({ typeLine: "Land — Urza's Saga" }),
    card({ typeLine: "Legendary Artifact Land" }),
    card({ typeLine: "Instant" }),
    card({ typeLine: "Legendary Planeswalker — Teferi" }),
    card({ typeLine: null }),
  ];
  const report = checkCube(cards, cards.length);

  assert.equal(bucket(report.types, "creature").cards, 1);
  assert.equal(
    bucket(report.types, "land").cards,
    2,
    "land wins over artifact",
  );
  assert.equal(bucket(report.types, "instant").cards, 1);
  assert.equal(bucket(report.types, "planeswalker").cards, 1);
  assert.equal(bucket(report.types, "other").cards, 1, "a card with no type");

  const bucketed = report.types.reduce((n, b) => n + b.cards, 0);
  assert.equal(bucketed, report.cardCount, "the type buckets sum to the cube");
});

test("an empty cube reports zeroes rather than dividing by zero", () => {
  const report = checkCube([], 360);
  assert.equal(report.cardCount, 0);
  assert.equal(report.difference, -360);
  assert.equal(report.lands, 0);
  assert.equal(report.problems.length, 0);
  assert.ok(report.colors.every((b) => b.cards === 0 && b.percent === 0));
  assert.ok(report.curve.every((b) => b.percent === 0));
  assert.equal(report.drafters, 8);
});
