/**
 * One Piece catalog ingest.  `npm run ingest:onepiece`
 *
 * Shape of the job:
 *   1. Fetch the booster index and the starter-deck index.
 *   2. Fetch one card list per release — 23 boosters plus 35 decks.
 *   3. Project each card onto the shared sets/oracle_cards/printings rows.
 *   4. Upsert the lot inside one transaction.
 *
 * Same three rules as the other two ingests: bulk rather than card-by-card,
 * upsert rather than truncate, and the unpooled connection for the
 * transaction. See scripts/ingest-cards.ts for why each one matters.
 *
 * Unlike the Pokémon run, this one also brings prices: the source publishes a
 * daily market price per card, which lands in `printings.usd_cents` and makes
 * One Piece cards count toward the collection's value.
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
import {
  getAllDecks,
  getAllSets,
  getSetCards,
  type OnePieceCard,
} from "../lib/onepiece/client";
import { projectCard, projectSet } from "../lib/onepiece/project";

config({ path: ".env.local" });

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

type Release = { id: string; name: string; kind: "set" | "deck" };

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
      `INSERT INTO ingest_runs (source, status) VALUES ('onepiece', 'running')
       RETURNING id`,
    );
    runId = runRows[0].id;

    log("loading release index...");
    const [boosters, decks] = await Promise.all([getAllSets(), getAllDecks()]);

    const releases: Release[] = [
      ...boosters.map((s) => ({
        id: s.set_id,
        name: s.set_name,
        kind: "set" as const,
      })),
      ...decks.map((d) => ({
        id: d.structure_deck_id,
        name: d.structure_deck_name,
        kind: "deck" as const,
      })),
    ];

    if (releases.length === 0) {
      throw new Error("Both release indexes came back empty.");
    }

    const setRows: CatalogSet[] = [];
    const oracleRows: CatalogOracle[] = [];
    const printingRows: CatalogPrinting[] = [];

    const warnings: unknown[] = [];
    let emptyReleases = 0;

    for (const [index, release] of releases.entries()) {
      let cards: OnePieceCard[];
      try {
        cards = await getSetCards(release.id, release.kind);
      } catch (error) {
        /*
         * One release failing does not fail the run. These are community
         * endpoints and an occasional 500 on one product is not a reason to
         * discard the other fifty-seven; the warning is recorded on the
         * ingest run so a gap is visible rather than silent.
         */
        warnings.push({
          reason: "release_fetch_failed",
          release: release.id,
          error: error instanceof Error ? error.message : String(error),
        });
        log(`  WARN: ${release.id} failed to load; continuing`);
        continue;
      }

      if (cards.length === 0) {
        emptyReleases += 1;
        warnings.push({ reason: "release_has_no_cards", release: release.id });
        continue;
      }

      setRows.push(
        projectSet(release.id, release.name, release.kind, cards.length),
      );

      for (const card of cards) {
        const { oracle, printing } = projectCard(card);
        oracleRows.push(oracle);
        printingRows.push(printing);
      }

      if ((index + 1) % 10 === 0 || index === releases.length - 1) {
        log(
          `  ${index + 1}/${releases.length} releases · ${printingRows.length.toLocaleString()} cards`,
        );
      }
    }

    if (emptyReleases > 0) {
      log(`  NOTE: ${emptyReleases} listed releases have no cards yet; skipped`);
    }

    const oracles = dedupeOracles(oracleRows);
    const printings = dedupePrintings(printingRows);

    log(
      `upserting ${setRows.length} releases, ${oracles.length.toLocaleString()} cards, ` +
        `${printings.length.toLocaleString()} printings...`,
    );

    await upsertCatalog(client, { sets: setRows, oracles, printings });

    await client.query(
      `UPDATE ingest_runs
          SET status = 'ok', finished_at = now(), row_count = $2, warnings = $3
        WHERE id = $1`,
      [runId, printings.length, warnings.length ? JSON.stringify(warnings) : null],
    );

    const { rows: counts } = await client.query<{
      sets: string;
      printings: string;
      priced: string;
    }>(
      `SELECT (SELECT count(*) FROM sets WHERE game = 'onepiece')::text      AS sets,
              (SELECT count(*) FROM printings WHERE game = 'onepiece')::text AS printings,
              (SELECT count(*) FROM printings
                WHERE game = 'onepiece' AND usd_cents IS NOT NULL)::text     AS priced`,
    );

    log(
      `done: ${counts[0].sets} One Piece releases, ${counts[0].printings} printings ` +
        `(${counts[0].priced} priced) in the database`,
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
  console.error("\none piece ingest failed:", error);
  process.exit(1);
});
