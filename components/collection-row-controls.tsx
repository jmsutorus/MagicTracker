"use client";

import { useCallback, useState } from "react";

import {
  adjustQuantityAction,
  moveItemAction,
  removeItemAction,
} from "@/app/collection/actions";
import { useLiveQuantity } from "@/components/use-live-quantity";

type Props = {
  itemId: string;
  quantity: number;
  locationId: string;
  locations: { id: string; name: string }[];
};

/**
 * Per-row quantity, location and removal controls on the browse screen.
 *
 * The server owns the arithmetic — the action sends a delta, not a new total,
 * so two adjustments in flight at once cannot overwrite each other with a
 * stale number. The quantity shown moves on the click rather than on the
 * response, and the route is revalidated once the clicking stops; see
 * use-live-quantity.ts for why it works that way. The row disappears on
 * reaching zero because the schema forbids a stored quantity of 0.
 */
export function CollectionRowControls({
  itemId,
  quantity,
  locationId,
  locations,
}: Props) {
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);

  const onAdjust = useCallback(
    (delta: number) => adjustQuantityAction(itemId, delta),
    [itemId],
  );

  const { shown, error, adjust, run, refreshNow } = useLiveQuantity({
    quantity,
    onAdjust,
  });

  function move(nextLocationId: string) {
    if (nextLocationId === locationId) return;
    run(() => moveItemAction(itemId, nextLocationId));
  }

  const buttonClass =
    "size-7 cursor-pointer rounded border border-border bg-surface text-sm leading-none text-muted hover:border-accent hover:text-foreground";

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {error ? (
        <span role="alert" className="text-xs text-bad">
          {error}
        </span>
      ) : null}

      <select
        value={locationId}
        onChange={(e) => move(e.target.value)}
        aria-label="Location"
        className="rounded border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-accent"
      >
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => adjust(-1)}
          aria-label="Remove one copy"
          className={buttonClass}
        >
          −
        </button>
        <span className="w-8 text-center font-mono text-sm tabular-nums">
          {shown}
        </span>
        <button
          type="button"
          onClick={() => adjust(1)}
          aria-label="Add one copy"
          className={buttonClass}
        >
          +
        </button>
      </div>

      {confirmingRemoval ? (
        <span className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => {
              /*
               * Refreshed immediately rather than after the quiet period:
               * the row is meant to vanish, and leaving a deleted row on
               * screen for another 400ms reads as the click not working.
               */
              run(async () => {
                const result = await removeItemAction(itemId);
                if (result.ok) refreshNow();
                return result;
              });
            }}
            className="cursor-pointer text-bad underline underline-offset-4"
          >
            remove all {shown}
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
          onClick={() => setConfirmingRemoval(true)}
          aria-label="Remove every copy in this row"
          className="cursor-pointer text-xs text-muted underline underline-offset-4 hover:text-bad"
        >
          remove
        </button>
      )}
    </div>
  );
}
