import { PageSkeleton, TableSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <PageSkeleton current="products" title="Precons">
      <TableSkeleton rows={10} />
    </PageSkeleton>
  );
}
