import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";

import {
  BOARD_ORDER,
  isDeckFormat,
  targetSizeFor,
  type DeckBoard,
  type DeckFormat,
} from "./constants";
import type { DeckError, DeckResult } from "./mutations";
import {
  BOARD_ORDER_SQL,
  buildVerdict,
  legalityColumnFor,
  type DeckVerdict,
} from "./queries";

/**
 * Unlisted share links.
 *
 * A link is *unlisted*, not public: the token is unguessable, the root layout
 * sets `robots: noindex`, and nothing links to it, so the page is reachable
 * only by someone you sent the URL to. That is the right strength for a
 * decklist — it is a list of cards anyone could look up, not a secret — and
 * it avoids inventing accounts for people who are only reading.
 *
 * What a visitor gets is deliberately narrower than what you see: the card
 * list, the colour identity and the legality verdict. Never what you own,
 * what a card is worth, where the deck is kept, or what still has to be
 * bought. Those are facts about *you*, and the list is a fact about the deck.
 */

/** 16 random bytes, URL-safe: 22 characters, 128 bits. */
function newToken(): string {
  return randomBytes(16).toString("base64url");
}

/**
 * The shape a token can have, checked before the database is asked.
 *
 * Not a security control — the lookup is parameterised — but it keeps a
 * 4 KB path from becoming a query, and it is the same test the route handler
 * and the page both need.
 */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

export function isShareToken(value: string): boolean {
  return TOKEN_RE.test(value);
}

/** Same guard as lib/decks/mutations.ts: a bad id is an error, not a 22P02. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ShareState = {
  token: string | null;
  createdAt: string | null;
};

export async function getShareState(deckId: string): Promise<ShareState> {
  if (!UUID_RE.test(deckId)) return { token: null, createdAt: null };
  const db = getDb();
  const { rows } = await db.execute<{
    share_token: string | null;
    share_created_at: string | null;
  }>(sql`
    SELECT share_token, share_created_at::text AS share_created_at
      FROM decks
     WHERE id = ${deckId}::uuid
  `);
  const row = rows[0];
  return {
    token: row?.share_token ?? null,
    createdAt: row?.share_created_at ?? null,
  };
}

export type ShareCreated = { ok: true; token: string } | DeckError;

/**
 * Hands out a link, replacing any previous one.
 *
 * Re-sharing mints a *new* token rather than returning the old one, so
 * "share it again" after a revoke cannot resurrect a URL you deliberately
 * killed. The retry loop is for the unique index: a 128-bit collision will
 * not happen, but a silent failure if it did would be worse than three
 * cheap attempts.
 */
export async function createShareLink(deckId: string): Promise<ShareCreated> {
  if (!UUID_RE.test(deckId)) return { ok: false, error: "Unknown deck." };
  const db = getDb();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = newToken();
    const { rows } = await db.execute<{ share_token: string }>(sql`
      UPDATE decks
         SET share_token = ${token},
             share_created_at = now(),
             updated_at = now()
       WHERE id = ${deckId}::uuid
         AND NOT EXISTS (
           SELECT 1 FROM decks other WHERE other.share_token = ${token}
         )
      RETURNING share_token
    `);
    if (rows[0]) return { ok: true, token: rows[0].share_token };

    // No row came back: either the deck is gone, or that token was taken.
    const { rows: exists } = await db.execute<{ one: number }>(
      sql`SELECT 1 AS one FROM decks WHERE id = ${deckId}::uuid`,
    );
    if (!exists[0]) return { ok: false, error: "That deck no longer exists." };
  }

  return { ok: false, error: "Could not create a link. Try again." };
}

export async function revokeShareLink(deckId: string): Promise<DeckResult> {
  if (!UUID_RE.test(deckId)) return { ok: false, error: "Unknown deck." };
  const db = getDb();
  const { rows } = await db.execute<{ id: string }>(sql`
    UPDATE decks
       SET share_token = NULL,
           share_created_at = NULL,
           updated_at = now()
     WHERE id = ${deckId}::uuid
    RETURNING id::text AS id
  `);
  if (!rows[0]) return { ok: false, error: "That deck no longer exists." };
  return { ok: true };
}

export type SharedCard = {
  oracleId: string;
  name: string;
  typeLine: string | null;
  manaCost: string | null;
  quantity: number;
  /** The pinned printing, when the owner chose one. */
  setCode: string | null;
  collectorNumber: string | null;
};

export type SharedDeck = {
  name: string;
  format: DeckFormat;
  /** 100, 60 at least, or the cube's own size. */
  targetSize: number;
  updatedAt: string;
  sharedAt: string | null;
  /**
   * The same tagged verdict the owner sees, and deliberately so: the list,
   * its size and whether it holds together are facts about the deck. What
   * the owner *owns* is not in here at all — see `SharedCard`.
   */
  verdict: DeckVerdict;
  boards: { board: DeckBoard; cards: SharedCard[] }[];
};

/**
 * A deck by its share token.
 *
 * One query, and it selects columns rather than `*`: this is the only read in
 * the app that answers to someone who is not signed in, so what it returns is
 * worth being able to see at a glance. `decks.notes` and `location_id` are
 * not in it on purpose — notes are where you write things about yourself.
 */
export async function getSharedDeck(token: string): Promise<SharedDeck | null> {
  if (!isShareToken(token)) return null;

  const db = getDb();

  const { rows: deckRows } = await db.execute<{
    id: string;
    name: string;
    format: string;
    target_size: number | null;
    updated_at: string;
    share_created_at: string | null;
  }>(sql`
    SELECT id::text AS id, name, format, target_size,
           updated_at::text AS updated_at,
           share_created_at::text AS share_created_at
      FROM decks
     WHERE share_token = ${token}
  `);

  const deck = deckRows[0];
  if (!deck) return null;

  // Before the cards, because it picks the legality column they are read
  // with — the same order, and for the same reason, as `getDeck`.
  const format: DeckFormat = isDeckFormat(deck.format)
    ? deck.format
    : "commander";
  const targetSize = targetSizeFor(format, deck.target_size);

  const { rows } = await db.execute<{
    board: string;
    oracle_id: string;
    name: string;
    type_line: string | null;
    mana_cost: string | null;
    oracle_text: string | null;
    color_identity: string[] | null;
    colors: string[] | null;
    cmc: number | null;
    keywords: string[] | null;
    format_legality: string | null;
    quantity: number;
    set_code: string | null;
    collector_number: string | null;
  }>(sql`
    SELECT dc.board,
           dc.oracle_id::text AS oracle_id,
           o.name,
           o.type_line,
           o.mana_cost,
           o.oracle_text,
           o.color_identity,
           o.colors,
           o.cmc,
           o.keywords,
           ${legalityColumnFor(format)} AS format_legality,
           dc.quantity,
           p.set_code,
           p.collector_number
      FROM deck_cards dc
      JOIN oracle_cards o ON o.oracle_id = dc.oracle_id
      LEFT JOIN printings p ON p.scryfall_id = dc.printing_id
     WHERE dc.deck_id = ${deck.id}::uuid
     ORDER BY array_position(${BOARD_ORDER_SQL}, dc.board),
              o.cmc NULLS FIRST,
              o.name
  `);

  const verdict = buildVerdict(format, targetSize, rows);

  const boards = BOARD_ORDER.map((board) => ({
    board: board as DeckBoard,
    cards: rows
      .filter((r) => r.board === board)
      .map((r) => ({
        oracleId: r.oracle_id,
        name: r.name,
        typeLine: r.type_line,
        manaCost: r.mana_cost,
        quantity: r.quantity,
        setCode: r.set_code,
        collectorNumber: r.collector_number,
      })),
  })).filter((b) => b.cards.length > 0);

  return {
    name: deck.name,
    format,
    targetSize,
    updatedAt: deck.updated_at,
    sharedAt: deck.share_created_at,
    verdict,
    boards,
  };
}

/** A file name for the shared decklist download. */
export function sharedListFilename(deckName: string): string {
  const slug =
    deckName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "deck";
  return `${slug}.txt`;
}
