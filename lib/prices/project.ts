import type { ScryfallCardPrices, ScryfallPrices } from "@/lib/scryfall/client";

/**
 * Turning Scryfall's price strings into rows worth storing.
 *
 * Pure, so the two things that are easy to get quietly wrong — decimal
 * parsing and picking the price for the finish you actually own — are tested
 * directly rather than only exercised through a weekly job nobody watches.
 */

/** A price for one (printing, finish) pair, in integer cents. */
export type PriceRow = {
  printingId: string;
  finish: string;
  priceCents: number;
};

/** A (printing, finish) pair with no usable price, for the coverage count. */
export type UnpricedRow = {
  printingId: string;
  finish: string;
  /** Why, in a few words, for the ingest log. */
  reason: "no-price-for-finish" | "not-in-scryfall";
};

/**
 * Parses a decimal money string into integer cents.
 *
 * Done on the string, never via `parseFloat(x) * 100`. Binary floating point
 * cannot represent most two-decimal values exactly — `0.29 * 100` is
 * `28.999999999999996` — and while a single `Math.round` hides that, the
 * habit does not survive being summed over a collection. Parsing the digits
 * is exact and cannot drift.
 *
 * Scryfall sends two decimal places ("1.25", "12.78", "0.02"), but a bare
 * integer and a single decimal place are accepted too rather than discarded:
 * a price that arrives as "5" is five dollars, not a missing price.
 */
export function parsePriceToCents(
  value: string | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;

  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const match = trimmed.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;

  const dollars = Number.parseInt(match[1], 10);
  // "1.5" is fifty cents, not five: pad on the right, not the left.
  const cents = Number.parseInt((match[2] ?? "0").padEnd(2, "0"), 10);

  const total = dollars * 100 + cents;
  // Guard against a price so large it stops being an integer safely, and
  // against the integer column it is headed for.
  return Number.isSafeInteger(total) && total <= 2_147_483_647 ? total : null;
}

/**
 * The price for one finish.
 *
 * Etched is its own key and not a kind of foil, matching how the collection
 * stores finishes: an etched foil usually exists alongside the regular foil
 * at a different price, so reading one for the other would misvalue both.
 */
export function priceForFinish(
  prices: ScryfallPrices | undefined,
  finish: string,
): number | null {
  if (!prices) return null;

  switch (finish) {
    case "nonfoil":
      return parsePriceToCents(prices.usd);
    case "foil":
      return parsePriceToCents(prices.usd_foil);
    case "etched":
      return parsePriceToCents(prices.usd_etched);
    default:
      return null;
  }
}

/**
 * Matches owned (printing, finish) pairs against what Scryfall returned.
 *
 * Returns the rows to store *and* the pairs it could not price, because the
 * total is only as honest as its coverage. Scryfall genuinely has no price
 * for some printings, and a foil price can be absent for a printing that
 * exists in foil — so an unpriced pair is a fact to report, not an error and
 * not something to pass over in silence.
 */
export function projectPrices(
  owned: { printingId: string; finish: string }[],
  cards: ScryfallCardPrices[],
): { priced: PriceRow[]; unpriced: UnpricedRow[] } {
  const byId = new Map<string, ScryfallCardPrices>();
  for (const card of cards) byId.set(card.id.toLowerCase(), card);

  const priced: PriceRow[] = [];
  const unpriced: UnpricedRow[] = [];

  for (const pair of owned) {
    const card = byId.get(pair.printingId.toLowerCase());
    if (!card) {
      unpriced.push({ ...pair, reason: "not-in-scryfall" });
      continue;
    }

    const cents = priceForFinish(card.prices, pair.finish);
    if (cents === null) {
      unpriced.push({ ...pair, reason: "no-price-for-finish" });
      continue;
    }

    priced.push({ ...pair, priceCents: cents });
  }

  return { priced, unpriced };
}

/**
 * A percentage change, or null when there is nothing to compare against.
 *
 * Null rather than zero when the old price was zero: a card that went from
 * free to a dollar has not risen by any percentage, and printing "+Infinity%"
 * or "0%" would both be lies. The cash delta is the honest number there, and
 * the value page leads with it.
 */
export function percentChange(from: number, to: number): number | null {
  if (from <= 0) return null;
  return ((to - from) / from) * 100;
}

/** A signed percentage, to one decimal place: "+12.4%". */
export function formatPercent(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}
