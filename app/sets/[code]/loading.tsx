import { PageSkeleton, Skeleton, TableSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <PageSkeleton current="sets">
      <Skeleton className="h-28 w-full rounded-lg" />
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
      <div className="mt-8">
        <TableSkeleton rows={10} />
      </div>
    </PageSkeleton>
  );
}
