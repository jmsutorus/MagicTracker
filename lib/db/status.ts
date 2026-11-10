import { sql } from "drizzle-orm";

import { getDb } from "./index";

export type DbStatus =
  | {
      reachable: true;
      serverVersion: string;
      pgTrgmInstalled: boolean;
      migrationsApplied: number;
      tables: string[];
      latencyMs: number;
    }
  | { reachable: false; error: string; latencyMs: number };

/**
 * Phase 0's acceptance test, rendered on the dashboard: can the app actually
 * reach Neon, did migrations land, and is the extension the Phase 1 search
 * design depends on present?
 */
export async function getDbStatus(): Promise<DbStatus> {
  const started = Date.now();

  try {
    const db = getDb();

    const { rows: versionRows } = await db.execute<{ version: string }>(
      sql`SELECT version() AS version`,
    );
    const version = versionRows[0]?.version ?? "unknown";

    const { rows: extRows } = await db.execute<{ installed: boolean }>(
      sql`SELECT EXISTS (
            SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'
          ) AS installed`,
    );

    const { rows: migrationRows } = await db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count
          FROM information_schema.tables
          WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'`,
    );

    let migrationsApplied = 0;
    if (migrationRows[0]?.count > 0) {
      const { rows } = await db.execute<{ count: number }>(
        sql`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`,
      );
      migrationsApplied = rows[0]?.count ?? 0;
    }

    const { rows: tableRows } = await db.execute<{ table_name: string }>(
      sql`SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
          ORDER BY table_name`,
    );

    return {
      reachable: true,
      // Trim the long build string down to "PostgreSQL 18.x".
      serverVersion: version.split(" ").slice(0, 2).join(" "),
      pgTrgmInstalled: extRows[0]?.installed ?? false,
      migrationsApplied,
      tables: tableRows.map((r) => r.table_name),
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    return {
      reachable: false,
      error: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - started,
    };
  }
}
