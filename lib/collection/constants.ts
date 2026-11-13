/**
 * Domain values shared by the schema, the server and the browser.
 *
 * These live apart from lib/db/schema.ts on purpose. The schema module
 * imports drizzle-orm/pg-core, so a client component that imported its
 * constants from there would pull the ORM into the browser bundle. This file
 * has no imports at all, which keeps it safe to use anywhere; schema.ts
 * re-exports from here so there is still exactly one definition of each.
 */

/** binder | box | deck | tradeable | sold */
export const LOCATION_KINDS = [
  "binder",
  "box",
  "deck",
  "tradeable",
  "sold",
] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

/**
 * What each kind is called where a person reads it.
 *
 * The stored values are terse because they are column values; "box" and
 * "deck" on screen read as jargon, and "deck" in particular collides with
 * the app's other meaning of the word — a decklist. These labels are the
 * only spelling the UI should use.
 */
export const LOCATION_KIND_LABELS: Record<LocationKind, string> = {
  binder: "Binder",
  box: "Storage box",
  deck: "Deck box",
  tradeable: "Trade pile",
  sold: "Sold",
};

/**
 * One sentence saying what a location is, for the screens that ask you to
 * pick one before you have been told.
 */
export const LOCATION_EXPLAINER =
  "A location is the physical place a card sits — a binder, a deck box, a shelf. Every card is in exactly one.";

/**
 * Which finishes a copy can be in. A copy's finish must also be one of the
 * printing's own `finishes` — a nonfoil-only printing has no foil version to
 * own — and the entry path checks that rather than trusting the client.
 */
export const CARD_FINISHES = ["nonfoil", "foil", "etched"] as const;
export type CardFinish = (typeof CARD_FINISHES)[number];

/** Near Mint through Damaged, the grades every marketplace agrees on. */
export const CARD_CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;
export type CardCondition = (typeof CARD_CONDITIONS)[number];

/**
 * "own 2 foil NM", or "own 3: 2 foil NM · 1 nonfoil LP".
 *
 * How many, and of what, in one line — what a card page's printings list has
 * to answer about each version.
 *
 * The finish is spelled out even when it is the ordinary one. Naming only the
 * foils would leave a bare "own 2" meaning either nonfoil or unstated, and
 * someone checking whether they already have the foil of a card is precisely
 * who reads this.
 *
 * The total leads only when the copies differ among themselves: "own 2: 2
 * foil NM" would say the same thing twice.
 */
export function describeOwnedCopies(
  groups: readonly { finish: string; condition: string; quantity: number }[],
): string {
  if (groups.length === 0) return "";

  const parts = groups.map(
    (g) => `${g.quantity} ${g.finish} ${g.condition}`.trim(),
  );
  if (parts.length === 1) return `own ${parts[0]}`;

  const total = groups.reduce((sum, g) => sum + g.quantity, 0);
  return `own ${total}: ${parts.join(" · ")}`;
}

/** The default every collection starts with, seeded by migration 0005. */
export const DEFAULT_LOCATION_NAME = "Unsorted";

/**
 * What counts as "a copy" for set completion.
 *
 * `any` is the default: for most people "I have that card" does not depend on
 * the treatment. The others are literal — `foil` means a foil copy, not "any
 * shiny copy", because an etched foil is a separate treatment that usually
 * exists alongside the regular foil, and counting one for the other would
 * call a set complete while the regular foils are still missing.
 *
 * (PLAN.md §4 listed three values. `etched` is the fourth because the
 * alternative was making `foil` mean two different things.)
 */
export const COMPLETION_FINISHES = [
  "any",
  "nonfoil",
  "foil",
  "etched",
] as const;
export type CompletionFinish = (typeof COMPLETION_FINISHES)[number];

/** The scope flags that define "complete" for one set. */
export type CompletionScope = {
  /** Restrict to booster-obtainable cards — the set as printed in packs. */
  boosterOnly: boolean;
  /** Include promo-stamped printings filed under this set code. */
  includePromos: boolean;
  /** Include art series cards, tokens and emblems filed under this code. */
  includeExtras: boolean;
  finish: CompletionFinish;
};

/**
 * Booster-only, any finish — the most common meaning of "I completed the set".
 *
 * For Bloomburrow that is the 281 booster-obtainable cards (collector numbers
 * 1-281) rather than all 397, which is what a shop or a binder page means by
 * a complete set.
 */
export const DEFAULT_COMPLETION_SCOPE: CompletionScope = {
  boosterOnly: true,
  includePromos: false,
  includeExtras: false,
  finish: "any",
};

/**
 * How a browsed collection is ordered.
 *
 * A fixed set rather than a column name from the query string: this value
 * reaches an ORDER BY, and the one thing that must never happen is a
 * caller interpolating whatever arrived. Every option here maps to a
 * hand-written fragment below.
 */
export const COLLECTION_SORTS = [
  "name",
  "name-desc",
  "set",
  "quantity",
  "rarity",
  "value",
  "added",
] as const;
export type CollectionSort = (typeof COLLECTION_SORTS)[number];

export const COLLECTION_SORT_LABELS: Record<CollectionSort, string> = {
  name: "Name A–Z",
  "name-desc": "Name Z–A",
  set: "Set, then number",
  quantity: "Most copies",
  rarity: "Rarest first",
  value: "Most valuable",
  added: "Recently added",
};

export function isCollectionSort(value: unknown): value is CollectionSort {
  return (
    typeof value === "string" &&
    (COLLECTION_SORTS as readonly string[]).includes(value)
  );
}
