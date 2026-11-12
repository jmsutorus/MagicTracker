import { PageSkeleton, Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <PageSkeleton current="collection" title="Add cards" width="max-w-3xl">
      <Skeleton className="h-10 w-full rounded-lg" />
      <Skeleton className="mt-3 h-24 w-full rounded-lg" />
    </PageSkeleton>
  );
}
