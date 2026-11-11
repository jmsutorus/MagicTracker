"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createDeckFromProductAction } from "@/app/decks/actions";

/**
 * "Build the deck too" — the other half of adding a precon.
 *
 * Phase 4 put the cards in the collection; this makes the decklist, copying
 * the product's commander and main board and pinning the printings the box
 * shipped. PLAN.md scheduled it here because it needs the deck tables.
 *
 * Separate from the add button on purpose: buying a precon to pull its cards
 * apart is at least as common as keeping it assembled, and the two are
 * different intentions.
 */
export function ProductDeckButton({
  fileName,
  productName,
  locationId,
  locationName,
}: {
  fileName: string;
  productName: string;
  /** The location the cards were put in, if any — the deck points at it. */
  locationId: string | null;
  locationName: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(productName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;

    setBusy(true);
    setError(null);

    const result = await createDeckFromProductAction(
      fileName,
      trimmed,
      locationId,
    );

    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }

    // Left busy: the navigation is what happens next.
    router.push(`/decks/${result.id}`);
  }

  return (
    <div className="rounded-lg border border-border bg-surface-muted p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
        Build the deck
      </h2>
      <p className="mt-2 text-sm text-muted">
        Makes a Commander deck from this product&rsquo;s commander and main
        board, with its printings pinned
        {locationName ? `, filed under ${locationName}` : ""}. Separate from
        adding the cards — a precon you are pulling apart for parts does not
        need a decklist.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Deck name</span>
          <input
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void create();
              }
            }}
            className="w-64 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </label>
        <button
          type="button"
          disabled={busy || name.trim().length === 0}
          onClick={() => void create()}
          className="cursor-pointer rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:text-foreground disabled:opacity-40"
        >
          {busy ? "Building…" : "Build the deck"}
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}
