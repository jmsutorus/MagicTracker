import { PageSkeleton, Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <PageSkeleton current="cards" title="Cards" width="max-w-2xl">
      <Skeleton className="h-12 w-full rounded-lg" />
    </PageSkeleton>
  );
}
