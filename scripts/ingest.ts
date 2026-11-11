/**
 * The scheduled ingest, as the Cloud Run Job runs it.  `npm run ingest`
 *
 * Two independent jobs, in order:
 *   1. scripts/ingest-cards.ts    — Scryfall bulk cards (the big one).
 *   2. scripts/ingest-products.ts — the MTGJSON sealed-product catalog.
 *
 * They run as separate child processes rather than as imported functions, for
 * two reasons. The card ingest streams a ~500 MB expanded file and peaks
 * around 172 MB of heap; giving it its own process means that peak is
 * released before the second job starts, instead of both living under one
 * --max-old-space-size. And a crash in one cannot take the other's database
 * connection or exit handler with it.
 *
 * Neither job depends on the other. The card ingest does not need the product
 * catalog, and a product's cards resolve to printings through a LEFT JOIN at
 * query time rather than at ingest time — so a product ingested before its
 * cards exist starts working by itself once the cards arrive. That is why a
 * failure in the first job does not skip the second: both are attempted, both
 * are reported, and the exit code is non-zero if either failed.
 *
 * Arguments are passed through, so `--args=--force` on the Cloud Run Job
 * forces both.
 */
import { spawnSync } from "node:child_process";
const SCRIPTS = ["scripts/ingest-cards.ts", "scripts/ingest-products.ts"];

function main(): void {
  const args = process.argv.slice(2);
  const failed: string[] = [];

  for (const script of SCRIPTS) {
    console.log(`\n=== ${script} ${args.join(" ")} ===\n`);

    /*
     * `node --import tsx <script>`, rather than the tsx shim in
     * node_modules/.bin. That shim needs a shell on Windows, and under
     * cmd.exe a forward-slash path is not a command — so spawning it works
     * on Linux and fails on the machine this was written on. Node resolves a
     * bare `--import` specifier against the working directory, so this form
     * needs no path separators and no shell at all.
     */
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", script, ...args],
      { stdio: "inherit" },
    );

    if (result.error) {
      console.error(`${script} could not be started:`, result.error);
      failed.push(script);
      continue;
    }

    if (result.status !== 0) {
      console.error(
        `${script} exited with ${result.status ?? `signal ${result.signal}`}`,
      );
      failed.push(script);
    }
  }

  if (failed.length > 0) {
    console.error(`\ningest finished with failures: ${failed.join(", ")}`);
    process.exit(1);
  }

  console.log("\ningest finished: both jobs succeeded");
}

main();
