import { formatCents, formatCentsDelta } from "@/lib/prices/constants";
import { percentChange, formatPercent } from "@/lib/prices/project";
import type { PriceHistorySeries } from "@/lib/prices/queries";

import { ValueChart } from "./value-chart";

/**
 * What the copies of this card have been worth, week by week.
 *
 * One chart per (printing, finish) rather than one combined line: a foil and
 * a nonfoil are two markets, and a line averaging them would show a price no
 * copy ever traded at. Each chart is a single series, so each is labelled by
 * its heading and carries no legend.
 *
 * Nothing renders for a card you do not own — the weekly job only prices the
 * collection, so there is no history to show and an empty chart would imply
 * the data went missing.
 */
export function PriceHistory({ series }: { series: PriceHistorySeries[] }) {
  if (series.length === 0) return null;

  const withHistory = series.filter((s) => s.points.length > 0);
  if (withHistory.length === 0) {
    return (
      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Price history
        </h2>
        <p className="mt-2 text-sm text-muted">
          You own this, but the weekly price job hasn&rsquo;t covered it yet.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-10">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
        Price history
      </h2>
      <p className="mt-1 text-xs text-muted">
        What your {withHistory.length === 1 ? "copy has" : "copies have"} been
        worth, one weekly snapshot per point.
      </p>

      <div className="mt-4 space-y-6">
        {withHistory.map((s) => {
          const first = s.points[0];
          const change = s.changeCents;
          const pct =
            first && change !== null
              ? percentChange(first.cents, first.cents + change)
              : null;

          return (
            <div
              key={`${s.printingId}:${s.finish}`}
              className="rounded-lg border border-border bg-surface p-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 className="text-sm font-medium">
                  {s.setCode.toUpperCase()} #{s.collectorNumber}
                  <span className="ml-2 text-xs text-muted">{s.finish}</span>
                  {s.copies > 1 ? (
                    <span className="ml-2 text-xs text-muted">
                      ×{s.copies} owned
                    </span>
                  ) : null}
                </h3>
                <p className="text-sm">
                  {s.latestCents !== null ? (
                    <span className="font-semibold">
                      {formatCents(s.latestCents)}
                    </span>
                  ) : null}
                  {change !== null ? (
                    <span
                      className={`ml-2 text-xs ${
                        change > 0
                          ? "text-ok"
                          : change < 0
                            ? "text-bad"
                            : "text-muted"
                      }`}
                    >
                      {formatCentsDelta(change)}
                      {pct !== null ? ` (${formatPercent(pct)})` : ""} over{" "}
                      {s.points.length} snapshot
                      {s.points.length === 1 ? "" : "s"}
                    </span>
                  ) : (
                    <span className="ml-2 text-xs text-muted">
                      one snapshot so far
                    </span>
                  )}
                </p>
              </div>

              {/*
                A single point is a dot, not a trend: the chart is withheld
                until there are two, so nothing implies a direction the data
                cannot support.
              */}
              {s.points.length > 1 ? (
                <div className="mt-3">
                  <ValueChart points={s.points} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
