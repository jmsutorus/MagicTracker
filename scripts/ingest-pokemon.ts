/**
 * Pokémon catalog ingest.  `npm run ingest:pokemon [-- --set <id>]`
 *
 * Shape of the job:
 *   1. Fetch the set index (one small file).
 *   2. Fetch one card file per set, oldest first.
 *   3. Project each card onto the shared sets/oracle_cards/printings rows.
 *   4. Upsert the lot inside one transaction.
 *
 * The same three rules the Scryfall ingest honors apply, for the same
 * reasons:
 *
 *   - BULK, never crawl. One request per set, not one per card.
 *   - UPSERT, never truncate. `collection_items` references `printings`.
 *   - Use the UNPOOLED connection, because a long transaction behaves badly
 *     through PgBouncer's transaction pooling.
 *
 * `--set <id>` loads a single set, for checking one release without a full
 * run. Everything else about the run is identical, including the transaction.
 */
import { config } from "dotenv";
import { Client } from "pg";

import {
  dedupeOracles,
  dedupePrintings,
  upsertCatalog,
  type CatalogOracle,
  type CatalogPrinting,
  type CatalogSet,
} from "../lib/games/catalog";
import { getAllSets, getSetCards } from "../lib/pokemon/client";
import { projectCard, projectSet } from "../lib/pokemon/project";

config({ path: ".env.local" });

const ONLY_SET = (() => {
  const i = process.argv.indexOf("--set");
  return i >= 0 ? process.argv[i + 1] : null;
})();

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

async function main(): Promise<void> {
  const connectionString =
    process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL_UNPOOLED (or DATABASE_URL) must be set. See .env.example.",
    );
  }

  const client = new Client({ connectionString });
  await client.connect();

  let runId: string | null = null;

  try {
    const { rows: runRows } = await client.query<{ id: string }>(
      `INSERT INTO ingest_runs (source, status) VALUES ('pokemon', 'running')
       RETURNING id`,
    );
    runId = runRows[0].id;

    log("loading set index...");
    const allSets = await getAllSets();
    const sets = ONLY_SET
      ? allSets.filter((s) => s.id === ONLY_SET)
      : [...allSets];

    if (sets.length === 0) {
      throw new Error(
        ONLY_SET
          ? `No set with id "${ONLY_SET}". Check sets/en.json for the spelling.`
          : "The set index came back empty.",
      );
    }

    /*
     * Oldest first, which is what makes the oracle dedupe correct: several
     * hundred printings of Pikachu all produce an oracle row, only the last
     * survives, and "last" should mean the most recent wording.
     */
    sets.sort((a, b) => (a.releaseDate ?? "").localeCompare(b.releaseDate ?? ""));

    const setRows: CatalogSet[] = [];
    const oracleRows: CatalogOracle[] = [];
    const printingRows: CatalogPrinting[] = [];

    const warnings: unknown[] = [];
    let emptySets = 0;

    for (const [index, set] of sets.entries()) {
      const cards = await getSetCards(set.id);

      if (cards.length === 0) {
        emptySets += 1;
        warnings.push({ reason: "set_has_no_cards", set: set.id });
        continue;
      }

      setRows.push({ ...projectSet(set), cardCount: cards.length });

      for (const card of cards) {
        const { oracle, printing } = projectCard(card, set);
        oracleRows.push(oracle);
        printingRows.push(printing);
      }

      if ((index + 1) % 25 === 0 || index === sets.length - 1) {
        log(
          `  ${index + 1}/${sets.length} sets · ${printingRows.length.toLocaleString()} cards`,
        );
      }
    }

    if (emptySets > 0) {
      log(`  NOTE: ${emptySets} listed sets have no card file yet; skipped`);
    }

    const oracles = dedupeOracles(oracleRows);
    const printings = dedupePrintings(printingRows);

    log(
      `upserting ${setRows.length} sets, ${oracles.length.toLocaleString()} cards, ` +
        `${printings.length.toLocaleString()} printings...`,
    );

    await upsertCatalog(client, {
      sets: setRows,
      oracles,
      printings,
    });

    await client.query(
      `UPDATE ingest_runs
          SET status = 'ok', finished_at = now(), row_count = $2, warnings = $3
        WHERE id = $1`,
      [runId, printings.length, warnings.length ? JSON.stringify(warnings) : null],
    );

    const { rows: counts } = await client.query<{
      sets: string;
      printings: string;
    }>(
      `SELECT (SELECT count(*) FROM sets WHERE game = 'pokemon')::text      AS sets,
              (SELECT count(*) FROM printings WHERE game = 'pokemon')::text AS printings`,
    );

    log(
      `done: ${counts[0].sets} Pokémon sets, ${counts[0].printings} printings in the database`,
    );
  } catch (error) {
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
  console.error("\npokemon ingest failed:", error);
  process.exit(1);
});
