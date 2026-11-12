import { AppFooter } from "@/components/app-footer";
import { AppHeader } from "@/components/app-header";
import { CardSearch } from "@/components/card-search";
import { requireUser } from "@/lib/auth/dal";

/**
 * Card search.
 *
 * This page used to open by reporting how many rows were in `printings`,
 * `oracle_cards` and `sets`, and — when the ingest had never run — by telling
 * whoever was looking to go and run `npm run ingest:cards`. Both are facts
 * about the installation rather than about Magic: nobody searching for Sol
 * Ring needs the size of the card database first, and nobody who is not the
 * person who deployed this can act on the second. An empty search simply
 * finds nothing, which says the same thing in the place it matters.
 */

export const metadata = { title: "Cards · MagicTracker" };

export default async function CardsPage() {
  await requireUser();

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader current="cards" />

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Cards</h1>

        <div className="mt-6">
          <CardSearch />
        </div>
      </main>

      <AppFooter />
    </div>
  );
}
