"use client";

import { useCallback, useEffect, useRef } from "react";

import {
  removeWishAction,
  setWishQuantityAction,
} from "@/app/wishlist/actions";
import { useLiveQuantity } from "@/components/use-live-quantity";

/**
 * Quantity and removal for one wishlist row.
 *
 * Minus at one copy removes the row rather than refusing: "I don't want this
 * any more" is the same gesture as "one fewer", and a disabled button that
 * means neither is worse than either.
 *
 * Unlike the collection and deck actions, this one takes a *total* rather
 * than a delta, so the running target is tracked here: two clicks in quick
 * succession have to send 3 then 2, not 3 then 3. The ref is what makes that
 * right without waiting for a round trip between presses.
 */
export function WishlistRowControls({
  id,
  quantity,
  name,
}: {
  id: string;
  quantity: number;
  name: string;
}) {
  const target = useRef(quantity);

  // The server's number wins whenever a refresh lands.
  useEffect(() => {
    target.current = quantity;
  }, [quantity]);

  const onAdjust = useCallback(
    (delta: number) => {
      target.current = Math.max(target.current + delta, 0);
      return setWishQuantityAction(id, target.current);
    },
    [id],
  );

  const { shown, error, adjust, run, refreshNow } = useLiveQuantity({
    quantity,
    onAdjust,
  });

  /*
   * Reaching zero deletes the row, so the page has to re-render for it to
   * disappear — the coalesced refresh would leave a removed row on screen.
   */
  function step(delta: number) {
    const willRemove = shown + delta <= 0;
    adjust(delta);
    if (willRemove) refreshNow();
  }

  const buttonClass =
    "cursor-pointer rounded-md border border-border bg-surface px-2 py-1 text-sm leading-none hover:border-accent hover:bg-surface-muted";

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => step(-1)}
        className={buttonClass}
        aria-label={
          quantity === 1
            ? `Remove ${name} from the wishlist`
            : `One fewer ${name}`
        }
      >
        −
      </button>
      <span className="w-6 text-center text-sm tabular-nums">{shown}</span>
      <button
        type="button"
        onClick={() => step(1)}
        className={buttonClass}
        aria-label={`One more ${name}`}
      >
        +
      </button>
      <button
        type="button"
        onClick={() =>
          run(async () => {
            const result = await removeWishAction(id);
            if (result.ok) refreshNow();
            return result;
          })
        }
        className="cursor-pointer text-xs text-muted underline underline-offset-4 hover:text-foreground"
      >
        Remove
      </button>
      {error ? (
        <span role="alert" className="text-xs text-bad">
          {error}
        </span>
      ) : null}
    </span>
  );
}
