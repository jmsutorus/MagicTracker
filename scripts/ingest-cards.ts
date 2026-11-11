/**
 * Scryfall bulk card ingest.  `npm run ingest:cards [-- --force]`
 *
 * Shape of the job:
 *   1. Ask Scryfall for the current `default_cards` bulk metadata.
 *   2. Exit early if that bulk file is the same one we last ingested.
 *   3. Load all sets (one small API call).
 *   4. Stream the ~500 MB card file, projecting each card and COPYing it into
 *      unlogged staging tables.
 *   5. Upsert staging into the live tables inside one transaction.
 *
 * Three rules this script exists to honor:
 *
 *   - STREAM, never buffer. `JSON.parse` on a 500 MB body would blow the heap.
 *   - UPSERT, never truncate. From Phase 2 `collection_items` references
 *     `printings`, so truncating would cascade into the record of cards you
 *     physically own.
 *   - Use the UNPOOLED connection. `COPY` and long transactions behave badly
 *     through PgBouncer's transaction pooling.
 */
import { once } from "node:events";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";

import { config } from "dotenv";
import { from as copyFrom } from "pg-copy-streams";
import { Client } from "pg";

import {
  bulkDownloadUri,
  bulkSize,
  getAllSets,
  getBulkDataEntry,
  openBulkStream,
} from "../lib/scryfall/client";
import {
  projectCard,
  type OracleRow,
  type PrintingRow,
  type ScryfallCard,
} from "../lib/scryfall/project";

config({ path: ".env.local" });

const FORCE = process.argv.includes("--force");
const PROGRESS_EVERY = 25_000;

// --- CSV serialization for COPY ... FROM STDIN WITH (FORMAT csv) ----------

/**
 * An unquoted empty field is NULL in CSV mode; `""` is an empty string. That
 * distinction is why nulls are not simply rendered as "".
 */
function csvText(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  return `"${value.replace(/"/g, '""')}"`;
}

function csvNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

function csvBool(value: boolean): string {
  return value ? "true" : "false";
}

/**
 * Postgres array literal, then CSV-quoted. Two layers of escaping: backslash
 * and double-quote are escaped for the array literal, then double-quotes are
 * doubled for CSV.
 */
function csvTextArray(values: string[] | null | undefined): string {
  if (values === null || values === undefined) return "";
  const inner = values
    .map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    .join(",");
  return csvText(`{${inner}}`);
}

function csvJson(value: unknown | null | undefined): string {
  if (value === null || value === undefined) return "";
  return csvText(JSON.stringify(value));
}

const PRINTING_COLUMNS = [
  "scryfall_id",
  "oracle_id",
  "set_code",
  "collector_number",
  "collector_number_num",
  "name",
  "rarity",
  "lang",
  "finishes",
  "is_booster",
  "is_promo",
  "is_variation",
  "frame_effects",
  "border_color",
  "full_art",
  "textless",
  "layout",
  "is_extra",
  "released_at",
  "tcgplayer_id",
  "image_status",
  "usd_cents",
  "usd_foil_cents",
  "usd_etched_cents",
] as const;

function printingToCsv(p: PrintingRow): string {
  return (
    [
      csvText(p.scryfallId),
      csvText(p.oracleId),
      csvText(p.setCode),
      csvText(p.collectorNumber),
      csvNumber(p.collectorNumberNum),
      csvText(p.name),
      csvText(p.rarity),
      csvText(p.lang),
      csvTextArray(p.finishes),
      csvBool(p.isBooster),
      csvBool(p.isPromo),
      csvBool(p.isVariation),
      csvTextArray(p.frameEffects),
      csvText(p.borderColor),
      csvBool(p.fullArt),
      csvBool(p.textless),
      csvText(p.layout),
      csvBool(p.isExtra),
      csvText(p.releasedAt),
      csvNumber(p.tcgplayerId),
      csvText(p.imageStatus),
      csvNumber(p.usdCents),
      csvNumber(p.usdFoilCents),
      csvNumber(p.usdEtchedCents),
    ].join(",") + "\n"
  );
}

const ORACLE_COLUMNS = [
  "oracle_id",
  "name",
  "mana_cost",
  "type_line",
  "oracle_text",
  "cmc",
  "colors",
  "color_identity",
  "keywords",
  "legalities",
  "reserved",
  "edhrec_rank",
  "layout",
] as const;

function oracleToCsv(o: OracleRow): string {
  return (
    [
      csvText(o.oracleId),
      csvText(o.name),
      csvText(o.manaCost),
      csvText(o.typeLine),
      csvText(o.oracleText),
      csvNumber(o.cmc),
      csvTextArray(o.colors),
      csvTextArray(o.colorIdentity),
      csvTextArray(o.keywords),
      csvJson(o.legalities),
      csvBool(o.reserved),
      csvNumber(o.edhrecRank),
      csvText(o.layout),
    ].join(",") + "\n"
  );
}

// --- helpers --------------------------------------------------------------

function log(message: string): void {
  const stamp = new Date().toISOString().slice(11, 19);
  console.log(`[${stamp}] ${message}`);
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

async function writeTo(
  stream: NodeJS.WritableStream,
  chunk: string,
): Promise<void> {
  if (!stream.write(chunk)) {
    await once(stream, "drain");
  }
}

// --- main -----------------------------------------------------------------

async function main(): Promise<void> {
  const connectionString =
    process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL_UNPOOLED (or DATABASE_URL) must be set.");
  }
  if (!process.env.DATABASE_URL_UNPOOLED) {
    log("WARNING: using the pooled connection; COPY may be slower or fail.");
  }

  const client = new Client({ connectionString, statement_timeout: 0 });
  await client.connect();

  let runId: string | null = null;

  try {
    // 1. What does Scryfall have?
    log("fetching bulk metadata...");
    const bulk = await getBulkDataEntry("default_cards");
    const compressed = bulkSize(bulk);
    log(
      `default_cards updated ${bulk.updated_at}` +
        (compressed === null ? "" : `, ${mb(compressed)} gzipped`),
    );

    // 2. Already ingested this exact file?
    const { rows: priorRows } = await client.query<{
      scryfall_bulk_updated_at: Date | null;
    }>(
      `SELECT scryfall_bulk_updated_at
         FROM ingest_runs
        WHERE source = 'scryfall' AND status = 'ok'
        ORDER BY started_at DESC
        LIMIT 1`,
    );

    const prior = priorRows[0]?.scryfall_bulk_updated_at;
    const bulkUpdatedAt = new Date(bulk.updated_at);

    if (prior && prior.getTime() === bulkUpdatedAt.getTime() && !FORCE) {
      log(
        `already ingested this bulk file (${bulk.updated_at}); nothing to do. Use --force to re-run.`,
      );
      await client.query(
        `INSERT INTO ingest_runs (source, status, finished_at, scryfall_bulk_updated_at)
         VALUES ('scryfall', 'skipped', now(), $1)`,
        [bulkUpdatedAt],
      );
      return;
    }

    const { rows: runRows } = await client.query<{ id: string }>(
      `INSERT INTO ingest_runs (source, status, scryfall_bulk_updated_at)
       VALUES ('scryfall', 'running', $1) RETURNING id`,
      [bulkUpdatedAt],
    );
    runId = runRows[0].id;

    const warnings: unknown[] = [];

    // 3. Sets — one small call, rather than deriving them from the card file.
    log("loading sets...");
    const sets = await getAllSets();
    await client.query(`
      CREATE UNLOGGED TABLE IF NOT EXISTS _staging_sets (LIKE sets);
      TRUNCATE _staging_sets;
    `);

    const setStream = client.query(
      copyFrom(
        `COPY _staging_sets (code, name, set_type, released_at, card_count,
                             parent_set_code, icon_svg_uri, digital, mtgjson_code)
         FROM STDIN WITH (FORMAT csv)`,
      ),
    );
    for (const s of sets) {
      await writeTo(
        setStream,
        [
          csvText(s.code),
          csvText(s.name),
          csvText(s.set_type),
          csvText(s.released_at ?? null),
          csvNumber(s.card_count ?? 0),
          csvText(s.parent_set_code ?? null),
          csvText(s.icon_svg_uri ?? null),
          csvBool(s.digital === true),
          // MTGJSON uses upper-case set codes; stored for the Phase 4 join.
          csvText(s.code.toUpperCase()),
        ].join(",") + "\n",
      );
    }
    setStream.end();
    await once(setStream, "finish");
    log(`staged ${sets.length} sets`);

    // 4. Stream the card file.
    log("streaming cards (this is the slow part)...");
    /*
     * Dropped and recreated rather than reused. These are LIKE the real
     * tables, so a staging table left behind by a crashed run has the column
     * set from *that* run; after a migration adds a column, IF NOT EXISTS
     * would quietly keep the old shape and the COPY would fail on a column
     * the real table has.
     */
    await client.query(`
      DROP TABLE IF EXISTS _staging_printings;
      CREATE UNLOGGED TABLE _staging_printings (LIKE printings);
      DROP TABLE IF EXISTS _staging_oracle;
      CREATE UNLOGGED TABLE _staging_oracle (LIKE oracle_cards);
    `);

    const webStream = await openBulkStream(bulkDownloadUri(bulk));
    const nodeStream = Readable.fromWeb(
      webStream as Parameters<typeof Readable.fromWeb>[0],
    );

    const printingStream = client.query(
      copyFrom(
        `COPY _staging_printings (${PRINTING_COLUMNS.join(", ")})
         FROM STDIN WITH (FORMAT csv)`,
      ),
    );

    /**
     * Oracle rows are deduped in memory rather than streamed, because one
     * Postgres connection can only run one COPY at a time. ~35k unique oracle
     * cards at roughly a kilobyte each is a few tens of MB — fine, and it
     * avoids downloading the 500 MB file twice.
     */
    const oracleById = new Map<string, OracleRow>();

    let seen = 0;
    let kept = 0;
    let skippedDigital = 0;
    let skippedNoOracle = 0;
    let malformed = 0;

    /**
     * Gzipped JSONL: gunzip, then one JSON object per line. readline pauses the
     * stream between iterations, so backpressure is handled for us and memory
     * stays flat regardless of file size.
     */
    const lines = createInterface({
      input: nodeStream.pipe(createGunzip()),
      crlfDelay: Infinity,
    });

    for await (const line of lines) {
      if (line.length === 0 || line === "[" || line === "]") continue;

      // Tolerate a trailing comma if the format ever reverts to a JSON array.
      const trimmed = line.endsWith(",") ? line.slice(0, -1) : line;

      let value: ScryfallCard;
      try {
        value = JSON.parse(trimmed) as ScryfallCard;
      } catch {
        malformed++;
        if (warnings.length < 50) {
          warnings.push({ reason: "unparseable_line", excerpt: trimmed.slice(0, 120) });
        }
        continue;
      }

      seen++;

      const projected = projectCard(value);
      if (!projected) {
        if (value.digital === true || !(value.games ?? ["paper"]).includes("paper")) {
          skippedDigital++;
        } else {
          skippedNoOracle++;
          if (warnings.length < 50) {
            warnings.push({
              reason: "no_oracle_id",
              id: value.id,
              name: value.name,
              layout: value.layout,
            });
          }
        }
        continue;
      }

      await writeTo(printingStream, printingToCsv(projected.printing));
      oracleById.set(projected.oracle.oracleId, projected.oracle);
      kept++;

      if (seen % PROGRESS_EVERY === 0) {
        const heap = process.memoryUsage().heapUsed;
        log(
          `  ${seen.toLocaleString()} seen, ${kept.toLocaleString()} kept, ` +
            `${oracleById.size.toLocaleString()} oracle cards, heap ${mb(heap)}`,
        );
      }
    }

    printingStream.end();
    await once(printingStream, "finish");
    log(
      `streamed ${seen.toLocaleString()} cards: kept ${kept.toLocaleString()}, ` +
        `skipped ${skippedDigital.toLocaleString()} digital-only, ` +
        `${skippedNoOracle} without an oracle id` +
        (malformed > 0 ? `, ${malformed} unparseable lines` : ""),
    );

    // Oracle rows, now that the printings COPY has finished.
    const oracleStream = client.query(
      copyFrom(
        `COPY _staging_oracle (${ORACLE_COLUMNS.join(", ")})
         FROM STDIN WITH (FORMAT csv)`,
      ),
    );
    for (const o of oracleById.values()) {
      await writeTo(oracleStream, oracleToCsv(o));
    }
    oracleStream.end();
    await once(oracleStream, "finish");
    log(`staged ${oracleById.size.toLocaleString()} oracle cards`);

    // 5. Upsert into live tables, in dependency order, atomically.
    log("upserting into live tables...");
    await client.query("BEGIN");

    await client.query(`
      INSERT INTO sets (code, name, set_type, released_at, card_count,
                        parent_set_code, icon_svg_uri, digital, mtgjson_code)
      SELECT code, name, set_type, released_at, card_count,
             parent_set_code, icon_svg_uri, digital, mtgjson_code
        FROM _staging_sets
      ON CONFLICT (code) DO UPDATE SET
        name = EXCLUDED.name,
        set_type = EXCLUDED.set_type,
        released_at = EXCLUDED.released_at,
        card_count = EXCLUDED.card_count,
        parent_set_code = EXCLUDED.parent_set_code,
        icon_svg_uri = EXCLUDED.icon_svg_uri,
        digital = EXCLUDED.digital,
        mtgjson_code = EXCLUDED.mtgjson_code
    `);

    await client.query(`
      INSERT INTO oracle_cards (${ORACLE_COLUMNS.join(", ")})
      SELECT DISTINCT ON (oracle_id) ${ORACLE_COLUMNS.join(", ")}
        FROM _staging_oracle
       ORDER BY oracle_id
      ON CONFLICT (oracle_id) DO UPDATE SET
        name = EXCLUDED.name,
        mana_cost = EXCLUDED.mana_cost,
        type_line = EXCLUDED.type_line,
        oracle_text = EXCLUDED.oracle_text,
        cmc = EXCLUDED.cmc,
        colors = EXCLUDED.colors,
        color_identity = EXCLUDED.color_identity,
        keywords = EXCLUDED.keywords,
        legalities = EXCLUDED.legalities,
        reserved = EXCLUDED.reserved,
        edhrec_rank = EXCLUDED.edhrec_rank,
        layout = EXCLUDED.layout
    `);

    /**
     * Reported for visibility only. (set_code, collector_number, lang) is not
     * unique in our schema, so duplicates are inserted rather than dropped —
     * but they are worth knowing about, since they usually mean upstream data
     * did something unusual.
     */
    const { rows: dupRows } = await client.query<{ count: string }>(`
      SELECT count(*)::text AS count FROM (
        SELECT set_code, collector_number, lang
          FROM _staging_printings
         GROUP BY set_code, collector_number, lang
        HAVING count(*) > 1
      ) d
    `);
    const dupGroups = Number(dupRows[0]?.count ?? 0);
    if (dupGroups > 0) {
      const { rows: examples } = await client.query(`
        SELECT set_code, collector_number, lang, count(*)::int AS n,
               array_agg(scryfall_id::text) AS ids
          FROM _staging_printings
         GROUP BY set_code, collector_number, lang
        HAVING count(*) > 1
         LIMIT 10
      `);
      warnings.push({ reason: "duplicate_set_collector_lang", groups: dupGroups, examples });
      log(
        `  NOTE: ${dupGroups} (set, collector_number, lang) groups have >1 printing; all retained`,
      );
    }

    const upsertResult = await client.query(`
      INSERT INTO printings (${PRINTING_COLUMNS.join(", ")})
      SELECT ${PRINTING_COLUMNS.join(", ")}
        FROM _staging_printings
      ON CONFLICT (scryfall_id) DO UPDATE SET
        oracle_id = EXCLUDED.oracle_id,
        set_code = EXCLUDED.set_code,
        collector_number = EXCLUDED.collector_number,
        collector_number_num = EXCLUDED.collector_number_num,
        name = EXCLUDED.name,
        rarity = EXCLUDED.rarity,
        lang = EXCLUDED.lang,
        finishes = EXCLUDED.finishes,
        is_booster = EXCLUDED.is_booster,
        is_promo = EXCLUDED.is_promo,
        is_variation = EXCLUDED.is_variation,
        frame_effects = EXCLUDED.frame_effects,
        border_color = EXCLUDED.border_color,
        full_art = EXCLUDED.full_art,
        textless = EXCLUDED.textless,
        layout = EXCLUDED.layout,
        is_extra = EXCLUDED.is_extra,
        released_at = EXCLUDED.released_at,
        tcgplayer_id = EXCLUDED.tcgplayer_id,
        image_status = EXCLUDED.image_status,
        usd_cents = EXCLUDED.usd_cents,
        usd_foil_cents = EXCLUDED.usd_foil_cents,
        usd_etched_cents = EXCLUDED.usd_etched_cents
    `);

    await client.query("COMMIT");
    log(`upserted ${upsertResult.rowCount?.toLocaleString() ?? "?"} printings`);

    /**
     * Printings we hold that are no longer in the bulk file. Reported, never
     * deleted: if a card vanishes from Scryfall and it is sitting in a binder,
     * deleting it would erase the record of something physically owned.
     */
    const { rows: staleRows } = await client.query<{ count: string }>(`
      SELECT count(*)::text AS count
        FROM printings p
       WHERE NOT EXISTS (
         SELECT 1 FROM _staging_printings s WHERE s.scryfall_id = p.scryfall_id
       )
    `);
    const stale = Number(staleRows[0]?.count ?? 0);
    if (stale > 0) {
      warnings.push({ reason: "stale_printings_retained", count: stale });
      log(`  NOTE: ${stale} printings are no longer in the bulk file; retained`);
    }

    await client.query(
      `UPDATE ingest_runs
          SET status = 'ok', finished_at = now(), row_count = $2,
              warnings = $3
        WHERE id = $1`,
      [runId, kept, warnings.length ? JSON.stringify(warnings) : null],
    );

    // Final tallies.
    const { rows: counts } = await client.query(`
      SELECT (SELECT count(*) FROM sets)         AS sets,
             (SELECT count(*) FROM oracle_cards) AS oracle_cards,
             (SELECT count(*) FROM printings)    AS printings,
             pg_size_pretty(pg_database_size(current_database())) AS db_size
    `);
    log(
      `done: ${counts[0].sets} sets, ${counts[0].oracle_cards} oracle cards, ` +
        `${counts[0].printings} printings, database ${counts[0].db_size}`,
    );

    await client.query(`
      DROP TABLE IF EXISTS _staging_sets;
      DROP TABLE IF EXISTS _staging_printings;
      DROP TABLE IF EXISTS _staging_oracle;
    `);
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Not in a transaction; nothing to roll back.
    }
    if (runId) {
      await client.query(
        `UPDATE ingest_runs
            SET status = 'failed', finished_at = now(), error = $2
          WHERE id = $1`,
        [runId, error instanceof Error ? error.message : String(error)],
      );
    }
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("\ningest failed:", error);
  process.exit(1);
});
