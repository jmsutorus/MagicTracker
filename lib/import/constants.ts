/**
 * Import domain values, shared by the server and the browser.
 *
 * Zero imports, for the same reason lib/collection/constants.ts and
 * lib/decks/constants.ts have none: the paste screen is a client component,
 * and reaching these through a module that touches drizzle would pull the ORM
 * into the browser bundle.
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
 * them onto the three boards `deck_cards` actually has, which keeps the
 * parser honest about what it read: a line under "Sideboard" parsed as a
 * sideboard line even though Commander has no sideboard, and the mapping —
 * not the parser — decides that the maybeboard is where it lands.
 */
export const IMPORT_SECTIONS = [
  "commander",
  "main",
  "sideboard",
  "maybeboard",
] as const;
export type ImportSection = (typeof IMPORT_SECTIONS)[number];

/** commander | main | maybe — the boards in lib/decks/constants.ts. */
export function sectionToBoard(
  section: ImportSection,
): "commander" | "main" | "maybe" {
  switch (section) {
    case "commander":
      return "commander";
    case "main":
      return "main";
    /*
     * Commander has no sideboard. Dropping those lines would silently lose
     * cards from a paste, and counting them toward the 100 would make every
     * imported 60-card list illegal for a reason the user did not choose, so
     * they land on the board that counts toward nothing.
     */
    case "sideboard":
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
