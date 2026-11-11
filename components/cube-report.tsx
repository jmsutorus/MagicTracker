import { ProgressBar } from "@/components/progress-bar";
import {
  describeDraft,
  type CubeBucket,
  type CubeReport,
} from "@/lib/decks/cube";

/**
 * What a cube looks like, as three distributions and one number.
 *
 * The number is the size against its target; the distributions are colour,
 * curve and card type. Each is one series, so each is one bar list in one
 * hue — `--chart-line`, the token the value chart uses, which is the
 * project's only mark colour that passes the lightness, chroma and contrast
 * checks in both themes. Giving the five colours their own five hues is the
 * obvious idea and the wrong one: WUBRG as swatches means yellow-white and
 * black marks on a cream or near-black surface, which is exactly the
 * contrast failure the palette rules exist to prevent. The labels carry the
 * identity instead.
 *
 * No legend: one series per chart, and the chart's own heading names it.
 */

/**
 * A horizontal bar list.
 *
 * Bars are scaled against the largest bucket rather than the total, because
 * the question a cube owner asks is "are my colours even", and a 7-bucket
 * split of 360 cards leaves every bar at a seventh of the width if you scale
 * to the whole. The count is printed beside every bar, so the scaling cannot
 * mislead about a value — it only decides how much of the row is ink.
 */
function Bars({
  buckets,
  emptyLabel,
}: {
  buckets: CubeBucket[];
  emptyLabel: string;
}) {
  const max = buckets.reduce((n, b) => Math.max(n, b.cards), 0);

  if (max === 0) {
    return <p className="mt-2 text-xs text-muted">{emptyLabel}</p>;
  }

  return (
    <ul className="mt-2 space-y-1.5">
      {buckets.map((bucket) => (
        <li key={bucket.key} className="flex items-center gap-2 text-xs">
          <span className="w-20 shrink-0 truncate text-muted">
            {bucket.label}
          </span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted">
            <span
              className="block h-full rounded-full"
              style={{
                width: `${(bucket.cards / max) * 100}%`,
                background: "var(--chart-line)",
              }}
            />
          </span>
          <span className="w-14 shrink-0 text-right tabular-nums">
            {bucket.cards}
            <span className="ml-1 text-muted">{bucket.percent}%</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Panel({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
        {title}
      </h3>
      {note ? <p className="mt-0.5 text-xs text-muted">{note}</p> : null}
      {children}
    </div>
  );
}

export function CubeReportPanel({
  report,
  ownedCopies = null,
  children,
}: {
  report: CubeReport;
  /**
   * Copies of the cube's cards the collection can supply, or null to say
   * nothing about ownership.
   *
   * Null is what the public share page passes. What you own is a fact about
   * you rather than about the cube, so the owned bar and its sentence are
   * absent from a shared page by construction — not hidden by a flag the
   * next change could forget to set.
   */
  ownedCopies?: number | null;
  /** The size control, which is interactive and so passed in from the page. */
  children?: React.ReactNode;
}) {
  const { cardCount, targetSize, difference, ready } = report;

  const ownedPercent =
    cardCount === 0 || ownedCopies === null
      ? 0
      : Math.min(Math.round((ownedCopies / cardCount) * 100), 100);

  const draft = describeDraft(targetSize);

  return (
    <>
      <section className="mt-6 rounded-lg border border-border bg-surface p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <span className="text-3xl font-semibold tabular-nums">
            {cardCount}
            <span className="text-xl text-muted">
              {" / "}
              {targetSize}
            </span>
          </span>
          <span
            className={`text-lg font-semibold ${ready ? "text-ok" : "text-muted"}`}
          >
            {ready
              ? "Ready to draft"
              : difference < 0
                ? `${-difference} to go`
                : `${difference} over`}
          </span>
        </div>

        {ownedCopies === null ? null : (
          <ProgressBar percent={ownedPercent} className="mt-3" />
        )}
        <p className="mt-3 text-sm text-muted">
          {ownedCopies === null
            ? `${cardCount} card${cardCount === 1 ? "" : "s"}`
            : `${ownedCopies} of ${cardCount} cards available from your collection`}
          {draft ? ` · ${targetSize} seats ${draft}` : ""}.
        </p>
        {draft === null ? (
          <p className="mt-1 text-xs text-muted">
            {targetSize} does not divide into 15-card packs, so a pod will leave
            cards in the box. That is fine — it just is not a round number of
            boosters.
          </p>
        ) : null}

        {children ? <div className="mt-4">{children}</div> : null}

        {report.problems.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {report.problems.map((problem) => (
              <li
                key={problem.code}
                className={`text-sm ${
                  problem.severity === "error" ? "text-bad" : "text-muted"
                }`}
              >
                <span>{problem.severity === "error" ? "✗" : "!"}</span>{" "}
                {problem.message}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="mt-6 grid grid-cols-1 gap-6 rounded-lg border border-border bg-surface p-5 sm:grid-cols-3">
        <Panel title="Colour" note="by the cards' own colours">
          <Bars buckets={report.colors} emptyLabel="No cards yet." />
        </Panel>
        <Panel title="Mana curve" note={`nonland · ${report.lands} lands`}>
          <Bars buckets={report.curve} emptyLabel="No nonland cards yet." />
        </Panel>
        <Panel title="Types" note="each card counted once">
          <Bars buckets={report.types} emptyLabel="No cards yet." />
        </Panel>
      </section>
    </>
  );
}
