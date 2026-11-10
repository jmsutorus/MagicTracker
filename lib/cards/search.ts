import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";

export type CardSearchResult = {
  oracleId: string;
  name: string;
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
};

export type PrintingSummary = {
  scryfallId: string;
  setCode: string;
  setName: string;
  setIconSvgUri: string | null;
  collectorNumber: string;
  rarity: string;
  finishes: string[];
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
 */
export async function searchCards(
  query: string,
  limit = 20,
): Promise<CardSearchResult[]> {
  const q = query.trim();
  if (q.length === 0) return [];

  const db = getDb();
  // Trigram matching on 1-2 characters is noise, and the btree index answers a
  // prefix instantly, so short queries stay prefix-only.
  const useTrigram = q.length >= 3;

  const pattern = escapeLikePattern(q);
  const prefixPattern = `${pattern}%`;
  const wordPattern = `% ${pattern}%`;

  const { rows } = await db.execute<{
    oracle_id: string;
    name: string;
    type_line: string | null;
    mana_cost: string | null;
    color_identity: string[] | null;
    printing_count: number;
    only_extras: boolean;
    newest_printing_id: string;
    newest_set_code: string;
    newest_set_name: string;
  }>(sql`
    WITH scored AS (
      SELECT o.oracle_id, o.name, o.type_line, o.mana_cost,
             o.color_identity, o.edhrec_rank,
             CASE
               WHEN lower(o.name) = lower(${q}) THEN 0
               WHEN o.name ILIKE ${prefixPattern} ESCAPE '\\' THEN 1
               WHEN o.name ILIKE ${wordPattern} ESCAPE '\\' THEN 2
               ELSE 3
             END AS tier,
             ${useTrigram ? sql`similarity(o.name, ${q})` : sql`0::real`} AS sim
        FROM oracle_cards o
       WHERE o.name ILIKE ${prefixPattern} ESCAPE '\\'
          OR o.name ILIKE ${wordPattern} ESCAPE '\\'
          ${useTrigram ? sql`OR o.name % ${q}` : sql``}
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
             AS newest_set_name
      FROM matches m
      JOIN printings p ON p.oracle_id = m.oracle_id
      JOIN sets s ON s.code = p.set_code
     GROUP BY m.oracle_id, m.name, m.type_line, m.mana_cost,
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
    typeLine: r.type_line,
    manaCost: r.mana_cost,
    colorIdentity: r.color_identity ?? [],
    printingCount: r.printing_count,
    onlyExtras: r.only_extras,
    newestPrintingId: r.newest_printing_id,
    newestSetCode: r.newest_set_code,
    newestSetName: r.newest_set_name,
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
    SELECT oracle_id, name, mana_cost, type_line, oracle_text, cmc,
           color_identity, keywords, legalities, reserved, edhrec_rank
      FROM oracle_cards
     WHERE oracle_id = ${oracleId}::uuid
  `);

  const card = cardRows[0];
  if (!card) return null;

  const { rows: printingRows } = await db.execute<{
    scryfall_id: string;
    set_code: string;
    set_name: string;
    icon_svg_uri: string | null;
    collector_number: string;
    rarity: string;
    finishes: string[];
    is_booster: boolean;
    is_promo: boolean;
    is_variation: boolean;
    full_art: boolean;
    released_at: string | null;
    lang: string;
  }>(sql`
    SELECT p.scryfall_id::text AS scryfall_id,
           p.set_code, s.name AS set_name, s.icon_svg_uri,
           p.collector_number, p.rarity, p.finishes,
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
      setCode: p.set_code,
      setName: p.set_name,
      setIconSvgUri: p.icon_svg_uri,
      collectorNumber: p.collector_number,
      rarity: p.rarity,
      finishes: p.finishes ?? [],
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
