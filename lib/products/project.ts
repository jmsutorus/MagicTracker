/**
 * Turning an MTGJSON deck into rows for `precon_cards`.
 *
 * Pure and separately tested, because the aggregation is the one place a
 * silent mistake would be invisible: a deck whose lines were double-counted
 * would add twice as many cards to a real collection as the box contains, and
 * nothing downstream could tell.
 */
import type { DeckCard, MtgjsonDeck } from "@/lib/mtgjson/client";
import type { PreconBoard } from "./constants";

export type PreconCardRow = {
  board: PreconBoard;
  scryfallId: string | null;
  cardName: string;
  mtgjsonSetCode: string | null;
  collectorNumber: string | null;
  quantity: number;
  isFoil: boolean;
  isEtched: boolean;
};

export type ProjectedDeck = {
  rows: PreconCardRow[];
  /** Total copies across every board — the deck as a physical stack. */
  cardCount: number;
  /** Distinct rows, which is distinct (printing, finish) pairs. */
  distinctCount: number;
  /** Entries MTGJSON itself gave no Scryfall id for. */
  unidentifiedCount: number;
};

/** MTGJSON's board names, mapped to ours. */
const BOARDS: ReadonlyArray<[keyof MtgjsonDeck, PreconBoard]> = [
  ["commander", "commander"],
  ["mainBoard", "main"],
  ["sideBoard", "side"],
  ["tokens", "token"],
  ["planes", "plane"],
  ["schemes", "scheme"],
];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Matches the CHECK on `precon_cards.quantity`, with a sane ceiling. */
const MAX_LINE_QUANTITY = 999;

function normalizeScryfallId(card: DeckCard): string | null {
  const id = card.identifiers?.scryfallId;
  if (typeof id !== "string") return null;
  const trimmed = id.trim().toLowerCase();
  // A malformed id is treated as absent rather than passed to a uuid cast,
  // where it would abort the whole product's insert over one bad line.
  return UUID_RE.test(trimmed) ? trimmed : null;
}

/**
 * Projects a deck, summing duplicate lines.
 *
 * Duplicates are summed rather than stored twice because `precon_cards` has a
 * unique key on (file_name, board, scryfall_id, is_foil, is_etched): a deck
 * that happened to list the same printing on two lines would otherwise abort
 * the insert. Summing is also the right answer — two lines of one card in one
 * box is that many copies.
 *
 * Unidentified lines are kept, not dropped. They are the gap that shows up on
 * a product MTGJSON has published before Scryfall has, and a visible
 * "couldn't match 2 cards" is worth far more than a deck that silently sells
 * itself as complete.
 */
export function projectDeck(deck: MtgjsonDeck): ProjectedDeck {
  const byIdentity = new Map<string, PreconCardRow>();
  let cardCount = 0;
  let unidentifiedCount = 0;

  for (const [source, board] of BOARDS) {
    const entries = deck[source];
    if (!Array.isArray(entries)) continue;

    for (const card of entries as DeckCard[]) {
      const count = Math.trunc(Number(card?.count ?? 0));
      if (!Number.isSafeInteger(count) || count < 1) continue;

      const name = typeof card.name === "string" ? card.name.trim() : "";
      if (name.length === 0) continue;

      const scryfallId = normalizeScryfallId(card);
      const isEtched = card.isEtched === true;
      // Etched and foil are not exclusive in MTGJSON's data, but they are in
      // ours: `collection_items.finish` is one value, and etched is the more
      // specific of the two.
      const isFoil = !isEtched && card.isFoil === true;

      if (scryfallId === null) unidentifiedCount += 1;
      cardCount += count;

      // An unidentified line is keyed on its name, so two different
      // unmatched cards stay two rows instead of merging into one.
      const key = [
        board,
        scryfallId ?? `name:${name.toLowerCase()}`,
        isFoil ? "f" : "-",
        isEtched ? "e" : "-",
      ].join("|");

      const existing = byIdentity.get(key);
      if (existing) {
        existing.quantity = Math.min(
          existing.quantity + count,
          MAX_LINE_QUANTITY,
        );
        continue;
      }

      byIdentity.set(key, {
        board,
        scryfallId,
        cardName: name,
        mtgjsonSetCode:
          typeof card.setCode === "string" && card.setCode.length > 0
            ? card.setCode
            : null,
        collectorNumber:
          typeof card.number === "string" && card.number.length > 0
            ? card.number
            : null,
        quantity: Math.min(count, MAX_LINE_QUANTITY),
        isFoil,
        isEtched,
      });
    }
  }

  const rows = [...byIdentity.values()];

  return {
    rows,
    cardCount,
    distinctCount: rows.length,
    unidentifiedCount,
  };
}
