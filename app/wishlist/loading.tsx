import { PageSkeleton, StatsSkeleton, TableSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <PageSkeleton current="wishlist" title="Wishlist">
      <StatsSkeleton count={2} />
      <div className="mt-6">
        <TableSkeleton rows={6} />
      </div>
    </PageSkeleton>
  );
}
