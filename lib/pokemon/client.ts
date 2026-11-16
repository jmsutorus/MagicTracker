/**
 * Pokémon card data, from the JSON that backs the Pokémon TCG API.
 *
 * The files are fetched from the public `pokemon-tcg-data` repository rather
 * than from api.pokemontcg.io, for three reasons:
 *
 *   - **It is bulk, not a crawl.** One file per set, 177 of them, served as
 *     static objects by a CDN. Walking the API card-by-card would be twenty
 *     thousand requests for the same bytes, which is exactly the thing
 *     lib/scryfall/client.ts exists to avoid doing to Scryfall.
 *   - **No key, no account.** Nothing about this app's one user reaches
 *     anybody's servers.
 *   - **It outlives the API.** The maintainers have announced that
 *     api.pokemontcg.io goes offline on 1 March 2027 while this repository
 *     stays up. Reading the files directly means that date is not an outage
 *     waiting to happen; if the data stops being updated, the ingest keeps
 *     working against whatever was last published and simply stops finding
 *     new sets.
 *
 * What the files do NOT carry is prices — those were an API feature. Pokémon
 * rows therefore have a null `usd_cents`, and `hasPrices()` in
 * lib/games/constants.ts is what tells the value pages to say so rather than
 * quietly totalling a collection as though those cards were worth nothing.
 */
const RAW_BASE =
  "https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master";

/** Identifies the software and nothing else — no email, no account name. */
const USER_AGENT = "MagicTracker/0.1 (personal collection tracker; one user)";

/** A courtesy pause between files. The data is static; there is no hurry. */
const COURTESY_DELAY_MS = 80;

let lastRequestAt = 0;

async function courtesyDelay(): Promise<void> {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < COURTESY_DELAY_MS) {
    await new Promise((r) => setTimeout(r, COURTESY_DELAY_MS - elapsed));
  }
  lastRequestAt = Date.now();
}

export type PokemonSet = {
  id: string;
  name: string;
  series?: string;
  printedTotal?: number;
  total?: number;
  ptcgoCode?: string;
  /** `YYYY/MM/DD`, which is not what Postgres wants. See projectSet(). */
  releaseDate?: string;
  images?: { symbol?: string; logo?: string };
};

export type PokemonCard = {
  id: string;
  name: string;
  /** Pokémon | Trainer | Energy */
  supertype?: string;
  subtypes?: string[];
  hp?: string;
  types?: string[];
  evolvesFrom?: string;
  evolvesTo?: string[];
  rules?: string[];
  attacks?: {
    name?: string;
    cost?: string[];
    convertedEnergyCost?: number;
    damage?: string;
    text?: string;
  }[];
  abilities?: { name?: string; text?: string; type?: string }[];
  weaknesses?: { type?: string; value?: string }[];
  resistances?: { type?: string; value?: string }[];
  retreatCost?: string[];
  number: string;
  artist?: string;
  rarity?: string;
  flavorText?: string;
  nationalPokedexNumbers?: number[];
  regulationMark?: string;
  images?: { small?: string; large?: string };
};

async function getJson<T>(path: string): Promise<T> {
  await courtesyDelay();

  const res = await fetch(`${RAW_BASE}${path}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(
      `pokemon-tcg-data GET ${path} failed: ${res.status} ${res.statusText}`,
    );
  }

  return (await res.json()) as T;
}

/** Every English set, oldest first. One small file. */
export async function getAllSets(): Promise<PokemonSet[]> {
  return getJson<PokemonSet[]>("/sets/en.json");
}

/**
 * Every card in one set.
 *
 * A set listed in `sets/en.json` whose card file is missing yields `[]`
 * rather than throwing: the two are published separately, so a set announced
 * before its cards are uploaded is a normal state of the repository for a day
 * or two, not a reason to fail a run that has already loaded 176 other sets.
 */
export async function getSetCards(setId: string): Promise<PokemonCard[]> {
  try {
    return await getJson<PokemonCard[]>(`/cards/en/${setId}.json`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("404")) return [];
    throw error;
  }
}
