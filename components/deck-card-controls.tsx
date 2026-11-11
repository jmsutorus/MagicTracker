"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  adjustDeckCardAction,
  removeDeckCardAction,
  setDeckCardBoardAction,
} from "@/app/decks/actions";
import {
  DECK_BOARDS,
  DECK_BOARD_LABELS,
  type DeckBoard,
} from "@/lib/decks/constants";

/**
 * Quantity, board and removal for one card in a deck.
 *
 * The board select is how a card becomes the commander — there is no separate
 * "set commander" control, because the command zone is a board like any
 * other (see lib/decks/constants.ts) and one control for one concept is
 * fewer things to learn.
 */
export function DeckCardControls({
  deckCardId,
  deckId,
  board,
  quantity,
}: {
  deckCardId: string;
  deckId: string;
  board: DeckBoard;
  quantity: number;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(work: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const result = await work();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "That did not work.");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <span className="flex flex-wrap items-center gap-1">
      <button
        type="button"
        aria-label="One fewer"
        disabled={busy}
        onClick={() =>
          void run(() => adjustDeckCardAction(deckCardId, -1, deckId))
        }
        className="cursor-pointer rounded border border-border px-2 text-sm hover:text-foreground disabled:opacity-40"
      >
        −
      </button>
      <span className="w-6 text-center text-sm tabular-nums">{quantity}</span>
      <button
        type="button"
        aria-label="One more"
        disabled={busy}
        onClick={() =>
          void run(() => adjustDeckCardAction(deckCardId, 1, deckId))
        }
        className="cursor-pointer rounded border border-border px-2 text-sm hover:text-foreground disabled:opacity-40"
      >
        +
      </button>

      <select
        aria-label="Board"
        value={board}
        disabled={busy}
        onChange={(e) =>
          void run(() =>
            setDeckCardBoardAction(deckCardId, e.target.value, deckId),
          )
        }
        className="ml-1 rounded border border-border bg-surface px-1 py-0.5 text-xs outline-none focus:border-accent"
      >
        {DECK_BOARDS.map((b) => (
          <option key={b} value={b}>
            {DECK_BOARD_LABELS[b]}
          </option>
        ))}
      </select>

      <button
        type="button"
        disabled={busy}
        onClick={() => void run(() => removeDeckCardAction(deckCardId, deckId))}
        className="ml-1 cursor-pointer text-xs text-muted underline underline-offset-4 hover:text-foreground disabled:opacity-40"
      >
        Remove
      </button>

      {error ? (
        <span role="alert" className="ml-2 text-xs text-bad">
          {error}
        </span>
      ) : null}
    </span>
  );
}
