import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { LocationsManager } from "@/components/locations-manager";
import { requireUser } from "@/lib/auth/dal";
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
          Where cards physically are. Every card has one, so entry defaults to{" "}
          <span className="text-foreground">Unsorted</span> until you file it.
        </p>

        <div className="mt-6">
          <LocationsManager locations={locations} />
        </div>
      </main>
    </div>
  );
}
