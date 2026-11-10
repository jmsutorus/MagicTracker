import { sql } from "drizzle-orm";

import { AppHeader } from "@/components/app-header";
import { CardSearch } from "@/components/card-search";
import { requireUser } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";

async function getCardCounts() {
  try {
    const db = getDb();
    const { rows } = await db.execute<{
      printings: number;
      oracle_cards: number;
      sets: number;
    }>(sql`
      SELECT (SELECT count(*) FROM printings)::int    AS printings,
             (SELECT count(*) FROM oracle_cards)::int AS oracle_cards,
             (SELECT count(*) FROM sets)::int         AS sets
    `);
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export default async function CardsPage() {
  await requireUser();
  const counts = await getCardCounts();

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader current="cards" />

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Cards</h1>
        <p className="mt-2 text-sm text-muted">
          {counts
            ? `${counts.oracle_cards.toLocaleString()} cards across ${counts.printings.toLocaleString()} printings in ${counts.sets.toLocaleString()} sets.`
            : "Card database not loaded yet — run npm run ingest:cards."}
        </p>

        <div className="mt-6">
          <CardSearch />
        </div>
      </main>
    </div>
  );
}
