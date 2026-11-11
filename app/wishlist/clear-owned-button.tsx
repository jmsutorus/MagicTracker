"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { clearOwnedWishesAction } from "./actions";

/**
 * Removes the wishes the collection already satisfies.
 *
 * Asked rather than done instantly, because it deletes rows and the count is
 * the only thing that says how many. A wish is cheap to re-add; the note on
 * it is not.
 */
export function ClearOwnedButton({ count }: { count: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [asking, setAsking] = useState(false);

  function clear() {
    startTransition(async () => {
      await clearOwnedWishesAction();
      setAsking(false);
      router.refresh();
    });
  }

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="cursor-pointer text-sm text-muted underline underline-offset-4 hover:text-foreground"
      >
        Remove the {count === 1 ? "one" : count} you own
      </button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-3 text-sm">
      <span className="text-muted">
        Remove {count === 1 ? "it" : `all ${count}`}?
      </span>
      <button
        type="button"
        onClick={clear}
        disabled={pending}
        className="cursor-pointer rounded-md border border-border bg-surface px-2.5 py-1 text-sm hover:bg-surface-muted disabled:opacity-50"
      >
        Remove
      </button>
      <button
        type="button"
        onClick={() => setAsking(false)}
        className="cursor-pointer text-sm text-muted underline underline-offset-4 hover:text-foreground"
      >
        Keep them
      </button>
    </span>
  );
}
