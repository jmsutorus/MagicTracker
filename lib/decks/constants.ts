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
 * What a deck is, which decides which rules it is held to.
 *
 * Two, because they are the two things this collection is actually for:
 * Commander, and a cube. Neither is "a deck with different rules turned on" —
 * a cube is a draft pool of 360-odd singleton cards with no commander, no
 * colour-identity restriction and no ban list, so it gets its own report in
 * lib/decks/cube.ts rather than a Commander verdict with the failing checks
 * suppressed. Everything *structural* is shared: a cube lives in `decks`, its
 * cards live in `deck_cards`, and owning, claiming and buying work the same,
 * because a cube is a stack of cards you physically have.
 *
 * Sealed is still not here: a sealed pool is not a list you curate.
 */
export const DECK_FORMATS = ["commander", "cube"] as const;
export type DeckFormat = (typeof DECK_FORMATS)[number];

export const DECK_FORMAT_LABELS: Record<DeckFormat, string> = {
  commander: "Commander",
  cube: "Cube",
};

export function isDeckFormat(value: unknown): value is DeckFormat {
  return (
    typeof value === "string" &&
    (DECK_FORMATS as readonly string[]).includes(value)
  );
}

/** A Commander deck is exactly 100 cards, commanders included. */
export const COMMANDER_DECK_SIZE = 100;

/**
 * How big a cube is meant to be.
 *
 * Unlike Commander's 100, this is the owner's decision, so it is stored per
 * deck (`decks.target_size`) rather than fixed here. The default and the
 * offered choices are the sizes that come out of the draft arithmetic below:
 * 360 is eight drafters at three 15-card packs, 540 is twelve, 450 is ten,
 * 180 is four.
 */
export const DEFAULT_CUBE_SIZE = 360;
export const CUBE_SIZE_CHOICES: readonly number[] = [180, 360, 450, 540, 720];
export const MIN_CUBE_SIZE = 1;

/**
 * An upper bound, so a typo cannot ask for a cube with a million slots.
 * Above the largest cube anyone drafts, and above MAX_IMPORT_LINES, so a
 * paste can always fill one.
 */
export const MAX_CUBE_SIZE = 2_000;

/** A draft pack, and how many each player opens — the usual booster draft. */
export const DRAFT_PACK_SIZE = 15;
export const DRAFT_PACKS_PER_PLAYER = 3;

/**
 * How many drafters a cube of this size seats, or null when it does not
 * divide evenly.
 *
 * This is the whole reason cubes come in multiples of 45: a 360 cube is
 * exactly eight players × three packs × fifteen cards, with nothing left
 * over. Saying so is more useful than the number alone, and saying nothing
 * when it does not divide is better than rounding — a cube of 400 seats
 * eight drafters and leaves 40 cards in the box, which is the owner's
 * business, not a verdict.
 */
export function draftersFor(size: number): number | null {
  const perPlayer = DRAFT_PACK_SIZE * DRAFT_PACKS_PER_PLAYER;
  if (!Number.isSafeInteger(size) || size <= 0) return null;
  if (size % perPlayer !== 0) return null;
  return size / perPlayer;
}

/**
 * The size a deck is measured against: fixed for Commander, stored for a
 * cube. One function so the page, the list and the report cannot disagree.
 */
export function targetSizeFor(
  format: DeckFormat,
  storedTargetSize: number | null,
): number {
  if (format === "commander") return COMMANDER_DECK_SIZE;
  return storedTargetSize ?? DEFAULT_CUBE_SIZE;
}

/**
 * The boards a format actually has.
 *
 * A cube has no command zone, so the editor never offers one. Cards already
 * sitting there — a Commander deck whose list was pasted into a cube, say —
 * still count and are still shown; the cube report asks you to move them
 * rather than hiding them.
 */
export function boardsFor(format: DeckFormat): readonly DeckBoard[] {
  return format === "cube" ? ["main", "maybe"] : DECK_BOARDS;
}

/** What the `main` board is called, which is not "Deck" for a cube. */
export function boardLabel(format: DeckFormat, board: DeckBoard): string {
  if (format === "cube" && board === "main") return "Cube list";
  if (format === "cube" && board === "maybe") return "Considering";
  return DECK_BOARD_LABELS[board];
}

/**
 * CATEGORIES AND GROUPING
 *
 * How a decklist is read. A 100-card Commander deck in one alphabetical run
 * is unreadable — the question anyone actually asks of a list is "how much
 * ramp is in here", and the answer is a heading with eight cards under it.
 * This is the feature Archidekt and Moxfield are really built around.
 *
 * Two kinds of grouping, deliberately:
 *
 *  - **Category** is stored, per card, and typed by the owner. It is the
 *    only one that can express "this Sol Ring is ramp, that one is a combo
 *    piece", because that is a judgement, not a property of the card.
 *  - **Type, mana value and colour** are derived at render time from data
 *    the card already has. They need no setup, which matters: a deck you
 *    just pasted in should group usefully before you have typed anything.
 */
export const DECK_GROUPINGS = [
  "category",
  "type",
  "cmc",
  "color",
  "none",
] as const;
export type DeckGrouping = (typeof DECK_GROUPINGS)[number];

export const DECK_GROUPING_LABELS: Record<DeckGrouping, string> = {
  category: "Category",
  type: "Card type",
  cmc: "Mana value",
  color: "Color",
  none: "Nothing",
};

export function isDeckGrouping(value: unknown): value is DeckGrouping {
  return (
    typeof value === "string" &&
    (DECK_GROUPINGS as readonly string[]).includes(value)
  );
}

/** Matches the CHECK on deck_cards.category. */
export const MAX_CATEGORY_LENGTH = 40;

/** What an uncategorised card is filed under. Not a storable category. */
export const UNCATEGORISED = "Uncategorized";

/**
 * Offered in the category box as a starting point, not as the allowed set —
 * the column is free text and a deck that wants "Stax" should get "Stax".
 * These are simply the headings most Commander lists end up with.
 */
export const SUGGESTED_CATEGORIES: readonly string[] = [
  "Ramp",
  "Card draw",
  "Removal",
  "Board wipe",
  "Tutor",
  "Protection",
  "Recursion",
  "Finisher",
  "Combo",
  "Utility",
  "Land",
];

/**
 * Normalises a typed category to what belongs in the column, or null.
 *
 * Null and the empty string have to collapse to the same thing, or a deck
 * grows an invisible category that sorts beside "Uncategorized" and contains
 * the same cards. The CHECK constraint enforces the trimmed form; this is
 * what makes sure it never has to fire.
 */
export function cleanCategory(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, MAX_CATEGORY_LENGTH);
}

/** The most commanders a legal deck can have. */
export const MAX_COMMANDERS = 2;

/** Guard on a single deck_cards row, matching the CHECK in the schema. */
export const MAX_DECK_CARD_QUANTITY = 99;

export const MAX_DECK_NAME_LENGTH = 100;
