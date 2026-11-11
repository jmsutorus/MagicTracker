/**
 * Weekly price snapshot.  `npm run ingest:prices [-- --force]`
 *
 * Shape of the job:
 *   1. Read the distinct (printing, finish) pairs present in the collection.
 *   2. Ask Scryfall for those printings, 75 at a time.
 *   3. Upsert one `price_snapshots` row per priced pair, dated today.
 *   4. Record the collection's total in `value_snapshots`.
 *
 * What it deliberately does not do: price all 110k printings. PLAN.md §6 is
 * blunt about it — 110k rows a week would exhaust the 1 GB plan within
 * months, and nobody needs a price history for a card they do not own. This
 * costs a few hundred rows a week and a handful of HTTP requests.
 *
 * It also deliberately does not download the bulk file. `POST
 * /cards/collection` is the endpoint Scryfall provides for looking up a known
 * list of printings, and fetching 77 MB weekly to read a few hundred prices
 * out of it would be the wasteful choice, not the polite one.
 *
 * Three rules, same as the other ingests:
 *
 *   - UPSERT, never truncate. The history is the whole point; replacing it
 *     weekly would leave a chart with one point on it.
 *   - Never write to a human-owned table. This reads `collection_items` and
 *     writes `price_snapshots`, `value_snapshots` and `ingest_runs`, and
 *     nothing else.
 *   - A pair with no price is counted and reported, never stored as zero. A
 *     total that quietly treats unpriced cards as free is worse than one that
 *     says how much it could not see.
 *
 * Unlike the other two it has no `--force`-able early exit: there is no
 * upstream version to compare against, and a second run on the same day just
 * updates that day's rows. `--force` is accepted and ignored so the scheduled
 * job can pass one set of arguments to all three.
 */
import { config } from "dotenv";
import { sql } from "drizzle-orm";

config({ path: ".env.local" });

/**
 * Use the direct endpoint, like the other ingests do.
 *
 * lib/db reads DATABASE_URL, which in the app is Neon's pooled (`-pooler`)
 * host. Set here, before lib/db is imported below, because it reads the
 * variable on first use.
 */
if (process.env.DATABASE_URL_UNPOOLED) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;
} else if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL_UNPOOLED (or DATABASE_URL) must be set.");
} else {
  console.warn(
    "WARNING: DATABASE_URL_UNPOOLED is not set; using the pooled endpoint.",
  );
}

function log(message: string): void {
  console.log(`[prices] ${message}`);
}

async function main(): Promise<void> {
  const { getDb } = await import("../lib/db");
  const { takeSnapshot } = await import("../lib/prices/snapshot");
  const { formatCents } = await import("../lib/prices/constants");

  const db = getDb();

  const { rows: runRows } = await db.execute<{ id: string }>(sql`
    INSERT INTO ingest_runs (source, status)
    VALUES ('prices', 'running')
    RETURNING id::text AS id
  `);
  const runId = runRows[0].id;

  try {
    const result = await takeSnapshot();

    if (result.owned === 0) {
      log("the collection is empty; recorded a zero and stopped");
    } else {
      log(
        `${result.priced} of ${result.owned} owned printing/finish pairs priced`,
      );
      log(
        `collection value on ${result.snapshotDate}: ` +
          `${formatCents(result.totalCents)} across ${result.pricedCopies} copies`,
      );
    }

    /*
     * Coverage, spelled out. These are the two ways a total can be understated
     * and neither is an error, so they are warnings on the run rather than a
     * failure — but they must be visible, because a value that silently omits
     * part of the collection is the failure mode that matters here.
     */
    const warnings: unknown[] = [];

    if (result.unpricedCopies > 0) {
      log(
        `${result.unpricedCopies} copies (${result.unpriced.length} printing/finish pairs) ` +
          "had no price and are not in the total",
      );
      warnings.push({
        kind: "unpriced",
        copies: result.unpricedCopies,
        pairs: result.unpriced.slice(0, 50),
      });
    }

    if (result.notFound.length > 0) {
      // A printing id the card database has but Scryfall does not: almost
      // always a printing that was merged or removed upstream.
      log(
        `${result.notFound.length} printing(s) are not in Scryfall any more: ` +
          result.notFound.slice(0, 5).join(", "),
      );
      warnings.push({ kind: "not-in-scryfall", ids: result.notFound });
    }

    await db.execute(sql`
      UPDATE ingest_runs
         SET status = 'ok', finished_at = now(), row_count = ${result.priced},
             warnings = ${warnings.length > 0 ? JSON.stringify(warnings) : null}
       WHERE id = ${runId}::uuid
    `);

    const { rows: counts } = await db.execute<{
      snapshots: number;
      days: number;
    }>(sql`
      SELECT (SELECT count(*) FROM price_snapshots)::int AS snapshots,
             (SELECT count(*) FROM value_snapshots)::int AS days
    `);
    log(
      `done: ${counts[0].snapshots} price rows over ${counts[0].days} snapshot date(s)`,
    );
  } catch (error) {
    await db.execute(sql`
      UPDATE ingest_runs
         SET status = 'failed', finished_at = now(),
             error = ${error instanceof Error ? error.message : String(error)}
       WHERE id = ${runId}::uuid
    `);
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nprice ingest failed:", error);
    process.exit(1);
  });
