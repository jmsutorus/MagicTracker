"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { addWishAction } from "@/app/wishlist/actions";

/**
 * "Want this" — for one card, or for one specific printing of it.
 *
 * Adding the same thing twice raises the quantity rather than failing, so the
 * button never has to go dead; it says what happened instead.
 */
export function WishButton({
  oracleId,
  printingId = null,
  finish = null,
  label = "Add to wishlist",
  compact = false,
}: {
  oracleId: string;
  printingId?: string | null;
  finish?: string | null;
  label?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<"idle" | "added" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  function add() {
    startTransition(async () => {
      const result = await addWishAction({ oracleId, printingId, finish });
      if (result.ok) {
        setState("added");
        router.refresh();
        window.setTimeout(() => setState("idle"), 4000);
      } else {
        setState("error");
        setError(result.error);
      }
    });
  }

  const text =
    state === "added" ? "On your wishlist" : state === "error" ? error : label;

  return (
    <button
      type="button"
      onClick={add}
      disabled={pending}
      className={
        compact
          ? "cursor-pointer text-xs text-muted underline underline-offset-4 hover:text-foreground disabled:opacity-50"
          : "inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-muted disabled:opacity-50"
      }
      aria-live="polite"
    >
      {text}
    </button>
  );
}
