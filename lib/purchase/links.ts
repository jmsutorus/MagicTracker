/**
 * External purchase links for TCGplayer and Mana Pool.
 *
 * Two kinds of link:
 *
 * - **Single card** — opens one printing on the store. TCGplayer has a product
 *   page when we know the `tcgplayer_id`, and a name search when we don't.
 *   Mana Pool addresses a printing by set code and collector number, which we
 *   always have, so it never needs the search fallback.
 *
 * - **Mass entry** — neither store takes a URL parameter that pre-fills a
 *   list, so the handoff is: format the list, copy it to the clipboard, open
 *   the store's bulk page, paste. The formatters here produce that text.
 *
 * Every URL and format below was checked against the live sites on
 * 2026-11-11. Where a store changes one, the check that catches it is a
 * 404 in the browser, not a failing test here — these are other people's
 * URLs and the tests only pin what we generate.
 */

// ---------------------------------------------------------------------------
// Single-card links
// ---------------------------------------------------------------------------

/**
 * TCGplayer: product page when we have the id, name search when we don't.
 *
 * The product URL resolves without a slug — `/product/726040` is the Tarkir
 * Sol Ring. Not every printing in the card database has a `tcgplayer_id`
 * (promos and foreign-only printings often don't), hence the fallback, which
 * uses the `q` parameter the site's own search bar uses.
 */
export function tcgplayerCardUrl(
  cardName: string,
  tcgplayerId?: number | null,
): string {
  if (tcgplayerId) {
    return `https://www.tcgplayer.com/product/${tcgplayerId}`;
  }
  return `https://www.tcgplayer.com/search/magic/product?q=${encodeURIComponent(cardName)}&view=grid`;
}

/** Mana Pool's card search, by name. */
export function manapoolCardUrl(cardName: string): string {
  return `https://manapool.com/cards?q=${encodeURIComponent(cardName)}`;
}

/**
 * Mana Pool addresses a printing as `/card/<set>/<collector>/<slug>`.
 *
 * The slug is cosmetic: Mana Pool 301s any slug to the canonical one, so a
 * double-faced card whose real slug carries both names still lands on the
 * right page. The set code must be lowercase to avoid a redirect hop.
 */
export function manapoolPrintingUrl(
  setCode: string,
  collectorNumber: string,
  cardName: string,
): string {
  const set = encodeURIComponent(setCode.toLowerCase());
  const number = encodeURIComponent(collectorNumber);
  return `https://manapool.com/card/${set}/${number}/${slugify(cardName)}`;
}

/** Lowercase, alphanumerics and single hyphens — Mana Pool's slug shape. */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "card"
  );
}

// ---------------------------------------------------------------------------
// Mass-entry text formatting
// ---------------------------------------------------------------------------

export type BuyListEntry = {
  quantity: number;
  name: string;
  /** Set code, when the specific printing matters. */
  setCode?: string | null;
  /** Collector number, when the specific printing matters. */
  collectorNumber?: string | null;
};

/**
 * The format both stores document:
 *
 *     4 Lightning Bolt [SLD] 84
 *     1 Sol Ring
 *
 * TCGplayer's Mass Entry help gives exactly that example, and Mana Pool's
 * add-deck page lists `4 Plains [M20] 261 *F*` among the forms it accepts.
 * The set code and collector number are optional, and leaving them off means
 * "any printing, cheapest first" — which is what a deck buy list wants. A set
 * want list includes them, because there the point is one particular card.
 *
 * A collector number without a set code is dropped: on its own it reads as
 * part of the card name and would match nothing.
 */
export function formatBuyListText(entries: BuyListEntry[]): string {
  return entries
    .map((entry) => {
      let line = `${entry.quantity} ${entry.name}`;
      if (entry.setCode) {
        line += ` [${entry.setCode.toUpperCase()}]`;
        if (entry.collectorNumber) {
          line += ` ${entry.collectorNumber}`;
        }
      }
      return line;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// The bulk-entry pages, opened in a new tab beside the clipboard copy
// ---------------------------------------------------------------------------

export const TCGPLAYER_MASS_ENTRY_URL = "https://www.tcgplayer.com/massentry";
export const MANAPOOL_MASS_ENTRY_URL = "https://manapool.com/add-deck";

export const STORE_LABELS = {
  tcgplayer: "TCGplayer",
  manapool: "Mana Pool",
} as const;

export type Store = keyof typeof STORE_LABELS;

export function massEntryUrl(store: Store): string {
  return store === "tcgplayer"
    ? TCGPLAYER_MASS_ENTRY_URL
    : MANAPOOL_MASS_ENTRY_URL;
}
