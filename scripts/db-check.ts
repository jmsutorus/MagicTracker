/**
 * Standalone connectivity check: `npm run db:check`
 *
 * Useful before touching the app — it tells you whether the problem is the
 * database, the connection string, or your code.
 */
import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const { getDbStatus } = await import("../lib/db/status");
  const status = await getDbStatus();

  if (!status.reachable) {
    console.error(`✗ unreachable after ${status.latencyMs} ms`);
    console.error(`  ${status.error}`);
    process.exitCode = 1;
    return;
  }

  console.log(`✓ reachable in ${status.latencyMs} ms`);
  console.log(`  server              ${status.serverVersion}`);
  console.log(
    `  pg_trgm             ${status.pgTrgmInstalled ? "installed" : "MISSING"}`,
  );
  console.log(`  migrations applied  ${status.migrationsApplied}`);
  console.log(`  tables              ${status.tables.join(", ") || "none"}`);

  if (!status.pgTrgmInstalled || status.migrationsApplied === 0) {
    console.error("\n✗ run `npm run db:migrate`");
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    // The pg pool holds the event loop open.
    process.exit(process.exitCode ?? 0);
  });
