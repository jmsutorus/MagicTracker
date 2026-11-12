import { PageSkeleton, Skeleton, TableSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <PageSkeleton current="cards">
      <div className="flex flex-col gap-6 sm:flex-row">
        {/* The card's own 488×680 ratio, so the image does not shove the
            text down the page when it decodes. */}
        <Skeleton className="aspect-[488/680] w-[244px] shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="mt-3 h-4 w-1/2" />
          <Skeleton className="mt-5 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-3/4" />
        </div>
      </div>
      <div className="mt-8">
        <TableSkeleton rows={5} />
      </div>
    </PageSkeleton>
  );
}
