import Link from "next/link";

import { AppFooter } from "@/components/app-footer";
import { AppHeader } from "@/components/app-header";
import { SetSymbol } from "@/components/card-art";
import { ProgressBar } from "@/components/progress-bar";
import { requireUser } from "@/lib/auth/dal";
import {
  listSetProgress,
  searchSets,
  type SetProgress,
} from "@/lib/completion/queries";
import { formatCents } from "@/lib/prices/constants";

export const metadata = { title: "Sets · MagicTracker" };

function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * How the list is ordered.
 *
 * `cheapest` is the one worth having: completion plus the prices the card
 * ingest already carries answers "which set can I actually finish", which is
 * a different question from "which am I closest to" — four mythics left is
 * further from done than forty commons.
 */
const SORTS = {
  released: "Newest first",
  closest: "Closest to done",
  cheapest: "Cheapest to finish",
} as const;

type Sort = keyof typeof SORTS;

function isSort(value: string | undefined): value is Sort {
  return value !== undefined && value in SORTS;
}

function sortProgress(rows: SetProgress[], sort: Sort): SetProgress[] {
  const copy = [...rows];
  if (sort === "closest") {
    // Complete sets have nothing left to be close to, so they go last.
    return copy.sort(
      (a, b) =>
        Number(a.missing === 0) - Number(b.missing === 0) ||
        b.percent - a.percent ||
        a.missing - b.missing,
    );
  }
  if (sort === "cheapest") {
    /*
     * A set with no priced missing card sorts last rather than first: its
     * total is zero because nothing is known, not because it is free. Done
     * sets go last too — they are not a thing to buy.
     */
    const rank = (r: SetProgress) =>
      r.missing === 0 || r.missingPriced === 0 ? 1 : 0;
    return copy.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        a.missingCents - b.missingCents ||
        a.missing - b.missing,
    );
  }
  return copy;
}

/** What a row says about the money, which depends on what is known. */
function costLabel(p: SetProgress): string | null {
  if (p.missing === 0) return null;
  if (p.missingPriced === 0) return "no prices yet";
  const total = formatCents(p.missingCents);
  return p.missingPriced < p.missing
    ? `${total} for ${p.missingPriced} of ${p.missing}`
    : `${total} to finish`;
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
  const sortParam = one(params.sort);
  const sort: Sort = isSort(sortParam) ? sortParam : "released";

  const [unsorted, searchResults] = await Promise.all([
    listSetProgress(),
    q ? searchSets(q) : Promise.resolve([]),
  ]);

  const progress = sortProgress(unsorted, sort);
  const outstanding = progress.filter((p) => p.missing > 0);
  const toFinish = outstanding.reduce((n, p) => n + p.missingCents, 0);
  const unpriced = outstanding.reduce(
    (n, p) => n + (p.missing - p.missingPriced),
    0,
  );

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader current="sets" />

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Sets</h1>
        {/* A sentence only when there is nothing to look at. Once the list is
            on screen it says what the list already says. */}
        {progress.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            Completion appears here once you own a card from a set.
          </p>
        ) : null}

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
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
                Your sets
              </h2>
              <nav className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
                {(Object.keys(SORTS) as Sort[]).map((key) => (
                  <Link
                    key={key}
                    href={
                      key === "released"
                        ? `/sets${q ? `?q=${encodeURIComponent(q)}` : ""}`
                        : `/sets?sort=${key}${q ? `&q=${encodeURIComponent(q)}` : ""}`
                    }
                    className={
                      key === sort
                        ? "font-medium text-foreground"
                        : "text-muted underline underline-offset-4 hover:text-foreground"
                    }
                    aria-current={key === sort ? "true" : undefined}
                  >
                    {SORTS[key]}
                  </Link>
                ))}
              </nav>
            </div>

            {outstanding.length > 0 ? (
              <p className="mt-2 text-sm text-muted">
                {unpriced === 0 ? (
                  <>
                    Everything you&rsquo;re missing across{" "}
                    {outstanding.length.toLocaleString()} set
                    {outstanding.length === 1 ? "" : "s"} would cost{" "}
                    <strong className="font-semibold text-foreground">
                      {formatCents(toFinish)}
                    </strong>
                    .
                  </>
                ) : (
                  <>
                    The missing cards that have a price would cost{" "}
                    <strong className="font-semibold text-foreground">
                      {formatCents(toFinish)}
                    </strong>
                    ; {unpriced.toLocaleString()} more have no price.
                  </>
                )}
              </p>
            ) : null}

            <ul className="mt-3 space-y-2">
              {progress.map((p) => (
                <li key={p.code}>
                  <Link
                    href={`/sets/${p.code}`}
                    className="block rounded-lg border border-border bg-surface px-4 py-3 hover:border-accent"
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <SetSymbol uri={p.iconSvgUri} code={p.code} />
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
                    {costLabel(p) ? (
                      <p className="mt-1.5 text-xs text-muted">
                        {p.missing.toLocaleString()} missing · {costLabel(p)}
                      </p>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>

      <AppFooter />
    </div>
  );
}
