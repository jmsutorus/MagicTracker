import type { Client } from "pg";

import type { GameSlug } from "@/lib/games/constants";

/**
 * The rows a non-Magic catalog ingest produces, and the upsert that writes
 * them.
 *
 * Deliberately *not* the COPY-into-staging machinery that scripts/ingest-
 * cards.ts uses. That exists because Scryfall's bulk file is 500 MB and
 * 110,963 rows, where the difference between COPY and INSERT is the
 * difference between four minutes and an hour. The Pokémon catalog is around
 * 20,000 cards and One Piece around 3,000; both fit comfortably in memory and
 * finish in seconds as batched multi-row inserts, so they get the simpler
 * thing rather than a copy of the complicated one.
 *
 * What is NOT simplified is the rule those scripts exist to protect:
 *
 *   UPSERT, NEVER TRUNCATE.
 *
 * `collection_items` references `printings` with ON DELETE RESTRICT. A
 * truncate here would either abort on the foreign key or, worse, take the
 * record of cards somebody physically owns with it. Every statement below is
 * an INSERT ... ON CONFLICT DO UPDATE, and every ingest is a refresh rather
 * than a replacement.
 *
 * Nor is the write scoped by game as a safety measure — it does not need to
 * be. Each row carries its own primary key, derived in lib/games/ids.ts from
 * the game and the source's own id, so a Pokémon ingest cannot collide with a
 * Magic row even in principle.
 */

export type CatalogSet = {
  /** Already prefixed by setCodeFor() — `pkm-sv8`, never bare `sv8`. */
  code: string;
  game: GameSlug;
  name: string;
  /** This game's own word for the kind of release: expansion, promo, deck. */
  setType: string;
  /** ISO date, or null where the catalog does not publish one. */
  releasedAt: string | null;
  cardCount: number;
  iconSvgUri: string | null;
};

export type CatalogOracle = {
  oracleId: string;
  game: GameSlug;
  name: string;
  /** "Basic Pokémon — Grass", "Character — Straw Hat Crew". */
  typeLine: string | null;
  oracleText: string | null;
  /** The facts only this game has. See `oracle_cards.game_data`. */
  gameData: Record<string, unknown> | null;
};

export type CatalogPrinting = {
  /** The derived UUID. See lib/games/ids.ts. */
  id: string;
  game: GameSlug;
  /** The source catalog's own id for this card — `sv8-1`, `OP11-004_p1`. */
  externalId: string;
  oracleId: string;
  setCode: string;
  collectorNumber: string;
  collectorNumberNum: number | null;
  name: string;
  rarity: string;
  finishes: string[];
  imageUrl: string | null;
  artUrl: string | null;
  releasedAt: string | null;
  /** Market price in cents, where the catalog publishes one. */
  usdCents: number | null;
};

export type CatalogBatch = {
  sets: CatalogSet[];
  oracles: CatalogOracle[];
  printings: CatalogPrinting[];
};

/**
 * Rows per statement.
 *
 * Postgres caps a statement at 65,535 bound parameters. The widest row here
 * binds 16, so 500 rows is 8,000 — an order of magnitude inside the limit,
 * and large enough that the round trips stop being what the ingest spends
 * its time on.
 */
const BATCH_SIZE = 500;

function chunk<T>(rows: T[], size = BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * `($1,$2,$3),($4,$5,$6),…` for a multi-row VALUES, and the flat parameter
 * list to go with it. Hand-built because the row count varies per batch;
 * every *value* is still bound, never interpolated.
 */
function valuesClause(rowCount: number, columnCount: number): string {
  const rows: string[] = [];
  for (let r = 0; r < rowCount; r++) {
    const params: string[] = [];
    for (let c = 0; c < columnCount; c++) params.push(`$${r * columnCount + c + 1}`);
    rows.push(`(${params.join(",")})`);
  }
  return rows.join(",");
}

async function upsertSets(client: Client, rows: CatalogSet[]): Promise<void> {
  const columns = 8;
  for (const batch of chunk(rows)) {
    const values: unknown[] = [];
    for (const s of batch) {
      values.push(
        s.code,
        s.game,
        s.name,
        s.setType,
        s.releasedAt,
        s.cardCount,
        s.iconSvgUri,
        false,
      );
    }

    await client.query(
      `INSERT INTO sets
         (code, game, name, set_type, released_at, card_count, icon_svg_uri, digital)
       VALUES ${valuesClause(batch.length, columns)}
       ON CONFLICT (code) DO UPDATE SET
         game         = EXCLUDED.game,
         name         = EXCLUDED.name,
         set_type     = EXCLUDED.set_type,
         released_at  = EXCLUDED.released_at,
         card_count   = EXCLUDED.card_count,
         icon_svg_uri = EXCLUDED.icon_svg_uri`,
      values,
    );
  }
}

async function upsertOracles(
  client: Client,
  rows: CatalogOracle[],
): Promise<void> {
  const columns = 6;
  for (const batch of chunk(rows)) {
    const values: unknown[] = [];
    for (const o of batch) {
      values.push(
        o.oracleId,
        o.game,
        o.name,
        o.typeLine,
        o.oracleText,
        o.gameData === null ? null : JSON.stringify(o.gameData),
      );
    }

    await client.query(
      `INSERT INTO oracle_cards
         (oracle_id, game, name, type_line, oracle_text, game_data)
       VALUES ${valuesClause(batch.length, columns)}
       ON CONFLICT (oracle_id) DO UPDATE SET
         game        = EXCLUDED.game,
         name        = EXCLUDED.name,
         type_line   = EXCLUDED.type_line,
         oracle_text = EXCLUDED.oracle_text,
         game_data   = EXCLUDED.game_data`,
      values,
    );
  }
}

async function upsertPrintings(
  client: Client,
  rows: CatalogPrinting[],
): Promise<void> {
  const columns = 14;
  for (const batch of chunk(rows)) {
    const values: unknown[] = [];
    for (const p of batch) {
      values.push(
        p.id,
        p.game,
        p.externalId,
        p.oracleId,
        p.setCode,
        p.collectorNumber,
        p.collectorNumberNum,
        p.name,
        p.rarity,
        p.finishes,
        p.imageUrl,
        p.artUrl,
        p.releasedAt,
        p.usdCents,
      );
    }

    await client.query(
      `INSERT INTO printings
         (scryfall_id, game, external_id, oracle_id, set_code,
          collector_number, collector_number_num, name, rarity, finishes,
          image_url, art_url, released_at, usd_cents)
       VALUES ${valuesClause(batch.length, columns)}
       ON CONFLICT (scryfall_id) DO UPDATE SET
         game                 = EXCLUDED.game,
         external_id          = EXCLUDED.external_id,
         oracle_id            = EXCLUDED.oracle_id,
         set_code             = EXCLUDED.set_code,
         collector_number     = EXCLUDED.collector_number,
         collector_number_num = EXCLUDED.collector_number_num,
         name                 = EXCLUDED.name,
         rarity               = EXCLUDED.rarity,
         finishes             = EXCLUDED.finishes,
         image_url            = EXCLUDED.image_url,
         art_url              = EXCLUDED.art_url,
         released_at          = EXCLUDED.released_at,
         usd_cents            = EXCLUDED.usd_cents`,
      values,
    );
  }
}

/**
 * Write one game's whole catalog, in one transaction.
 *
 * In dependency order, and atomically: a printing whose set or oracle card
 * failed to load would otherwise become an orphan that only shows up later
 * as a card mysteriously absent from a set. Rolling the whole run back
 * instead means a failed ingest leaves yesterday's catalog intact, which is
 * always the better of the two outcomes for data nobody can retype.
 */
export async function upsertCatalog(
  client: Client,
  batch: CatalogBatch,
): Promise<void> {
  await client.query("BEGIN");
  try {
    await upsertSets(client, batch.sets);
    await upsertOracles(client, batch.oracles);
    await upsertPrintings(client, batch.printings);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

/**
 * Collapses oracle rows that several printings share.
 *
 * Every printing projects its own oracle row — forty Pikachus produce forty
 * copies of one card — and inserting all of them would make the statement
 * hit the same primary key many times over, which Postgres rejects outright
 * ("ON CONFLICT DO UPDATE command cannot affect row a second time").
 *
 * The last one wins, and the ingests feed sets in release order, so the
 * surviving text is the most recent printing's. That is the right choice for
 * a card whose wording was revised.
 */
export function dedupeOracles(rows: CatalogOracle[]): CatalogOracle[] {
  const byId = new Map<string, CatalogOracle>();
  for (const row of rows) byId.set(row.oracleId, row);
  return [...byId.values()];
}

/** The same, for printings: a catalog that lists a card twice is not an error. */
export function dedupePrintings(rows: CatalogPrinting[]): CatalogPrinting[] {
  const byId = new Map<string, CatalogPrinting>();
  for (const row of rows) byId.set(row.id, row);
  return [...byId.values()];
}
