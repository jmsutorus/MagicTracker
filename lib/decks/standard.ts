import {
  STANDARD_COPY_LIMIT,
  STANDARD_MAX_SIDEBOARD,
  STANDARD_MIN_DECK_SIZE,
  type DeckBoard,
} from "./constants";
import { copyLimit } from "./legality";

/**
 * The Standard construction rules, as pure functions over card facts.
 *
 * Pure and separately tested for the same reason lib/decks/legality.ts is:
 * "this deck is legal" is advice somebody acts on at a table, and being
 * confidently wrong about it is worse than saying nothing.
 *
 * Rules enforced:
 *
 *   - At least 60 cards in the main deck, with no upper limit.
 *   - A sideboard of at most 15 cards — or none at all.
 *   - At most four copies of any one card **across both**, except basic
 *     lands and cards whose own text says otherwise.
 *   - Every card legal in Standard, and none of them banned.
 *
 * Three things a reading of the format summary would get wrong, and each is
 * the reason a rule is written the way it is below:
 *
 * **Sixty is a floor, not a size.** Commander's 100 is exact and a deck of
 * 99 is illegal; Standard's 60 is a minimum, and a 61-card deck is legal and
 * sometimes deliberate. Reusing the Commander check with a different number
 * would have called a legal deck illegal.
 *
 * **The four-copy limit spans the sideboard.** Four Llanowar Elves in the
 * deck and two in the sideboard is six copies and is not legal. Storage
 * keeps main and side as two rows — `deck_cards`'s key is (deck, board,
 * card) — so a per-row check is the natural one to write and it passes that
 * deck without a word. The totals here are summed per card across every
 * board that counts, which is the only version of the rule that is true.
 *
 * **The card pool is not a list this app keeps.** Which cards are in
 * Standard changes with every rotation and every ban announcement, so the
 * verdict reads `legalities->>'standard'` off the card, refreshed by the
 * weekly ingest. A rotation therefore arrives on its own, and nothing here
 * has to know when one happened.
 */

/** What a rule needs to know about a card. Columns, no interpretation. */
export type StandardCard = {
  oracleId: string;
  name: string;
  typeLine: string | null;
  oracleText: string | null;
  /** `legalities->>'standard'`: legal | not_legal | banned. */
  standardLegality: string | null;
  board: DeckBoard;
  quantity: number;
};

export type StandardProblem = {
  severity: "error" | "warning";
  /** Stable identifier, for testing and for grouping in the UI. */
  code:
    | "deck_size"
    | "sideboard_size"
    | "copies"
    | "banned"
    | "not_legal"
    | "command_zone";
  message: string;
  cards: { oracleId: string; name: string }[];
};

export type StandardReport = {
  legal: boolean;
  /** Copies in the main deck — what the 60 is measured against. */
  cardCount: number;
  /** Copies in the sideboard, which are not part of the 60. */
  sideboardCount: number;
  minimumSize: number;
  maximumSideboard: number;
  problems: StandardProblem[];
};

/**
 * How many copies of this card a Standard deck may hold, in total.
 *
 * Four, unless the card says otherwise — and "says otherwise" is the same
 * reading `copyLimit` already does for Commander's singleton rule, so a
 * basic land is unlimited here too and Seven Dwarves is seven rather than
 * four. A limit of one out of `copyLimit` means "no exception printed on
 * this card", which in Standard is four; anything else is the card's own
 * number and outranks the format's.
 */
export function standardCopyLimit(card: {
  typeLine: string | null;
  oracleText: string | null;
}): number {
  const printed = copyLimit(card);
  return printed === 1 ? STANDARD_COPY_LIMIT : printed;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

/**
 * Checks a Standard deck.
 *
 * `cards` are the rows on the counted boards — main, side, and anything
 * stranded in a command zone. The maybeboard is excluded by the caller,
 * because a card under consideration is not a card in the deck.
 */
export function checkStandardDeck(cards: StandardCard[]): StandardReport {
  const problems: StandardProblem[] = [];

  /*
   * A Standard deck has no command zone. Cards can still be sitting in one —
   * a Commander list pasted in, or a precon built and then rebuilt — and
   * they are part of the stack, so they count toward the deck rather than
   * vanishing from the total with no explanation. Same judgment as the cube
   * report: describe the odd row, do not hide it.
   */
  const stranded = cards.filter((c) => c.board === "commander");
  if (stranded.length > 0) {
    problems.push({
      severity: "warning",
      code: "command_zone",
      message: `${stranded.map((c) => c.name).join(", ")} ${plural(
        stranded.length,
        "is",
        "are",
      )} in the command zone. Standard has no commander — ${plural(
        stranded.length,
        "it counts",
        "they count",
      )} toward the deck until you move ${plural(
        stranded.length,
        "it",
        "them",
      )}.`,
      cards: stranded.map((c) => ({ oracleId: c.oracleId, name: c.name })),
    });
  }

  const mainCards = cards.filter((c) => c.board !== "side");
  const sideCards = cards.filter((c) => c.board === "side");

  const cardCount = mainCards.reduce((n, c) => n + c.quantity, 0);
  const sideboardCount = sideCards.reduce((n, c) => n + c.quantity, 0);

  // ---- size -------------------------------------------------------------
  // Only a shortfall is a problem: there is no maximum deck size in Standard,
  // so a 63-card deck gets no comment at all.
  if (cardCount < STANDARD_MIN_DECK_SIZE) {
    const short = STANDARD_MIN_DECK_SIZE - cardCount;
    problems.push({
      severity: "error",
      code: "deck_size",
      message: `${cardCount} ${plural(cardCount, "card")} — ${short} short of ${STANDARD_MIN_DECK_SIZE}.`,
      cards: [],
    });
  }

  if (sideboardCount > STANDARD_MAX_SIDEBOARD) {
    problems.push({
      severity: "error",
      code: "sideboard_size",
      message: `${sideboardCount} cards in the sideboard — ${
        sideboardCount - STANDARD_MAX_SIDEBOARD
      } over the ${STANDARD_MAX_SIDEBOARD}-card limit.`,
      cards: [],
    });
  }

  // ---- copies, across both boards ---------------------------------------
  /*
   * Summed per card rather than per row. A card in the deck and in the
   * sideboard is two rows and one card, and the limit is on the card.
   */
  type Tally = { card: StandardCard; copies: number };
  const tallies = new Map<string, Tally>();
  for (const card of cards) {
    const existing = tallies.get(card.oracleId);
    if (existing) {
      existing.copies += card.quantity;
    } else {
      tallies.set(card.oracleId, { card, copies: card.quantity });
    }
  }

  const overLimit = [...tallies.values()].filter(
    ({ card, copies }) => copies > standardCopyLimit(card),
  );
  if (overLimit.length > 0) {
    problems.push({
      severity: "error",
      code: "copies",
      message: `Too many copies: ${overLimit
        .map(({ card, copies }) => {
          const limit = standardCopyLimit(card);
          return `${copies}× ${card.name} (limit ${
            Number.isFinite(limit) ? limit : "any"
          })`;
        })
        .join(", ")}. The limit counts the deck and the sideboard together.`,
      cards: overLimit.map(({ card }) => ({
        oracleId: card.oracleId,
        name: card.name,
      })),
    });
  }

  // ---- the card pool ----------------------------------------------------
  /*
   * Deduplicated by card, so a playset over two boards is named once rather
   * than twice in the same sentence.
   */
  const distinct = [...tallies.values()].map(({ card }) => card);

  const banned = distinct.filter((c) => c.standardLegality === "banned");
  if (banned.length > 0) {
    problems.push({
      severity: "error",
      code: "banned",
      message: `Banned in Standard: ${banned.map((c) => c.name).join(", ")}.`,
      cards: banned.map((c) => ({ oracleId: c.oracleId, name: c.name })),
    });
  }

  const notLegal = distinct.filter((c) => c.standardLegality === "not_legal");
  if (notLegal.length > 0) {
    problems.push({
      severity: "error",
      code: "not_legal",
      message: `Not in Standard: ${notLegal
        .map((c) => c.name)
        .join(
          ", ",
        )}. Usually a card from a set that has rotated out, or one that was never in the format.`,
      cards: notLegal.map((c) => ({ oracleId: c.oracleId, name: c.name })),
    });
  }

  return {
    legal: problems.every((p) => p.severity !== "error"),
    cardCount,
    sideboardCount,
    minimumSize: STANDARD_MIN_DECK_SIZE,
    maximumSideboard: STANDARD_MAX_SIDEBOARD,
    problems,
  };
}
