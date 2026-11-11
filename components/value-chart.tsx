"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  DEFAULT_PRICE_SOURCE,
  PRICE_SOURCE_CURRENCY,
  formatCents,
  formatCentsDelta,
  type PriceSource,
} from "@/lib/prices/constants";

/**
 * The value-over-time chart.
 *
 * One series, so there is no legend: the heading above the chart names what is
 * plotted, and a box with a single swatch would only restate it.
 *
 * The y axis starts at zero. For money that is the honest baseline — an empty
 * collection really is worth nothing, and the job records a zero to say so —
 * and it keeps a week of noise on a few hundred dollars from reading as a
 * crash.
 *
 * The line colour is its own token rather than `--accent`: the brand accent
 * sits outside the lightness band a chart mark needs (the dark one reads too
 * light against a dark surface), so `--chart-line` is the same hue snapped to
 * a step that passes, picked separately for each mode.
 */

export type ValueChartPoint = { date: string; cents: number };

const HEIGHT = 240;
const PAD = { top: 28, right: 14, bottom: 30, left: 62 };
/** Only short series get a dot on every point; past this they read as noise. */
const DOTS_UP_TO = 24;
const FALLBACK_WIDTH = 720;

/** A date-only string as UTC, so the local timezone cannot shift the day. */
function dayMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function formatDay(date: string): string {
  return new Date(dayMs(date)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatFullDay(date: string): string {
  return new Date(dayMs(date)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The top of the axis, rounded up to something a reader can hold in their
 * head. Clean ticks are worth more than a tight fit.
 */
function niceCeiling(cents: number): number {
  if (cents <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(cents));
  for (const step of [1, 1.5, 2, 2.5, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= cents) return Math.round(candidate);
  }
  return Math.round(10 * magnitude);
}

/**
 * Axis ticks in whole dollars. One style per axis, so the choice comes from
 * the axis maximum rather than from each tick.
 */
function axisLabel(cents: number, source: PriceSource): string {
  const symbol = PRICE_SOURCE_CURRENCY[source];
  if (cents === 0) return `${symbol}0`;
  const dollars = cents / 100;
  if (dollars >= 10_000) {
    const thousands = dollars / 1000;
    return `${symbol}${
      thousands >= 100 ? Math.round(thousands) : thousands.toFixed(1)
    }K`;
  }
  if (dollars >= 10) return `${symbol}${Math.round(dollars).toLocaleString()}`;
  // Below ten dollars the cents are the whole story.
  return formatCents(cents, source);
}

export function ValueChart({
  points,
  source = DEFAULT_PRICE_SOURCE,
}: {
  points: ValueChartPoint[];
  source?: PriceSource;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [measured, setMeasured] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      if (next > 0) setMeasured(Math.round(next));
    });
    observer.observe(el);
    setMeasured(Math.round(el.clientWidth));
    return () => observer.disconnect();
  }, []);

  const width = measured > 0 ? measured : FALLBACK_WIDTH;

  const geometry = useMemo(() => {
    const plotWidth = Math.max(10, width - PAD.left - PAD.right);
    const plotHeight = HEIGHT - PAD.top - PAD.bottom;
    const maxCents = points.reduce((hi, p) => Math.max(hi, p.cents), 0);
    const top = niceCeiling(maxCents);
    const times = points.map((p) => dayMs(p.date));
    const first = times[0] ?? 0;
    const span = (times[times.length - 1] ?? 0) - first;

    // A single snapshot has no span to spread across: centre it rather than
    // dividing by zero or pinning it to the left edge.
    const xOf = (index: number) =>
      span <= 0
        ? PAD.left + plotWidth / 2
        : PAD.left + ((times[index] - first) / span) * plotWidth;
    const yOf = (cents: number) =>
      PAD.top + plotHeight - (cents / top) * plotHeight;

    return { plotWidth, plotHeight, top, xOf, yOf };
  }, [points, width]);

  const { plotWidth, plotHeight, top, xOf, yOf } = geometry;

  const linePath = useMemo(
    () =>
      points.length < 2
        ? null
        : points
            .map(
              (p, i) =>
                `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)} ${yOf(
                  p.cents,
                ).toFixed(1)}`,
            )
            .join(" "),
    [points, xOf, yOf],
  );

  const areaPath = useMemo(() => {
    if (points.length < 2) return null;
    const baseline = PAD.top + plotHeight;
    const lead = points
      .map(
        (p, i) =>
          `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)} ${yOf(p.cents).toFixed(
            1,
          )}`,
      )
      .join(" ");
    return `${lead} L${xOf(points.length - 1).toFixed(1)} ${baseline} L${xOf(
      0,
    ).toFixed(1)} ${baseline} Z`;
  }, [points, plotHeight, xOf, yOf]);

  if (points.length === 0) return null;

  const ticks = [0, top / 2, top];
  const last = points[points.length - 1];
  const lastIndex = points.length - 1;
  const highest = points.reduce((hi, p) => Math.max(hi, p.cents), 0);

  const shown = active ?? lastIndex;
  const shownPoint = points[shown];
  const previous = shown > 0 ? points[shown - 1] : null;

  /*
   * The nearest point to the pointer, in the SVG's own coordinates. The
   * element can still be scaled on the first frame — before the width is
   * measured it is drawn from a 720-wide viewBox — so the pointer is mapped
   * through the rendered box rather than read off it directly.
   */
  const nearestIndex = (clientX: number): number => {
    const svg = svgRef.current;
    if (!svg) return lastIndex;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return lastIndex;
    const x = (clientX - rect.left) * (width / rect.width);
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < points.length; i += 1) {
      const distance = Math.abs(xOf(i) - x);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best;
  };

  const tooltipFraction = xOf(shown) / width;
  const tooltipShift =
    tooltipFraction < 0.18
      ? "translateX(0)"
      : tooltipFraction > 0.82
        ? "translateX(-100%)"
        : "translateX(-50%)";
  /*
   * The tooltip sits in whichever half of the plot the line is not in. Pinned
   * to the top it covered the line and the end label on exactly the charts
   * this one draws — a total near the top of its own axis — which is the
   * reading the reader is hovering to get.
   */
  const tooltipAtBottom = yOf(shownPoint.cents) < PAD.top + plotHeight / 2;

  return (
    <div>
      <div ref={wrapRef} className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          width="100%"
          height={HEIGHT}
          role="img"
          tabIndex={0}
          aria-label={`Collection value, ${points.length} snapshot${
            points.length === 1 ? "" : "s"
          } from ${formatFullDay(points[0].date)} to ${formatFullDay(
            last.date,
          )}. Latest ${formatCents(last.cents, source)}, highest ${formatCents(
            highest,
            source,
          )}. The table below lists every snapshot.`}
          className="touch-none outline-none focus-visible:ring-2 focus-visible:ring-accent"
          onPointerMove={(event) => setActive(nearestIndex(event.clientX))}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive(lastIndex)}
          onBlur={() => setActive(null)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              const step = event.key === "ArrowLeft" ? -1 : 1;
              setActive((current) =>
                Math.min(lastIndex, Math.max(0, (current ?? lastIndex) + step)),
              );
            } else if (event.key === "Home") {
              event.preventDefault();
              setActive(0);
            } else if (event.key === "End") {
              event.preventDefault();
              setActive(lastIndex);
            }
          }}
        >
          {/*
            Hairlines, solid and one step off the surface, so the grid reads as
            chrome and not as data.
          */}
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={PAD.left + plotWidth}
                y1={yOf(tick)}
                y2={yOf(tick)}
                stroke="var(--border)"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 10}
                y={yOf(tick) + 4}
                textAnchor="end"
                className="fill-muted text-[11px] [font-variant-numeric:tabular-nums]"
              >
                {axisLabel(tick, source)}
              </text>
            </g>
          ))}

          <text x={PAD.left} y={HEIGHT - 10} className="fill-muted text-[11px]">
            {formatDay(points[0].date)}
          </text>
          {points.length > 1 ? (
            <text
              x={PAD.left + plotWidth}
              y={HEIGHT - 10}
              textAnchor="end"
              className="fill-muted text-[11px]"
            >
              {formatDay(last.date)}
            </text>
          ) : null}

          {areaPath ? (
            <path d={areaPath} fill="var(--chart-line)" fillOpacity={0.1} />
          ) : null}

          {active !== null ? (
            <line
              x1={xOf(active)}
              x2={xOf(active)}
              y1={PAD.top}
              y2={PAD.top + plotHeight}
              stroke="var(--muted)"
              strokeWidth={1}
            />
          ) : null}

          {linePath ? (
            <path
              d={linePath}
              fill="none"
              stroke="var(--chart-line)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}

          {points.length <= DOTS_UP_TO
            ? points.map((p, i) => (
                <circle
                  key={p.date}
                  cx={xOf(i)}
                  cy={yOf(p.cents)}
                  r={4}
                  fill="var(--chart-line)"
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              ))
            : null}

          {/*
            The end dot and its value: one direct label, on the point the
            reader came for. Anchored at the end so the text runs back over the
            plot instead of off the card.
          */}
          <circle
            cx={xOf(lastIndex)}
            cy={yOf(last.cents)}
            r={4}
            fill="var(--chart-line)"
            stroke="var(--surface)"
            strokeWidth={2}
          />
          <text
            x={xOf(lastIndex) + 4}
            y={
              yOf(last.cents) - 12 < PAD.top
                ? yOf(last.cents) + 20
                : yOf(last.cents) - 12
            }
            textAnchor="end"
            className="fill-foreground text-[12px] font-medium [font-variant-numeric:tabular-nums]"
          >
            {formatCents(last.cents, source)}
          </text>

          {active !== null ? (
            <circle
              cx={xOf(active)}
              cy={yOf(points[active].cents)}
              r={4}
              fill="var(--chart-line)"
              stroke="var(--surface)"
              strokeWidth={2}
            />
          ) : null}
        </svg>

        {active !== null ? (
          <div
            className="pointer-events-none absolute rounded-md border border-border bg-surface px-3 py-2 whitespace-nowrap shadow-sm"
            style={{
              left: `${tooltipFraction * 100}%`,
              transform: tooltipShift,
              ...(tooltipAtBottom
                ? { bottom: PAD.bottom + 6 }
                : { top: PAD.top + 6 }),
            }}
          >
            {/*
              Value first, series second: the reader already knows what is
              plotted and came for the number. The key is a short stroke, not a
              filled box.
            */}
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-block h-[2px] w-3 rounded-full"
                style={{ background: "var(--chart-line)" }}
              />
              <span className="text-sm font-semibold [font-variant-numeric:tabular-nums]">
                {formatCents(shownPoint.cents, source)}
              </span>
            </div>
            <div className="mt-0.5 text-xs text-muted">
              {formatFullDay(shownPoint.date)}
            </div>
            {previous ? (
              <div className="text-xs text-muted [font-variant-numeric:tabular-nums]">
                {formatCentsDelta(shownPoint.cents - previous.cents, source)}{" "}
                since {formatDay(previous.date)}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* The table view, so every value is readable without a pointer. */}
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-muted hover:text-foreground">
          Show the numbers
        </summary>
        <table className="mt-3 w-full text-left">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
              <th scope="col" className="py-1.5 font-medium">
                Snapshot
              </th>
              <th scope="col" className="py-1.5 text-right font-medium">
                Value
              </th>
              <th scope="col" className="py-1.5 text-right font-medium">
                Change
              </th>
            </tr>
          </thead>
          <tbody className="[font-variant-numeric:tabular-nums]">
            {points.map((p, i) => {
              const delta = i === 0 ? null : p.cents - points[i - 1].cents;
              return (
                <tr
                  key={p.date}
                  className="border-b border-border last:border-0"
                >
                  <td className="py-1.5">{formatFullDay(p.date)}</td>
                  <td className="py-1.5 text-right">
                    {formatCents(p.cents, source)}
                  </td>
                  <td
                    className={`py-1.5 text-right ${
                      delta === null || delta === 0
                        ? "text-muted"
                        : delta > 0
                          ? "text-ok"
                          : "text-bad"
                    }`}
                  >
                    {delta === null ? "—" : formatCentsDelta(delta, source)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </details>
    </div>
  );
}
