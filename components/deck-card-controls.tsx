"use client";

import { useCallback } from "react";

import {
  adjustDeckCardAction,
  removeDeckCardAction,
  setDeckCardBoardAction,
} from "@/app/decks/actions";
import { useLiveQuantity } from "@/components/use-live-quantity";
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
 *
 * The count moves on the click, not on the response: building a cube means
 * hundreds of these, and a deck page that refetches itself between every
 * press is the reason this felt slower than the tools it is compared with.
 * See use-live-quantity.ts.
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

  const onAdjust = useCallback(
    (delta: number) => adjustDeckCardAction(deckCardId, delta, deckId),
    [deckCardId, deckId],
  );

  const { shown, error, adjust, run, refreshNow } = useLiveQuantity({
    quantity,
    onAdjust,
  });

  return (
    <span className="flex flex-wrap items-center gap-1">
      <button
        type="button"
        aria-label="One fewer"
        onClick={() => adjust(-1)}
        className="cursor-pointer rounded border border-border px-2 text-sm hover:border-accent hover:text-foreground"
      >
        −
      </button>
      <span className="w-6 text-center text-sm tabular-nums">{shown}</span>
      <button
        type="button"
        aria-label="One more"
        onClick={() => adjust(1)}
        className="cursor-pointer rounded border border-border px-2 text-sm hover:border-accent hover:text-foreground"
      >
        +
      </button>

      <select
        aria-label="Board"
        value={board}
        onChange={(e) => {
          const next = e.target.value;
          /*
           * Immediately, not after the quiet period: moving a card to
           * another board moves the row to another section of the page, and
           * that only happens on a re-render.
           */
          run(async () => {
            const result = await setDeckCardBoardAction(
              deckCardId,
              next,
              deckId,
            );
            if (result.ok) refreshNow();
            return result;
          });
        }}
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
        onClick={() =>
          run(async () => {
            const result = await removeDeckCardAction(deckCardId, deckId);
            if (result.ok) refreshNow();
            return result;
          })
        }
        className="ml-1 cursor-pointer text-xs text-muted underline underline-offset-4 hover:text-foreground"
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
