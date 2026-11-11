/**
 * Deck domain values, shared by the schema, the server and the browser.
 *
 * Zero imports, for the same reason lib/collection/constants.ts has none: the
 * deck editor is a client component, and importing these from lib/db/schema.ts
 * would drag drizzle-orm into the browser bundle.
 */

/**
 * Where a card sits in a deck.
 *
 * `commander` is a board rather than a column on `decks`, which is a
 * departure from the sketch in PLAN.md §5 (`commander_printing_id FK NULL`).
 * Commander legally allows **two** commanders — Partner, Partner with,
 * Friends forever, Doctor's companion, and Choose a Background — and a single
 * column cannot hold a pair. Modelling it as a board also matches how MTGJSON
 * ships precons and how `precon_cards` already stores them, so creating a
 * deck from a precon is a straight copy.
 *
 * `maybe` is the maybeboard: cards under consideration that count toward
 * nothing — not the 100, not legality, not the buy list.
 */
export const DECK_BOARDS = ["commander", "main", "maybe"] as const;
export type DeckBoard = (typeof DECK_BOARDS)[number];

export const DECK_BOARD_LABELS: Record<DeckBoard, string> = {
  commander: "Commander",
  main: "Deck",
  maybe: "Maybeboard",
};

/** Boards that count toward the 100 and toward legality. */
export const COUNTED_BOARDS: readonly DeckBoard[] = ["commander", "main"];

/**
 * Only Commander is validated.
 *
 * "I mostly play Commander and sealed", and sealed is not a constructed
 * format with a decklist. The column exists so a second format can be added
 * without a migration, but every rule in lib/decks/legality.ts is a Commander
 * rule and nothing pretends otherwise.
 */
export const DECK_FORMATS = ["commander"] as const;
export type DeckFormat = (typeof DECK_FORMATS)[number];

/** A Commander deck is exactly 100 cards, commanders included. */
export const COMMANDER_DECK_SIZE = 100;

/** The most commanders a legal deck can have. */
export const MAX_COMMANDERS = 2;

/** Guard on a single deck_cards row, matching the CHECK in the schema. */
export const MAX_DECK_CARD_QUANTITY = 99;

export const MAX_DECK_NAME_LENGTH = 100;
