import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

/**
 * One driver for both the app and the ingest scripts: node-postgres.
 *
 * Neon's *pooled* endpoint (the `-pooler` host) sits behind PgBouncer, which is
 * exactly what serverless containers want, and unlike the HTTP driver it
 * supports interactive transactions. Phase 4 (adding a whole precon) and
 * Phase 5 (saving a deck) both want to write many rows atomically.
 *
 * Connections are created lazily, on first query — deliberately.
 * `next build` evaluates modules while collecting page data, so connecting at
 * import time would make DATABASE_URL a *build-time* requirement and force the
 * database password into the build environment. Firebase App Hosting
 * distinguishes BUILD from RUNTIME secret availability, and credentials belong
 * only in RUNTIME. Staying lazy keeps builds credential-free.
 */
type Db = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as {
  __mtPool?: Pool;
  __mtDb?: Db;
};

function createPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    // Neon's free compute autosuspends after 5 minutes idle and takes a few
    // hundred ms to wake. Keep the pool small and let connections go.
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  });
}

export function getDb(): Db {
  if (globalForDb.__mtDb) return globalForDb.__mtDb;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Locally: copy .env.example to .env.local and " +
        "fill it in. On App Hosting: check the DATABASE_URL secret is bound " +
        "with RUNTIME availability in apphosting.yaml.",
    );
  }

  const pool = globalForDb.__mtPool ?? createPool(connectionString);
  const db = drizzle(pool, { schema });

  // Cached on globalThis rather than a module-local: in development this
  // survives hot reloads, which otherwise leak a pool per edit until Neon
  // starts refusing connections. In production it is simply the one instance.
  globalForDb.__mtPool = pool;
  globalForDb.__mtDb = db;

  return db;
}

export { schema };
