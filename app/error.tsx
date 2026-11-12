"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * The error boundary for every route under the root layout.
 *
 * Before this existed, an unhandled throw anywhere — most plausibly the
 * database being unreachable, since every page in this app opens with a query
 * — dropped the visitor on Next's default error screen: an unstyled page with
 * no navigation and no way back. One bad query looked like the whole app
 * falling over.
 *
 * The one failure worth naming explicitly is the database, because it is both
 * the likeliest and the one where "try again" genuinely works: the free Neon
 * compute suspends when idle, and a retry after a cold start usually
 * succeeds. So the retry button is the primary action, not a link home.
 *
 * Note the prop is `retry`, not `reset`, in this version of Next.
 */
export default function ErrorPage({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    // No error reporting service wired up; the server log is the record.
    console.error(error);
  }, [error]);

  /*
   * The message is shown, but never as the whole explanation. A Postgres
   * connection error reads like a stack trace, so it sits underneath a
   * sentence that says what to do about it.
   */
  const message =
    error instanceof Error ? error.message : "Something went wrong.";

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">
        That page didn&rsquo;t load
      </h1>

      <p className="mt-3 text-sm text-muted">
        Most often this is the database waking up — the free compute suspends
        after five minutes idle, and the first request after that can time out.
        Trying again usually works.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => retry()}
          className="cursor-pointer rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-contrast hover:opacity-90"
        >
          Try again
        </button>
        <Link
          href="/"
          className="text-sm text-muted underline underline-offset-4 hover:text-foreground"
        >
          Back to the dashboard
        </Link>
      </div>

      <details className="mt-8 rounded-lg border border-border bg-surface-muted px-4 py-3">
        <summary className="cursor-pointer text-sm text-muted">
          What went wrong
        </summary>
        <p className="mt-3 font-mono text-xs break-words text-bad">{message}</p>
      </details>
    </main>
  );
}
