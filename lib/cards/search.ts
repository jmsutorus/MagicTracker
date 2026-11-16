import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import type { GameSlug } from "@/lib/games/constants";

export type CardSearchResult = {
  oracleId: string;
  name: string;
  game: GameSlug;
  typeLine: string | null;
  manaCost: string | null;
  colorIdentity: string[];
  printingCount: number;
  /** True when every printing is an art series card, token or similar. */
  onlyExtras: boolean;
  /** Most recent printing — the image and default pick for the result row. */
  newestPrintingId: string;
  newestSetCode: string;
  newestSetName: string;
  /** The tile beside the row — the crop where there is one. */
  newestArtUrl: string | null;
  /** The whole card, for the hover preview. */
  newestImageUrl: string | null;
};

export type PrintingSummary = {
  scryfallId: string;
  /**
   * The name as this printing prints it.
   *
   * The same as the card's for Magic, where a printing never renames the
   * card. One Piece gives alternate arts a suffix — "Kujyaku (Alternate
   * Art)" — and prints them under the base card's number, so without this
   * the two rows are identical on screen.
   */
  name: string;
  setCode: string;
  setName: string;
  setIconSvgUri: string | null;
  collectorNumber: string;
  rarity: string;
  /** Where the picture is. See `printings.image_url`. */
  imageUrl: string | null;
  artUrl: string | null;
  finishes: string[];
  /** TCGplayer's product id, when they list this printing. */
  tcgplayerId: number | null;
  isBooster: boolean;
  isPromo: boolean;
  isVariation: boolean;
  fullArt: boolean;
  releasedAt: string | null;
  lang: string;
};

export type CardDetail = {
  oracleId: string;
  name: string;
  game: GameSlug;
  /**
   * The facts only this game has — HP and attacks, or cost and power.
   * Null for Magic, whose facts are the named fields here.
   * See `oracle_cards.game_data`.
   */
  gameData: Record<string, unknown> | null;
  manaCost: string | null;
  typeLine: string | null;
  oracleText: string | null;
  cmc: number | null;
  colorIdentity: string[];
  keywords: string[] | null;
  legalities: Record<string, string> | null;
  reserved: boolean;
  edhrecRank: number | null;
  printings: PrintingSummary[];
};

/**
 * Trigram similarity floor. Below this, `%` stops matching.
 * 0.3 is Postgres's default; 0.25 is slightly more forgiving, which suits
 * typo-tolerant type-ahead over a fixed vocabulary of real card names.
 */
const SIMILARITY_THRESHOLD = 0.25;

/**
 * Escapes LIKE wildcards in user input.
 *
 * Without this, a query of "%" matches every card and "_" matches any single
 * character. Not a SQL injection — values are still parameterized — but the
 * pattern semantics leak, which makes results baffling.
 */
function escapeLikePattern(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1");
}

/**
 * Card name search.
 *
 * Matching is tiered, and the tiers are ordered before any other signal:
 *
 *   0. exact name
 *   1. name starts with the query
 *   2. a word inside the name starts with the query
 *   3. trigram-similar (typo tolerance), only for 3+ characters
 *
 * Within tiers 0-2, EDHREC rank decides — popularity is the best available
 * proxy for "the card they meant". Trigram similarity is deliberately NOT used
 * to rank these, because similarity rewards *short* names: against "lightn",
 * "Lightning" scores higher than "Lightning Bolt", which buried the most
 * played card in the game below cards nobody asked for.
 *
 * Within tier 3 similarity leads, since there popularity alone could promote a
 * well-known card that barely resembles the query.
 *
 * `game` narrows the search to one game. Left out, every game is searched at
 * once, which is the right default for a header search box — somebody typing
 * "Charizard" should not have to have told the app which game they meant.
 * Ranking survives the mix because the tiers are computed from the name
 * alone; `edhrec_rank` only ever breaks ties, and it is null outside Magic,
 * so a Pokémon card never outranks a Magic card that matched better, nor the
 * reverse.
 */
export async function searchCards(
  query: string,
  limit = 20,
  game?: GameSlug,
): Promise<CardSearchResult[]> {
  const q = query.trim();
  if (q.length === 0) return [];

  const db = getDb();
  const gameFilter = game ? sql`AND o.game = ${game}` : sql``;
  // Trigram matching on 1-2 characters is noise, and the btree index answers a
  // prefix instantly, so short queries stay prefix-only.
  const useTrigram = q.length >= 3;

  const pattern = escapeLikePattern(q);
  const prefixPattern = `${pattern}%`;
  const wordPattern = `% ${pattern}%`;

  const { rows } = await db.execute<{
    oracle_id: string;
    name: string;
    game: GameSlug;
    type_line: string | null;
    mana_cost: string | null;
    color_identity: string[] | null;
    printing_count: number;
    only_extras: boolean;
    newest_printing_id: string;
    newest_set_code: string;
    newest_set_name: string;
    newest_art_url: string | null;
    newest_image_url: string | null;
  }>(sql`
    WITH scored AS (
      SELECT o.oracle_id, o.name, o.game, o.type_line, o.mana_cost,
             o.color_identity, o.edhrec_rank,
             CASE
               WHEN lower(o.name) = lower(${q}) THEN 0
               WHEN o.name ILIKE ${prefixPattern} ESCAPE '\\' THEN 1
               WHEN o.name ILIKE ${wordPattern} ESCAPE '\\' THEN 2
               ELSE 3
             END AS tier,
             ${useTrigram ? sql`similarity(o.name, ${q})` : sql`0::real`} AS sim
        FROM oracle_cards o
       WHERE (o.name ILIKE ${prefixPattern} ESCAPE '\\'
          OR o.name ILIKE ${wordPattern} ESCAPE '\\'
          ${useTrigram ? sql`OR o.name % ${q}` : sql``})
          ${gameFilter}
    ),
    -- Ranking lives in its own layer because Postgres cannot reference an
    -- output alias such as tier from inside an expression in ORDER BY; here
    -- tier and sim are real columns of the scored CTE.
    -- (No backticks in this comment: the whole query is a JS template literal.)
    matches AS (
      SELECT * FROM scored
       ORDER BY
         tier ASC,
         -- Similarity leads inside the fuzzy tier only; elsewhere it would
         -- outvote popularity and favor whichever name is shortest.
         CASE WHEN tier = 3 THEN -sim ELSE 0 END ASC,
         edhrec_rank ASC NULLS LAST,
         name ASC
       LIMIT ${limit}
    )
    SELECT m.oracle_id,
           m.name,
           m.game,
           m.type_line,
           m.mana_cost,
           m.color_identity,
           count(p.scryfall_id)::int AS printing_count,
           bool_and(p.is_extra) AS only_extras,
           (array_agg(p.scryfall_id::text
                      ORDER BY p.is_extra ASC,
                               p.released_at DESC NULLS LAST,
                               p.collector_number_num DESC NULLS LAST))[1]
             AS newest_printing_id,
           (array_agg(p.set_code
                      ORDER BY p.released_at DESC NULLS LAST,
                               p.collector_number_num DESC NULLS LAST))[1]
             AS newest_set_code,
           (array_agg(s.name
                      ORDER BY p.released_at DESC NULLS LAST,
                               p.collector_number_num DESC NULLS LAST))[1]
             AS newest_set_name,
           -- Picked by the same ordering as newest_printing_id, so the art
           -- and the printing it is credited to are always the same card.
           (array_agg(coalesce(p.art_url, p.image_url)
                      ORDER BY p.is_extra ASC,
                               p.released_at DESC NULLS LAST,
                               p.collector_number_num DESC NULLS LAST))[1]
             AS newest_art_url,
           (array_agg(p.image_url
                      ORDER BY p.is_extra ASC,
                               p.released_at DESC NULLS LAST,
                               p.collector_number_num DESC NULLS LAST))[1]
             AS newest_image_url
      FROM matches m
      JOIN printings p ON p.oracle_id = m.oracle_id
      JOIN sets s ON s.code = p.set_code
     GROUP BY m.oracle_id, m.name, m.game, m.type_line, m.mana_cost,
              m.color_identity, m.edhrec_rank, m.tier, m.sim
     ORDER BY
       -- Art series cards and tokens last. An art series card is literally
       -- named "Lightning Bolt // Lightning Bolt", so without this it crowds
       -- out the card you were actually looking for.
       bool_and(p.is_extra) ASC,
       m.tier ASC,
       CASE WHEN m.tier = 3 THEN -m.sim ELSE 0 END ASC,
       m.edhrec_rank ASC NULLS LAST,
       m.name ASC
  `);

  return rows.map((r) => ({
    oracleId: r.oracle_id,
    name: r.name,
    game: r.game,
    typeLine: r.type_line,
    manaCost: r.mana_cost,
    colorIdentity: r.color_identity ?? [],
    printingCount: r.printing_count,
    onlyExtras: r.only_extras,
    newestPrintingId: r.newest_printing_id,
    newestSetCode: r.newest_set_code,
    newestSetName: r.newest_set_name,
    newestArtUrl: r.newest_art_url,
    newestImageUrl: r.newest_image_url,
  }));
}

/** One card, with every printing of it — the Phase 2 printing picker. */
export async function getCardDetail(
  oracleId: string,
): Promise<CardDetail | null> {
  const db = getDb();

  const { rows: cardRows } = await db.execute<{
    oracle_id: string;
    name: string;
    game: GameSlug;
    game_data: Record<string, unknown> | null;
    mana_cost: string | null;
    type_line: string | null;
    oracle_text: string | null;
    cmc: number | null;
    color_identity: string[] | null;
    keywords: string[] | null;
    legalities: Record<string, string> | null;
    reserved: boolean;
    edhrec_rank: number | null;
  }>(sql`
    SELECT oracle_id, name, game, game_data, mana_cost, type_line,
           oracle_text, cmc, color_identity, keywords, legalities,
           reserved, edhrec_rank
      FROM oracle_cards
     WHERE oracle_id = ${oracleId}::uuid
  `);

  const card = cardRows[0];
  if (!card) return null;

  const { rows: printingRows } = await db.execute<{
    scryfall_id: string;
    name: string;
    set_code: string;
    set_name: string;
    icon_svg_uri: string | null;
    collector_number: string;
    rarity: string;
    image_url: string | null;
    art_url: string | null;
    finishes: string[];
    tcgplayer_id: number | null;
    is_booster: boolean;
    is_promo: boolean;
    is_variation: boolean;
    full_art: boolean;
    released_at: string | null;
    lang: string;
  }>(sql`
    SELECT p.scryfall_id::text AS scryfall_id, p.name,
           p.set_code, s.name AS set_name, s.icon_svg_uri,
           p.collector_number, p.rarity, p.image_url, p.art_url,
           p.finishes, p.tcgplayer_id,
           p.is_booster, p.is_promo, p.is_variation, p.full_art,
           p.released_at::text AS released_at, p.lang
      FROM printings p
      JOIN sets s ON s.code = p.set_code
     WHERE p.oracle_id = ${oracleId}::uuid
     ORDER BY p.released_at DESC NULLS LAST,
              p.set_code ASC,
              p.collector_number_num ASC NULLS LAST,
              p.collector_number ASC
  `);

  return {
    oracleId: card.oracle_id,
    name: card.name,
    game: card.game,
    gameData: card.game_data,
    manaCost: card.mana_cost,
    typeLine: card.type_line,
    oracleText: card.oracle_text,
    cmc: card.cmc,
    colorIdentity: card.color_identity ?? [],
    keywords: card.keywords,
    legalities: card.legalities,
    reserved: card.reserved,
    edhrecRank: card.edhrec_rank,
    printings: printingRows.map((p) => ({
      scryfallId: p.scryfall_id,
      name: p.name,
      setCode: p.set_code,
      setName: p.set_name,
      setIconSvgUri: p.icon_svg_uri,
      collectorNumber: p.collector_number,
      rarity: p.rarity,
      imageUrl: p.image_url,
      artUrl: p.art_url,
      finishes: p.finishes ?? [],
      tcgplayerId: p.tcgplayer_id,
      isBooster: p.is_booster,
      isPromo: p.is_promo,
      isVariation: p.is_variation,
      fullArt: p.full_art,
      releasedAt: p.released_at,
      lang: p.lang,
    })),
  };
}

/** Applied per-session; the GIN index uses it to decide what `%` matches. */
export async function ensureSimilarityThreshold(): Promise<void> {
  const db = getDb();
  await db.execute(
    sql`SELECT set_config('pg_trgm.similarity_threshold', ${String(SIMILARITY_THRESHOLD)}, false)`,
  );
}
