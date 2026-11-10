/**
 * Scryfall access, with their API terms encoded in one place.
 *
 * The rules (PLAN.md §4) are not optional politeness — the API returns 403
 * without a User-Agent and Accept header, and Scryfall documents that repeated
 * misuse can get an IP blocked:
 *
 *   - Use bulk files; never crawl card-by-card.
 *   - Send a descriptive User-Agent and explicit Accept on every request.
 *   - Max 10 req/sec, with 50-100ms of courtesy delay between calls.
 *   - Cache for at least 24h; don't re-host images or redistribute the data.
 *
 * The User-Agent deliberately identifies the software and nothing else. It
 * carries no email address, account name or other personal detail.
 */
const USER_AGENT = "MagicTracker/0.1 (personal collection tracker; one user)";
const API_BASE = "https://api.scryfall.com";

/** Scryfall asks for 50-100ms between requests. */
const COURTESY_DELAY_MS = 120;

let lastRequestAt = 0;

async function courtesyDelay(): Promise<void> {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < COURTESY_DELAY_MS) {
    await new Promise((r) => setTimeout(r, COURTESY_DELAY_MS - elapsed));
  }
  lastRequestAt = Date.now();
}

export function scryfallHeaders(): Record<string, string> {
  return {
    "User-Agent": USER_AGENT,
    Accept: "application/json",
  };
}

async function apiGet<T>(path: string): Promise<T> {
  await courtesyDelay();

  const res = await fetch(`${API_BASE}${path}`, { headers: scryfallHeaders() });

  if (!res.ok) {
    throw new Error(
      `Scryfall GET ${path} failed: ${res.status} ${res.statusText}. ` +
        (res.status === 403
          ? "A 403 usually means the User-Agent or Accept header was dropped."
          : ""),
    );
  }

  return (await res.json()) as T;
}

export type BulkDataEntry = {
  type: string;
  name: string;
  updated_at: string;
  /**
   * Bulk exports are gzipped JSONL — one card object per line, not a JSON
   * array. The field is `jsonl_download_uri`; `download_uri` is kept as a
   * fallback in case a different shape is ever served.
   */
  jsonl_download_uri?: string;
  download_uri?: string;
  compressed_size?: number;
  size?: number;
};

/** The download URL for an entry, whichever field name it arrives under. */
export function bulkDownloadUri(entry: BulkDataEntry): string {
  const uri = entry.jsonl_download_uri ?? entry.download_uri;
  if (!uri) {
    throw new Error(
      `Bulk entry "${entry.type}" has no download URI. ` +
        `Scryfall's bulk-data shape may have changed again; keys were: ` +
        Object.keys(entry).join(", "),
    );
  }
  return uri;
}

/** Compressed byte size, whichever field name it arrives under. */
export function bulkSize(entry: BulkDataEntry): number | null {
  return entry.compressed_size ?? entry.size ?? null;
}

/**
 * Metadata for the bulk exports. The download URI carries a daily timestamp,
 * so it must be fetched rather than hardcoded.
 */
export async function getBulkDataEntry(
  type: "default_cards" | "all_cards" | "oracle_cards",
): Promise<BulkDataEntry> {
  const { data } = await apiGet<{ data: BulkDataEntry[] }>("/bulk-data");
  const entry = data.find((d) => d.type === type);
  if (!entry) {
    throw new Error(`No bulk-data entry of type "${type}"`);
  }
  return entry;
}

export type ScryfallSet = {
  code: string;
  mtgo_code?: string;
  arena_code?: string;
  tcgplayer_id?: number;
  name: string;
  set_type: string;
  released_at?: string;
  block_code?: string;
  block?: string;
  parent_set_code?: string;
  card_count: number;
  digital: boolean;
  nonfoil_only: boolean;
  foil_only: boolean;
  icon_svg_uri: string;
};

/**
 * All sets — about a thousand rows, so one request rather than deriving them
 * from the 500 MB card file.
 */
export async function getAllSets(): Promise<ScryfallSet[]> {
  const { data } = await apiGet<{ data: ScryfallSet[] }>("/sets");
  return data;
}

/**
 * Streams a bulk file. These live on *.scryfall.io, which is explicitly not
 * rate limited — but the body is ~77 MB gzipped and ~500 MB expanded, so the
 * caller must gunzip and parse it line by line, never buffering the whole thing.
 */
export async function openBulkStream(
  downloadUri: string,
): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch(downloadUri, { headers: scryfallHeaders() });

  if (!res.ok) {
    throw new Error(
      `Bulk download failed: ${res.status} ${res.statusText} for ${downloadUri}`,
    );
  }
  if (!res.body) {
    throw new Error("Bulk download returned no body");
  }

  return res.body;
}

/**
 * Card images are hotlinked from Scryfall's CDN, never re-hosted — so no image
 * URLs are stored. The CDN path is derivable from the card's UUID.
 */
export function cardImageUrl(
  scryfallId: string,
  size: "small" | "normal" | "large" | "png" | "art_crop" = "normal",
): string {
  const ext = size === "png" ? "png" : "jpg";
  return `https://cards.scryfall.io/${size}/front/${scryfallId[0]}/${scryfallId[1]}/${scryfallId}.${ext}`;
}
