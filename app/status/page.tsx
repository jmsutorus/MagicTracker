import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { requireUser } from "@/lib/auth/dal";
import { getDbStatus } from "@/lib/db/status";
import { getLastBackup } from "@/lib/export/build";

/**
 * Where the plumbing lives now.
 *
 * All of this used to be on the dashboard — the Postgres version, the
 * extension list, the migration count, the table count, the round-trip time,
 * and the storage path of the last automatic backup. It was the whole front
 * page back when Phase 0 was the only phase, and it stayed there long after
 * the app had something better to lead with.
 *
 * None of it is deleted, because one of these facts is genuinely load
 * bearing: when the database is unreachable every other page in the app is
 * empty or wrong, and nothing on those pages can tell you why. It is just no
 * longer the first thing anyone sees. The footer links here.
 */

export const metadata = { title: "Status · MagicTracker" };

export default async function StatusPage() {
  const user = await requireUser();
  const [status, backup] = await Promise.all([getDbStatus(), getLastBackup()]);

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader />

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        <Link
          href="/"
          className="text-sm text-muted underline underline-offset-4 hover:text-foreground"
        >
          ← Dashboard
        </Link>

        <h1 className="mt-5 text-2xl font-semibold tracking-tight">Status</h1>

        <p className="mt-2 text-sm text-muted">
          {status.reachable ? (
            <>
              Everything is reachable. Nothing here needs your attention — this
              page exists for the times when something does.
            </>
          ) : (
            <span className="text-bad">
              The database is unreachable, which is why the rest of the app is
              empty.
            </span>
          )}
        </p>

        <section className="mt-6 rounded-lg border border-border bg-surface px-4 py-2">
          <dl>
            {status.reachable ? (
              <>
                <Row label="Database" value="reachable" tone="ok" />
                <Row label="Round trip" value={`${status.latencyMs} ms`} />
                <Row label="Server" value={status.serverVersion} />
                <Row
                  label="pg_trgm (fuzzy search)"
                  value={status.pgTrgmInstalled ? "installed" : "not installed"}
                  tone={status.pgTrgmInstalled ? "ok" : "warn"}
                />
                <Row
                  label="Migrations applied"
                  value={String(status.migrationsApplied)}
                  tone={status.migrationsApplied > 0 ? "ok" : "warn"}
                />
                <Row label="Tables" value={String(status.tables.length)} />
              </>
            ) : (
              <Row label="Error" value={status.error} tone="bad" />
            )}
            <Row label="Signed in as" value={user.email} />
          </dl>
        </section>

        {status.reachable && status.latencyMs > 1000 ? (
          <p className="mt-3 text-xs text-muted">
            A slow first request is expected: Neon&apos;s free compute suspends
            after 5 minutes idle and takes a few hundred ms to wake.
          </p>
        ) : null}

        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Backups
          </h2>
          <div className="mt-3 rounded-lg border border-border bg-surface px-4 py-2">
            <dl>
              {backup === null ? (
                <Row
                  label="Last automatic backup"
                  value="none recorded yet"
                  tone="warn"
                />
              ) : (
                <>
                  <Row
                    label="Last automatic backup"
                    value={backup.startedAt.slice(0, 16)}
                  />
                  <Row
                    label="Result"
                    value={backup.status}
                    tone={backup.status === "ok" ? "ok" : "bad"}
                  />
                  {backup.destination ? (
                    <Row label="Written to" value={backup.destination} />
                  ) : null}
                </>
              )}
            </dl>
          </div>
          <p className="mt-3 text-sm text-muted">
            <a
              href="/api/export"
              className="underline underline-offset-4 hover:text-foreground"
            >
              Export a backup now
            </a>{" "}
            — one JSON file with your locations, collection, decks and
            completion rules, card names included, so it is worth something
            without this app.
          </p>
        </section>
      </main>
    </div>
  );
}

function Row({
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
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2.5 last:border-0">
      <dt className="shrink-0 text-sm text-muted">{label}</dt>
      <dd className={`min-w-0 text-right font-mono text-sm break-all ${toneClass}`}>
        {value}
      </dd>
    </div>
  );
}
