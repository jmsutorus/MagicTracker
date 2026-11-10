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
 * Which finishes a copy can be in. A copy's finish must also be one of the
 * printing's own `finishes` — a nonfoil-only printing has no foil version to
 * own — and the entry path checks that rather than trusting the client.
 */
export const CARD_FINISHES = ["nonfoil", "foil", "etched"] as const;
export type CardFinish = (typeof CARD_FINISHES)[number];

/** Near Mint through Damaged, the grades every marketplace agrees on. */
export const CARD_CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;
export type CardCondition = (typeof CARD_CONDITIONS)[number];

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
export const COMPLETION_FINISHES = ["any", "nonfoil", "foil", "etched"] as const;
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
