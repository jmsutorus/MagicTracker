"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createDeckAction } from "@/app/decks/actions";

/**
 * Create a deck and go straight to it.
 *
 * It navigates rather than returning to the list, because the only reason to
 * create a deck is to put cards in it.
 */
export function DeckCreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;

    setBusy(true);
    setError(null);

    const result = await createDeckAction(trimmed);

    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }

    // Left busy on purpose: the navigation is the next thing that happens,
    // and re-enabling the button would invite a second deck.
    router.push(`/decks/${result.id}`);
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">New deck</span>
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
            placeholder="Zinnia, Valley's Voice…"
            className="w-64 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent"
          />
        </label>
        <button
          type="button"
          disabled={busy || name.trim().length === 0}
          onClick={() => void create()}
          className="cursor-pointer rounded-lg bg-accent px-3 py-2 text-sm text-accent-contrast disabled:opacity-40"
        >
          {busy ? "Creating…" : "Create"}
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-sm text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}
