import { PageSkeleton, Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <PageSkeleton current="import" title="Import" width="max-w-3xl">
      <Skeleton className="h-48 w-full rounded-lg" />
    </PageSkeleton>
  );
}
