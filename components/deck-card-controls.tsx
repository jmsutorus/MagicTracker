"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  adjustDeckCardAction,
  removeDeckCardAction,
  setDeckCardBoardAction,
} from "@/app/decks/actions";
import {
  boardLabel,
  boardsFor,
  type DeckBoard,
  type DeckFormat,
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
  format,
  board,
  quantity,
}: {
  deckCardId: string;
  deckId: string;
  /** Decides which boards exist: a cube has no command zone. */
  format: DeckFormat;
  board: DeckBoard;
  quantity: number;
}) {
  /*
   * The card's current board is always an option, even when the format does
   * not offer it. A cube with a card left in the command zone needs to be
   * able to move it out, and a select whose value matches none of its
   * options renders as blank — so the way out would be the control that
   * looks broken.
   */
  const boards = boardsFor(format);
  const options = boards.includes(board) ? boards : [board, ...boards];
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
        {options.map((b) => (
          <option key={b} value={b}>
            {boardLabel(format, b)}
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
