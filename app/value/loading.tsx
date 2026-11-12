import { PageSkeleton, Skeleton, StatsSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <PageSkeleton current="value" title="Value">
      <StatsSkeleton count={3} />
      {/* The chart's own box, so the axis does not jump when it lands. */}
      <Skeleton className="mt-6 h-64 w-full rounded-lg" />
    </PageSkeleton>
  );
}
