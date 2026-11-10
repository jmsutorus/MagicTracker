/**
 * Manual search check against the real card database: `npx tsx scripts/search-smoke.ts`
 *
 * Not a unit test — it needs a loaded database. It exists because the search
 * query composes conditional `sql` fragments, which typecheck fine but can
 * still produce invalid SQL, and because ranking quality is a judgement call
 * best seen with real card names.
 */
import { config } from "dotenv";

config({ path: ".env.local" });

const CASES = [
  "li", // 2 chars: prefix tier only
  "lightn", // prefix
  "lightning bolt", // exact
  "lightnig bolt", // typo -> trigram tier
  "sol ring",
  "atraxa",
  "jace, the mind", // partial, with punctuation
  "counterspel", // typo
  "zzzzzznotacard",
];

async function main() {
  const { searchCards, ensureSimilarityThreshold } = await import(
    "../lib/cards/search"
  );

  await ensureSimilarityThreshold();

  for (const q of CASES) {
    const started = Date.now();
    const results = await searchCards(q, 5);
    const ms = Date.now() - started;

    console.log(`\n"${q}"  ->  ${results.length} results in ${ms}ms`);
    for (const r of results) {
      console.log(
        `   ${r.name.padEnd(38).slice(0, 38)} ${String(r.printingCount).padStart(3)} printings  ${r.newestSetCode}`,
      );
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
