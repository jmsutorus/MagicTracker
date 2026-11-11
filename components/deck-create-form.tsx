"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createDeckAction } from "@/app/decks/actions";
import {
  CUBE_SIZE_CHOICES,
  DECK_FORMATS,
  DECK_FORMAT_LABELS,
  DEFAULT_CUBE_SIZE,
  MAX_CUBE_SIZE,
  MIN_CUBE_SIZE,
  draftersFor,
  type DeckFormat,
} from "@/lib/decks/constants";

/**
 * Create a deck and go straight to it.
 *
 * It navigates rather than returning to the list, because the only reason to
 * create a deck is to put cards in it.
 *
 * The format is chosen here and not changed later. That is deliberate: the
 * two formats mean different things about every card in the list — a cube has
 * no command zone and no colour identity — so switching one would silently
 * reinterpret the whole deck. Pasting a list into a new cube is one step on
 * the import screen, which is how a cube usually arrives anyway.
 */
const OTHER = "other";

export function DeckCreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [format, setFormat] = useState<DeckFormat>("commander");
  const [sizeChoice, setSizeChoice] = useState(String(DEFAULT_CUBE_SIZE));
  const [customSize, setCustomSize] = useState(String(DEFAULT_CUBE_SIZE));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wantedSize =
    sizeChoice === OTHER ? Number.parseInt(customSize, 10) : Number(sizeChoice);
  const sizeValid =
    format !== "cube" ||
    (Number.isSafeInteger(wantedSize) &&
      wantedSize >= MIN_CUBE_SIZE &&
      wantedSize <= MAX_CUBE_SIZE);

  async function create() {
    const trimmed = name.trim();
    if (trimmed.length === 0 || !sizeValid) return;

    setBusy(true);
    setError(null);

    const result = await createDeckAction(trimmed, {
      format,
      targetSize: format === "cube" ? wantedSize : null,
    });

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
            placeholder={
              format === "cube"
                ? "Vintage cube, Peasant cube…"
                : "Zinnia, Valley's Voice…"
            }
            className="w-64 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Format</span>
          <select
            value={format}
            disabled={busy}
            onChange={(e) => setFormat(e.target.value as DeckFormat)}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          >
            {DECK_FORMATS.map((option) => (
              <option key={option} value={option}>
                {DECK_FORMAT_LABELS[option]}
              </option>
            ))}
          </select>
        </label>

        {format === "cube" ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">Size</span>
              <select
                value={sizeChoice}
                disabled={busy}
                onChange={(e) => setSizeChoice(e.target.value)}
                className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
              >
                {CUBE_SIZE_CHOICES.map((size) => {
                  const drafters = draftersFor(size);
                  return (
                    <option key={size} value={String(size)}>
                      {drafters === null
                        ? `${size}`
                        : `${size} — ${drafters} drafters`}
                    </option>
                  );
                })}
                <option value={OTHER}>Another size…</option>
              </select>
            </label>

            {sizeChoice === OTHER ? (
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted">Cards</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={MIN_CUBE_SIZE}
                  max={MAX_CUBE_SIZE}
                  value={customSize}
                  disabled={busy}
                  onChange={(e) => setCustomSize(e.target.value)}
                  className="w-24 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
                />
              </label>
            ) : null}
          </>
        ) : null}

        <button
          type="button"
          disabled={busy || name.trim().length === 0 || !sizeValid}
          onClick={() => void create()}
          className="cursor-pointer rounded-lg bg-accent px-3 py-2 text-sm text-accent-contrast disabled:opacity-40"
        >
          {busy ? "Creating…" : "Create"}
        </button>
      </div>

      <p className="mt-2 text-xs text-muted">
        {format === "cube"
          ? "A draft pool: singleton by convention, no commander, no colour identity to stay inside. The size is yours to change later."
          : "100 cards, singleton, inside the commander's colour identity — checked as you build."}
      </p>

      {error ? (
        <p role="alert" className="mt-2 text-sm text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}
