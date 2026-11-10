import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { ProgressBar } from "@/components/progress-bar";
import { requireUser } from "@/lib/auth/dal";
import { listSetProgress, searchSets } from "@/lib/completion/queries";

export const metadata = { title: "Sets · MagicTracker" };

function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function SetsPage({
  searchParams,
}: {
  // Next 16: searchParams is a Promise.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();

  const params = await searchParams;
  const q = one(params.q)?.slice(0, 60) ?? "";

  const [progress, searchResults] = await Promise.all([
    listSetProgress(),
    q ? searchSets(q) : Promise.resolve([]),
  ]);

  const complete = progress.filter((p) => p.target > 0 && p.owned >= p.target);

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader current="sets" />

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Sets</h1>
        <p className="mt-2 text-sm text-muted">
          {progress.length === 0
            ? "Completion appears here once you own a card from a set."
            : `${progress.length} set${progress.length === 1 ? "" : "s"} with cards in your collection${complete.length > 0 ? `, ${complete.length} complete` : ""}.`}
        </p>

        <form className="mt-6 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">
              Look up any set, including ones you own nothing from
            </span>
            <input
              name="q"
              defaultValue={q}
              placeholder="Bloomburrow, or blb…"
              className="w-72 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent"
            />
          </label>
          <button
            type="submit"
            className="cursor-pointer rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm hover:text-foreground"
          >
            Search
          </button>
          {q ? (
            <Link
              href="/sets"
              className="py-2 text-sm text-muted underline underline-offset-4 hover:text-foreground"
            >
              Clear
            </Link>
          ) : null}
        </form>

        {q ? (
          <section className="mt-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              Search results
            </h2>
            {searchResults.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No set matches “{q}”.</p>
            ) : (
              <ul className="mt-2 overflow-hidden rounded-lg border border-border bg-surface">
                {searchResults.map((s) => (
                  <li
                    key={s.code}
                    className="border-b border-border last:border-0"
                  >
                    <Link
                      href={`/sets/${s.code}`}
                      className="flex items-baseline gap-3 px-4 py-2.5 text-sm hover:bg-surface-muted"
                    >
                      <span className="w-12 shrink-0 font-mono text-xs uppercase text-muted">
                        {s.code}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      <span className="shrink-0 text-xs text-muted">
                        {s.releasedAt?.slice(0, 4) ?? "—"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {progress.length > 0 ? (
          <section className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              Your sets
            </h2>
            <ul className="mt-2 space-y-2">
              {progress.map((p) => (
                <li key={p.code}>
                  <Link
                    href={`/sets/${p.code}`}
                    className="block rounded-lg border border-border bg-surface px-4 py-3 hover:border-accent"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-mono text-xs uppercase text-muted">
                        {p.code}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <span className="text-sm text-muted">
                        {p.owned.toLocaleString()} / {p.target.toLocaleString()}
                      </span>
                      <span
                        className={`w-12 text-right text-sm font-semibold ${
                          p.percent >= 100 ? "text-ok" : ""
                        }`}
                      >
                        {p.percent}%
                      </span>
                    </div>
                    <ProgressBar percent={p.percent} className="mt-2" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </div>
  );
}
