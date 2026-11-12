"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";

import { moveItemsAction, removeItemsAction } from "@/app/collection/actions";
import { CardLink } from "@/components/card-link";
import { CollectionRowControls } from "@/components/collection-row-controls";
import type { CollectionRow } from "@/lib/collection/queries";
import { formatCents } from "@/lib/prices/constants";

/**
 * The collection table: selectable rows, sortable columns, bulk actions.
 *
 * Two things were missing and both were felt on every visit.
 *
 * **Sorting.** The query was `ORDER BY name ASC`, full stop — there was no
 * way to ask "what is my most valuable card" or "what did I add last week"
 * of a collection this app exists to track the value of.
 *
 * **Selection.** Re-filing a binder meant changing a location dropdown once
 * per row, which is one round trip per card. Now the rows are checkboxes and
 * the move is one statement.
 *
 * Selection is deliberately *not* persisted across navigation. It is scoped
 * to what is on screen, which is the only set the person can actually see
 * and reason about — a selection that silently spanned pages would make
 * "remove 40 cards" mean something nobody verified.
 */
export function CollectionTable({
  rows,
  locations,
}: {
  rows: CollectionRow[];
  locations: { id: string; name: string }[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);

  const sort = params.get("sort") ?? "name";

  const refresh = useCallback(() => {
    setSelected(new Set());
    setConfirmingRemoval(false);
    startTransition(() => router.refresh());
  }, [router]);

  function toggle(itemId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
    setConfirmingRemoval(false);
  }

  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.itemId));

  function toggleAll() {
    setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.itemId)));
    setConfirmingRemoval(false);
  }

  /** Copies, not rows — the number that makes "remove" worth confirming. */
  const selectedCopies = useMemo(
    () =>
      rows
        .filter((r) => selected.has(r.itemId))
        .reduce((n, r) => n + r.quantity, 0),
    [rows, selected],
  );

  async function run(work: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const result = await work();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "That did not work.");
      return;
    }
    refresh();
  }

  /** A heading that sorts, toggling to descending where that makes sense. */
  function sortLink(label: string, key: string, descKey?: string) {
    const active = sort === key || (descKey ? sort === descKey : false);
    const next = sort === key && descKey ? descKey : key;

    const search = new URLSearchParams(params.toString());
    search.set("sort", next);
    search.delete("page");

    return (
      <a
        href={`/collection?${search.toString()}`}
        onClick={(e) => {
          e.preventDefault();
          startTransition(() => {
            router.replace(`/collection?${search.toString()}`, {
              scroll: false,
            });
          });
        }}
        className={`hover:text-foreground ${active ? "text-foreground" : ""}`}
      >
        {label}
        {active ? (
          <span aria-hidden className="ml-1">
            {sort === descKey ? "↓" : "↑"}
          </span>
        ) : null}
        <span className="sr-only">
          {active ? " (sorted by this column)" : " — sort by this column"}
        </span>
      </a>
    );
  }

  return (
    <>
      {/*
        The bulk bar appears only with a selection, and reports copies as
        well as rows: "3 rows" hides that one of them is a playset.
      */}
      {selected.size > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-accent bg-surface-muted px-4 py-3">
          <span className="text-sm">
            <strong className="font-semibold tabular-nums">
              {selected.size}
            </strong>{" "}
            {selected.size === 1 ? "row" : "rows"} selected
            <span className="text-muted">
              {" "}
              ({selectedCopies} {selectedCopies === 1 ? "card" : "cards"})
            </span>
          </span>

          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">Move to</span>
            <select
              defaultValue=""
              disabled={busy}
              onChange={(e) => {
                const locationId = e.target.value;
                if (!locationId) return;
                e.target.value = "";
                void run(() => moveItemsAction([...selected], locationId));
              }}
              className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
            >
              <option value="">choose…</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>

          {confirmingRemoval ? (
            <span className="flex items-center gap-2 text-sm">
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => removeItemsAction([...selected]))}
                className="cursor-pointer rounded-lg bg-bad px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                Remove {selectedCopies}{" "}
                {selectedCopies === 1 ? "card" : "cards"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingRemoval(false)}
                className="cursor-pointer text-muted underline underline-offset-4"
              >
                cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmingRemoval(true)}
              className="cursor-pointer text-sm text-muted underline underline-offset-4 hover:text-bad"
            >
              Remove
            </button>
          )}

          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto cursor-pointer text-sm text-muted underline underline-offset-4 hover:text-foreground"
          >
            Clear selection
          </button>

          {error ? (
            <span role="alert" className="w-full text-sm text-bad">
              {error}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="w-9 px-3 py-2">
                <input
                  type="checkbox"
                  checked={allOnPage}
                  onChange={toggleAll}
                  aria-label="Select every row on this page"
                  className="cursor-pointer accent-[var(--accent)]"
                />
              </th>
              <th className="px-4 py-2 font-medium">
                {sortLink("Card", "name", "name-desc")}
              </th>
              <th className="px-4 py-2 font-medium">
                {sortLink("Set", "set")}
              </th>
              <th className="hidden px-4 py-2 font-medium sm:table-cell">
                Finish
              </th>
              <th className="hidden px-4 py-2 text-right font-medium md:table-cell">
                {sortLink("Value", "value")}
              </th>
              <th className="px-4 py-2 text-right font-medium">
                Quantity &amp; location
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isSelected = selected.has(row.itemId);
              return (
                <tr
                  key={row.itemId}
                  className={`border-b border-border last:border-0 ${
                    isSelected ? "bg-surface-muted" : ""
                  }`}
                >
                  <td className="px-3 py-2 align-top">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggle(row.itemId)}
                      aria-label={`Select ${row.name}`}
                      className="mt-1 cursor-pointer accent-[var(--accent)]"
                    />
                  </td>
                  <td className="px-4 py-2 align-top">
                    {/* Hover or focus the name to see the card, without
                        leaving a hundred-row page to find out which
                        printing you are looking at. */}
                    <CardLink
                      oracleId={row.oracleId}
                      imageId={row.printingId}
                      name={row.name}
                    />
                    <span className="block text-xs text-muted">
                      {row.typeLine ?? ""}
                    </span>
                  </td>
                  <td className="px-4 py-2 align-top">
                    <span className="font-mono text-xs uppercase">
                      {row.setCode}
                    </span>{" "}
                    <span className="font-mono text-xs text-muted">
                      #{row.collectorNumber}
                    </span>
                    <span className="block text-xs text-muted">
                      {row.rarity}
                    </span>
                  </td>
                  <td className="hidden px-4 py-2 align-top sm:table-cell">
                    <span className="text-xs">
                      {row.finish === "nonfoil" ? "—" : row.finish}
                    </span>
                    <span className="block text-xs text-muted">
                      {row.condition}
                    </span>
                  </td>
                  <td className="hidden px-4 py-2 text-right align-top md:table-cell">
                    {row.priceCents === null ? (
                      <span className="text-xs text-muted">—</span>
                    ) : (
                      <>
                        <span className="text-xs tabular-nums">
                          {formatCents(row.priceCents * row.quantity)}
                        </span>
                        {row.quantity > 1 ? (
                          <span className="block text-xs tabular-nums text-muted">
                            {formatCents(row.priceCents)} each
                          </span>
                        ) : null}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-2 align-top">
                    <CollectionRowControls
                      itemId={row.itemId}
                      quantity={row.quantity}
                      locationId={row.locationId}
                      locations={locations}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
