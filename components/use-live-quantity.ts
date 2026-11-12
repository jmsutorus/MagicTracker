"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/** How long to wait for more clicks before asking the server to re-render. */
const REFRESH_QUIET_MS = 400;

type Result = { ok: boolean; error?: string };

/**
 * A quantity you can click up and down without waiting for a round trip.
 *
 * What this replaces: every +/− button in the app used to `await` its server
 * action, then call `router.refresh()`, and sat `disabled` for the duration.
 * Three consequences, all of them felt:
 *
 *  1. The number did not move until the server answered — on a sleeping Neon
 *     compute, that is a visible pause on a button press.
 *  2. The button was disabled while it waited, so adding four copies meant
 *     four round trips you had to sit through *in sequence*. On Manabox that
 *     is four taps.
 *  3. Each click refetched the whole route, and the actions revalidate up to
 *     five paths, so a run up to 4 copies refetched the collection, the
 *     dashboard and the deck list four times over.
 *
 * So: the shown number moves immediately, the action is fired and not
 * awaited, and the revalidation is coalesced — one refresh once the clicking
 * stops, rather than one per click. The server still owns the arithmetic
 * (every action takes a *delta*, never a total), which is what makes firing
 * several at once safe: two in-flight adjustments cannot overwrite each other
 * with a stale total.
 *
 * Why not `useOptimistic`: it reverts its optimistic value when the
 * transition that set it ends. That is right when the refresh is inside the
 * transition, but here the refresh is deliberately *debounced* outside it, so
 * the value would snap back to the stale server number and then forward again
 * — a flicker on every click. Reconciling against the prop instead gives the
 * same guarantee (the server's number always wins in the end) with no flicker.
 */
export function useLiveQuantity({
  quantity,
  onAdjust,
}: {
  /** The server's number. Wins whenever it changes. */
  quantity: number;
  /** Sends a delta. Resolves ok, or with a message to show and revert. */
  onAdjust: (delta: number) => Promise<Result>;
}) {
  const router = useRouter();
  const [shown, setShown] = useState(quantity);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /*
   * The server's number is the truth. When a refresh lands with a different
   * one — because another tab moved it, or because an adjustment failed
   * server-side — the display follows it rather than keeping a local guess.
   *
   * Adjusted during render rather than in an effect. This is React's
   * documented way to reset state when a prop changes: an effect would
   * render the stale number once, then immediately re-render with the new
   * one, which is both a wasted pass and a visible flash of the old count.
   */
  const [lastQuantity, setLastQuantity] = useState(quantity);
  if (quantity !== lastQuantity) {
    setLastQuantity(quantity);
    setShown(quantity);
  }

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      router.refresh();
    }, REFRESH_QUIET_MS);
  }, [router]);

  const adjust = useCallback(
    (delta: number) => {
      setError(null);
      // Moves now. The await below never gates the number.
      setShown((n) => Math.max(n + delta, 0));

      void (async () => {
        const result = await onAdjust(delta);
        if (!result.ok) {
          setError(result.error ?? "That did not work.");
          // Put it back: the copy was never added or removed.
          setShown((n) => n - delta);
          return;
        }
        scheduleRefresh();
      })();
    },
    [onAdjust, scheduleRefresh],
  );

  /** For an action that is not a delta — a removal, a move, a board change. */
  const run = useCallback(
    (work: () => Promise<Result>) => {
      setError(null);
      void (async () => {
        const result = await work();
        if (!result.ok) {
          setError(result.error ?? "That did not work.");
          return;
        }
        scheduleRefresh();
      })();
    },
    [scheduleRefresh],
  );

  /** Refresh now rather than after the quiet period. */
  const refreshNow = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    router.refresh();
  }, [router]);

  return { shown, error, setError, adjust, run, refreshNow };
}
