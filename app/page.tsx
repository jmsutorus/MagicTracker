import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { ProgressBar } from "@/components/progress-bar";
import { requireUser } from "@/lib/auth/dal";
import { getCollectionTotals } from "@/lib/collection/queries";
import { listSetProgress } from "@/lib/completion/queries";
import { getDbStatus } from "@/lib/db/status";
import { listDecks } from "@/lib/decks/queries";
import { getLastBackup } from "@/lib/export/build";
import { formatCents, formatCentsDelta } from "@/lib/prices/constants";
import { formatPercent, percentChange } from "@/lib/prices/project";
import { getValueTotals } from "@/lib/prices/queries";

/**
 * The front door.
 *
 * It answers three questions in order: what do I have, what am I partway
 * through, and what do I want to do next. What it deliberately does *not*
 * lead with is how the software is doing — the Postgres version, the
 * extension list and the migration count were the whole page while Phase 0
 * was the only phase, and they are diagnostics, not a dashboard. They are
 * still here, one click down, because the one failure this page cannot hide
 * is the database being unreachable.
 */

const NUMBER = new Intl.NumberFormat("en-US");

/** Sets shown under "in progress", and decks under "Decks". */
const PREVIEW_ROWS = 4;

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      {/* Tabular figures: these sit in a row and a shifting digit width
          makes a set of numbers look misaligned as they update. */}
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
      {hint ? <dd className="text-xs text-muted">{hint}</dd> : null}
    </div>
  );
}

function Action({
  href,
  title,
  detail,
}: {
  href: string;
  title: string;
  detail: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-border bg-surface px-4 py-3 hover:border-accent"
    >
      <span className="block text-sm font-medium">{title}</span>
      <span className="mt-0.5 block text-xs text-muted">{detail}</span>
    </Link>
  );
}

function SectionHeading({
  title,
  href,
  linkLabel,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
        {title}
      </h2>
      {href ? (
        <Link
          href={href}
          className="text-xs text-muted underline underline-offset-4 hover:text-foreground"
        >
          {linkLabel ?? "See all"}
        </Link>
      ) : null}
    </div>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();

  /*
   * In parallel, not one after another. These are six independent round
   * trips to a database that sleeps after five minutes idle, and awaiting
   * them in sequence made the first load of the front door the slowest page
   * in the app.
   */
  const [totals, value, decks, sets, backup, status] = await Promise.all([
    getCollectionTotals(),
    getValueTotals(),
    listDecks(),
    listSetProgress(),
    getLastBackup(),
    getDbStatus(),
  ]);

  const valueDelta =
    value.previousCents === null
      ? null
      : value.totalCents - value.previousCents;
  const valuePercent =
    value.previousCents === null
      ? null
      : percentChange(value.previousCents, value.totalCents);

  const empty = totals.totalCopies === 0;

  const completedSets = sets.filter((s) => s.percent >= 100);
  /*
   * Nearest to done first, and only sets that are actually underway. A set
   * you own three cards from is not something you are "partway through", and
   * sorting by percent puts the ones worth a few more cards at the top —
   * which is the question this list exists to answer.
   */
  const inProgress = sets
    .filter((s) => s.percent < 100 && s.owned > 0)
    .sort((a, b) => b.percent - a.percent || b.owned - a.owned)
    .slice(0, PREVIEW_ROWS);

  const recentDecks = decks.slice(0, PREVIEW_ROWS);
  const builtDecks = decks.filter((d) => d.allocatedCopies > 0).length;
  /*
   * Copies the decks want that the collection cannot supply. Summed across
   * decks rather than deduplicated, because two decks that each want a Sol
   * Ring you do not own need two Sol Rings — the per-deck buy lists are the
   * ones that say which.
   */
  const toBuy = decks.reduce(
    (n, d) => n + Math.max(d.cardCount - d.ownedCopies, 0),
    0,
  );

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader current="dashboard" />

      <main className="mx-auto w-full max-w-4xl flex-1 space-y-8 px-4 py-8">
        {/* ---- the two numbers that matter -------------------------------- */}
        <section className="rounded-lg border border-border bg-surface p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <h1 className="text-xs uppercase tracking-wide text-muted">
                Collection
              </h1>
              <p className="mt-1 text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">
                {NUMBER.format(totals.totalCopies)}
                <span className="ml-2 text-base font-normal text-muted">
                  {totals.totalCopies === 1 ? "card" : "cards"}
                </span>
              </p>
              <p className="mt-2 text-sm text-muted">
                {empty ? (
                  "Nothing in it yet."
                ) : (
                  <>
                    {NUMBER.format(totals.distinctCards)} distinct ·{" "}
                    {NUMBER.format(totals.distinctSets)}{" "}
                    {totals.distinctSets === 1 ? "set" : "sets"}
                    {totals.foilCopies > 0
                      ? ` · ${NUMBER.format(totals.foilCopies)} foil`
                      : ""}
                  </>
                )}
              </p>
            </div>

            {/*
              A stat tile, not a chart: one number with its change. The chart
              it comes from lives on the value page, where there is room for
              the axis and the history behind it.
            */}
            <div className="sm:text-right">
              <p className="text-xs uppercase tracking-wide text-muted">
                Value
              </p>
              {value.asOf === null ? (
                <>
                  <p className="mt-1 text-2xl font-semibold text-muted">—</p>
                  <p className="text-xs text-muted">
                    {empty
                      ? "Priced once there are cards to price."
                      : "The weekly job records the first snapshot on Monday."}
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
                    {formatCents(value.totalCents)}
                  </p>
                  <p className="text-xs text-muted">
                    {valueDelta === null ? (
                      <>First snapshot, {value.asOf}.</>
                    ) : (
                      <>
                        <span
                          className={
                            valueDelta === 0
                              ? "text-muted"
                              : valueDelta > 0
                                ? "text-ok"
                                : "text-bad"
                          }
                        >
                          {formatCentsDelta(valueDelta)}
                          {valuePercent === null
                            ? ""
                            : ` (${formatPercent(valuePercent)})`}
                        </span>{" "}
                        since {value.previousDate}
                      </>
                    )}
                  </p>
                  <Link
                    href="/value"
                    className="mt-1 inline-block text-xs text-muted underline underline-offset-4 hover:text-foreground"
                  >
                    Value over time
                  </Link>
                </>
              )}
            </div>
          </div>

          {empty ? null : (
            <dl className="mt-6 grid grid-cols-3 gap-4 border-t border-border pt-5">
              <Stat
                label="Decks"
                value={NUMBER.format(decks.length)}
                hint={
                  decks.length === 0
                    ? "none yet"
                    : `${NUMBER.format(builtDecks)} built`
                }
              />
              <Stat
                label="Sets complete"
                value={`${NUMBER.format(completedSets.length)} / ${NUMBER.format(sets.length)}`}
                hint="by your own scope rules"
              />
              <Stat
                label="Still to buy"
                value={NUMBER.format(toBuy)}
                hint={toBuy === 0 ? "nothing" : "cards, across all decks"}
              />
            </dl>
          )}
        </section>

        {/* ---- what you came here to do ----------------------------------- */}
        <section>
          <SectionHeading title="Add something" />
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Action
              href="/collection/add"
              title="Add cards"
              detail="Type a name, or a set and collector number"
            />
            <Action
              href="/import"
              title="Paste a list"
              detail="A decklist, a cube, or a CSV export"
            />
            <Action
              href="/decks"
              title="Build a deck"
              detail="Commander or cube, checked as you go"
            />
            <Action
              href="/products"
              title="Open a precon"
              detail="Every card from the box in one step"
            />
          </div>
        </section>

        {empty ? (
          <section className="rounded-lg border border-border bg-surface p-5">
            <SectionHeading title="Start here" />
            <ol className="mt-3 space-y-3 text-sm">
              <li>
                <Link
                  href="/collection/locations"
                  className="underline underline-offset-4 hover:text-accent"
                >
                  Name a location
                </Link>{" "}
                — a binder, a deck box, a shelf. Every card you add lives in
                one, which is what makes &ldquo;where is my second Sol
                Ring&rdquo; answerable.
              </li>
              <li>
                <Link
                  href="/collection/add"
                  className="underline underline-offset-4 hover:text-accent"
                >
                  Add your first cards
                </Link>{" "}
                — or{" "}
                <Link
                  href="/import"
                  className="underline underline-offset-4 hover:text-accent"
                >
                  paste a list
                </Link>{" "}
                if you already have one somewhere.
              </li>
              <li>
                <Link
                  href="/products"
                  className="underline underline-offset-4 hover:text-accent"
                >
                  Bought a precon?
                </Link>{" "}
                Add the whole box, and the deck it came as, in two clicks.
              </li>
            </ol>
          </section>
        ) : null}

        {/*
          Shown whenever there is something to show, and not gated on the
          collection being non-empty: a cube pasted in before a single card
          has been entered is exactly the case where somebody wants to see
          their deck on the front page.
        */}
        {decks.length > 0 || sets.length > 0 ? (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            {/* ---- decks --------------------------------------------------- */}
            <section>
              <SectionHeading
                title="Decks"
                href="/decks"
                linkLabel="All decks"
              />
              {recentDecks.length === 0 ? (
                <p className="mt-3 rounded-lg border border-border bg-surface p-4 text-sm text-muted">
                  No decks yet.{" "}
                  <Link
                    href="/decks"
                    className="underline underline-offset-4 hover:text-foreground"
                  >
                    Start one
                  </Link>
                  , or build it from a precon.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {recentDecks.map((deck) => {
                    const percent =
                      deck.cardCount === 0
                        ? 0
                        : Math.min(
                            Math.round(
                              (deck.ownedCopies / deck.cardCount) * 100,
                            ),
                            100,
                          );
                    return (
                      <li key={deck.id}>
                        <Link
                          href={`/decks/${deck.id}`}
                          className="block rounded-lg border border-border bg-surface px-4 py-3 hover:border-accent"
                        >
                          <div className="flex items-baseline gap-3">
                            <span className="min-w-0 flex-1 truncate text-sm">
                              {deck.name}
                            </span>
                            <span className="shrink-0 text-xs tabular-nums text-muted">
                              {deck.ownedCopies} / {deck.cardCount} owned
                            </span>
                          </div>
                          <ProgressBar percent={percent} className="mt-2" />
                          <p className="mt-1 truncate text-xs text-muted">
                            {deck.format === "cube"
                              ? `${deck.targetSize}-card cube`
                              : deck.commanderNames.length > 0
                                ? deck.commanderNames.join(" + ")
                                : "no commander yet"}
                          </p>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* ---- sets ---------------------------------------------------- */}
            <section>
              <SectionHeading title="Sets in progress" href="/sets" />
              {inProgress.length === 0 ? (
                <p className="mt-3 rounded-lg border border-border bg-surface p-4 text-sm text-muted">
                  {completedSets.length > 0
                    ? `Every set you own from is complete — all ${NUMBER.format(completedSets.length)} of them.`
                    : "Nothing underway yet. Open a set to set its scope."}
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {inProgress.map((set) => (
                    <li key={set.code}>
                      <Link
                        href={`/sets/${set.code}`}
                        className="block rounded-lg border border-border bg-surface px-4 py-3 hover:border-accent"
                      >
                        <div className="flex items-baseline gap-3">
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {set.name}
                          </span>
                          <span className="shrink-0 font-mono text-xs uppercase text-muted">
                            {set.code}
                          </span>
                          <span className="shrink-0 text-xs tabular-nums text-muted">
                            {set.percent}%
                          </span>
                        </div>
                        <ProgressBar percent={set.percent} className="mt-2" />
                        <p className="mt-1 text-xs tabular-nums text-muted">
                          {NUMBER.format(set.owned)} of{" "}
                          {NUMBER.format(set.target)} printings
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}

        {/* ---- your data --------------------------------------------------- */}
        <section className="rounded-lg border border-border bg-surface p-5">
          <SectionHeading title="Your data" />
          <p className="mt-3 text-sm text-muted">
            One JSON file: locations, every collection row, every deck, and your
            per-set completion rules — with card names beside the ids, so it is
            worth something without this app. The card database is not in it;
            that rebuilds from Scryfall in under a minute.
          </p>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <a
              href="/api/export"
              className="text-sm underline underline-offset-4 hover:text-accent"
            >
              Download a copy
            </a>
            <p className="text-xs text-muted">
              {backup === null ? (
                <>The weekly job takes one automatically. None recorded yet.</>
              ) : (
                <>
                  Last automatic backup {backup.startedAt.slice(0, 16)} —{" "}
                  <span
                    className={backup.status === "ok" ? "text-ok" : "text-bad"}
                  >
                    {backup.status}
                  </span>
                  {backup.destination ? (
                    <>
                      {" "}
                      → <span className="font-mono">{backup.destination}</span>
                    </>
                  ) : null}
                  .
                </>
              )}
            </p>
          </div>
        </section>

        {/* ---- diagnostics, folded away ------------------------------------ */}
        <section>
          <details
            open={!status.reachable}
            className="rounded-lg border border-border bg-surface-muted px-4 py-3"
          >
            {/*
              Open by default when the database is unreachable. Every other
              part of this page would be empty or wrong in that case, and a
              collapsed section is exactly where nobody would look.
            */}
            <summary className="cursor-pointer text-sm text-muted">
              System —{" "}
              {status.reachable ? (
                <>
                  <span className="text-ok">database reachable</span>,{" "}
                  {status.latencyMs} ms
                </>
              ) : (
                <span className="text-bad">database unreachable</span>
              )}
            </summary>

            <dl className="mt-3">
              {status.reachable ? (
                <>
                  <StatusRow label="Server" value={status.serverVersion} />
                  <StatusRow
                    label="Round trip"
                    value={`${status.latencyMs} ms`}
                  />
                  <StatusRow
                    label="pg_trgm (fuzzy search)"
                    value={
                      status.pgTrgmInstalled ? "installed" : "not installed"
                    }
                    tone={status.pgTrgmInstalled ? "ok" : "warn"}
                  />
                  <StatusRow
                    label="Migrations applied"
                    value={String(status.migrationsApplied)}
                    tone={status.migrationsApplied > 0 ? "ok" : "warn"}
                  />
                  <StatusRow
                    label="Tables"
                    value={String(status.tables.length)}
                  />
                </>
              ) : (
                <StatusRow label="Error" value={status.error} tone="bad" />
              )}
              <StatusRow label="Signed in as" value={user.email} />
            </dl>

            {status.reachable && status.latencyMs > 1000 ? (
              <p className="mt-3 text-xs text-muted">
                A slow first request is expected: Neon&apos;s free compute
                suspends after 5 minutes idle and takes a few hundred ms to
                wake.
              </p>
            ) : null}
          </details>
        </section>
      </main>
    </div>
  );
}

function StatusRow({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "ok" | "bad" | "warn" | "neutral";
}) {
  const toneClass =
    tone === "ok"
      ? "text-ok"
      : tone === "bad"
        ? "text-bad"
        : tone === "warn"
          ? "text-warn"
          : "text-foreground";

  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2 last:border-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={`text-right font-mono text-sm ${toneClass}`}>{value}</dd>
    </div>
  );
}
