import { ManaCost } from "@/components/mana-cost";
import type { DeckCardRow } from "@/lib/decks/queries";

/**
 * What a deck is made of: its curve, its colours, and its card types.
 *
 * Every deckbuilder this app gets compared to puts these on the deck page,
 * and for good reason — "is my curve too high" and "am I actually three
 * colours" are the two questions you ask of a list you are editing, and
 * neither is answerable by reading 100 rows of a table.
 *
 * Form choices, deliberately:
 *
 *  - **The curve is a column chart.** Ordered buckets, magnitude compared
 *    low-to-high, one series — so one hue, no legend (the heading names it),
 *    and the count carried by the axis and the hover rather than printed on
 *    every bar.
 *  - **The colour split is a thin segmented bar over a list**, not a pie.
 *    A pie of six close values is the thing you cannot read; the documented
 *    answer for "the split beside its figures" is a thin segmented bar with
 *    no text on it, where the list underneath carries each part's name and
 *    amount and its swatch replaces the legend. Here the swatch is the mana
 *    pip itself, which is both the name and the colour — and it is the
 *    secondary encoding that the mana palette's green/red adjacency requires
 *    (see the note in globals.css).
 *
 * Lands are excluded from the curve, which is the convention every one of
 * those tools follows: a land has no mana cost, so counting 38 of them at
 * zero would bury the curve under one column that means nothing.
 */

/** Buckets. 7 is "7 or more" — past that the columns are all noise. */
const MAX_BUCKET = 7;

const MANA_COLORS = [
  { key: "W", token: "var(--mana-w)", name: "White" },
  { key: "U", token: "var(--mana-u)", name: "Blue" },
  { key: "B", token: "var(--mana-b)", name: "Black" },
  { key: "R", token: "var(--mana-r)", name: "Red" },
  { key: "G", token: "var(--mana-g)", name: "Green" },
] as const;

/** The broad types, in the order a decklist is usually grouped. */
const TYPE_ORDER = [
  "Creature",
  "Instant",
  "Sorcery",
  "Artifact",
  "Enchantment",
  "Planeswalker",
  "Battle",
  "Land",
] as const;

function isLand(typeLine: string | null): boolean {
  return (typeLine ?? "").includes("Land");
}

export function DeckStats({ cards }: { cards: DeckCardRow[] }) {
  /*
   * Counted boards only, and by copies rather than rows: a deck with four
   * Lightning Bolts has four cards at one mana, and a curve that counted it
   * once would understate every repeated card in a 60-card deck.
   */
  const counted = cards.filter((c) => c.board !== "maybe");
  const totalCopies = counted.reduce((n, c) => n + c.quantity, 0);

  if (totalCopies === 0) return null;

  // ---- the curve ---------------------------------------------------------
  const spells = counted.filter((c) => !isLand(c.typeLine));
  const curve = Array.from({ length: MAX_BUCKET + 1 }, () => 0);
  for (const card of spells) {
    const cmc = Math.max(0, Math.round(card.cmc ?? 0));
    curve[Math.min(cmc, MAX_BUCKET)] += card.quantity;
  }
  const curveTotal = curve.reduce((a, b) => a + b, 0);
  const peak = Math.max(...curve);
  const averageCmc =
    curveTotal === 0
      ? 0
      : spells.reduce((n, c) => n + (c.cmc ?? 0) * c.quantity, 0) / curveTotal;

  // ---- the colours -------------------------------------------------------
  /*
   * By colour identity, and a gold card counts once in each of its colours —
   * so these sum to more than the deck size, which is why the bar is a share
   * of the pips and the figures are counts rather than percentages of 100.
   */
  const colorCounts = MANA_COLORS.map((color) => ({
    ...color,
    count: counted
      .filter((c) => c.colorIdentity.includes(color.key))
      .reduce((n, c) => n + c.quantity, 0),
  }));
  const colorless = counted
    .filter((c) => c.colorIdentity.length === 0 && !isLand(c.typeLine))
    .reduce((n, c) => n + c.quantity, 0);

  const colorSegments = [
    ...colorCounts.filter((c) => c.count > 0),
    ...(colorless > 0
      ? [
          {
            key: "C",
            token: "var(--mana-c)",
            name: "Colorless",
            count: colorless,
          },
        ]
      : []),
  ];
  const colorTotal = colorSegments.reduce((n, c) => n + c.count, 0);

  // ---- the types ---------------------------------------------------------
  const typeCounts = TYPE_ORDER.map((type) => ({
    type,
    count: counted
      .filter((c) => (c.typeLine ?? "").includes(type))
      .reduce((n, c) => n + c.quantity, 0),
  })).filter((t) => t.count > 0);

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          What&rsquo;s in it
        </h2>
        <p className="text-xs text-muted">
          {/* Proportional figures: this is prose, not a column. */}
          Average cost {averageCmc.toFixed(2)} · {curveTotal} spell
          {curveTotal === 1 ? "" : "s"}
          {spells.length < counted.length
            ? ` · ${totalCopies - curveTotal} land${totalCopies - curveTotal === 1 ? "" : "s"}`
            : ""}
        </p>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <ManaCurve curve={curve} peak={peak} />
        <div className="space-y-5">
          <ColorSplit segments={colorSegments} total={colorTotal} />
          <TypeList types={typeCounts} />
        </div>
      </div>
    </section>
  );
}

/**
 * The curve.
 *
 * Plain divs rather than an SVG: eight bars on a shared baseline need no
 * scales, no axes and no measurement, and flexbox gives the 2px gap between
 * adjacent bars that the mark spec asks for without any geometry.
 */
function ManaCurve({ curve, peak }: { curve: number[]; peak: number }) {
  return (
    /* No `m-0`: Tailwind's preflight already zeroes a figure's margin, and
       setting it here would override the parent's `space-y` gap. */
    <figure>
      <figcaption className="text-xs uppercase tracking-wide text-muted">
        Mana curve
      </figcaption>

      {/* Height includes the label band, so the axis is never cropped. */}
      <div className="mt-3 flex h-32 items-end gap-0.5">
        {curve.map((count, cmc) => {
          const share = peak === 0 ? 0 : count / peak;
          return (
            <div
              key={cmc}
              className="flex h-full flex-1 flex-col justify-end"
              /*
               * The accessible name carries the value, so the number is
               * reachable without hovering. The native title gives the same
               * thing to a mouse.
               */
              title={`${count} card${count === 1 ? "" : "s"} at ${cmc === MAX_BUCKET ? `${MAX_BUCKET}+` : cmc} mana`}
            >
              {/*
                Only the peak is direct-labelled. A number over every column
                is the "value on every data point" anti-pattern; the one
                that tells you where the deck sits is worth printing.
              */}
              {count === peak && count > 0 ? (
                <span className="mb-1 text-center text-[10px] tabular-nums text-muted">
                  {count}
                </span>
              ) : null}
              <div
                role="img"
                aria-label={`${count} at ${cmc === MAX_BUCKET ? `${MAX_BUCKET} or more` : cmc} mana`}
                style={{
                  height: `${share * 100}%`,
                  background: "var(--chart-line)",
                  // Rounded data-end only; the baseline end stays square.
                  borderRadius: "4px 4px 0 0",
                }}
                className={count === 0 ? "min-h-0" : "min-h-[3px]"}
              />
            </div>
          );
        })}
      </div>

      {/* The axis: hairline, one shade off the surface, solid. */}
      <div className="mt-1.5 flex gap-0.5 border-t border-border pt-1.5">
        {curve.map((_, cmc) => (
          <span
            key={cmc}
            className="flex-1 text-center text-[10px] tabular-nums text-muted"
          >
            {cmc === MAX_BUCKET ? `${MAX_BUCKET}+` : cmc}
          </span>
        ))}
      </div>
    </figure>
  );
}

/**
 * The colour split: a thin segmented bar, then the figures.
 *
 * No text on the bar — the rows below carry every name and count, and the
 * pip on each row is the swatch that stands in for a legend.
 */
function ColorSplit({
  segments,
  total,
}: {
  segments: { key: string; token: string; name: string; count: number }[];
  total: number;
}) {
  if (total === 0) return null;

  return (
    /* See ManaCurve on why there is no `m-0` here. */
    <figure>
      <figcaption className="text-xs uppercase tracking-wide text-muted">
        Colors
      </figcaption>

      {/* 8px, fully rounded, no baseline — a figure, not a plot. */}
      <div className="mt-2.5 flex h-2 gap-0.5 overflow-hidden rounded-full">
        {segments.map((seg) => (
          <div
            key={seg.key}
            style={{
              width: `${(seg.count / total) * 100}%`,
              background: seg.token,
            }}
            title={`${seg.name}: ${seg.count}`}
          />
        ))}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map((seg) => (
          <li key={seg.key} className="flex items-center gap-1.5 text-sm">
            {seg.key === "C" ? (
              <span
                aria-hidden
                className="inline-block size-3.5 shrink-0 rounded-full"
                style={{ background: seg.token }}
              />
            ) : (
              <ManaCost cost={`{${seg.key}}`} size={14} label={seg.name} />
            )}
            <span className="tabular-nums">{seg.count}</span>
            <span className="sr-only">{seg.name}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

function TypeList({ types }: { types: { type: string; count: number }[] }) {
  if (types.length === 0) return null;

  return (
    <div>
      <h3 className="text-xs uppercase tracking-wide text-muted">Types</h3>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {types.map(({ type, count }) => (
          <li key={type}>
            <span className="tabular-nums">{count}</span>{" "}
            <span className="text-muted">
              {/* "Sorcerys" is not a word; nor is "Sorceries" worth a table. */}
              {count === 1 ? type.toLowerCase() : pluralType(type)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function pluralType(type: string): string {
  const lower = type.toLowerCase();
  if (lower === "sorcery") return "sorceries";
  return `${lower}s`;
}
