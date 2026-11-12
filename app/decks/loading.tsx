import { PageSkeleton, Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <PageSkeleton current="decks" title="Decks">
      <div className="space-y-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-lg border border-border bg-surface px-4 py-3">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="mt-2 h-1.5 w-full rounded-full" />
            <Skeleton className="mt-2 h-3 w-24" />
          </div>
        ))}
      </div>
    </PageSkeleton>
  );
}
