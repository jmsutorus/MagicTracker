/**
 * One Piece card data, from the community OPTCG API.
 *
 * Free, unauthenticated, and small: 23 booster sets plus 35 starter decks is
 * 60 requests for the whole catalog, each returning one set's cards in a
 * single response. That is bulk in every sense that matters, so there is no
 * card-by-card crawl here either.
 *
 * Unlike the Pokémon files, these responses *do* carry a market price per
 * card, refreshed daily upstream. That is why One Piece cards contribute a
 * real number to the collection's value and Pokémon cards do not.
 *
 * Boosters and starter decks are served by different endpoints with the same
 * row shape, which is the only reason `getSetCards` takes a kind.
 */
const API_BASE = "https://optcgapi.com/api";

/** Identifies the software and nothing else — no email, no account name. */
const USER_AGENT = "MagicTracker/0.1 (personal collection tracker; one user)";

/** A community-run server. Sixty requests, unhurried. */
const COURTESY_DELAY_MS = 250;

let lastRequestAt = 0;

async function courtesyDelay(): Promise<void> {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < COURTESY_DELAY_MS) {
    await new Promise((r) => setTimeout(r, COURTESY_DELAY_MS - elapsed));
  }
  lastRequestAt = Date.now();
}

export type OnePieceSet = {
  set_name: string;
  set_id: string;
};

export type OnePieceDeck = {
  structure_deck_name: string;
  structure_deck_id: string;
};

export type OnePieceCard = {
  card_name: string;
  card_text: string | null;
  set_name: string;
  set_id: string;
  rarity: string | null;
  /** The printed card number, shared by a card and its alternate arts. */
  card_set_id: string;
  /** The *printing* id: `OP11-004`, or `OP11-004_p1` for an alternate art. */
  card_image_id: string;
  card_image: string | null;
  card_color: string | null;
  /** Leader | Character | Event | Stage */
  card_type: string | null;
  life: string | null;
  card_cost: string | null;
  card_power: string | null;
  sub_types: string | null;
  counter_amount: number | null;
  attribute: string | null;
  /** Dollars, not cents, and a float. See centsFromDollars(). */
  market_price: number | null;
  inventory_price: number | null;
};

async function getJson<T>(path: string): Promise<T> {
  await courtesyDelay();

  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`OPTCG API GET ${path} failed: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as T;
}

export async function getAllSets(): Promise<OnePieceSet[]> {
  return getJson<OnePieceSet[]>("/allSets/");
}

export async function getAllDecks(): Promise<OnePieceDeck[]> {
  return getJson<OnePieceDeck[]>("/allDecks/");
}

/**
 * One release's cards.
 *
 * An empty array rather than a throw when the release has no cards yet: the
 * set index lists a product as soon as it is announced, so a set that 404s is
 * normally one that has not been spoiled, not a broken run.
 */
export async function getSetCards(
  id: string,
  kind: "set" | "deck",
): Promise<OnePieceCard[]> {
  const path = kind === "deck" ? `/decks/${id}/` : `/sets/${id}/`;
  try {
    return await getJson<OnePieceCard[]>(path);
  } catch (error) {
    if (error instanceof Error && error.message.includes("404")) return [];
    throw error;
  }
}
