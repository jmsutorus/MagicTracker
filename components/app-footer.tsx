import Link from "next/link";

/**
 * The quiet end of every page.
 *
 * Two links and nothing else. What used to sit here was a paragraph
 * explaining what the export contains and a line printing the storage
 * bucket the last automatic backup was written to — both of which answer a
 * question nobody has while they are looking at their cards. The export is
 * still one click away; what it contains is the export's business.
 *
 * "Status" is the escape hatch for the one failure a page cannot report
 * itself: when the database is unreachable, every other page is empty or
 * wrong, and this is the link that still works.
 */
export function AppFooter() {
  return (
    <footer className="mx-auto w-full max-w-5xl px-4 pb-8">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border pt-4 text-xs text-muted">
        <a
          href="/api/export"
          className="underline underline-offset-4 hover:text-foreground"
        >
          Export a backup
        </a>
        <Link
          href="/status"
          className="underline underline-offset-4 hover:text-foreground"
        >
          Status
        </Link>
      </div>
    </footer>
  );
}
