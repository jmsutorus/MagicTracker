import Link from "next/link";

import { AppHeader } from "@/components/app-header";

/**
 * 404.
 *
 * Reached by `notFound()` from the deck, set, card and product pages — all of
 * which call it on a malformed or unknown id — as well as by a mistyped URL.
 * The old behaviour was Next's bare default page, which gave no way onward;
 * the header alone is most of the fix.
 */
export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Not found</h1>
        <p className="mt-3 text-sm text-muted">
          There&rsquo;s nothing at this address. If you followed a link to a
          deck or a card, it may have been deleted since.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <Link
            href="/"
            className="rounded-lg bg-accent px-4 py-2.5 font-medium text-accent-contrast hover:opacity-90"
          >
            Dashboard
          </Link>
          <Link
            href="/cards"
            className="text-muted underline underline-offset-4 hover:text-foreground"
          >
            Search for a card
          </Link>
          <Link
            href="/collection"
            className="text-muted underline underline-offset-4 hover:text-foreground"
          >
            Your collection
          </Link>
        </div>
      </main>
    </div>
  );
}
