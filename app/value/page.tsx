import Link from "next/link";

import { AppFooter } from "@/components/app-footer";
import { AppHeader } from "@/components/app-header";
import { ValueChart } from "@/components/value-chart";
import { requireUser } from "@/lib/auth/dal";
import {
  DEFAULT_PRICE_SOURCE,
  MOVERS_WINDOW_DAYS,
  formatCents,
  formatCentsDelta,
} from "@/lib/prices/constants";
import { formatPercent, percentChange } from "@/lib/prices/project";
import {
  getAcquisitionSummary,
  getMostValuable,
  getMovers,
  getValueHistory,
  getValueTotals,
  type MoverRow,
} from "@/lib/prices/queries";

export const metadata = { title: "Value · MagicTracker" };

/** A snapshot date as a day, in UTC: the column is a date, not a moment. */
function formatDay(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function finishLabel(finish: string): string {
  return finish === "nonfoil" ? "nonfoil" : finish;
}

function CardCell({
  oracleId,
  name,
  setCode,
  collectorNumber,
  finish,
  quantity,
}: {
  oracleId: string;
  name: string;
  setCode: string;
  collectorNumber: string;
  finish: string;
  quantity: number;
}) {
  return (
    <>
      <Link href={`/cards/${oracleId}`} className="hover:underline">
        {name}
      </Link>
      <span className="block text-xs text-muted">
        <span className="font-mono uppercase">{setCode}</span>{" "}
        <span className="font-mono">#{collectorNumber}</span> ·{" "}
        {finishLabel(finish)} · {quantity}×
      </span>
    </>
  );
}

function MoversList({ rows, title }: { rows: MoverRow[]; title: string }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Nothing yet.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {rows.map((row) => (
            <li
              key={`${row.printingId}-${row.finish}`}
              className="flex items-baseline justify-between gap-3 border-b border-border py-1.5 text-sm last:border-0"
            >
              <span className="min-w-0 flex-1">
                <CardCell
                  oracleId={row.oracleId}
                  name={row.name}
                  setCode={row.setCode}
                  collectorNumber={row.collectorNumber}
                  finish={row.finish}
                  quantity={row.quantity}
                />
              </span>
              <span className="shrink-0 text-right [font-variant-numeric:tabular-nums]">
                <span
                  className={row.holdingDeltaCents > 0 ? "text-ok" : "text-bad"}
                >
                  {formatCentsDelta(row.holdingDeltaCents)}
                </span>
                <span className="block text-xs text-muted">
                  {formatCents(row.fromCents)} → {formatCents(row.toCents)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default async function ValuePage() {
  await requireUser();

  /* getLastPriceRun() is no longer read here — when the last pricing run
     happened is a question for /status, not for a page about what the
     collection is worth. */
  const [totals, history, movers, acquisition, valuable] = await Promise.all([
    getValueTotals(),
    getValueHistory(),
    getMovers(),
    getAcquisitionSummary(),
    getMostValuable(),
  ]);

  const delta =
    totals.previousCents === null
      ? null
      : totals.totalCents - totals.previousCents;
  const deltaPercent =
    totals.previousCents === null
      ? null
      : percentChange(totals.previousCents, totals.totalCents);

  const acquisitionDelta = acquisition.marketCents - acquisition.spentCents;
  const acquisitionPercent =
    acquisition.knownCopies === 0
      ? null
      : percentChange(acquisition.spentCents, acquisition.marketCents);

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader current="value" />

      <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-8">
        <section>
          <h1 className="text-2xl font-semibold tracking-tight">Value</h1>
          {/* One caveat, kept: the number is for a near-mint copy whatever
              condition you actually entered, and a reader who does not know
              that will read it as worth more than it is. The rest of the old
              paragraph explained where the data comes from and how often it
              refreshes, which changes nothing anyone would do. */}
          <p className="mt-2 text-sm text-muted">
            Near-mint market price, recorded weekly. Condition isn&rsquo;t
            discounted.
          </p>
        </section>

        {totals.asOf === null ? (
          <section className="rounded-lg border border-border bg-surface p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              No snapshot yet
            </h2>
            {/*
              What this said before: which job writes the snapshots, which
              day it runs, the npm command to run one by hand, and the raw
              `started_at` of the last attempt with its row count. That is
              the operator's view of a cron job, on a page about what a
              collection is worth — and the command is only actionable by
              whoever deployed this. The failure case still has somewhere to
              go: /status reports when the last run was and whether it
              worked.
            */}
            <p className="mt-3 text-sm text-muted">
              Prices are recorded once a week. The first one lands next
              Monday, and the chart starts the week after — a line needs two
              points.
            </p>
          </section>
        ) : (
          <>
            <section className="rounded-lg border border-border bg-surface p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
                Collection value
              </h2>
              {/*
                The hero figure: proportional digits, not tabular — equal-width
                digits make a large number look loose. Tabular is for the
                columns further down, where figures have to line up.
              */}
              <p className="mt-2 text-5xl font-semibold tracking-tight">
                {formatCents(totals.totalCents)}
              </p>
              <p className="mt-2 text-sm text-muted">
                {delta === null ? (
                  <>First snapshot, taken {formatDay(totals.asOf)}.</>
                ) : (
                  <>
                    <span
                      className={
                        delta === 0
                          ? "text-muted"
                          : delta > 0
                            ? "text-ok"
                            : "text-bad"
                      }
                    >
                      {formatCentsDelta(delta)}
                      {deltaPercent === null
                        ? ""
                        : ` (${formatPercent(deltaPercent)})`}
                    </span>{" "}
                    since {formatDay(totals.previousDate ?? totals.asOf)}. As of{" "}
                    {formatDay(totals.asOf)}.
                  </>
                )}
              </p>
              <p className="mt-3 text-xs text-muted">
                {totals.pricedCopies.toLocaleString()} copies priced
                {totals.unpricedCopies > 0 ? (
                  <>
                    {" "}
                    · {totals.unpricedCopies.toLocaleString()} copies (
                    {totals.unpricedItems.toLocaleString()}{" "}
                    {totals.unpricedItems === 1 ? "printing" : "printings"}) had
                    no price and count as nothing in the total
                  </>
                ) : null}
              </p>
            </section>

            <section className="rounded-lg border border-border bg-surface p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
                Value over time
              </h2>
              <p className="mt-1 text-xs text-muted">
                The weekly totals as they were recorded — each point is that
                week&apos;s prices against what you owned that week, not
                today&apos;s collection priced backwards.
              </p>
              <div className="mt-4">
                <ValueChart points={history} source={DEFAULT_PRICE_SOURCE} />
              </div>
            </section>

            {acquisition.knownCopies > 0 ? (
              <section className="rounded-lg border border-border bg-surface p-5">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
                  Spent against market
                </h2>
                <p className="mt-1 text-xs text-muted">
                  Only the {acquisition.knownCopies.toLocaleString()} copies
                  where you recorded what you paid
                  {acquisition.unknownCopies > 0 ? (
                    <>
                      {" "}
                      ({acquisition.unknownCopies.toLocaleString()} have no
                      recorded price and are left out, rather than counted as
                      free)
                    </>
                  ) : null}
                  .
                </p>
                <dl className="mt-3 flex flex-wrap gap-x-10 gap-y-3">
                  <div>
                    <dt className="text-xs text-muted">Paid</dt>
                    <dd className="text-lg [font-variant-numeric:tabular-nums]">
                      {formatCents(acquisition.spentCents)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Market now</dt>
                    <dd className="text-lg [font-variant-numeric:tabular-nums]">
                      {formatCents(acquisition.marketCents)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Difference</dt>
                    <dd
                      className={`text-lg [font-variant-numeric:tabular-nums] ${
                        acquisitionDelta === 0
                          ? ""
                          : acquisitionDelta > 0
                            ? "text-ok"
                            : "text-bad"
                      }`}
                    >
                      {formatCentsDelta(acquisitionDelta)}
                      {acquisitionPercent === null
                        ? ""
                        : ` (${formatPercent(acquisitionPercent)})`}
                    </dd>
                  </div>
                </dl>
              </section>
            ) : null}

            <section className="rounded-lg border border-border bg-surface p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
                Most valuable
              </h2>
              {valuable.length === 0 ? (
                <p className="mt-3 text-sm text-muted">Nothing priced yet.</p>
              ) : (
                <table className="mt-3 w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                      <th scope="col" className="py-1.5 font-medium">
                        Card
                      </th>
                      <th scope="col" className="py-1.5 text-right font-medium">
                        Each
                      </th>
                      <th scope="col" className="py-1.5 text-right font-medium">
                        Held
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {valuable.map((row) => (
                      <tr
                        key={`${row.oracleId}-${row.setCode}-${row.collectorNumber}-${row.finish}`}
                        className="border-b border-border last:border-0"
                      >
                        <td className="py-1.5 align-top">
                          <CardCell
                            oracleId={row.oracleId}
                            name={row.name}
                            setCode={row.setCode}
                            collectorNumber={row.collectorNumber}
                            finish={row.finish}
                            quantity={row.quantity}
                          />
                        </td>
                        <td className="py-1.5 text-right align-top text-muted [font-variant-numeric:tabular-nums]">
                          {formatCents(row.unitCents)}
                        </td>
                        <td className="py-1.5 text-right align-top [font-variant-numeric:tabular-nums]">
                          {formatCents(row.totalCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="rounded-lg border border-border bg-surface p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
                Movers
              </h2>
              <p className="mt-1 text-xs text-muted">
                Over the last {MOVERS_WINDOW_DAYS} days, by the change across
                the copies you own — thirty lands up a nickel moves a collection
                more than one card up a dollar.
              </p>
              <div className="mt-4 grid gap-6 sm:grid-cols-2">
                <MoversList rows={movers.gainers} title="Up" />
                <MoversList rows={movers.losers} title="Down" />
              </div>
            </section>
          </>
        )}
      </main>

      <AppFooter />
    </div>
  );
}
