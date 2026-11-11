import assert from "node:assert/strict";
import { test } from "node:test";

import type { MtgjsonDeck } from "@/lib/mtgjson/client";

import { projectDeck } from "./project";

const ID_A = "9b3603aa-58a2-41d4-a58f-2b3306876e35";
const ID_B = "dfe36901-5841-4942-8b61-c27311000000";

function deck(partial: Partial<MtgjsonDeck>): MtgjsonDeck {
  return { code: "BLC", name: "Test", type: "Commander Deck", ...partial };
}

test("reads the boards it knows and maps their names", () => {
  const { rows, cardCount } = projectDeck(
    deck({
      commander: [
        { count: 1, name: "Zinnia", identifiers: { scryfallId: ID_A } },
      ],
      mainBoard: [
        { count: 3, name: "Forest", identifiers: { scryfallId: ID_B } },
      ],
    }),
  );

  assert.deepEqual(
    rows.map((r) => r.board),
    ["commander", "main"],
  );
  assert.equal(cardCount, 4);
});

test("sums duplicate lines instead of emitting two rows", () => {
  // Two rows with the same identity would violate the unique key on
  // precon_cards and abort the whole product.
  const { rows, cardCount, distinctCount } = projectDeck(
    deck({
      mainBoard: [
        { count: 4, name: "Forest", identifiers: { scryfallId: ID_A } },
        { count: 6, name: "Forest", identifiers: { scryfallId: ID_A } },
      ],
    }),
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 10);
  assert.equal(cardCount, 10);
  assert.equal(distinctCount, 1);
});

test("the same printing in two finishes stays two rows", () => {
  const { rows } = projectDeck(
    deck({
      mainBoard: [
        { count: 1, name: "Sol Ring", identifiers: { scryfallId: ID_A } },
        {
          count: 1,
          name: "Sol Ring",
          isFoil: true,
          identifiers: { scryfallId: ID_A },
        },
      ],
    }),
  );

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => r.isFoil),
    [false, true],
  );
});

test("the same printing on two boards stays two rows", () => {
  const { rows } = projectDeck(
    deck({
      commander: [
        { count: 1, name: "Zinnia", identifiers: { scryfallId: ID_A } },
      ],
      mainBoard: [
        { count: 1, name: "Zinnia", identifiers: { scryfallId: ID_A } },
      ],
    }),
  );
  assert.equal(rows.length, 2);
});

test("etched wins over foil, because a finish is one value", () => {
  const { rows } = projectDeck(
    deck({
      mainBoard: [
        {
          count: 1,
          name: "Sol Ring",
          isFoil: true,
          isEtched: true,
          identifiers: { scryfallId: ID_A },
        },
      ],
    }),
  );

  assert.equal(rows[0].isEtched, true);
  assert.equal(rows[0].isFoil, false);
});

test("a missing Scryfall id is kept and counted, not dropped", () => {
  const { rows, unidentifiedCount, cardCount } = projectDeck(
    deck({
      mainBoard: [
        { count: 1, name: "Brand New Card" },
        { count: 1, name: "Forest", identifiers: { scryfallId: ID_A } },
      ],
    }),
  );

  assert.equal(rows.length, 2);
  assert.equal(unidentifiedCount, 1);
  assert.equal(cardCount, 2);
  assert.equal(rows[0].scryfallId, null);
  assert.equal(rows[0].cardName, "Brand New Card");
});

test("two different unidentified cards do not merge into one", () => {
  const { rows } = projectDeck(
    deck({
      mainBoard: [
        { count: 1, name: "Card One" },
        { count: 2, name: "Card Two" },
      ],
    }),
  );

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => r.quantity),
    [1, 2],
  );
});

test("a malformed Scryfall id is treated as absent, not cast", () => {
  // Passing "not-a-uuid" to a ::uuid cast raises 22P02 and would abort the
  // insert for every other card in the product.
  const { rows, unidentifiedCount } = projectDeck(
    deck({
      mainBoard: [
        { count: 1, name: "Bad Id", identifiers: { scryfallId: "not-a-uuid" } },
      ],
    }),
  );

  assert.equal(rows[0].scryfallId, null);
  assert.equal(unidentifiedCount, 1);
});

test("ids are lower-cased so they match the stored uuid form", () => {
  const { rows } = projectDeck(
    deck({
      mainBoard: [
        {
          count: 1,
          name: "Forest",
          identifiers: { scryfallId: ID_A.toUpperCase() },
        },
      ],
    }),
  );
  assert.equal(rows[0].scryfallId, ID_A);
});

test("a zero, negative or fractional count is skipped", () => {
  const { rows, cardCount } = projectDeck(
    deck({
      mainBoard: [
        { count: 0, name: "Zero" },
        { count: -2, name: "Negative" },
        { count: Number.NaN, name: "NaN" },
        { count: 1, name: "Real", identifiers: { scryfallId: ID_A } },
      ],
    }),
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].cardName, "Real");
  assert.equal(cardCount, 1);
});

test("an unnamed entry is skipped rather than stored as an empty name", () => {
  const { rows } = projectDeck(
    deck({ mainBoard: [{ count: 1, name: "   " }] }),
  );
  assert.equal(rows.length, 0);
});

test("boards that are absent or not arrays are ignored", () => {
  const { rows, cardCount } = projectDeck(
    deck({ mainBoard: undefined, tokens: null as never }),
  );
  assert.equal(rows.length, 0);
  assert.equal(cardCount, 0);
});

test("an empty deck projects to zero of everything", () => {
  const p = projectDeck(deck({}));
  assert.deepEqual(p, {
    rows: [],
    cardCount: 0,
    distinctCount: 0,
    unidentifiedCount: 0,
  });
});
