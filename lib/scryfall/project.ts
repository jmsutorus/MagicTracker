/**
 * Maps a Scryfall card object onto our `printings` + `oracle_cards` rows.
 *
 * Kept pure and separate from the ingest so the awkward cases — multi-faced
 * cards, reversible cards with no top-level oracle_id, collector numbers that
 * aren't numbers — can be unit tested without a database or a 500 MB download.
 */

export type ScryfallCardFace = {
  oracle_id?: string;
  name?: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  colors?: string[];
};

export type ScryfallCard = {
  id: string;
  oracle_id?: string;
  name: string;
  lang: string;
  released_at?: string;
  layout: string;
  mana_cost?: string;
  cmc?: number;
  type_line?: string;
  oracle_text?: string;
  colors?: string[];
  color_identity?: string[];
  keywords?: string[];
  legalities?: Record<string, string>;
  games?: string[];
  reserved?: boolean;
  foil?: boolean;
  nonfoil?: boolean;
  finishes?: string[];
  oversized?: boolean;
  promo?: boolean;
  variation?: boolean;
  booster?: boolean;
  full_art?: boolean;
  textless?: boolean;
  digital?: boolean;
  set: string;
  set_type?: string;
  collector_number: string;
  rarity: string;
  frame_effects?: string[];
  border_color?: string;
  image_status?: string;
  edhrec_rank?: number;
  card_faces?: ScryfallCardFace[];
  tcgplayer_id?: number;
};

export type PrintingRow = {
  scryfallId: string;
  oracleId: string;
  setCode: string;
  collectorNumber: string;
  collectorNumberNum: number | null;
  name: string;
  rarity: string;
  lang: string;
  finishes: string[];
  isBooster: boolean;
  isPromo: boolean;
  isVariation: boolean;
  frameEffects: string[] | null;
  borderColor: string | null;
  fullArt: boolean;
  textless: boolean;
  layout: string | null;
  isExtra: boolean;
  releasedAt: string | null;
  tcgplayerId: number | null;
  imageStatus: string | null;
};

export type OracleRow = {
  oracleId: string;
  name: string;
  manaCost: string | null;
  typeLine: string | null;
  oracleText: string | null;
  cmc: number | null;
  colors: string[] | null;
  colorIdentity: string[];
  keywords: string[] | null;
  legalities: Record<string, string> | null;
  reserved: boolean;
  edhrecRank: number | null;
  layout: string | null;
};

/**
 * Layouts that are not a playable card face.
 * Scryfall's own search calls these `is:extra`.
 */
const EXTRA_LAYOUTS = new Set([
  "art_series",
  "token",
  "double_faced_token",
  "emblem",
  "scheme",
  "planar",
  "vanguard",
  "augment",
  "host",
]);

/** Sets that contain only extras. */
const EXTRA_SET_TYPES = new Set(["token", "memorabilia"]);

/**
 * "Extra" means real cardboard that isn't a playable card: art series cards,
 * tokens, emblems, schemes.
 *
 * These are kept, not filtered out — art series cards come in Collector
 * Boosters and people genuinely collect them, so dropping them would lose part
 * of a real collection. But they must not outrank the playable card: an
 * art series card is named "Lightning Bolt // Lightning Bolt" and would
 * otherwise crowd a search for Lightning Bolt.
 */
export function isExtraCard(card: ScryfallCard): boolean {
  if (EXTRA_LAYOUTS.has(card.layout)) return true;
  if (card.set_type && EXTRA_SET_TYPES.has(card.set_type)) return true;
  return false;
}

/**
 * Only cards that exist on cardboard.
 *
 * `games` lists the platforms a printing exists on. Arena- and MTGO-only cards
 * can never be in a physical collection, so they are noise in every search and
 * would inflate every set-completion denominator.
 */
export function isPaperCard(card: ScryfallCard): boolean {
  if (card.digital === true) return false;
  const games = card.games ?? [];
  // Treat a missing `games` as paper rather than dropping the card: better to
  // include something questionable than silently lose a real printing.
  if (games.length === 0) return true;
  return games.includes("paper");
}

/**
 * `oracle_id` is top-level for almost every card, but absent on the
 * `reversible_card` layout, where each face carries its own. Both faces of a
 * reversible card are the same game object, so the first face's id is correct.
 */
export function resolveOracleId(card: ScryfallCard): string | null {
  if (card.oracle_id) return card.oracle_id;

  for (const face of card.card_faces ?? []) {
    if (face.oracle_id) return face.oracle_id;
  }

  return null;
}

/**
 * Leading integer of a collector number, for ordering.
 *
 * Collector numbers are strings: "1", "42", "123a", "★15", "A-7", "T3".
 * Sorting them as text gives 1, 10, 100, 2 — which makes a "what am I missing"
 * list unreadable, since it should run in set order. Extracting the numeric
 * part lets us sort by (num, raw) and get 1, 2, 10, 100, with "123a" landing
 * next to "123".
 */
export function collectorNumberToInt(collectorNumber: string): number | null {
  const match = collectorNumber.match(/\d+/);
  if (!match) return null;

  const value = Number.parseInt(match[0], 10);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Joins a field across faces with " // ", matching how Magic prints
 * double-faced and split cards. Falls back to the top-level value.
 */
function joinFaces(
  card: ScryfallCard,
  key: "mana_cost" | "type_line" | "oracle_text",
): string | null {
  const topLevel = card[key];
  if (topLevel !== undefined && topLevel !== null && topLevel !== "") {
    return topLevel;
  }

  const faces = card.card_faces ?? [];
  const parts = faces
    .map((face) => face[key])
    .filter((v): v is string => v !== undefined && v !== null && v !== "");

  if (parts.length === 0) return null;
  return parts.join(" // ");
}

function colorsOf(card: ScryfallCard): string[] | null {
  if (card.colors) return card.colors;

  // Transform cards carry colors per face; the union is the card's colors.
  const faces = card.card_faces ?? [];
  const union = new Set<string>();
  let sawAny = false;
  for (const face of faces) {
    if (face.colors) {
      sawAny = true;
      for (const c of face.colors) union.add(c);
    }
  }

  return sawAny ? [...union].sort() : null;
}

/**
 * Derive finishes for older data that predates the `finishes` array and only
 * had the `foil` / `nonfoil` booleans.
 */
function finishesOf(card: ScryfallCard): string[] {
  if (card.finishes && card.finishes.length > 0) return card.finishes;

  const derived: string[] = [];
  if (card.nonfoil) derived.push("nonfoil");
  if (card.foil) derived.push("foil");
  return derived;
}

export type ProjectedCard = {
  printing: PrintingRow;
  oracle: OracleRow;
};

/**
 * Returns null when the card should not be stored at all (digital-only), or
 * when it lacks an oracle id we can attribute it to.
 */
export function projectCard(card: ScryfallCard): ProjectedCard | null {
  if (!isPaperCard(card)) return null;

  const oracleId = resolveOracleId(card);
  if (!oracleId) return null;

  const printing: PrintingRow = {
    scryfallId: card.id,
    oracleId,
    setCode: card.set,
    collectorNumber: card.collector_number,
    collectorNumberNum: collectorNumberToInt(card.collector_number),
    name: card.name,
    rarity: card.rarity,
    lang: card.lang,
    finishes: finishesOf(card),
    isBooster: card.booster === true,
    isPromo: card.promo === true,
    isVariation: card.variation === true,
    frameEffects: card.frame_effects ?? null,
    borderColor: card.border_color ?? null,
    fullArt: card.full_art === true,
    textless: card.textless === true,
    layout: card.layout ?? null,
    isExtra: isExtraCard(card),
    releasedAt: card.released_at ?? null,
    tcgplayerId: card.tcgplayer_id ?? null,
    imageStatus: card.image_status ?? null,
  };

  const oracle: OracleRow = {
    oracleId,
    name: card.name,
    manaCost: joinFaces(card, "mana_cost"),
    typeLine: joinFaces(card, "type_line"),
    oracleText: joinFaces(card, "oracle_text"),
    cmc: card.cmc ?? null,
    colors: colorsOf(card),
    colorIdentity: card.color_identity ?? [],
    keywords: card.keywords ?? null,
    legalities: card.legalities ?? null,
    reserved: card.reserved === true,
    edhrecRank: card.edhrec_rank ?? null,
    layout: card.layout ?? null,
  };

  return { printing, oracle };
}
