import {
  PageSkeleton,
  StatsSkeleton,
  TableSkeleton,
} from "@/components/skeleton";

export default function Loading() {
  return (
    <PageSkeleton current="collection" title="Collection" width="max-w-5xl">
      <StatsSkeleton />
      <div className="mt-6">
        <TableSkeleton rows={10} />
      </div>
    </PageSkeleton>
  );
}
