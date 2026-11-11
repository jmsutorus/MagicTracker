/**
 * MTGJSON sealed-product catalog ingest.  `npm run ingest:products [-- --force]`
 *
 * Shape of the job:
 *   1. Ask MTGJSON for the current version (`Meta.json`, a few bytes).
 *   2. Exit early if that version is the one we last ingested.
 *   3. Load `DeckList.json` (0.65 MB) and upsert `precon_products`.
 *   4. Re-fetch the contents of products already in the cache, since a new
 *      MTGJSON version may have corrected them.
 *
 * What it deliberately does not do: download `AllPrintings.json.gz` (176 MB)
 * or `AllDeckFiles.zip` (253 MB). MTGJSON publishes no file dedicated to
 * sealed products, so those are the only wholesale sources for deck contents,
 * and a collection needs the contents of the few products you own rather than
 * all 3,144. Contents are fetched per product, on first open, and cached.
 *
 * Three rules, same as the card ingest:
 *
 *   - UPSERT, never truncate. `precon_products` rows carry cached contents
 *     state, and replacing them would throw that away every week.
 *   - Never touch a human-owned table. This writes `precon_products`,
 *     `precon_cards` and `ingest_runs` and nothing else — in particular never
 *     `collection_items`, even though a product's cards are what gets added
 *     to it.
 *   - A product that vanishes upstream is retained and warned about, not
 *     deleted. `precon_cards` cascades from `precon_products`, so deleting
 *     would silently drop a card list you may have been looking at.
 */
import { config } from "dotenv";
import { sql } from "drizzle-orm";

config({ path: ".env.local" });

/**
 * Use the direct endpoint, like the card ingest does.
 *
 * lib/db reads DATABASE_URL, which in the app is Neon's pooled (`-pooler`)
 * host. A batch job wants the direct one instead: the contents refresh runs a
 * delete-and-insert inside one transaction, and PgBouncer's transaction
 * pooling handles long transactions badly. Set here, before lib/db is
 * imported below, because it reads the variable on first use.
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

const FORCE = process.argv.includes("--force");

/**
 * How many cached products to re-fetch in one run. Contents are only cached
 * for products someone opened, so in practice this is a handful; the cap
 * exists so that a future bulk-open cannot turn the weekly job into a
 * thousand sequential downloads.
 */
const MAX_CONTENT_REFRESHES = 50;

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

async function main(): Promise<void> {
  // Imported lazily so that `config()` above has already populated the
  // environment before lib/db reads DATABASE_URL.
  const [{ getDb }, mtgjson, { refreshProductContents }] = await Promise.all([
    import("../lib/db"),
    import("../lib/mtgjson/client"),
    import("../lib/products/contents"),
  ]);

  const db = getDb();
  const warnings: unknown[] = [];

  log("asking MTGJSON for its current version...");
  const meta = await mtgjson.getMeta();
  log(`MTGJSON ${meta.version} (${meta.date})`);

  const { rows: lastRows } = await db.execute<{ version: string | null }>(sql`
    SELECT mtgjson_version AS version
      FROM ingest_runs
     WHERE source = 'mtgjson' AND status = 'ok'
     ORDER BY started_at DESC
     LIMIT 1
  `);

  const last = lastRows[0]?.version ?? null;
  if (!FORCE && last === meta.version) {
    log(`already ingested ${meta.version}; nothing to do (use --force)`);
    await db.execute(sql`
      INSERT INTO ingest_runs (source, status, finished_at, mtgjson_version)
      VALUES ('mtgjson', 'skipped', now(), ${meta.version})
    `);
    return;
  }

  const { rows: runRows } = await db.execute<{
    id: string;
    started_at: string;
  }>(sql`
    INSERT INTO ingest_runs (source, status, mtgjson_version)
    VALUES ('mtgjson', 'running', ${meta.version})
    RETURNING id::text AS id, started_at::text AS started_at
  `);
  const runId = runRows[0].id;
  // The database's clock, not this machine's: it is what `updated_at = now()`
  // below is compared against, and the two must come from the same source.
  const runStartedAt = runRows[0].started_at;

  try {
    log("loading the deck catalog...");
    const { decks } = await mtgjson.getDeckList();
    log(`${decks.length} decks in the catalog`);

    // Validated rather than trusted: this runs unattended, and an entry that
    // lost its fileName would be a product with no primary key.
    const usable = decks.filter((d) => {
      const ok =
        typeof d?.fileName === "string" &&
        d.fileName.length > 0 &&
        typeof d.name === "string" &&
        d.name.length > 0 &&
        typeof d.code === "string" &&
        d.code.length > 0 &&
        typeof d.type === "string" &&
        d.type.length > 0;
      if (!ok) warnings.push({ reason: "unusable_catalog_entry", entry: d });
      return ok;
    });

    // Chunked because 3,144 rows is more placeholders than one statement
    // wants, and because a chunk is a natural progress unit.
    const CHUNK = 400;
    let upserted = 0;

    for (let i = 0; i < usable.length; i += CHUNK) {
      const chunk = usable.slice(i, i + CHUNK);

      const values = chunk.map(
        (d) => sql`(
          ${d.fileName},
          ${d.name},
          ${d.code},
          ${d.type},
          ${d.releaseDate && d.releaseDate.length > 0 ? d.releaseDate : null},
          ${d.source && d.source.length > 0 ? d.source : null}
        )`,
      );

      /*
       * The contents columns are absent from the DO UPDATE on purpose. A
       * weekly catalog refresh must not clear a cached card list: the refresh
       * of those happens below, deliberately and per product.
       */
      await db.execute(sql`
        INSERT INTO precon_products
          (file_name, name, mtgjson_set_code, product_type, released_at, source)
        VALUES ${sql.join(values, sql`, `)}
        ON CONFLICT (file_name) DO UPDATE
          SET name             = EXCLUDED.name,
              mtgjson_set_code = EXCLUDED.mtgjson_set_code,
              product_type     = EXCLUDED.product_type,
              released_at      = EXCLUDED.released_at,
              source           = EXCLUDED.source,
              updated_at       = now()
      `);

      upserted += chunk.length;
      log(`  upserted ${upserted}/${usable.length}`);
    }

    /*
     * Products no longer in the catalog. Retained, like stale printings.
     *
     * Found by timestamp rather than by a NOT IN over 3,144 file names:
     * every row the catalog still contains was just written with
     * `updated_at = now()`, so anything older than this run was not in it.
     */
    const { rows: staleRows } = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n
        FROM precon_products
       WHERE updated_at < ${runStartedAt}::timestamptz
    `);
    const stale = staleRows[0]?.n ?? 0;
    if (stale > 0) {
      warnings.push({ reason: "stale_products_retained", count: stale });
      log(`  NOTE: ${stale} products are no longer in the catalog; retained`);
    }

    // How many products have a Scryfall set to link to. Recorded because the
    // answer is not 100%: MTGJSON's Q01-Q08 Challenger codes match no
    // Scryfall set, and a sudden drop here would mean the join broke.
    const { rows: linkRows } = await db.execute<{
      linked: number;
      total: number;
    }>(sql`
      SELECT count(s.code)::int AS linked, count(*)::int AS total
        FROM precon_products p
        LEFT JOIN sets s ON s.mtgjson_code = p.mtgjson_set_code
    `);
    const { linked, total } = linkRows[0];
    log(`${linked}/${total} products link to a Scryfall set`);
    if (total - linked > 0) {
      warnings.push({ reason: "products_without_set", count: total - linked });
    }

    // Refresh the contents we already hold, since a new MTGJSON version may
    // have corrected a card list. Only products someone has opened have any.
    const { rows: cached } = await db.execute<{ file_name: string }>(sql`
      SELECT file_name
        FROM precon_products
       WHERE contents_fetched_at IS NOT NULL
         AND (contents_version IS NULL OR contents_version <> ${meta.version})
       ORDER BY contents_fetched_at
       LIMIT ${MAX_CONTENT_REFRESHES}
    `);

    if (cached.length > 0) {
      log(`refreshing ${cached.length} cached card list(s)...`);
      for (const { file_name } of cached) {
        const result = await refreshProductContents(file_name);
        if (!result.ok) {
          warnings.push({
            reason: "contents_refresh_failed",
            product: file_name,
          });
          log(`  WARN ${file_name}: ${result.error}`);
          continue;
        }
        log(
          `  ${file_name}: ${result.cardCount} cards` +
            (result.unidentifiedCount > 0
              ? `, ${result.unidentifiedCount} unidentified`
              : ""),
        );
      }
    }

    await db.execute(sql`
      UPDATE ingest_runs
         SET status = 'ok', finished_at = now(), row_count = ${upserted},
             warnings = ${warnings.length > 0 ? JSON.stringify(warnings) : null}
       WHERE id = ${runId}::uuid
    `);

    const { rows: counts } = await db.execute<{
      products: number;
      commander: number;
      with_contents: number;
      cards: number;
    }>(sql`
      SELECT (SELECT count(*) FROM precon_products)::int AS products,
             (SELECT count(*) FROM precon_products
               WHERE product_type = 'Commander Deck')::int AS commander,
             (SELECT count(*) FROM precon_products
               WHERE contents_fetched_at IS NOT NULL)::int AS with_contents,
             (SELECT count(*) FROM precon_cards)::int AS cards
    `);
    const c = counts[0];
    log(
      `done: ${c.products} products (${c.commander} Commander decks), ` +
        `${c.with_contents} with cached contents, ${c.cards} card rows`,
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
    console.error("\nproduct ingest failed:", error);
    process.exit(1);
  });
