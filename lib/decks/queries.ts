import { sql, type SQL } from "drizzle-orm";

import { getDb } from "@/lib/db";

import {
  COUNTED_BOARDS,
  isDeckFormat,
  targetSizeFor,
  type DeckBoard,
  type DeckFormat,
} from "./constants";
import { checkCube, type CubeCard, type CubeReport } from "./cube";
import {
  checkCommanderDeck,
  type LegalityCard,
  type LegalityReport,
} from "./legality";

/**
 * Reads for the deck pages.
 *
 * The one query that justifies this file is `availableFragment`: how many
 * copies of a card are free to build with. It is not "how many do I own" —
 * a card already spoken for by another built deck is not available, and
 * showing it as available is how you end up building two decks that cannot
 * both exist. See the comment there.
 */

/**
 * Copies owned, minus copies other decks have physically claimed.
 *
 * `is_allocated` records a claim rather than moving collection rows (see the
 * note on `deck_cards` in lib/db/schema.ts). So availability is a
 * subtraction, and `excludeDeckId` is what makes it right from inside a
 * deck: this deck's own claim must not count against itself, or every card
 * you allocated would immediately read as unavailable.
 */
function availableFragment(excludeDeckId: SQL | null): SQL {
  const exclusion =
    excludeDeckId === null ? sql`` : sql`AND dc2.deck_id <> ${excludeDeckId}`;

  return sql`
    GREATEST(
      coalesce((
        SELECT sum(c.quantity) FROM collection_items c
          JOIN printings p ON p.scryfall_id = c.printing_id
         WHERE p.oracle_id = base.oracle_id
      ), 0)
      - coalesce((
        SELECT sum(dc2.quantity) FROM deck_cards dc2
         WHERE dc2.oracle_id = base.oracle_id
           AND dc2.is_allocated
           AND dc2.board <> 'maybe'
           ${exclusion}
      ), 0),
      0
    )::int
  `;
}

export type DeckListRow = {
  id: string;
  name: string;
  format: DeckFormat;
  /** What the list is measured against: 100, or the cube's own size. */
  targetSize: number;
  locationId: string | null;
  locationName: string | null;
  /** Cards on the counted boards, commanders included. */
  cardCount: number;
  commanderNames: string[];
  colorIdentity: string[];
  /** Copies of the deck's cards owned, capped at what the deck needs. */
  ownedCopies: number;
  /** Copies the deck has claimed physically. */
  allocatedCopies: number;
  updatedAt: string;
};

export async function listDecks(): Promise<DeckListRow[]> {
  const db = getDb();

  const { rows } = await db.execute<{
    id: string;
    name: string;
    format: string;
    target_size: number | null;
    location_id: string | null;
    location_name: string | null;
    card_count: number;
    commander_names: string[] | null;
    color_identity: string[] | null;
    owned_copies: number;
    allocated_copies: number;
    updated_at: string;
  }>(sql`
    WITH base AS (
      SELECT dc.deck_id, dc.oracle_id, dc.quantity, dc.board, dc.is_allocated
        FROM deck_cards dc
       WHERE dc.board <> 'maybe'
    ),
    availability AS (
      SELECT base.deck_id,
             base.quantity,
             base.is_allocated,
             LEAST(${availableFragment(sql`base.deck_id`)}, base.quantity) AS have
        FROM base
    )
    SELECT d.id::text AS id,
           d.name,
           d.format,
           d.target_size,
           d.location_id::text AS location_id,
           l.name AS location_name,
           d.updated_at::text AS updated_at,
           coalesce((
             SELECT sum(quantity) FROM base WHERE base.deck_id = d.id
           ), 0)::int AS card_count,
           coalesce((
             SELECT array_agg(o.name ORDER BY o.name)
               FROM deck_cards dc
               JOIN oracle_cards o ON o.oracle_id = dc.oracle_id
              WHERE dc.deck_id = d.id AND dc.board = 'commander'
           ), '{}') AS commander_names,
           coalesce((
             SELECT array_agg(DISTINCT ci)
               FROM deck_cards dc
               JOIN oracle_cards o ON o.oracle_id = dc.oracle_id,
                    unnest(o.color_identity) AS ci
              WHERE dc.deck_id = d.id AND dc.board = 'commander'
           ), '{}') AS color_identity,
           coalesce((
             SELECT sum(have) FROM availability WHERE availability.deck_id = d.id
           ), 0)::int AS owned_copies,
           coalesce((
             SELECT sum(quantity) FROM base
              WHERE base.deck_id = d.id AND base.is_allocated
           ), 0)::int AS allocated_copies
      FROM decks d
      LEFT JOIN locations l ON l.id = d.location_id
     ORDER BY d.updated_at DESC
  `);

  return rows.map((r) => {
    const format = deckFormat(r.format);
    return {
      id: r.id,
      name: r.name,
      format,
      targetSize: targetSizeFor(format, r.target_size),
      locationId: r.location_id,
      locationName: r.location_name,
      cardCount: r.card_count,
      commanderNames: r.commander_names ?? [],
      colorIdentity: r.color_identity ?? [],
      ownedCopies: r.owned_copies,
      allocatedCopies: r.allocated_copies,
      updatedAt: r.updated_at,
    };
  });
}

/**
 * The format column, as a format.
 *
 * `decks.format` is text with a CHECK, so the database already refuses
 * anything else — but a value read out of a column is still a string as far
 * as the compiler is concerned, and silently rendering a deck with an
 * unknown format as a blank page would be worse than treating it as the one
 * every deck was before cubes existed.
 */
function deckFormat(raw: string): DeckFormat {
  return isDeckFormat(raw) ? raw : "commander";
}

export type DeckCardRow = {
  id: string;
  board: DeckBoard;
  oracleId: string;
  name: string;
  typeLine: string | null;
  manaCost: string | null;
  cmc: number | null;
  colorIdentity: string[];
  commanderLegality: string | null;
  /** The owner's heading for this card; null is "Uncategorized". */
  category: string | null;
  quantity: number;
  isAllocated: boolean;
  /** The chosen printing, when one is pinned. */
  printingId: string | null;
  printingSetCode: string | null;
  printingCollectorNumber: string | null;
  /**
   * The printing to draw the card as: the pinned one, or a representative one
   * when nothing is pinned.
   *
   * A deck card is an oracle card — "a Sol Ring", not a particular Sol Ring —
   * so most rows have no printing at all, and a visual deck view needs
   * *something* to show. Falling back to the printing's own id keeps the
   * image honest where one is pinned, and picks the plainest English version
   * otherwise. Null only for a card with no printings at all, which the card
   * ingest should make impossible.
   */
  imageId: string | null;
  /** Copies free to build with: owned minus other decks' claims. */
  available: number;
  /** Copies owned in total, ignoring every claim. */
  owned: number;
};

/**
 * What this deck is judged by, tagged with which judgment it is.
 *
 * A union rather than two optional fields, because exactly one applies and
 * the UI has to render one panel or the other: Commander's verdict is
 * legal/not legal against a fixed rule set, and a cube's report is a
 * description of a pool nobody can declare illegal. Running the Commander
 * rules on a 360-card cube would produce fifteen errors that are all
 * "a cube is not a Commander deck", and the type is what stops a template
 * from reaching for `legality` on something that has none.
 */
export type DeckVerdict =
  | { kind: "commander"; report: LegalityReport }
  | { kind: "cube"; report: CubeReport };

export type DeckDetail = {
  id: string;
  name: string;
  format: DeckFormat;
  /** 100 for Commander, the cube's own size for a cube. */
  targetSize: number;
  notes: string | null;
  locationId: string | null;
  locationName: string | null;
  cards: DeckCardRow[];
  verdict: DeckVerdict;
  /** Cards on the counted boards, commanders included. */
  cardCount: number;
  /** Cards the deck needs that are not available. */
  missing: { oracleId: string; name: string; need: number }[];
  updatedAt: string;
};

export async function getDeck(deckId: string): Promise<DeckDetail | null> {
  const db = getDb();

  const { rows: deckRows } = await db.execute<{
    id: string;
    name: string;
    format: string;
    target_size: number | null;
    notes: string | null;
    location_id: string | null;
    location_name: string | null;
    updated_at: string;
  }>(sql`
    SELECT d.id::text AS id, d.name, d.format, d.target_size, d.notes,
           d.location_id::text AS location_id,
           l.name AS location_name,
           d.updated_at::text AS updated_at
      FROM decks d
      LEFT JOIN locations l ON l.id = d.location_id
     WHERE d.id = ${deckId}::uuid
  `);

  const deck = deckRows[0];
  if (!deck) return null;

  const { rows } = await db.execute<{
    id: string;
    board: string;
    oracle_id: string;
    name: string;
    type_line: string | null;
    mana_cost: string | null;
    cmc: number | null;
    color_identity: string[] | null;
    colors: string[] | null;
    oracle_text: string | null;
    keywords: string[] | null;
    commander_legality: string | null;
    category: string | null;
    quantity: number;
    is_allocated: boolean;
    printing_id: string | null;
    printing_set_code: string | null;
    printing_collector_number: string | null;
    image_id: string | null;
    available: number;
    owned: number;
  }>(sql`
    WITH base AS (
      SELECT dc.id, dc.board, dc.oracle_id, dc.quantity, dc.is_allocated,
             dc.printing_id, dc.deck_id, dc.category
        FROM deck_cards dc
       WHERE dc.deck_id = ${deckId}::uuid
    )
    SELECT base.id::text AS id,
           base.board,
           base.oracle_id::text AS oracle_id,
           o.name,
           o.type_line,
           o.mana_cost,
           o.cmc,
           o.color_identity,
           o.colors,
           o.oracle_text,
           o.keywords,
           o.legalities->>'commander' AS commander_legality,
           base.category,
           base.quantity,
           base.is_allocated,
           base.printing_id::text AS printing_id,
           p.set_code         AS printing_set_code,
           p.collector_number AS printing_collector_number,
           /*
            * The image to draw this row as. The pinned printing wins; with
            * nothing pinned, the plainest English printing stands in —
            * English first, then booster-obtainable over extras, then the
            * lowest collector number, which between them land on the
            * ordinary version of the card rather than a borderless promo.
            */
           coalesce(base.printing_id, (
             SELECT pr.scryfall_id
               FROM printings pr
              WHERE pr.oracle_id = base.oracle_id
              ORDER BY pr.lang = 'en' DESC,
                       pr.is_extra ASC,
                       pr.collector_number_num ASC NULLS LAST
              LIMIT 1
           ))::text AS image_id,
           ${availableFragment(sql`${deckId}::uuid`)} AS available,
           coalesce((
             SELECT sum(c.quantity) FROM collection_items c
               JOIN printings pr ON pr.scryfall_id = c.printing_id
              WHERE pr.oracle_id = base.oracle_id
           ), 0)::int AS owned
      FROM base
      JOIN oracle_cards o ON o.oracle_id = base.oracle_id
      LEFT JOIN printings p ON p.scryfall_id = base.printing_id
     ORDER BY array_position(
                ARRAY['commander', 'main', 'maybe']::text[], base.board
              ),
              o.cmc NULLS FIRST,
              o.name
  `);

  const cards: DeckCardRow[] = rows.map((r) => ({
    id: r.id,
    board: r.board as DeckBoard,
    oracleId: r.oracle_id,
    name: r.name,
    typeLine: r.type_line,
    manaCost: r.mana_cost,
    cmc: r.cmc,
    colorIdentity: r.color_identity ?? [],
    commanderLegality: r.commander_legality,
    category: r.category,
    quantity: r.quantity,
    isAllocated: r.is_allocated,
    printingId: r.printing_id,
    printingSetCode: r.printing_set_code,
    printingCollectorNumber: r.printing_collector_number,
    imageId: r.image_id,
    available: r.available,
    owned: r.owned,
  }));

  const format = deckFormat(deck.format);
  const targetSize = targetSizeFor(format, deck.target_size);

  /*
   * The maybeboard is filtered out here, not in the rule engine. Both
   * checkCommanderDeck and checkCube count every row they are given — a card
   * under consideration is not a card in the deck, and letting one count
   * toward the size or the colour balance would make the answer wrong in a
   * way the user never asked for.
   */
  const countedRows = rows.filter((r) =>
    (COUNTED_BOARDS as readonly string[]).includes(r.board),
  );

  const verdict: DeckVerdict =
    format === "cube"
      ? {
          kind: "cube",
          report: checkCube(
            countedRows.map((r): CubeCard => ({
              oracleId: r.oracle_id,
              name: r.name,
              typeLine: r.type_line,
              oracleText: r.oracle_text,
              colors: r.colors,
              colorIdentity: r.color_identity ?? [],
              cmc: r.cmc,
              board: r.board as DeckBoard,
              quantity: r.quantity,
            })),
            targetSize,
          ),
        }
      : {
          kind: "commander",
          report: checkCommanderDeck(
            countedRows.map((r): LegalityCard => ({
              oracleId: r.oracle_id,
              name: r.name,
              typeLine: r.type_line,
              oracleText: r.oracle_text,
              colorIdentity: r.color_identity ?? [],
              keywords: r.keywords,
              commanderLegality: r.commander_legality,
              board: r.board as DeckBoard,
              quantity: r.quantity,
            })),
          ),
        };

  const missing = cards
    .filter((c) => c.board !== "maybe" && c.available < c.quantity)
    .map((c) => ({
      oracleId: c.oracleId,
      name: c.name,
      need: c.quantity - c.available,
    }));

  return {
    id: deck.id,
    name: deck.name,
    format,
    targetSize,
    notes: deck.notes,
    locationId: deck.location_id,
    locationName: deck.location_name,
    cards,
    verdict,
    cardCount: verdict.report.cardCount,
    missing,
    updatedAt: deck.updated_at,
  };
}

export type DeckCardCandidate = {
  oracleId: string;
  name: string;
  typeLine: string | null;
  manaCost: string | null;
  colorIdentity: string[];
  commanderLegality: string | null;
  available: number;
  owned: number;
  /** True when this card is already on one of the deck's boards. */
  inDeck: boolean;
  /** Whether it fits the deck's current commander identity. */
  inIdentity: boolean;
};

/**
 * Search for a card to add to a deck, answering "do I own it" inline.
 *
 * The inline owned-vs-needed is the point: deciding whether to put a card in
 * a deck means knowing whether you have one, and making that a second lookup
 * is what makes other trackers tedious.
 */
export async function searchDeckCards(
  deckId: string,
  query: string,
  limit = 12,
): Promise<DeckCardCandidate[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const db = getDb();

  // Escaped: a literal % or _ in the query would widen the search.
  const pattern = `%${trimmed.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

  const { rows } = await db.execute<{
    oracle_id: string;
    name: string;
    type_line: string | null;
    mana_cost: string | null;
    color_identity: string[] | null;
    commander_legality: string | null;
    available: number;
    owned: number;
    in_deck: boolean;
    in_identity: boolean;
  }>(sql`
    WITH identity AS (
      SELECT coalesce(array_agg(DISTINCT ci), '{}') AS colors
        FROM deck_cards dc
        JOIN oracle_cards o ON o.oracle_id = dc.oracle_id,
             unnest(o.color_identity) AS ci
       WHERE dc.deck_id = ${deckId}::uuid AND dc.board = 'commander'
    ),
    /*
     * Whether there is a command zone at all, kept separate from the colors.
     * Both "no commander yet" and "a colorless commander" produce an empty
     * identity array, and they mean opposite things: with no commander
     * nothing can be off-identity, while a colorless commander admits only
     * colorless cards. Without this flag, every colored card would be
     * flagged in a deck that has not picked a commander yet.
     */
    has_commander AS (
      SELECT EXISTS (
        SELECT 1 FROM deck_cards dc
         WHERE dc.deck_id = ${deckId}::uuid AND dc.board = 'commander'
      ) AS present
    ),
    matches AS (
      SELECT o.oracle_id, o.name, o.type_line, o.mana_cost, o.color_identity,
             o.legalities->>'commander' AS commander_legality,
             -- An exact name first, then a prefix, then anything: typing
             -- "bolt" should not bury Lightning Bolt under Bolt Bend.
             CASE
               WHEN lower(o.name) = lower(${trimmed}) THEN 0
               WHEN o.name ILIKE ${`${trimmed.replace(/[\\%_]/g, (m) => `\\${m}`)}%`} ESCAPE '\\' THEN 1
               ELSE 2
             END AS rank
        FROM oracle_cards o
       WHERE o.name ILIKE ${pattern} ESCAPE '\\'
         -- Tokens and art series are not cards you put in a deck.
         AND o.layout NOT IN ('token', 'double_faced_token', 'art_series', 'emblem')
       ORDER BY rank, o.edhrec_rank NULLS LAST, o.name
       LIMIT ${limit}
    )
    SELECT base.oracle_id::text AS oracle_id,
           base.name, base.type_line, base.mana_cost,
           base.color_identity, base.commander_legality,
           ${availableFragment(sql`${deckId}::uuid`)} AS available,
           coalesce((
             SELECT sum(c.quantity) FROM collection_items c
               JOIN printings pr ON pr.scryfall_id = c.printing_id
              WHERE pr.oracle_id = base.oracle_id
           ), 0)::int AS owned,
           EXISTS (
             SELECT 1 FROM deck_cards dc
              WHERE dc.deck_id = ${deckId}::uuid
                AND dc.oracle_id = base.oracle_id
           ) AS in_deck,
           (
             NOT (SELECT present FROM has_commander)
             OR base.color_identity <@ (SELECT colors FROM identity)
           ) AS in_identity
      FROM matches base
     ORDER BY base.rank, base.name
  `);

  return rows.map((r) => ({
    oracleId: r.oracle_id,
    name: r.name,
    typeLine: r.type_line,
    manaCost: r.mana_cost,
    colorIdentity: r.color_identity ?? [],
    commanderLegality: r.commander_legality,
    available: r.available,
    owned: r.owned,
    inDeck: r.in_deck,
    inIdentity: r.in_identity,
  }));
}

/**
 * The buy list: what the deck needs that the collection cannot supply.
 *
 * Card names only, no set code — unlike the set want list, which names a
 * printing because the point there is completing one particular set. A deck
 * needs the card and any printing will do, so pinning one would make a worse
 * shopping list.
 */
export function formatBuyList(
  missing: { name: string; need: number }[],
): string {
  return missing.map((m) => `${m.need} ${m.name}`).join("\n");
}

export function buyListFilename(deckName: string): string {
  const slug =
    deckName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "deck";
  return `${slug}-buy-list.txt`;
}
