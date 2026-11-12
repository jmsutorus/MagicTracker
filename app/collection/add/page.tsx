import Link from "next/link";

import { AppFooter } from "@/components/app-footer";
import { AppHeader } from "@/components/app-header";
import { CollectionEntry } from "@/components/collection-entry";
import { requireUser } from "@/lib/auth/dal";
import { DEFAULT_LOCATION_NAME } from "@/lib/collection/constants";
import {
  getCollectionTotals,
  listEntrySets,
  listLocations,
} from "@/lib/collection/queries";

export const metadata = { title: "Add cards · MagicTracker" };

export default async function AddCardsPage() {
  await requireUser();

  const [locations, sets, totals] = await Promise.all([
    listLocations(),
    listEntrySets(),
    getCollectionTotals(),
  ]);

  // The migration seeds "Unsorted", so this normally finds it. Falling back to
  // the first location keeps the screen usable if it was renamed.
  const defaultLocation =
    locations.find((l) => l.name === DEFAULT_LOCATION_NAME) ?? locations[0];

  if (!defaultLocation) {
    return (
      <div className="flex flex-1 flex-col">
        <AppHeader current="collection" />
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
          <h1 className="text-2xl font-semibold tracking-tight">Add cards</h1>
          <p className="mt-3 text-sm text-bad">
            There are no locations to file cards into, so entry would have
            nowhere to put them. Create one on the{" "}
            <Link href="/collection/locations" className="underline">
              locations page
            </Link>
            .
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader current="collection" />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Add cards</h1>
          <p className="text-sm text-muted">
            {totals.totalCopies.toLocaleString()} card
            {totals.totalCopies === 1 ? "" : "s"} so far ·{" "}
            <Link href="/collection" className="underline underline-offset-4">
              browse
            </Link>
          </p>
        </div>

        <div className="mt-6">
          <CollectionEntry
            locations={locations}
            sets={sets}
            defaultLocationId={defaultLocation.id}
          />
        </div>
      </main>

      <AppFooter />
    </div>
  );
}
