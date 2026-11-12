import { PageSkeleton, TableSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <PageSkeleton current="sets" title="Sets">
      <TableSkeleton rows={12} />
    </PageSkeleton>
  );
}
