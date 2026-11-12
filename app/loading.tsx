import { Skeleton } from "@/components/skeleton";

/**
 * The root fallback, used by any route without its own.
 *
 * No navigation in it: this one also covers the public share page and the
 * login screen, neither of which has the app header, and showing a signed-in
 * nav to someone following a share link would be wrong.
 */
export default function Loading() {
  return (
    <main
      className="mx-auto w-full max-w-4xl flex-1 px-4 py-8"
      aria-busy="true"
      aria-live="polite"
    >
      <Skeleton className="h-8 w-48" />
      <span className="sr-only">Loading…</span>
      <Skeleton className="mt-6 h-32 w-full rounded-lg" />
      <Skeleton className="mt-4 h-4 w-2/3" />
      <Skeleton className="mt-2 h-4 w-1/2" />
    </main>
  );
}
