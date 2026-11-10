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
