import { sql, type SQL } from "drizzle-orm";

import { getDb } from "@/lib/db";

import { COUNTED_BOARDS, type DeckBoard } from "./constants";
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
  format: string;
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

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    format: r.format,
    locationId: r.location_id,
    locationName: r.location_name,
    cardCount: r.card_count,
    commanderNames: r.commander_names ?? [],
    colorIdentity: r.color_identity ?? [],
    ownedCopies: r.owned_copies,
    allocatedCopies: r.allocated_copies,
    updatedAt: r.updated_at,
  }));
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
  quantity: number;
  isAllocated: boolean;
  /** The chosen printing, when one is pinned. */
  printingId: string | null;
  printingSetCode: string | null;
  printingCollectorNumber: string | null;
  /** Copies free to build with: owned minus other decks' claims. */
  available: number;
  /** Copies owned in total, ignoring every claim. */
  owned: number;
};

export type DeckDetail = {
  id: string;
  name: string;
  format: string;
  notes: string | null;
  locationId: string | null;
  locationName: string | null;
  cards: DeckCardRow[];
  legality: LegalityReport;
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
    notes: string | null;
    location_id: string | null;
    location_name: string | null;
    updated_at: string;
  }>(sql`
    SELECT d.id::text AS id, d.name, d.format, d.notes,
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
    oracle_text: string | null;
    keywords: string[] | null;
    commander_legality: string | null;
    quantity: number;
    is_allocated: boolean;
    printing_id: string | null;
    printing_set_code: string | null;
    printing_collector_number: string | null;
    available: number;
    owned: number;
  }>(sql`
    WITH base AS (
      SELECT dc.id, dc.board, dc.oracle_id, dc.quantity, dc.is_allocated,
             dc.printing_id, dc.deck_id
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
           o.oracle_text,
           o.keywords,
           o.legalities->>'commander' AS commander_legality,
           base.quantity,
           base.is_allocated,
           base.printing_id::text AS printing_id,
           p.set_code         AS printing_set_code,
           p.collector_number AS printing_collector_number,
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
    quantity: r.quantity,
    isAllocated: r.is_allocated,
    printingId: r.printing_id,
    printingSetCode: r.printing_set_code,
    printingCollectorNumber: r.printing_collector_number,
    available: r.available,
    owned: r.owned,
  }));

  /*
   * The maybeboard is filtered out here, not in the rule engine.
   * checkCommanderDeck counts every row it is given — a card under
   * consideration is not a card in the deck, and letting one count toward the
   * 100 or toward color identity would make the verdict wrong in a way the
   * user never asked for.
   */
  const counted: LegalityCard[] = rows
    .filter((r) => (COUNTED_BOARDS as readonly string[]).includes(r.board))
    .map((r) => ({
      oracleId: r.oracle_id,
      name: r.name,
      typeLine: r.type_line,
      oracleText: r.oracle_text,
      colorIdentity: r.color_identity ?? [],
      keywords: r.keywords,
      commanderLegality: r.commander_legality,
      board: r.board as DeckBoard,
      quantity: r.quantity,
    }));

  const legality = checkCommanderDeck(counted);

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
    format: deck.format,
    notes: deck.notes,
    locationId: deck.location_id,
    locationName: deck.location_name,
    cards,
    legality,
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
