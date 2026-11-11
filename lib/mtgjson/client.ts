/**
 * MTGJSON access — the source for sealed-product contents.
 *
 * Scryfall is the card database (lib/scryfall/client.ts); it does not publish
 * what is inside a precon. MTGJSON does, and the two are joined on
 * `identifiers.scryfallId`, which every entry of every deck file we have
 * examined carries.
 *
 * What is fetched, and what is deliberately not:
 *
 *   - `DeckList.json` (0.65 MB) — the catalog of all 3,144 decks. Weekly.
 *   - `/api/v5/decks/<fileName>.json` (~0.5 MB) — one deck, on demand.
 *   - NOT `AllPrintings.json.gz` (176 MB) or `AllDeckFiles.zip` (253 MB).
 *     MTGJSON publishes no download dedicated to sealed products, so those
 *     are the only wholesale options, and downloading 253 MB to make a
 *     handful of products addable is not a trade worth making.
 *
 * The same courtesy rules as Scryfall apply by choice rather than by
 * enforcement: a descriptive User-Agent, an explicit Accept, a delay between
 * requests, and caching so the same file is never fetched twice. The
 * User-Agent names the software and nothing else — no email address, no
 * account name.
 */
const USER_AGENT = "MagicTracker/0.1 (personal collection tracker; one user)";
const API_BASE = "https://mtgjson.com/api/v5";

const COURTESY_DELAY_MS = 150;

/** One deck file is ~0.5 MB; this is the ceiling before we refuse to buffer. */
const MAX_DECK_BYTES = 16 * 1024 * 1024;

const REQUEST_TIMEOUT_MS = 30_000;

let lastRequestAt = 0;

async function courtesyDelay(): Promise<void> {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < COURTESY_DELAY_MS) {
    await new Promise((r) => setTimeout(r, COURTESY_DELAY_MS - elapsed));
  }
  lastRequestAt = Date.now();
}

export function mtgjsonHeaders(): Record<string, string> {
  return { "User-Agent": USER_AGENT, Accept: "application/json" };
}

/**
 * Every MTGJSON file is `{ meta, data }`. The timeout matters because this
 * runs inside a page render: without it a hung connection would hold the
 * request open until the platform killed it, with nothing said to the user.
 */
async function getJson<T>(path: string, maxBytes: number): Promise<T> {
  await courtesyDelay();

  const res = await fetch(`${API_BASE}${path}`, {
    headers: mtgjsonHeaders(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    // The files are versioned weekly and we cache the result ourselves, so
    // there is nothing for an HTTP cache layer to add here.
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(
      `MTGJSON GET ${path} failed: ${res.status} ${res.statusText}`,
    );
  }

  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    throw new Error(
      `MTGJSON ${path} is ${declared} bytes, over the ${maxBytes} limit`,
    );
  }

  const text = await res.text();
  if (text.length > maxBytes) {
    throw new Error(`MTGJSON ${path} exceeded the ${maxBytes} byte limit`);
  }

  return JSON.parse(text) as T;
}

export type MtgjsonMeta = { date: string; version: string };

/**
 * The current publication version, e.g. `5.3.0+20261110`.
 *
 * `Meta.json` is wrapped in `{ meta, data }` like every other MTGJSON file,
 * with the same object under both keys — so the version is never at the top
 * level, however much it looks like it should be.
 */
export async function getMeta(): Promise<MtgjsonMeta> {
  const body = await getJson<{ meta?: MtgjsonMeta; data?: MtgjsonMeta }>(
    "/Meta.json",
    4096,
  );
  const meta = body?.data ?? body?.meta;
  if (!meta?.version) throw new Error("MTGJSON Meta.json had no version");
  return meta;
}

export type DeckListEntry = {
  code: string;
  fileName: string;
  name: string;
  releaseDate: string;
  source: string;
  type: string;
};

/**
 * The deck catalog. Every entry of all 3,144 has all six fields populated,
 * but they are validated anyway: this runs unattended on a weekly schedule,
 * and a row that quietly lost its `fileName` would become a product with no
 * primary key.
 */
export async function getDeckList(): Promise<{
  meta: MtgjsonMeta;
  decks: DeckListEntry[];
}> {
  const body = await getJson<{ meta: MtgjsonMeta; data: DeckListEntry[] }>(
    "/DeckList.json",
    8 * 1024 * 1024,
  );

  if (!Array.isArray(body?.data)) {
    throw new Error("MTGJSON DeckList.json had no data array");
  }

  return { meta: body.meta, decks: body.data };
}

/**
 * One entry on one board. MTGJSON embeds the whole card object, which is why
 * a deck file is half a megabyte; only these fields are read.
 */
export type DeckCard = {
  count: number;
  isFoil?: boolean;
  isEtched?: boolean;
  name: string;
  setCode?: string;
  number?: string;
  uuid?: string;
  identifiers?: { scryfallId?: string };
};

export type MtgjsonDeck = {
  code: string;
  name: string;
  type: string;
  releaseDate?: string;
  commander?: DeckCard[];
  mainBoard?: DeckCard[];
  sideBoard?: DeckCard[];
  tokens?: DeckCard[];
  planes?: DeckCard[];
  schemes?: DeckCard[];
};

/**
 * One deck's contents.
 *
 * `fileName` goes into the URL path, so it is percent-encoded: thirteen of
 * the 3,144 names contain non-ASCII letters (`MahōGakuinSeishunHakusho_SLD`),
 * and pasting one in raw would produce a malformed request.
 */
export async function getDeck(fileName: string): Promise<{
  meta: MtgjsonMeta;
  deck: MtgjsonDeck;
}> {
  const body = await getJson<{ meta: MtgjsonMeta; data: MtgjsonDeck }>(
    `/decks/${encodeURIComponent(fileName)}.json`,
    MAX_DECK_BYTES,
  );

  if (!body?.data) {
    throw new Error(`MTGJSON deck "${fileName}" had no data object`);
  }

  return { meta: body.meta, deck: body.data };
}
