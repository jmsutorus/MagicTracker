import {
  boardInFormat,
  type DeckBoard,
  type DeckFormat,
} from "@/lib/decks/constants";

/**
 * Import domain values, shared by the server and the browser.
 *
 * One import, and deliberately only that one: lib/decks/constants.ts is
 * itself import-free for the same reason this file nearly is — the paste
 * screen is a client component, and reaching these through a module that
 * touches drizzle would pull the ORM into the browser bundle.
 */

/**
 * Where a parsed list can go.
 *
 * `check` writes nothing. It is first in the list and the default because it
 * is the use PLAN.md §7 names: "importing a decklist you found online to
 * check against what you own". The answer to that question is the review
 * table itself, so making the user pick a destination before they can see it
 * would put a write in front of a read.
 */
export const IMPORT_TARGETS = ["check", "collection", "deck"] as const;
export type ImportTarget = (typeof IMPORT_TARGETS)[number];

/**
 * The sections a pasted list can divide itself into.
 *
 * These are the exporters' words, not this app's. `sectionToBoard` below maps
 * them onto the boards `deck_cards` actually has, which keeps the parser
 * honest about what it read: a line under "Sideboard" is parsed as a
 * sideboard line whatever the destination turns out to be, and the mapping —
 * not the parser — decides where that lands.
 */
export const IMPORT_SECTIONS = [
  "commander",
  "main",
  "sideboard",
  "maybeboard",
] as const;
export type ImportSection = (typeof IMPORT_SECTIONS)[number];

/**
 * Which board a parsed section lands on, in a deck of this format.
 *
 * Format-dependent for exactly one section, and that one matters: a
 * sideboard is a real part of a Standard deck and nothing at all in
 * Commander or a cube.
 *
 * In a format that has one, a pasted sideboard lands in the sideboard —
 * which is the difference between importing a Standard decklist and
 * importing three-quarters of one. In a format that does not, those lines go
 * to the maybeboard rather than being dropped: dropping them would silently
 * lose cards from a paste, and counting them toward the 100 would make every
 * imported 60-card list illegal for a reason the user did not choose.
 *
 * The command zone is *not* conditional. A Commander list pasted into a cube
 * or a Standard deck keeps its commanders where the paste said they were,
 * and the deck's own report explains the stranded rows — which is better
 * than quietly refiling somebody's cards and saying nothing.
 */
export function sectionToBoard(
  section: ImportSection,
  format: DeckFormat = "commander",
): DeckBoard {
  switch (section) {
    case "commander":
      return "commander";
    case "main":
      return "main";
    // `boardInFormat` is the one place that decides where a board a format
    // does not have ends up, so this cannot disagree with the import write.
    case "sideboard":
      return boardInFormat("side", format);
    case "maybeboard":
      return "maybe";
  }
}

/**
 * Limits on one paste.
 *
 * A server action carries its body through a POST with a 1 MB default limit,
 * and a browser that is handed a 50,000-row review table stops responding.
 * Both of those fail confusingly, so the parser refuses early and says which
 * limit was hit.
 */
export const MAX_IMPORT_CHARS = 200_000;
export const MAX_IMPORT_LINES = 2_000;

/**
 * How many unmatched names get a fuzzy lookup.
 *
 * Suggestions are one trigram query each — the only part of resolving that
 * cannot be batched — so a paste where nothing matches (the wrong file, or a
 * CSV in a language this database does not hold) would otherwise fire a
 * thousand queries to tell the user the same thing a dozen would.
 */
export const MAX_SUGGESTION_LOOKUPS = 25;
export const SUGGESTIONS_PER_LINE = 5;

/** Human wording for each section, for the review table's group headings. */
export const IMPORT_SECTION_LABELS: Record<ImportSection, string> = {
  commander: "Commander",
  main: "Deck",
  sideboard: "Sideboard",
  maybeboard: "Maybeboard",
};
