import { signOut } from "@/auth";
import { requireUser } from "@/lib/auth/dal";
import { getDbStatus } from "@/lib/db/status";

const PHASES = [
  { n: 0, name: "Foundation", detail: "App, database, auth, deploy", state: "current" },
  { n: 1, name: "Card database + search", detail: "Scryfall ingest, pg_trgm type-ahead", state: "next" },
  { n: 2, name: "Collection entry", detail: "Name + collector-number modes, locations", state: "todo" },
  { n: 3, name: "Set completion", detail: "Per-set scope rules, missing-card lists", state: "todo" },
  { n: 4, name: "Sealed product add", detail: "Precons in two clicks", state: "todo" },
  { n: 5, name: "Commander decks", detail: "Singleton, color identity, buy list", state: "todo" },
  { n: 6, name: "Bulk paste import", detail: "Decklists and CSV", state: "todo" },
  { n: 7, name: "Value tracking", detail: "Weekly owned-card prices", state: "todo" },
] as const;

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

  return (
    <div className="flex-1 flex flex-col">
      <header className="border-b border-border">
        <div className="mx-auto w-full max-w-3xl px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="text-lg font-semibold tracking-tight">MagicTracker</span>
            <span className="text-xs text-muted shrink-0">Phase 0</span>
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button
              type="submit"
              className="text-sm text-muted hover:text-foreground underline underline-offset-4 cursor-pointer"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-3xl px-4 py-8 space-y-8">
        <section>
          <h1 className="text-2xl font-semibold tracking-tight">
            Foundation is up
          </h1>
          <p className="mt-2 text-muted">
            Signed in as <span className="font-mono text-foreground">{user.email}</span>.
            Nothing else can get in — sign-in is gated by an email allowlist that
            fails closed.
          </p>
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
                <StatusRow label="Round trip" value={`${status.latencyMs} ms`} />
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
                  value={status.tables.length ? status.tables.join(", ") : "none"}
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
              A slow first request is expected: Neon&apos;s free compute suspends
              after 5 minutes idle and takes a few hundred ms to wake.
            </p>
          ) : null}
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
                  <span className="block text-xs text-muted">{phase.detail}</span>
                </span>
                {phase.state === "current" ? (
                  <span className="text-xs text-accent shrink-0">building</span>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      </main>
    </div>
  );
}
