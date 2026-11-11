import assert from "node:assert/strict";
import { test } from "node:test";

import {
  collectorNumberToInt,
  isPaperCard,
  projectCard,
  resolveOracleId,
  type ScryfallCard,
} from "./project";

function card(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    oracle_id: "22222222-2222-4222-8222-222222222222",
    name: "Lightning Bolt",
    lang: "en",
    layout: "normal",
    set: "blb",
    collector_number: "123",
    rarity: "common",
    games: ["paper"],
    ...overrides,
  };
}

// --- collector number ordering -------------------------------------------

test("collectorNumberToInt extracts the leading number", () => {
  assert.equal(collectorNumberToInt("1"), 1);
  assert.equal(collectorNumberToInt("42"), 42);
  assert.equal(collectorNumberToInt("123a"), 123);
  assert.equal(collectorNumberToInt("★15"), 15);
  assert.equal(collectorNumberToInt("A-7"), 7);
  assert.equal(collectorNumberToInt("T3"), 3);
});

test("collectorNumberToInt returns null when there is no number", () => {
  assert.equal(collectorNumberToInt(""), null);
  assert.equal(collectorNumberToInt("★"), null);
});

test("numeric ordering beats text ordering", () => {
  // The whole point: as text these sort 1, 10, 100, 2.
  const raw = ["1", "10", "100", "2"];
  const sorted = [...raw].sort(
    (a, b) => (collectorNumberToInt(a) ?? 0) - (collectorNumberToInt(b) ?? 0),
  );
  assert.deepEqual(sorted, ["1", "2", "10", "100"]);
});

// --- paper filtering ------------------------------------------------------

test("keeps paper cards, drops digital-only ones", () => {
  assert.equal(isPaperCard(card({ games: ["paper"] })), true);
  assert.equal(isPaperCard(card({ games: ["paper", "arena"] })), true);
  assert.equal(isPaperCard(card({ games: ["arena"] })), false);
  assert.equal(isPaperCard(card({ games: ["mtgo", "arena"] })), false);
});

test("a digital flag excludes the card even if games says paper", () => {
  assert.equal(isPaperCard(card({ digital: true, games: ["paper"] })), false);
});

test("missing games is treated as paper rather than dropped", () => {
  // Better to include something questionable than silently lose a printing.
  assert.equal(isPaperCard(card({ games: undefined })), true);
  assert.equal(isPaperCard(card({ games: [] })), true);
});

test("projectCard returns null for a digital-only card", () => {
  assert.equal(projectCard(card({ games: ["arena"] })), null);
});

// --- oracle id ------------------------------------------------------------

test("resolveOracleId prefers the top-level id", () => {
  assert.equal(
    resolveOracleId(card()),
    "22222222-2222-4222-8222-222222222222",
  );
});

test("resolveOracleId falls back to a face for reversible cards", () => {
  // reversible_card has no top-level oracle_id; each face carries one.
  const reversible = card({
    oracle_id: undefined,
    layout: "reversible_card",
    card_faces: [
      { oracle_id: "33333333-3333-4333-8333-333333333333", name: "Front" },
      { oracle_id: "33333333-3333-4333-8333-333333333333", name: "Back" },
    ],
  });
  assert.equal(
    resolveOracleId(reversible),
    "33333333-3333-4333-8333-333333333333",
  );
  assert.notEqual(projectCard(reversible), null);
});

test("projectCard returns null when no oracle id can be found", () => {
  assert.equal(
    projectCard(card({ oracle_id: undefined, card_faces: [] })),
    null,
  );
});

// --- multi-faced cards ----------------------------------------------------

test("joins faces with // when the top-level field is absent", () => {
  const dfc = card({
    name: "Delver of Secrets // Insectile Aberration",
    layout: "transform",
    mana_cost: undefined,
    oracle_text: undefined,
    card_faces: [
      { name: "Delver of Secrets", mana_cost: "{U}", oracle_text: "Front text" },
      { name: "Insectile Aberration", mana_cost: "", oracle_text: "Back text" },
    ],
  });

  const result = projectCard(dfc);
  assert.ok(result);
  assert.equal(result.oracle.manaCost, "{U}");
  assert.equal(result.oracle.oracleText, "Front text // Back text");
});

test("prefers the top-level field over faces when present", () => {
  const split = card({
    mana_cost: "{1}{R} // {2}{R}",
    card_faces: [{ mana_cost: "{1}{R}" }, { mana_cost: "{2}{R}" }],
  });
  const result = projectCard(split);
  assert.ok(result);
  assert.equal(result.oracle.manaCost, "{1}{R} // {2}{R}");
});

test("unions face colors when top-level colors are absent", () => {
  const dfc = card({
    colors: undefined,
    card_faces: [{ colors: ["U"] }, { colors: ["G", "U"] }],
  });
  const result = projectCard(dfc);
  assert.ok(result);
  assert.deepEqual(result.oracle.colors, ["G", "U"]);
});

// --- finishes -------------------------------------------------------------

test("uses the finishes array when present", () => {
  const result = projectCard(card({ finishes: ["nonfoil", "foil"] }));
  assert.ok(result);
  assert.deepEqual(result.printing.finishes, ["nonfoil", "foil"]);
});

test("derives finishes from legacy foil/nonfoil booleans", () => {
  const result = projectCard(
    card({ finishes: undefined, nonfoil: true, foil: false }),
  );
  assert.ok(result);
  assert.deepEqual(result.printing.finishes, ["nonfoil"]);
});

// --- completion scope flags ----------------------------------------------

test("carries the flags that drive completion scope", () => {
  const collectorBooster = projectCard(
    card({ booster: false, promo: false, variation: true, full_art: true }),
  );
  assert.ok(collectorBooster);
  assert.equal(collectorBooster.printing.isBooster, false);
  assert.equal(collectorBooster.printing.isVariation, true);
  assert.equal(collectorBooster.printing.fullArt, true);

  const boosterCard = projectCard(card({ booster: true }));
  assert.ok(boosterCard);
  assert.equal(boosterCard.printing.isBooster, true);
  assert.equal(boosterCard.printing.isPromo, false);
});

test("absent boolean flags default to false, not undefined", () => {
  // These columns are NOT NULL; undefined would break the COPY.
  const result = projectCard(
    card({ booster: undefined, promo: undefined, variation: undefined }),
  );
  assert.ok(result);
  assert.equal(result.printing.isBooster, false);
  assert.equal(result.printing.isPromo, false);
  assert.equal(result.printing.isVariation, false);
  assert.equal(result.oracle.reserved, false);
});

test("color identity defaults to an empty array, never null", () => {
  const result = projectCard(card({ color_identity: undefined }));
  assert.ok(result);
  assert.deepEqual(result.oracle.colorIdentity, []);
});

// --- prices carried off the bulk file -------------------------------------

test("prices land on the printing row as cents, per finish", () => {
  const result = projectCard(
    card({
      finishes: ["nonfoil", "foil", "etched"],
      prices: {
        usd: "1.25",
        usd_foil: "12.78",
        usd_etched: "40",
        eur: "9.99",
        tix: "0.02",
      },
    }),
  );
  assert.notEqual(result, null);
  assert.equal(result!.printing.usdCents, 125);
  assert.equal(result!.printing.usdFoilCents, 1278);
  // A bare integer is dollars, not cents.
  assert.equal(result!.printing.usdEtchedCents, 4000);
});

test("a missing price for a finish is null, not zero", () => {
  // Zero would be a price — a free card — and would drag a cost-to-finish
  // total down as if the card were already covered.
  const result = projectCard(card({ prices: { usd: "0.35" } }));
  assert.equal(result!.printing.usdCents, 35);
  assert.equal(result!.printing.usdFoilCents, null);
  assert.equal(result!.printing.usdEtchedCents, null);
});

test("a card with no prices block at all prices as null", () => {
  const result = projectCard(card());
  assert.equal(result!.printing.usdCents, null);
  assert.equal(result!.printing.usdFoilCents, null);
  assert.equal(result!.printing.usdEtchedCents, null);
});

test("an unparseable price is null rather than a guess", () => {
  const result = projectCard(card({ prices: { usd: "1,25" } }));
  assert.equal(result!.printing.usdCents, null);
});
