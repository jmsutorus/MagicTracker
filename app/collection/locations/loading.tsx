import { PageSkeleton, TableSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <PageSkeleton current="collection" title="Locations" width="max-w-3xl">
      <TableSkeleton rows={4} />
    </PageSkeleton>
  );
}
