import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { LocationsManager } from "@/components/locations-manager";
import { requireUser } from "@/lib/auth/dal";
import { LOCATION_EXPLAINER } from "@/lib/collection/constants";
import { listLocations } from "@/lib/collection/queries";

export const metadata = { title: "Locations · MagicTracker" };

export default async function LocationsPage() {
  await requireUser();
  const locations = await listLocations();

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader current="collection" />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Locations</h1>
          <Link
            href="/collection"
            className="text-sm text-muted underline underline-offset-4 hover:text-foreground"
          >
            Back to collection
          </Link>
        </div>

        <p className="mt-2 text-sm text-muted">
          {LOCATION_EXPLAINER} Every card starts in{" "}
          <span className="text-foreground">Unsorted</span> — the catch-all this
          app seeds — until you file it somewhere else. The kind is a label for
          you; nothing in the app behaves differently because of it, except that
          a new deck box is what a precon is filed into.
        </p>

        <div className="mt-6">
          <LocationsManager locations={locations} />
        </div>
      </main>
    </div>
  );
}
