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
 * `side` is the sideboard, which only a 60-card constructed format has. It is
 * a real part of the deck — you buy it, you own it, it is bound by the
 * four-copy limit along with the main deck — which is exactly what separates
 * it from `maybe`, and why it could not simply be folded into it when
 * Standard arrived.
 *
 * `maybe` is the maybeboard: cards under consideration that count toward
 * nothing — not the 100, not legality, not the buy list.
 */
export const DECK_BOARDS = ["commander", "main", "side", "maybe"] as const;
export type DeckBoard = (typeof DECK_BOARDS)[number];

export const DECK_BOARD_LABELS: Record<DeckBoard, string> = {
  commander: "Commander",
  main: "Deck",
  side: "Sideboard",
  maybe: "Maybeboard",
};

/**
 * The order boards are listed and stored in, for the one `array_position`
 * every decklist query sorts by.
 *
 * Exported as a plain string list because three SQL statements need it as a
 * literal array, and three hand-written copies of `ARRAY['commander',
 * 'main', 'maybe']` is precisely how a new board gets added in one of them
 * and silently sorts last in the other two.
 */
export const BOARD_ORDER: readonly string[] = DECK_BOARDS;

/**
 * The boards that count toward a format's size and its verdict.
 *
 * Format-dependent, because the boards do not mean the same thing in each.
 * A Commander deck's command zone is part of the 100; a Standard deck's
 * sideboard is not part of the 60 but *is* bound by the four-copy limit, so
 * the rules engine has to see it; a maybeboard is never counted anywhere.
 *
 * Everything not listed here is excluded before the rules engine runs, so a
 * format that cannot have a board also cannot be judged by what is sitting
 * on it.
 */
export function countedBoardsFor(format: DeckFormat): readonly DeckBoard[] {
  if (format === "standard") return ["commander", "main", "side"];
  return ["commander", "main"];
}

/**
 * What a deck is, which decides which rules it is held to.
 *
 * Three, and none of them is "a deck with different rules turned on". A cube
 * is a draft pool of 360-odd singleton cards with no commander, no
 * colour-identity restriction and no ban list. A Standard deck is sixty
 * cards or more with a fifteen-card sideboard, four copies of anything, and
 * a card pool that rotates. Each gets its own report — lib/decks/cube.ts,
 * lib/decks/standard.ts — rather than a Commander verdict with the
 * inapplicable checks suppressed.
 *
 * Everything *structural* is shared: all three live in `decks`, their cards
 * live in `deck_cards`, and owning, claiming, buying and sharing work the
 * same, because all three are stacks of cards you physically have.
 *
 * Sealed is still not here: a sealed pool is not a list you curate.
 */
export const DECK_FORMATS = ["commander", "standard", "cube"] as const;
export type DeckFormat = (typeof DECK_FORMATS)[number];

export const DECK_FORMAT_LABELS: Record<DeckFormat, string> = {
  commander: "Commander",
  standard: "Standard",
  cube: "Cube",
};

/**
 * Which key in `oracle_cards.legalities` decides whether a card may be in
 * this deck, or null for a format nobody can be illegal in.
 *
 * A cube has no ban list — a Conspiracy or a playtest card is a perfectly
 * ordinary thing to put in one — so it gets null rather than being quietly
 * held to Commander's list, which is what reading one hard-coded key for
 * every format would have done.
 *
 * Scryfall maintains these per card and the weekly ingest refreshes them, so
 * a Standard rotation lands here within a week of happening, with no code
 * change and no list to keep.
 */
export function legalityKeyFor(format: DeckFormat): string | null {
  if (format === "commander") return "commander";
  if (format === "standard") return "standard";
  return null;
}

export function isDeckFormat(value: unknown): value is DeckFormat {
  return (
    typeof value === "string" &&
    (DECK_FORMATS as readonly string[]).includes(value)
  );
}

/** A Commander deck is exactly 100 cards, commanders included. */
export const COMMANDER_DECK_SIZE = 100;

/**
 * Standard: sixty cards or more, fifteen in the sideboard or fewer, four
 * copies of any one card across both.
 *
 * A *minimum*, not a size. A 61-card Standard deck is legal and sometimes
 * deliberate, so the number here is a floor the deck has to clear rather
 * than a target it has to hit — see `sizeRuleFor`, which is what keeps the
 * deck list from printing "63 / 60" as though it were a failure.
 */
export const STANDARD_MIN_DECK_SIZE = 60;
export const STANDARD_MAX_SIDEBOARD = 15;

/**
 * Four of any one card, across the main deck and the sideboard **together**.
 *
 * The combined part is the whole rule: four in the deck and two more in the
 * sideboard is six copies and is illegal, and a per-row check — which is
 * what the storage layer's unique key would naturally give you, since main
 * and side are two different rows — would pass it without a word.
 */
export const STANDARD_COPY_LIMIT = 4;

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
  if (format === "standard") return STANDARD_MIN_DECK_SIZE;
  return storedTargetSize ?? DEFAULT_CUBE_SIZE;
}

/**
 * What that number *is*: a rule, a floor, or a plan.
 *
 * The three formats mean three different things by their size, and a single
 * `count === target` test would be wrong for two of them. 99 cards in a
 * Commander deck is illegal. 63 in a Standard deck is fine. 358 in a 360
 * cube is neither — it is a cube you have not finished.
 */
export type SizeRule = "exact" | "at_least" | "target";

export function sizeRuleFor(format: DeckFormat): SizeRule {
  if (format === "commander") return "exact";
  if (format === "standard") return "at_least";
  return "target";
}

/** Whether a count satisfies the format's size, by that format's reading. */
export function meetsTargetSize(
  format: DeckFormat,
  count: number,
  targetSize: number,
): boolean {
  return sizeRuleFor(format) === "at_least"
    ? count >= targetSize
    : count === targetSize;
}

/**
 * The boards a format actually has.
 *
 * Neither a cube nor a Standard deck has a command zone, and only Standard
 * has a sideboard, so the editor offers each format only the boards it can
 * actually use. Cards already sitting somewhere a format has no board for —
 * a Commander list pasted into a cube, say — still count and are still
 * shown; the report asks you to move them rather than hiding them.
 */
export function boardsFor(format: DeckFormat): readonly DeckBoard[] {
  if (format === "cube") return ["main", "maybe"];
  if (format === "standard") return ["main", "side", "maybe"];
  return ["commander", "main", "maybe"];
}

/**
 * The nearest board this format actually has.
 *
 * The rule is one sentence: a card must either count toward the deck's
 * verdict or sit on the board that openly counts toward nothing. Anything
 * else is a row that is bought, owned and claimed like the rest of the deck
 * while being invisible to the only panel that explains the deck — which is
 * the kind of discrepancy nobody ever finds.
 *
 * So it is not symmetric, and should not be. A commander pasted into a cube
 * or a Standard deck **stays** in the command zone, because
 * `countedBoardsFor` counts it there and the report names it and asks you to
 * move it. A sideboard pasted into a Commander deck or a cube has no such
 * home, so it lands on the maybeboard — the cards are kept, as a paste's
 * cards always are, and nothing pretends they are part of the deck.
 */
export function boardInFormat(board: DeckBoard, format: DeckFormat): DeckBoard {
  if (board === "maybe") return "maybe";
  return (countedBoardsFor(format) as readonly string[]).includes(board)
    ? board
    : "maybe";
}

/** What a board is called, which is not always what the column says. */
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
