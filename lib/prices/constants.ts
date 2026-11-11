/**
 * Price domain values, shared by the server and the browser.
 *
 * Zero imports, for the same reason the other constants modules have none:
 * the value screen renders a chart in the browser, and reaching these through
 * a module that touches drizzle would pull the ORM into the bundle.
 */

/**
 * Where a price came from, and in which currency.
 *
 * The currency is part of the name rather than a separate column, because a
 * chart that mixed dollars and euros would be wrong without being obviously
 * wrong. Adding `scryfall-eur` later is a new value here and nothing else.
 */
export const PRICE_SOURCES = ["scryfall-usd"] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

export const DEFAULT_PRICE_SOURCE: PriceSource = "scryfall-usd";

/** The currency symbol for a source, for display. */
export const PRICE_SOURCE_CURRENCY: Record<PriceSource, string> = {
  "scryfall-usd": "$",
};

/**
 * How far back "movers" looks.
 *
 * Thirty days rather than since-the-last-snapshot: the job runs weekly, and a
 * one-week delta on a card worth a few dollars is mostly noise. The query
 * takes the newest snapshot at or before the cutoff, so a missed week shifts
 * the comparison point instead of emptying the list.
 */
export const MOVERS_WINDOW_DAYS = 30;

/** How many gainers and losers the value page lists. */
export const MOVERS_LIMIT = 10;

/**
 * Money as a string, from integer cents.
 *
 * Cents everywhere, never a float: prices are added up across hundreds of
 * rows, and binary floating point cannot represent $0.29 exactly, so a
 * running total drifts. Postgres does the summing in `integer`, and this only
 * ever formats the result.
 */
export function formatCents(
  cents: number,
  source: PriceSource = DEFAULT_PRICE_SOURCE,
): string {
  const symbol = PRICE_SOURCE_CURRENCY[source];
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}${symbol}${dollars.toLocaleString()}.${String(remainder).padStart(2, "0")}`;
}

/** The same, with a leading `+` on a gain, for a movers list. */
export function formatCentsDelta(
  cents: number,
  source: PriceSource = DEFAULT_PRICE_SOURCE,
): string {
  return cents > 0
    ? `+${formatCents(cents, source)}`
    : formatCents(cents, source);
}
