import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { requireUser } from "@/lib/auth/dal";
import { getDbStatus } from "@/lib/db/status";
import { getLastBackup } from "@/lib/export/build";
import { formatCents, formatCentsDelta } from "@/lib/prices/constants";
import { formatPercent, percentChange } from "@/lib/prices/project";
import { getValueTotals } from "@/lib/prices/queries";

/**
 * Annotated rather than inferred from `as const`.
 *
 * With the literal types, a state no phase currently holds makes its branch
 * in the renderer a type error ("no overlap"), which would mean editing the
 * presentation every time a phase ships. The roadmap's shape is the stable
 * thing here; which state each phase is in is not.
 */
type PhaseState = "done" | "current" | "next" | "todo";

const PHASES: readonly {
  n: number;
  name: string;
  detail: string;
  state: PhaseState;
}[] = [
  {
    n: 0,
    name: "Foundation",
    detail: "App, database, auth, deploy",
    state: "done",
  },
  {
    n: 1,
    name: "Card database + search",
    detail: "Scryfall ingest, pg_trgm type-ahead",
    state: "done",
  },
  {
    n: 2,
    name: "Collection entry",
    detail: "Name + collector-number modes, locations",
    state: "done",
  },
  {
    n: 3,
    name: "Set completion",
    detail: "Per-set scope rules, missing-card lists",
    state: "done",
  },
  {
    n: 4,
    name: "Sealed product add",
    detail: "Precons in two clicks",
    state: "done",
  },
  {
    n: 5,
    name: "Commander decks",
    detail: "Singleton, color identity, buy list",
    state: "done",
  },
  {
    n: 6,
    name: "Bulk paste import",
    detail: "Decklists and CSV, with a review step",
    state: "done",
  },
  {
    n: 7,
    name: "Value tracking",
    detail: "Weekly owned-card prices, value over time",
    state: "done",
  },
  {
    n: 8,
    name: "Polish",
    detail: "Home-screen icon, exports, deck share links",
    state: "done",
  },
];

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
    <div className="flex items-baseline justify-between gap-4 py-2 border-b border-border last:border-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={`text-sm font-mono text-right ${toneClass}`}>{value}</dd>
    </div>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();
  const status = await getDbStatus();
  const value = await getValueTotals();
  const backup = await getLastBackup();

  const valueDelta =
    value.previousCents === null
      ? null
      : value.totalCents - value.previousCents;
  const valuePercent =
    value.previousCents === null
      ? null
      : percentChange(value.previousCents, value.totalCents);

  return (
    <div className="flex-1 flex flex-col">
      <AppHeader current="dashboard" />

      <main className="flex-1 mx-auto w-full max-w-3xl px-4 py-8 space-y-8">
        <section>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-2 text-muted">
            Signed in as{" "}
            <span className="font-mono text-foreground">{user.email}</span>.
          </p>
        </section>

        {/*
          A stat tile, not a chart: one number with its change. The chart it
          comes from lives on the value page, where there is room for the axis
          and the history behind it.
        */}
        <section className="rounded-lg border border-border bg-surface p-5">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              Collection value
            </h2>
            <Link
              href="/value"
              className="text-xs text-muted underline underline-offset-4 hover:text-foreground"
            >
              Details
            </Link>
          </div>
          {value.asOf === null ? (
            <p className="mt-3 text-sm text-muted">
              No price snapshot yet — the weekly job records one on Mondays.
            </p>
          ) : (
            <>
              <p className="mt-2 text-3xl font-semibold tracking-tight">
                {formatCents(value.totalCents)}
              </p>
              <p className="mt-1 text-sm text-muted">
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
                    since {value.previousDate}, as of {value.asOf}.
                  </>
                )}
              </p>
            </>
          )}
        </section>

        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Database
          </h2>
          <dl className="mt-3">
            {status.reachable ? (
              <>
                <StatusRow label="Connection" value="reachable" tone="ok" />
                <StatusRow label="Server" value={status.serverVersion} />
                <StatusRow
                  label="Round trip"
                  value={`${status.latencyMs} ms`}
                />
                <StatusRow
                  label="pg_trgm (fuzzy search)"
                  value={status.pgTrgmInstalled ? "installed" : "not installed"}
                  tone={status.pgTrgmInstalled ? "ok" : "warn"}
                />
                <StatusRow
                  label="Migrations applied"
                  value={String(status.migrationsApplied)}
                  tone={status.migrationsApplied > 0 ? "ok" : "warn"}
                />
                <StatusRow
                  label="Tables"
                  value={
                    status.tables.length ? status.tables.join(", ") : "none"
                  }
                />
              </>
            ) : (
              <>
                <StatusRow label="Connection" value="unreachable" tone="bad" />
                <StatusRow label="Error" value={status.error} tone="bad" />
              </>
            )}
          </dl>
          {status.reachable && status.latencyMs > 1000 ? (
            <p className="mt-3 text-xs text-muted">
              A slow first request is expected: Neon&apos;s free compute
              suspends after 5 minutes idle and takes a few hundred ms to wake.
            </p>
          ) : null}
        </section>

        <section className="rounded-lg border border-border bg-surface p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              Your data
            </h2>
            <a
              href="/api/export"
              className="text-sm text-muted underline underline-offset-4 hover:text-foreground"
            >
              Download a copy
            </a>
          </div>
          <p className="mt-3 text-sm text-muted">
            One JSON file: locations, every collection row, every deck, and your
            per-set completion rules — with card names beside the ids, so it is
            worth something without this app. The card database is not in it;
            that rebuilds from Scryfall in under a minute.
          </p>
          <p className="mt-2 text-xs text-muted">
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
        </section>

        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Roadmap
          </h2>
          <ol className="mt-3 space-y-1">
            {PHASES.map((phase) => (
              <li
                key={phase.n}
                className="flex items-baseline gap-3 py-1.5 border-b border-border last:border-0"
              >
                <span
                  className={`font-mono text-xs w-6 shrink-0 ${
                    phase.state === "current"
                      ? "text-accent"
                      : phase.state === "next"
                        ? "text-foreground"
                        : "text-muted"
                  }`}
                >
                  {phase.n}
                </span>
                <span className="flex-1 min-w-0">
                  <span
                    className={
                      phase.state === "todo" ? "text-muted" : "text-foreground"
                    }
                  >
                    {phase.name}
                  </span>
                  <span className="block text-xs text-muted">
                    {phase.detail}
                  </span>
                </span>
                {phase.state === "current" ? (
                  <span className="shrink-0 text-xs text-accent">building</span>
                ) : phase.state === "done" ? (
                  <span className="shrink-0 text-xs text-ok">done</span>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      </main>
    </div>
  );
}
