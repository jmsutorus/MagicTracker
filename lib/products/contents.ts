import { sql, type SQL } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { getDeck } from "@/lib/mtgjson/client";

import { isPreconFileName } from "./constants";
import { projectDeck, type PreconCardRow } from "./project";

/**
 * Filling in a product's card list, the first time anyone asks for it.
 *
 * The catalog (3,144 products) is ingested weekly; contents are not, because
 * MTGJSON's only wholesale sources for them are 176 MB and 253 MB downloads
 * and a collection needs a handful of products, not all of them. So a product
 * arrives with null contents and is filled on first open — one ~0.5 MB fetch,
 * cached in `precon_cards` from then on.
 *
 * After that first fetch a product page makes no network calls at all. The
 * weekly job is what refreshes a cached product when MTGJSON publishes a new
 * version; see scripts/ingest-products.ts.
 */

export type EnsureResult =
  | {
      ok: true;
      /** False when the cache already held it, which is the usual case. */
      fetched: boolean;
      cardCount: number;
      distinctCount: number;
      unidentifiedCount: number;
    }
  | { ok: false; error: string };

type ProductRow = {
  file_name: string;
  contents_fetched_at: string | null;
  card_count: number | null;
  distinct_count: number | null;
  unidentified_count: number | null;
};

/**
 * Writes a projected deck into `precon_cards`, replacing whatever was there.
 *
 * Delete-then-insert inside one transaction rather than an upsert: a card
 * dropped from a corrected product must disappear, and an upsert would leave
 * it behind forever. Nothing references `precon_cards`, so replacing rows
 * costs nothing — unlike `collection_items`, which may never be rebuilt this
 * way.
 */
async function writeContents(
  fileName: string,
  rows: PreconCardRow[],
  totals: {
    cardCount: number;
    distinctCount: number;
    unidentifiedCount: number;
  },
  version: string,
): Promise<void> {
  const db = getDb();

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`DELETE FROM precon_cards WHERE file_name = ${fileName}`,
    );

    if (rows.length > 0) {
      // One multi-row INSERT rather than a statement per card: a precon is
      // about 100 lines, and 100 round trips to Neon would dominate the time
      // the fetch itself takes.
      const values: SQL[] = rows.map(
        (r) => sql`(
          ${fileName},
          ${r.board},
          ${r.scryfallId}::uuid,
          ${r.cardName},
          ${r.mtgjsonSetCode},
          ${r.collectorNumber},
          ${r.quantity},
          ${r.isFoil},
          ${r.isEtched}
        )`,
      );

      await tx.execute(sql`
        INSERT INTO precon_cards
          (file_name, board, scryfall_id, card_name, mtgjson_set_code,
           collector_number, quantity, is_foil, is_etched)
        VALUES ${sql.join(values, sql`, `)}
      `);
    }

    await tx.execute(sql`
      UPDATE precon_products
         SET card_count         = ${totals.cardCount},
             distinct_count     = ${totals.distinctCount},
             unidentified_count = ${totals.unidentifiedCount},
             contents_version   = ${version},
             contents_fetched_at = now(),
             updated_at         = now()
       WHERE file_name = ${fileName}
    `);
  });
}

/**
 * Fetches and stores one product's contents unconditionally.
 *
 * Used by the weekly job to refresh a product already in the cache. Callers
 * serving a page should use `ensureProductContents`, which does nothing when
 * the cache is already warm.
 */
export async function refreshProductContents(
  fileName: string,
): Promise<EnsureResult> {
  if (!isPreconFileName(fileName)) {
    return { ok: false, error: "Unknown product." };
  }

  try {
    const { meta, deck } = await getDeck(fileName);
    const projected = projectDeck(deck);

    await writeContents(
      fileName,
      projected.rows,
      projected,
      meta?.version ?? "unknown",
    );

    return {
      ok: true,
      fetched: true,
      cardCount: projected.cardCount,
      distinctCount: projected.distinctCount,
      unidentifiedCount: projected.unidentifiedCount,
    };
  } catch (error) {
    console.error(`products: could not load contents for ${fileName}`, error);
    return {
      ok: false,
      error:
        "Could not load this product's card list from MTGJSON. " +
        "Try again in a moment.",
    };
  }
}

/**
 * The card list for a product, fetching it only if it is not cached yet.
 */
export async function ensureProductContents(
  fileName: string,
): Promise<EnsureResult> {
  if (!isPreconFileName(fileName)) {
    return { ok: false, error: "Unknown product." };
  }

  const db = getDb();

  const { rows } = await db.execute<ProductRow>(sql`
    SELECT file_name,
           contents_fetched_at::text AS contents_fetched_at,
           card_count, distinct_count, unidentified_count
      FROM precon_products
     WHERE file_name = ${fileName}
  `);

  const product = rows[0];
  if (!product) return { ok: false, error: "Unknown product." };

  if (product.contents_fetched_at !== null) {
    return {
      ok: true,
      fetched: false,
      cardCount: product.card_count ?? 0,
      distinctCount: product.distinct_count ?? 0,
      unidentifiedCount: product.unidentified_count ?? 0,
    };
  }

  return refreshProductContents(fileName);
}
