import { PageSkeleton, Skeleton, TableSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <PageSkeleton current="products">
      <Skeleton className="h-24 w-full rounded-lg" />
      <div className="mt-6">
        <TableSkeleton rows={10} />
      </div>
    </PageSkeleton>
  );
}
