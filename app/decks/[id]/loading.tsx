import { CardGridSkeleton, PageSkeleton, Skeleton } from "@/components/skeleton";

/**
 * The heaviest page in the app: the deck, its legality verdict, what you own
 * of it, and the per-card collection availability. Worth its own shape — the
 * verdict panel and the card grid are what the eye goes to, so they are what
 * the skeleton holds space for.
 */
export default function Loading() {
  return (
    <PageSkeleton current="decks">
      <Skeleton className="h-32 w-full rounded-lg" />
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
      <div className="mt-8">
        <CardGridSkeleton count={8} />
      </div>
    </PageSkeleton>
  );
}
