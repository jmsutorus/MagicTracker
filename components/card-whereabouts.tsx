import Link from "next/link";

import {
  CARD_FINISH_LABELS,
  LOCATION_KIND_LABELS,
} from "@/lib/collection/constants";
import type { CardLocationCopies } from "@/lib/collection/queries";
import { DECK_BOARD_LABELS, DECK_FORMAT_LABELS } from "@/lib/decks/constants";
import type { CardDeckUse } from "@/lib/decks/queries";

/**
 * "Where is it, and what is it in" for one card: every location a copy is
 * filed in, and every deck that lists it.
 *
 * Renders nothing for a card you neither own nor deck, which is most card
 * pages. A card that is decked but not owned still shows its decks, because
 * "which deck wanted this" is the question you have when you are about to
 * buy one.
 */
export function CardWhereabouts({
  cardName,
  locations,
  decks,
}: {
  cardName: string;
  locations: CardLocationCopies[];
  decks: CardDeckUse[];
}) {
  if (locations.length === 0 && decks.length === 0) return null;

  // Grouped by location, keeping the query's shelf order.
  const byLocation = new Map<
    string,
    {
      name: string;
      kind: CardLocationCopies["locationKind"];
      rows: CardLocationCopies[];
    }
  >();
  for (const row of locations) {
    const group = byLocation.get(row.locationId);
    if (group) group.rows.push(row);
    else
      byLocation.set(row.locationId, {
        name: row.locationName,
        kind: row.locationKind,
        rows: [row],
      });
  }

  const ownedTotal = locations.reduce((sum, r) => sum + r.quantity, 0);
  const deckCount = new Set(decks.map((d) => d.deckId)).size;

  return (
    <section className="mt-8 grid gap-6 sm:grid-cols-2">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Where your copies are
        </h2>
        {byLocation.size === 0 ? (
          <p className="mt-2 text-sm text-muted">You don&apos;t own a copy.</p>
        ) : (
          <>
            <p className="mt-1 text-xs text-muted">
              {ownedTotal} {ownedTotal === 1 ? "copy" : "copies"} in{" "}
              {byLocation.size}{" "}
              {byLocation.size === 1 ? "location" : "locations"}
            </p>
            <ul className="mt-3 overflow-hidden rounded-lg border border-border bg-surface">
              {[...byLocation].map(([id, group]) => {
                const count = group.rows.reduce((s, r) => s + r.quantity, 0);
                const href = `/collection?${new URLSearchParams({
                  location: id,
                  q: cardName,
                })}`;
                return (
                  <li
                    key={id}
                    className="border-b border-border px-4 py-2.5 last:border-0"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <Link
                        href={href}
                        className="min-w-0 truncate text-sm font-medium underline-offset-4 hover:underline"
                      >
                        {group.name}
                      </Link>
                      <span className="shrink-0 text-xs text-muted">
                        {LOCATION_KIND_LABELS[group.kind]} ·{" "}
                        <span className="text-ok">{count}</span>
                      </span>
                    </div>
                    <ul className="mt-1 space-y-0.5">
                      {group.rows.map((r) => (
                        <li
                          key={`${r.printingId}-${r.finish}-${r.condition}`}
                          className="flex gap-2 font-mono text-xs text-muted"
                        >
                          <span className="w-6 shrink-0 text-right text-foreground">
                            {r.quantity}×
                          </span>
                          <span className="truncate">
                            {r.setCode.toUpperCase()} #{r.collectorNumber} ·{" "}
                            {CARD_FINISH_LABELS[r.finish] ?? r.finish} ·{" "}
                            {r.condition}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          In your decks
        </h2>
        {decks.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Not in any deck.</p>
        ) : (
          <>
            <p className="mt-1 text-xs text-muted">
              {deckCount} {deckCount === 1 ? "deck" : "decks"}
            </p>
            <ul className="mt-3 overflow-hidden rounded-lg border border-border bg-surface">
              {decks.map((d) => (
                <li
                  key={`${d.deckId}-${d.board}`}
                  className="border-b border-border px-4 py-2.5 last:border-0"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <Link
                      href={`/decks/${d.deckId}`}
                      className="min-w-0 truncate text-sm font-medium underline-offset-4 hover:underline"
                    >
                      {d.deckName}
                    </Link>
                    <span className="shrink-0 text-xs text-muted">
                      {DECK_FORMAT_LABELS[d.format]}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {d.board === "commander"
                      ? "Commander"
                      : `${d.quantity}× in ${DECK_BOARD_LABELS[d.board].toLowerCase()}`}
                    {d.isAllocated ? (
                      <>
                        {" · "}
                        <span className="text-ok">built</span>
                        {d.locationName ? (
                          <> · kept in {d.locationName}</>
                        ) : null}
                      </>
                    ) : (
                      " · not built"
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
