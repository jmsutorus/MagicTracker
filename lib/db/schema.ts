import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Phase 0 schema.
 *
 * The card database tables (sets / oracle_cards / printings / sealed products)
 * arrive in Phase 1 together with the ingest script. `ingest_runs` lands now
 * because it is what the ingest job checks to decide whether there is new bulk
 * data worth downloading, and because it proves the migration pipeline works
 * end to end.
 *
 * Ownership rule, enforced by convention and worth keeping: the ingest job may
 * TRUNCATE and rebuild machine-owned card tables, and must never write to the
 * human-owned tables (collection, decks, locations). See PLAN.md §5.
 */
export const ingestRuns = pgTable(
  "ingest_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** 'scryfall' | 'mtgjson' | 'prices' */
    source: text("source").notNull(),

    /** 'running' | 'ok' | 'failed' | 'skipped' */
    status: text("status").notNull(),

    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),

    rowCount: integer("row_count"),

    /**
     * Source versions. The ingest job compares these against the live bulk
     * metadata and exits early when nothing has changed, which is what keeps a
     * weekly cron from re-downloading 500 MB for no reason.
     */
    scryfallBulkUpdatedAt: timestamp("scryfall_bulk_updated_at", {
      withTimezone: true,
    }),
    mtgjsonVersion: text("mtgjson_version"),

    /**
     * Rows that could not be resolved, e.g. an MTGJSON precon card with no
     * matching Scryfall printing. Recorded rather than dropped so gaps on
     * brand-new products are visible instead of silent.
     */
    warnings: jsonb("warnings").$type<unknown[]>(),

    error: text("error"),
  },
  (table) => [index("ingest_runs_source_started_at_idx").on(table.source, table.startedAt)],
);

export type IngestRun = typeof ingestRuns.$inferSelect;
export type NewIngestRun = typeof ingestRuns.$inferInsert;
