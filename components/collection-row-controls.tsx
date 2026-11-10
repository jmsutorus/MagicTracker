"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  adjustQuantityAction,
  moveItemAction,
  removeItemAction,
} from "@/app/collection/actions";

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
 * stale number. The local quantity is only what is drawn until the refresh
 * lands, and the row disappears on reaching zero because the schema forbids a
 * stored quantity of 0.
 */
export function CollectionRowControls({
  itemId,
  quantity,
  locationId,
  locations,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useState(quantity);
  const [error, setError] = useState<string | null>(null);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);

  async function adjust(delta: number) {
    setError(null);
    const result = await adjustQuantityAction(itemId, delta);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setShown(result.quantity);
    startTransition(() => router.refresh());
  }

  async function remove() {
    setError(null);
    const result = await removeItemAction(itemId);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    startTransition(() => router.refresh());
  }

  async function move(nextLocationId: string) {
    if (nextLocationId === locationId) return;
    setError(null);
    const result = await moveItemAction(itemId, nextLocationId);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    startTransition(() => router.refresh());
  }

  const buttonClass =
    "size-7 cursor-pointer rounded border border-border bg-surface text-sm leading-none text-muted hover:text-foreground disabled:opacity-40";

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {error ? (
        <span role="alert" className="text-xs text-bad">
          {error}
        </span>
      ) : null}

      <select
        value={locationId}
        onChange={(e) => void move(e.target.value)}
        disabled={pending}
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
          onClick={() => void adjust(-1)}
          disabled={pending}
          aria-label="Remove one copy"
          className={buttonClass}
        >
          −
        </button>
        <span className="w-8 text-center font-mono text-sm">{shown}</span>
        <button
          type="button"
          onClick={() => void adjust(1)}
          disabled={pending}
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
            onClick={() => void remove()}
            disabled={pending}
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
          disabled={pending}
          aria-label="Remove every copy in this row"
          className="cursor-pointer text-xs text-muted underline underline-offset-4 hover:text-bad"
        >
          remove
        </button>
      )}
    </div>
  );
}
