"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  deleteDeckAction,
  renameDeckAction,
  setDeckAllocationAction,
  setDeckLocationAction,
} from "@/app/decks/actions";

type LocationOption = { id: string; name: string };

/**
 * Deck-level controls: name, where it physically lives, whether it is built,
 * and deletion.
 *
 * "Mark as built" is the allocation switch. It claims the physical copies for
 * this deck so that another deck stops reporting them as free to build with,
 * and it moves nothing in the collection — see the note on `deck_cards` in
 * lib/db/schema.ts for why a claim beats a hundred card moves.
 */
export function DeckToolbar({
  deckId,
  name,
  locationId,
  locations,
  allocatedCount,
  cardCount,
}: {
  deckId: string;
  name: string;
  locationId: string | null;
  locations: LocationOption[];
  /** Cards this deck has already claimed. */
  allocatedCount: number;
  /** Cards on the counted boards, for the button's wording. */
  cardCount: number;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [draftName, setDraftName] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const built = allocatedCount > 0;

  async function run(
    work: () => Promise<{ ok: boolean; error?: string }>,
    onDone?: () => void,
  ) {
    setBusy(true);
    setError(null);
    setStatus(null);
    const result = await work();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "That did not work.");
      return;
    }
    onDone?.();
    startTransition(() => router.refresh());
  }

  async function allocate(next: boolean) {
    setBusy(true);
    setError(null);
    setStatus(null);

    const result = await setDeckAllocationAction(deckId, next);

    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setStatus(
      next
        ? result.skipped > 0
          ? `Claimed ${result.cards} card${result.cards === 1 ? "" : "s"}. ${result.skipped} ${result.skipped === 1 ? "is" : "are"} not available to claim — you do not own ${result.skipped === 1 ? "it" : "them"}, or another built deck has ${result.skipped === 1 ? "it" : "them"}.`
          : `Claimed ${result.cards} card${result.cards === 1 ? "" : "s"}.`
        : `Released ${result.cards} card${result.cards === 1 ? "" : "s"} back to the collection.`,
    );
    startTransition(() => router.refresh());
  }

  return (
    <div className="rounded-lg border border-border bg-surface-muted p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Deck name</span>
          <input
            value={draftName}
            disabled={busy}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void run(() => renameDeckAction(deckId, draftName));
              }
            }}
            className="w-64 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </label>

        {draftName.trim() !== name ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => renameDeckAction(deckId, draftName))}
            className="cursor-pointer rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:text-foreground disabled:opacity-40"
          >
            Save name
          </button>
        ) : null}

        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Where it lives</span>
          <select
            value={locationId ?? ""}
            disabled={busy}
            onChange={(e) =>
              void run(() =>
                setDeckLocationAction(
                  deckId,
                  e.target.value === "" ? null : e.target.value,
                ),
              )
            }
            className="w-56 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          >
            <option value="">Not built yet</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy || cardCount === 0}
          onClick={() => void allocate(!built)}
          className="cursor-pointer rounded-lg bg-accent px-3 py-2 text-sm text-accent-contrast disabled:opacity-40"
        >
          {built ? "Release the cards" : "Mark as built"}
        </button>

        <span className="text-xs text-muted">
          {built
            ? `${allocatedCount} card${allocatedCount === 1 ? "" : "s"} claimed — other decks will not count them as available.`
            : "Claims the physical copies, so another deck cannot also plan to use them. Nothing in the collection moves."}
        </span>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-bad">
          {error}
        </p>
      ) : null}

      {status ? (
        <p role="status" className="mt-3 text-sm text-muted">
          {status}
        </p>
      ) : null}

      <div className="mt-4 border-t border-border pt-3">
        {confirmingDelete ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm">
              Delete “{name}”? The card list goes with it. Your collection is
              not touched.
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(
                  () => deleteDeckAction(deckId),
                  () => router.push("/decks"),
                )
              }
              className="cursor-pointer rounded-lg border border-border px-3 py-1.5 text-sm text-bad hover:text-foreground disabled:opacity-40"
            >
              Delete it
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="cursor-pointer text-sm text-muted underline underline-offset-4 hover:text-foreground"
            >
              Keep it
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="cursor-pointer text-sm text-muted underline underline-offset-4 hover:text-foreground"
          >
            Delete this deck
          </button>
        )}
      </div>
    </div>
  );
}
