import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";

/**
 * The export: everything in this database that cannot be rebuilt.
 *
 * Five tables. The card tables are not in here and never will be — 110k
 * printings regenerate from Scryfall in about 35 seconds, and putting them in
 * the file would turn a 200 KB backup you can read into an 80 MB one you
 * cannot. What is in here is the part that exists nowhere else: where your
 * cards are, what you paid, which decks you built, and the per-set rules you
 * chose for completion.
 *
 * Every row carries human-readable identity alongside the ids — a card's
 * name, set code and collector number, a location's name — so the file is
 * worth something even if the ids ever stop matching: with the names, the
 * collection can be re-entered by hand or re-imported. An export that only
 * had UUIDs in it would be a backup of a database, not of a collection.
 */

export const EXPORT_FORMAT_VERSION = 1;

export type ExportLocation = {
  id: string;
  name: string;
  kind: string;
  sortOrder: number;
};

export type ExportCollectionItem = {
  printingId: string;
  name: string;
  setCode: string;
  collectorNumber: string;
  finish: string;
  condition: string;
  quantity: number;
  location: string;
  acquiredAt: string | null;
  acquiredPriceCents: number | null;
  notes: string | null;
};

export type ExportDeckCard = {
  oracleId: string;
  name: string;
  board: string;
  quantity: number;
  isAllocated: boolean;
  printingId: string | null;
  setCode: string | null;
  collectorNumber: string | null;
};

export type ExportDeck = {
  id: string;
  name: string;
  format: string;
  notes: string | null;
  location: string | null;
  /** Whether a share link is live. The token itself is never exported. */
  shared: boolean;
  updatedAt: string;
  cards: ExportDeckCard[];
};

export type ExportCompletionTarget = {
  setCode: string;
  boosterOnly: boolean;
  includePromos: boolean;
  includeExtras: boolean;
  finish: string;
};

export type CollectionExport = {
  app: "MagicTracker";
  formatVersion: number;
  exportedAt: string;
  counts: {
    locations: number;
    collectionItems: number;
    collectionCopies: number;
    decks: number;
    deckCards: number;
    completionTargets: number;
  };
  locations: ExportLocation[];
  collection: ExportCollectionItem[];
  decks: ExportDeck[];
  completionTargets: ExportCompletionTarget[];
};

export async function buildExport(): Promise<CollectionExport> {
  const db = getDb();

  const { rows: locations } = await db.execute<{
    id: string;
    name: string;
    kind: string;
    sort_order: number;
  }>(sql`
    SELECT id::text AS id, name, kind, sort_order
      FROM locations
     ORDER BY sort_order, name
  `);

  const { rows: items } = await db.execute<{
    printing_id: string;
    name: string;
    set_code: string;
    collector_number: string;
    finish: string;
    condition: string;
    quantity: number;
    location: string;
    acquired_at: string | null;
    acquired_price_cents: number | null;
    notes: string | null;
  }>(sql`
    SELECT c.printing_id::text AS printing_id,
           o.name,
           p.set_code,
           p.collector_number,
           c.finish,
           c.condition,
           c.quantity,
           l.name AS location,
           c.acquired_at::text AS acquired_at,
           c.acquired_price_cents,
           c.notes
      FROM collection_items c
      JOIN printings p ON p.scryfall_id = c.printing_id
      JOIN oracle_cards o ON o.oracle_id = p.oracle_id
      JOIN locations l ON l.id = c.location_id
     ORDER BY l.name, o.name, p.set_code, p.collector_number, c.finish,
              c.condition
  `);

  const { rows: deckRows } = await db.execute<{
    id: string;
    name: string;
    format: string;
    notes: string | null;
    location: string | null;
    shared: boolean;
    updated_at: string;
  }>(sql`
    SELECT d.id::text AS id, d.name, d.format, d.notes,
           l.name AS location,
           (d.share_token IS NOT NULL) AS shared,
           d.updated_at::text AS updated_at
      FROM decks d
      LEFT JOIN locations l ON l.id = d.location_id
     ORDER BY d.name
  `);

  const { rows: deckCardRows } = await db.execute<{
    deck_id: string;
    oracle_id: string;
    name: string;
    board: string;
    quantity: number;
    is_allocated: boolean;
    printing_id: string | null;
    set_code: string | null;
    collector_number: string | null;
  }>(sql`
    SELECT dc.deck_id::text AS deck_id,
           dc.oracle_id::text AS oracle_id,
           o.name,
           dc.board,
           dc.quantity,
           dc.is_allocated,
           dc.printing_id::text AS printing_id,
           p.set_code,
           p.collector_number
      FROM deck_cards dc
      JOIN oracle_cards o ON o.oracle_id = dc.oracle_id
      LEFT JOIN printings p ON p.scryfall_id = dc.printing_id
     ORDER BY array_position(
                ARRAY['commander', 'main', 'maybe']::text[], dc.board
              ),
              o.name
  `);

  const { rows: targets } = await db.execute<{
    set_code: string;
    booster_only: boolean;
    include_promos: boolean;
    include_extras: boolean;
    finish: string;
  }>(sql`
    SELECT set_code, booster_only, include_promos, include_extras, finish
      FROM completion_targets
     ORDER BY set_code
  `);

  // Grouped in JS rather than with a json_agg: the deck count here is in the
  // dozens, and one readable query per table beats one clever one.
  const cardsByDeck = new Map<string, ExportDeckCard[]>();
  for (const row of deckCardRows) {
    const list = cardsByDeck.get(row.deck_id) ?? [];
    list.push({
      oracleId: row.oracle_id,
      name: row.name,
      board: row.board,
      quantity: row.quantity,
      isAllocated: row.is_allocated,
      printingId: row.printing_id,
      setCode: row.set_code,
      collectorNumber: row.collector_number,
    });
    cardsByDeck.set(row.deck_id, list);
  }

  const decks: ExportDeck[] = deckRows.map((d) => ({
    id: d.id,
    name: d.name,
    format: d.format,
    notes: d.notes,
    location: d.location,
    shared: d.shared,
    updatedAt: d.updated_at,
    cards: cardsByDeck.get(d.id) ?? [],
  }));

  const collection: ExportCollectionItem[] = items.map((i) => ({
    printingId: i.printing_id,
    name: i.name,
    setCode: i.set_code,
    collectorNumber: i.collector_number,
    finish: i.finish,
    condition: i.condition,
    quantity: i.quantity,
    location: i.location,
    acquiredAt: i.acquired_at,
    acquiredPriceCents: i.acquired_price_cents,
    notes: i.notes,
  }));

  return {
    app: "MagicTracker",
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    counts: {
      locations: locations.length,
      collectionItems: collection.length,
      collectionCopies: collection.reduce((n, i) => n + i.quantity, 0),
      decks: decks.length,
      deckCards: deckCardRows.length,
      completionTargets: targets.length,
    },
    locations: locations.map((l) => ({
      id: l.id,
      name: l.name,
      kind: l.kind,
      sortOrder: l.sort_order,
    })),
    collection,
    decks,
    completionTargets: targets.map((t) => ({
      setCode: t.set_code,
      boosterOnly: t.booster_only,
      includePromos: t.include_promos,
      includeExtras: t.include_extras,
      finish: t.finish,
    })),
  };
}

/** `magictracker-2026-11-11.json`, for the download. */
export function exportFilename(when = new Date(), extension = "json"): string {
  return `magictracker-${when.toISOString().slice(0, 10)}.${extension}`;
}

export type BackupRun = {
  startedAt: string;
  status: string;
  rowCount: number | null;
  /** Where the file went, as the script recorded it. */
  destination: string | null;
};

/**
 * The last scheduled backup, for the dashboard.
 *
 * The destination is read back out of the run's warnings rather than kept in
 * a column of its own: `ingest_runs` is shared by four jobs and a
 * backup-shaped column would be null for three of them.
 */
export async function getLastBackup(): Promise<BackupRun | null> {
  const db = getDb();
  const { rows } = await db.execute<{
    started_at: string;
    status: string;
    row_count: number | null;
    warnings: unknown;
  }>(sql`
    SELECT started_at::text AS started_at, status, row_count, warnings
      FROM ingest_runs
     WHERE source = 'backup'
     ORDER BY started_at DESC
     LIMIT 1
  `);

  const row = rows[0];
  if (!row) return null;

  let destination: string | null = null;
  if (Array.isArray(row.warnings)) {
    for (const entry of row.warnings) {
      if (
        entry &&
        typeof entry === "object" &&
        (entry as { kind?: unknown }).kind === "destination" &&
        typeof (entry as { destination?: unknown }).destination === "string"
      ) {
        destination = (entry as { destination: string }).destination;
      }
    }
  }

  return {
    startedAt: row.started_at,
    status: row.status,
    rowCount: row.row_count,
    destination,
  };
}
