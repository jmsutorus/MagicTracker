import { sql, type SQL } from "drizzle-orm";

import { representativePrinting } from "@/lib/cards/art";
import { getDb } from "@/lib/db";

import {
  BOARD_ORDER,
  DECK_FORMATS,
  countedBoardsFor,
  isDeckFormat,
  legalityKeyFor,
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
import {
  checkStandardDeck,
  type StandardCard,
  type StandardReport,
} from "./standard";

/**
 * `BOARD_ORDER` as a SQL array, for the one sort every decklist query uses.
 *
 * Built from the list in lib/decks/constants.ts rather than written out in
 * each statement: this app has three queries that order a decklist by board,
 * and three hand-written copies of the array is how `side` gets added to one
 * of them and silently sorts last in the other two. `sql.raw` is safe here
 * and necessary — the values are a closed set of identifiers from our own
 * source, and a bound parameter cannot be an array literal in this position.
 */
export const BOARD_ORDER_SQL = sql.raw(
  `ARRAY[${BOARD_ORDER.map((board) => `'${board}'`).join(", ")}]::text[]`,
);

/**
 * The card legality column this format is judged by, or NULL for a format
 * with no ban list at all.
 *
 * A cube gets a real NULL rather than Commander's column quietly reused,
 * because "this card is banned" is not a fact about a cube.
 */
export function legalityColumnFor(format: DeckFormat): SQL {
  const key = legalityKeyFor(format);
  return key === null ? sql`NULL::text` : sql`o.legalities->>${key}`;
}

/**
 * The same choice, made in SQL from the deck's own row.
 *
 * `searchDeckCards` has a deck id and no format, and the search box is the
 * keyboard-first path — a second round trip to learn the format would cost a
 * request on every debounce. The CASE is generated from `legalityKeyFor`
 * rather than written out, so the mapping still exists in exactly one place;
 * a format that maps to null is simply absent and the CASE yields NULL.
 */
const LEGALITY_KEY_BY_DECK_FORMAT = sql.raw(
  `CASE format ${DECK_FORMATS.filter((format) => legalityKeyFor(format))
    .map((format) => `WHEN '${format}' THEN '${legalityKeyFor(format)}'`)
    .join(" ")} END`,
);

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
  /** What the list is measured against: 100, 60 at least, or a cube's size. */
  targetSize: number;
  locationId: string | null;
  locationName: string | null;
  /** The deck proper: commanders included, sideboard not. */
  cardCount: number;
  /**
   * Copies in the sideboard, which only Standard has.
   *
   * Separate from `cardCount` because the sideboard is not part of the 60
   * and printing 75 against a 60-card minimum would read as a deck that has
   * gone wrong. It is still owned, claimed and bought like the rest, so it
   * is counted in `ownedCopies` below.
   */
  sideboardCount: number;
  commanderNames: string[];
  /**
   * A printing to draw the deck's art from, or null.
   *
   * The deck's identity on a list is its commander, and a commander is a
   * picture before it is a name. This is the printing whose `art_crop` the
   * deck row and the deck page use as their banner.
   *
   * It prefers the printing the deck actually names — if you chose the
   * Secret Lair Dogmeat, that is the Dogmeat you should see — and falls back
   * to any English, non-extra printing of the same card, newest first, since
   * `deck_cards.printing_id` is a nullable preference rather than a
   * requirement. Null for a cube, and for a commander deck with no commander
   * picked yet.
   */
  artPrintingId: string | null;
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
    sideboard_count: number;
    commander_names: string[] | null;
    art_printing_id: string | null;
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
             SELECT sum(quantity) FROM base
              WHERE base.deck_id = d.id AND base.board <> 'side'
           ), 0)::int AS card_count,
           coalesce((
             SELECT sum(quantity) FROM base
              WHERE base.deck_id = d.id AND base.board = 'side'
           ), 0)::int AS sideboard_count,
           coalesce((
             SELECT array_agg(o.name ORDER BY o.name)
               FROM deck_cards dc
               JOIN oracle_cards o ON o.oracle_id = dc.oracle_id
              WHERE dc.deck_id = d.id AND dc.board = 'commander'
           ), '{}') AS commander_names,
           (
             /*
              * One printing of one commander, for the row's art.
              *
              * The deck's own printing_id wins when it has one; otherwise
              * the shared fallback in lib/cards/art.ts picks a printing. The
              * name ordering only matters for a partner pair, where it makes
              * the choice stable rather than whichever row came back first.
              */
             SELECT coalesce(
                      dc.printing_id,
                      ${representativePrinting(sql`dc.oracle_id`)}
                    )::text
               FROM deck_cards dc
               JOIN oracle_cards o ON o.oracle_id = dc.oracle_id
              WHERE dc.deck_id = d.id AND dc.board = 'commander'
              ORDER BY o.name
              LIMIT 1
           ) AS art_printing_id,
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
      sideboardCount: r.sideboard_count,
      commanderNames: r.commander_names ?? [],
      artPrintingId: r.art_printing_id,
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
  /**
   * How this card stands in *this deck's* format — legal, banned, not_legal
   * — or null for a format with no ban list.
   *
   * Named for the deck's format rather than for Commander's, because that is
   * what it now holds: a Standard deck's rows carry Standard legality, and a
   * row labelled `commanderLegality` reading "not_legal" on a perfectly good
   * Standard card would be a badge nobody could explain.
   */
  formatLegality: string | null;
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
  | { kind: "standard"; report: StandardReport }
  | { kind: "cube"; report: CubeReport };

/**
 * The card facts any of the three verdicts is computed from.
 *
 * Column names rather than camelCase, because it is a row: both callers —
 * the owner's deck page and the public share page — hand it the result of a
 * query, and converting twice on the way to a pure function that wants three
 * different subsets of it would be work done for nobody.
 */
export type VerdictRow = {
  oracle_id: string;
  name: string;
  type_line: string | null;
  oracle_text: string | null;
  color_identity: string[] | null;
  colors: string[] | null;
  cmc: number | null;
  keywords: string[] | null;
  /** The legality column for *this deck's* format; null when it has none. */
  format_legality: string | null;
  board: string;
  quantity: number;
};

/**
 * Judges a deck by the rules of its own format.
 *
 * One function, called from both pages, because there were two copies of
 * this branch the day a third format arrived and the second copy is the one
 * that would have kept quietly returning a Commander verdict for a Standard
 * deck — with every card in it reported as breaking singleton.
 *
 * The uncounted boards are dropped here rather than in the rule engines,
 * which count every row they are given. A card on the maybeboard is not a
 * card in the deck, and a board a format does not have — a command zone in
 * Standard — is still counted so the deck's own report can explain the row
 * instead of the total silently disagreeing with the list.
 */
export function buildVerdict(
  format: DeckFormat,
  targetSize: number,
  rows: VerdictRow[],
): DeckVerdict {
  const counted = countedBoardsFor(format) as readonly string[];
  const countedRows = rows.filter((r) => counted.includes(r.board));

  if (format === "cube") {
    return {
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
    };
  }

  if (format === "standard") {
    return {
      kind: "standard",
      report: checkStandardDeck(
        countedRows.map((r): StandardCard => ({
          oracleId: r.oracle_id,
          name: r.name,
          typeLine: r.type_line,
          oracleText: r.oracle_text,
          standardLegality: r.format_legality,
          board: r.board as DeckBoard,
          quantity: r.quantity,
        })),
      ),
    };
  }

  return {
    kind: "commander",
    report: checkCommanderDeck(
      countedRows.map((r): LegalityCard => ({
        oracleId: r.oracle_id,
        name: r.name,
        typeLine: r.type_line,
        oracleText: r.oracle_text,
        colorIdentity: r.color_identity ?? [],
        keywords: r.keywords,
        commanderLegality: r.format_legality,
        board: r.board as DeckBoard,
        quantity: r.quantity,
      })),
    ),
  };
}

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

  // Read before the cards are, because it decides which legality column the
  // card query selects — a Standard deck's rows are judged by Standard.
  const format = deckFormat(deck.format);
  const targetSize = targetSizeFor(format, deck.target_size);

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
    format_legality: string | null;
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
           ${legalityColumnFor(format)} AS format_legality,
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
     ORDER BY array_position(${BOARD_ORDER_SQL}, base.board),
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
    formatLegality: r.format_legality,
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

  const verdict = buildVerdict(format, targetSize, rows);

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
  /** Legal, banned or not_legal in this deck's format; null for a cube. */
  formatLegality: string | null;
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
    format_legality: string | null;
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
             /*
              * Judged by the deck's own format: Standard legality in a
              * Standard deck, Commander's in a Commander deck, and NULL in a
              * cube, which has no ban list to be on. A scalar subquery
              * rather than a second round trip, because this runs on every
              * debounce of the search box.
              */
             o.legalities->>(
               SELECT ${LEGALITY_KEY_BY_DECK_FORMAT}
                 FROM decks WHERE id = ${deckId}::uuid
             ) AS format_legality,
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
           base.color_identity, base.format_legality,
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
    formatLegality: r.format_legality,
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
