import { AppHeader } from "@/components/app-header";

/**
 * Loading placeholders.
 *
 * Why these exist at all: every page in this app is an async server component
 * reading the signed-in user's own data out of Postgres, and the free Neon
 * compute suspends after five minutes idle. Without a `loading.tsx` the
 * router has nothing to show during that wait, so Next holds the *old* page
 * on screen and the click appears to have done nothing — which is exactly
 * what a first-time visitor reads as "this is broken", and what the sites
 * this one is compared against never do.
 *
 * The shapes deliberately echo the real layout rather than being one generic
 * spinner. A skeleton that lands where the content lands reads as the page
 * arriving; a centred spinner reads as a wait, and then the content jumps.
 */

export function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`skeleton block ${className}`} />;
}

/**
 * The frame every signed-in route shares: the real header, so the navigation
 * stays put and readable across the wait, over a skeleton of the page body.
 *
 * The header is rendered for real and not faked — it needs no data, so there
 * is no reason to show a grey bar where a working nav could be. Its links
 * work during the load, which also makes a slow page interruptible.
 */
export function PageSkeleton({
  current,
  title,
  children,
  width = "max-w-4xl",
}: {
  current?: Parameters<typeof AppHeader>[0]["current"];
  /** Printed for real: the destination is known before its data is. */
  title?: string;
  children?: React.ReactNode;
  width?: string;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <AppHeader current={current} />
      <main
        className={`mx-auto w-full ${width} flex-1 px-4 py-8`}
        /*
         * Announced once, politely: a screen reader gets "Loading" rather
         * than a silent page or a stream of empty boxes.
         */
        aria-busy="true"
        aria-live="polite"
      >
        {title ? (
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        ) : (
          <Skeleton className="h-8 w-48" />
        )}
        <span className="sr-only">Loading…</span>
        <div className="mt-6">{children}</div>
      </main>
    </div>
  );
}

/** A stat strip: the dashboard and most index pages open with one. */
export function StatsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="rounded-lg border border-border bg-surface px-4 py-3"
        >
          <Skeleton className="h-3 w-16" />
          <Skeleton className="mt-2 h-6 w-12" />
        </div>
      ))}
    </div>
  );
}

/** Rows in a bordered table, which is most of this app. */
export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-0"
        >
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-16 shrink-0" />
          <Skeleton className="hidden h-4 w-20 shrink-0 sm:block" />
          <Skeleton className="h-4 w-24 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/** Cards in the visual grid, at the same aspect ratio as a real card. */
export function CardGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="aspect-[488/680] w-full rounded-xl" />
      ))}
    </div>
  );
}

/** The bordered panels the dashboard and deck pages are built from. */
export function PanelSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <Skeleton className="h-3 w-24" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="mt-3 h-4" />
      ))}
    </div>
  );
}
