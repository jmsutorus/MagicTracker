"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  removeWishAction,
  setWishQuantityAction,
} from "@/app/wishlist/actions";

/**
 * Quantity and removal for one wishlist row.
 *
 * Minus at one copy removes the row rather than refusing: "I don't want this
 * any more" is the same gesture as "one fewer", and a disabled button that
 * means neither is worse than either.
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
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function setTo(next: number) {
    startTransition(async () => {
      const result = await setWishQuantityAction(id, next);
      if (result.ok) {
        setError(null);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await removeWishAction(id);
      if (result.ok) {
        setError(null);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  const buttonClass =
    "cursor-pointer rounded-md border border-border bg-surface px-2 py-1 text-sm leading-none hover:bg-surface-muted disabled:opacity-50";

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => setTo(quantity - 1)}
        disabled={pending}
        className={buttonClass}
        aria-label={
          quantity === 1
            ? `Remove ${name} from the wishlist`
            : `One fewer ${name}`
        }
      >
        −
      </button>
      <span className="w-6 text-center text-sm tabular-nums">{quantity}</span>
      <button
        type="button"
        onClick={() => setTo(quantity + 1)}
        disabled={pending}
        className={buttonClass}
        aria-label={`One more ${name}`}
      >
        +
      </button>
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        className="cursor-pointer text-xs text-muted underline underline-offset-4 hover:text-foreground disabled:opacity-50"
      >
        Remove
      </button>
      {error ? <span className="text-xs text-bad">{error}</span> : null}
    </span>
  );
}
