import assert from "node:assert/strict";
import { test } from "node:test";

import { sectionToBoard } from "./constants";
import {
  formatCardList,
  normalizeCardName,
  parseCsvRows,
  parseDecklistLine,
  parseImport,
} from "./parse";

/**
 * Tests for the paste parser.
 *
 * Every decklist shape here is one a real exporter produces. The cases worth
 * reading are the ones where the obvious rule is wrong: a parenthesis that is
 * part of a card's name, a comma inside a card's name in a CSV, a `#` that is
 * a collector number on one line and a comment on the next, and a group
 * heading that would otherwise be imported as a card.
 */

/** Narrows a parse result to a successful one, with a readable failure. */
function ok(input: string) {
  const result = parseImport(input);
  assert.equal(
    result.ok,
    true,
    `expected a parse, got ${JSON.stringify(result)}`,
  );
  if (!result.ok) throw new Error("unreachable");
  return result;
}

function line(input: string) {
  const outcome = parseDecklistLine(input);
  assert.equal(
    outcome.kind,
    "line",
    `expected a card line from ${JSON.stringify(input)}`,
  );
  if (outcome.kind !== "line") throw new Error("unreachable");
  return outcome;
}

/* -- quantities ----------------------------------------------------------- */

test("a plain quantity and name", () => {
  const l = line("4 Lightning Bolt");
  assert.equal(l.quantity, 4);
  assert.equal(l.name, "Lightning Bolt");
});

test("every way exporters write the quantity marker", () => {
  for (const input of [
    "4 Lightning Bolt",
    "4x Lightning Bolt",
    "4X Lightning Bolt",
    "4x  Lightning Bolt",
    "4 x Lightning Bolt",
    "4× Lightning Bolt",
  ]) {
    const l = line(input);
    assert.equal(l.quantity, 4, input);
    assert.equal(l.name, "Lightning Bolt", input);
  }
});

test("no quantity means one copy", () => {
  const l = line("Sol Ring");
  assert.equal(l.quantity, 1);
  assert.equal(l.name, "Sol Ring");
});

test("a quantity with no name is a problem, not a card", () => {
  assert.deepEqual(parseDecklistLine("4x"), {
    kind: "problem",
    reason: "no-name",
  });
  assert.deepEqual(parseDecklistLine("284"), {
    kind: "problem",
    reason: "no-name",
  });
  assert.deepEqual(parseDecklistLine("-----"), {
    kind: "problem",
    reason: "no-name",
  });
});

test("zero and absurd quantities are rejected rather than clamped", () => {
  // Clamping 0 up to 1 would add a card the list said not to add, and
  // clamping 1000 down to 999 would quietly change a number the user typed.
  assert.deepEqual(parseDecklistLine("0 Sol Ring"), {
    kind: "problem",
    reason: "bad-quantity",
  });
  assert.deepEqual(parseDecklistLine("1000 Sol Ring"), {
    kind: "problem",
    reason: "bad-quantity",
  });
  assert.equal(line("999 Sol Ring").quantity, 999);
});

/* -- set codes and collector numbers -------------------------------------- */

test("the Arena and Moxfield form: name, set, collector number", () => {
  const l = line("1 Sol Ring (LTC) 284");
  assert.equal(l.name, "Sol Ring");
  assert.equal(l.setCode, "LTC");
  assert.equal(l.collectorNumber, "284");
});

test("a lowercase set code is uppercased", () => {
  assert.equal(line("1x Sol Ring (ltc) 284").setCode, "LTC");
});

test("a hashed collector number, with and without a set", () => {
  assert.equal(line("1 Sol Ring (LTC) #284").collectorNumber, "284");

  const bare = line("1 Sol Ring #284");
  assert.equal(bare.name, "Sol Ring");
  assert.equal(bare.collectorNumber, "284");
  assert.equal(bare.setCode, null);
});

test("MTGGoldfish writes the set in square brackets", () => {
  const l = line("1 Sol Ring [LTC]");
  assert.equal(l.name, "Sol Ring");
  assert.equal(l.setCode, "LTC");
});

test("Deckstats puts the set before the name", () => {
  const l = line("1 [LTC] Sol Ring");
  assert.equal(l.name, "Sol Ring");
  assert.equal(l.setCode, "LTC");
});

test("an Archidekt category list is discarded, not read as a set", () => {
  const l = line("1x Sol Ring (ltc) 284 [Artifact,Ramp]");
  assert.equal(l.name, "Sol Ring");
  assert.equal(l.setCode, "LTC");
  assert.equal(l.collectorNumber, "284");
});

test("a parenthetical that is part of the card's name survives", () => {
  // "Erase (Not the Urza's Legacy One)" is a real card. A rule that read any
  // trailing parenthesis as a set code would import a card called "Erase".
  const l = line("1 Erase (Not the Urza's Legacy One)");
  assert.equal(l.name, "Erase (Not the Urza's Legacy One)");
  assert.equal(l.setCode, null);
});

/* -- markers -------------------------------------------------------------- */

test("Moxfield's foil and etched markers", () => {
  assert.equal(line("1 Sol Ring (LTC) 284 *F*").finish, "foil");
  assert.equal(line("1 Sol Ring (LTC) 284 *E*").finish, "etched");
  assert.equal(line("1 Sol Ring (LTC) 284").finish, null);
});

test("an unstated finish is null, not nonfoil", () => {
  // The apply step fills a null from the destination's default. If the parser
  // answered "nonfoil" here, a stated default of foil could never apply.
  assert.equal(line("1 Sol Ring").finish, null);
});

test("TappedOut marks the commander on the card line", () => {
  const l = line("1x Zinnia, Valley's Voice *CMDR*");
  assert.equal(l.name, "Zinnia, Valley's Voice");
  assert.equal(l.section, "commander");
});

test("Deckstats marks the commander in a trailing comment", () => {
  const l = line("1 [LTC] Sol Ring # !Commander");
  assert.equal(l.name, "Sol Ring");
  assert.equal(l.setCode, "LTC");
  assert.equal(l.section, "commander");
});

test("the classic SB: prefix", () => {
  const l = line("SB: 1 Negate");
  assert.equal(l.name, "Negate");
  assert.equal(l.section, "sideboard");
});

/* -- names ---------------------------------------------------------------- */

test("split-card names are folded onto the stored spelling", () => {
  assert.equal(normalizeCardName("Fire//Ice"), "Fire // Ice");
  assert.equal(normalizeCardName("Fire // Ice"), "Fire // Ice");
  assert.equal(normalizeCardName("Fire / Ice"), "Fire // Ice");
  assert.equal(normalizeCardName("  Wear   //   Tear  "), "Wear // Tear");
});

test("a name is not mangled by the slash rule", () => {
  // No single slash to rewrite, and nothing to collapse.
  assert.equal(
    normalizeCardName("Jaya's Immolating Inferno"),
    "Jaya's Immolating Inferno",
  );
});

test("surrounding quotes are stripped", () => {
  assert.equal(
    normalizeCardName('"Erebos, God of the Dead"'),
    "Erebos, God of the Dead",
  );
});

/* -- sections ------------------------------------------------------------- */

test("a heading sets the section for the lines under it", () => {
  const result = ok(
    [
      "Commander",
      "1 Zinnia, Valley's Voice",
      "",
      "Deck",
      "1 Sol Ring",
      "1 Llanowar Elves",
    ].join("\n"),
  );
  assert.equal(result.lines.length, 3);
  assert.equal(result.lines[0].section, "commander");
  assert.equal(result.lines[1].section, "main");
  assert.equal(result.lines[2].section, "main");
});

test("Deckstats writes its headings as comments", () => {
  // "//Main" has to be a heading rather than a comment, or every card under
  // it lands on whatever section preceded it.
  const result = ok(
    ["//Commander", "1 Sol Ring", "//Main", "1 Llanowar Elves"].join("\n"),
  );
  assert.equal(result.lines[0].section, "commander");
  assert.equal(result.lines[1].section, "main");
});

test("a heading with a count on it", () => {
  const result = ok(
    ["Deck (99)", "1 Sol Ring", "Sideboard: ", "1 Negate"].join("\n"),
  );
  assert.equal(result.lines[0].section, "main");
  assert.equal(result.lines[1].section, "sideboard");
});

test("Arena's About preamble is dropped", () => {
  // Without this, "Name My Commander Deck" imports as a card by that name.
  const result = ok(
    [
      "About",
      "Name My Commander Deck",
      "",
      "Deck",
      "1 Sol Ring (LTC) 284",
    ].join("\n"),
  );
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].name, "Sol Ring");
  assert.equal(result.problems.length, 0);
});

test("a card-type grouping heading does not move the section", () => {
  const result = ok(
    [
      "Sideboard",
      "Creature (2)",
      "1 Llanowar Elves",
      "Artifact",
      "1 Sol Ring",
    ].join("\n"),
  );
  assert.equal(result.lines.length, 2);
  assert.equal(result.lines[0].section, "sideboard");
  assert.equal(result.lines[1].section, "sideboard");
});

test("an invented grouping heading is skipped, not imported as a card", () => {
  // Archidekt lets you name your own categories, so the words cannot be
  // listed. A count in parentheses with no quantity in front is the tell.
  const result = ok(
    ["Ramp (12)", "1 Sol Ring", "Card Draw (9)", "1 Rhystic Study"].join("\n"),
  );
  assert.equal(result.lines.length, 2);
  assert.deepEqual(
    result.lines.map((l) => l.name),
    ["Sol Ring", "Rhystic Study"],
  );
});

test("comments and blank lines are skipped, not reported as problems", () => {
  const result = ok(["// my deck", "", "# a note", "1 Sol Ring"].join("\n"));
  assert.equal(result.lines.length, 1);
  assert.equal(result.problems.length, 0);
  assert.equal(result.skipped, 3);
});

test("a sideboard lands on the maybeboard", () => {
  // Commander has no sideboard. Dropping the cards would lose them; counting
  // them would make every imported list illegal by 15 cards.
  assert.equal(sectionToBoard("sideboard"), "maybe");
  assert.equal(sectionToBoard("maybeboard"), "maybe");
  assert.equal(sectionToBoard("commander"), "commander");
  assert.equal(sectionToBoard("main"), "main");
});

/* -- whole-paste behaviour ------------------------------------------------ */

test("a full Arena export", () => {
  const result = ok(
    [
      "Deck",
      "1 Zinnia, Valley's Voice (BLB) 229",
      "1 Sol Ring (LTC) 284",
      "30 Mountain (BLB) 275",
      "",
      "Sideboard",
      "1 Negate (DMU) 58",
    ].join("\n"),
  );
  assert.equal(result.format, "decklist");
  assert.equal(result.lines.length, 4);
  assert.equal(result.lines[2].quantity, 30);
  assert.equal(result.lines[3].section, "sideboard");
});

test("a decklist line with a comma in the card name is not a CSV", () => {
  // The CSV test is a recognised header row, not the presence of commas.
  const result = ok("1 Erebos, God of the Dead\n1 Sol Ring");
  assert.equal(result.format, "decklist");
  assert.equal(result.lines[0].name, "Erebos, God of the Dead");
});

test("an empty paste fails before anything else", () => {
  const result = parseImport("   \n  \n");
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.reason, "empty");
});

test("an oversized paste names the limit it broke", () => {
  const tooManyLines = parseImport(
    Array.from({ length: 2_001 }, () => "1 Sol Ring").join("\n"),
  );
  assert.equal(tooManyLines.ok, false);
  if (tooManyLines.ok) throw new Error("unreachable");
  assert.equal(tooManyLines.reason, "too-many-lines");

  const tooLong = parseImport(`1 ${"a".repeat(200_001)}`);
  assert.equal(tooLong.ok, false);
  if (tooLong.ok) throw new Error("unreachable");
  assert.equal(tooLong.reason, "too-long");
});

/* -- CSV ------------------------------------------------------------------ */

test("a quoted field keeps its commas", () => {
  const rows = parseCsvRows('Count,Name\n2,"Erebos, God of the Dead"\n', ",");
  assert.deepEqual(rows[1].fields, ["2", "Erebos, God of the Dead"]);
});

test("a doubled quote inside a quoted field", () => {
  const rows = parseCsvRows('Name\n"Erase ""Not"" It"\n', ",");
  assert.deepEqual(rows[1].fields, ['Erase "Not" It']);
});

test("a newline inside a quoted field does not end the row", () => {
  // The row count and the line numbers both have to survive this, or a
  // problem on a later row cites the wrong line.
  const rows = parseCsvRows(
    'Name,Notes\nSol Ring,"line one\nline two"\n2,x\n',
    ",",
  );
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1].fields, ["Sol Ring", "line one\nline two"]);
  assert.equal(rows[2].lineNumber, 4);
});

test("a Deckbox export: Count wins over Tradelist Count", () => {
  // Tradelist Count is how many you will trade away. Reading it as the
  // quantity owned would import 0 of everything you are not trading.
  const result = ok(
    [
      "Count,Tradelist Count,Name,Edition,Card Number,Condition,Language,Foil",
      '3,1,"Erebos, God of the Dead",Theros,85,Good (Lightly Played),English,',
      "1,0,Sol Ring,Commander Legends,472,Near Mint,English,foil",
    ].join("\n"),
  );
  assert.equal(result.format, "csv");
  assert.equal(result.lines.length, 2);

  assert.equal(result.lines[0].quantity, 3);
  assert.equal(result.lines[0].name, "Erebos, God of the Dead");
  assert.equal(result.lines[0].condition, "LP");
  assert.equal(result.lines[0].finish, "nonfoil");
  // Deckbox's Edition column holds the set's *name*. Kept as written rather
  // than discarded: resolution matches a hint against a set's name as well as
  // its code, which is the only way a Deckbox row finds its printing.
  assert.equal(result.lines[0].setHint, "Theros");
  assert.equal(result.lines[0].collectorNumber, "85");

  assert.equal(result.lines[1].condition, "NM");
  assert.equal(result.lines[1].finish, "foil");
});

test("a ManaBox export, including the Scryfall id", () => {
  // When a file names the printing outright there is nothing left to guess.
  const result = ok(
    [
      "Name,Set code,Collector number,Foil,Quantity,Scryfall ID,Condition",
      "Sol Ring,LTC,284,etched,2,8f3a1b2c-4d5e-4f60-8a9b-0c1d2e3f4a5b,near_mint",
      "Llanowar Elves,M19,314,normal,1,,poor",
    ].join("\n"),
  );
  assert.equal(result.lines[0].finish, "etched");
  assert.equal(result.lines[0].quantity, 2);
  assert.equal(result.lines[0].setHint, "LTC");
  assert.equal(
    result.lines[0].scryfallId,
    "8f3a1b2c-4d5e-4f60-8a9b-0c1d2e3f4a5b",
  );
  assert.equal(result.lines[0].condition, "NM");

  assert.equal(result.lines[1].finish, "nonfoil");
  assert.equal(result.lines[1].scryfallId, null);
  assert.equal(result.lines[1].condition, "DMG");
});

test("a tab-separated export", () => {
  const result = ok(["Quantity\tName\tSet", "2\tSol Ring\tLTC"].join("\n"));
  assert.equal(result.format, "csv");
  assert.equal(result.lines[0].quantity, 2);
  assert.equal(result.lines[0].name, "Sol Ring");
  assert.equal(result.lines[0].setHint, "LTC");
});

test("a semicolon-separated export", () => {
  const result = ok(["Count;Name;Edition", "2;Sol Ring;LTC"].join("\n"));
  assert.equal(result.format, "csv");
  assert.equal(result.lines[0].quantity, 2);
});

test("a CSV with no quantity column is one copy per row", () => {
  const result = ok(
    ["Name,Set code", "Sol Ring,LTC", "Llanowar Elves,M19"].join("\n"),
  );
  assert.equal(result.lines.length, 2);
  assert.equal(result.lines[0].quantity, 1);
});

test("a CSV with no finish or condition column states neither", () => {
  const result = ok(["Name,Set code", "Sol Ring,LTC"].join("\n"));
  assert.equal(result.lines[0].finish, null);
  assert.equal(result.lines[0].condition, null);
});

test("a CSV row with no name is a problem citing its line", () => {
  const result = ok(
    ["Count,Name,Edition", "2,,LTC", "1,Sol Ring,LTC"].join("\n"),
  );
  assert.equal(result.lines.length, 1);
  assert.equal(result.problems.length, 1);
  assert.equal(result.problems[0].lineNumber, 2);
  assert.equal(result.problems[0].reason, "no-name-column");
});

test("a header alone parses to nothing without failing", () => {
  const result = ok("Count,Name,Edition\n");
  assert.equal(result.format, "csv");
  assert.equal(result.lines.length, 0);
  assert.equal(result.problems.length, 0);
});

/* -- writing a list back out ---------------------------------------------- */

test("formatCardList writes what the parser reads", () => {
  const text = formatCardList([
    { name: "Sol Ring", quantity: 1 },
    { name: "Mountain", quantity: 30 },
  ]);
  assert.equal(text, "1 Sol Ring\n30 Mountain");

  const round = ok(text);
  assert.deepEqual(
    round.lines.map((l) => [l.quantity, l.name]),
    [
      [1, "Sol Ring"],
      [30, "Mountain"],
    ],
  );
});
