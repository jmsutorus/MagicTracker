"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { setDeckTargetSizeAction } from "@/app/decks/actions";
import {
  CUBE_SIZE_CHOICES,
  MAX_CUBE_SIZE,
  MIN_CUBE_SIZE,
  draftersFor,
} from "@/lib/decks/constants";

/**
 * How big this cube is meant to be.
 *
 * The common sizes are offered because they are not arbitrary — each is a
 * whole number of 15-card packs for a whole pod — and a free number is
 * offered too, because plenty of cubes are 400 cards and that is the owner's
 * business. The label says what each size seats rather than leaving the
 * arithmetic to the reader.
 */
const OTHER = "other";

function label(size: number): string {
  const drafters = draftersFor(size);
  return drafters === null ? `${size}` : `${size} — ${drafters} drafters`;
}

export function CubeSizeForm({
  deckId,
  targetSize,
}: {
  deckId: string;
  targetSize: number;
}) {
  const router = useRouter();

  const listed = CUBE_SIZE_CHOICES.includes(targetSize);
  const [choice, setChoice] = useState(listed ? String(targetSize) : OTHER);
  const [custom, setCustom] = useState(String(targetSize));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const wanted =
    choice === OTHER ? Number.parseInt(custom, 10) : Number(choice);
  const valid =
    Number.isSafeInteger(wanted) &&
    wanted >= MIN_CUBE_SIZE &&
    wanted <= MAX_CUBE_SIZE;

  async function save() {
    if (!valid || wanted === targetSize) return;

    setBusy(true);
    setError(null);
    setStatus(null);

    const result = await setDeckTargetSizeAction(deckId, wanted);

    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    setStatus(`Target is now ${wanted} cards.`);
    router.refresh();
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Cube size</span>
          <select
            value={choice}
            disabled={busy}
            onChange={(e) => setChoice(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          >
            {CUBE_SIZE_CHOICES.map((size) => (
              <option key={size} value={String(size)}>
                {label(size)}
              </option>
            ))}
            <option value={OTHER}>Another size…</option>
          </select>
        </label>

        {choice === OTHER ? (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Cards</span>
            <input
              type="number"
              inputMode="numeric"
              min={MIN_CUBE_SIZE}
              max={MAX_CUBE_SIZE}
              value={custom}
              disabled={busy}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void save();
                }
              }}
              className="w-24 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </label>
        ) : null}

        <button
          type="button"
          disabled={busy || !valid || wanted === targetSize}
          onClick={() => void save()}
          className="cursor-pointer rounded-lg border border-border px-3 py-2 text-sm hover:border-accent disabled:opacity-40"
        >
          {busy ? "Saving…" : "Set size"}
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-sm text-bad">
          {error}
        </p>
      ) : null}
      {status && !error ? (
        <p className="mt-2 text-sm text-muted">{status}</p>
      ) : null}
    </div>
  );
}
