"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

/**
 * Put the cursor back in an input that is disabled while the add is in flight.
 *
 * Every entry box in the app clears itself and calls `input.focus()` as soon
 * as the server action resolves — and every one of them failed to, because the
 * box is `disabled={busy}`. `setBusy(false)` only *schedules* a render, so at
 * the moment `focus()` runs the element still carries `disabled` in the DOM,
 * and focusing a disabled element is a silent no-op. The box re-enabled a tick
 * later with the cursor nowhere, so the next card name went into the void
 * until you clicked back in — which is exactly the mouse trip the keyboard
 * flow exists to avoid.
 *
 * So the request to focus is remembered and served after the render that
 * re-enables the element. Each request is served once (`served`), so an
 * unrelated action that happens to flip `busy` cannot steal the cursor back
 * into the box on its own.
 */
export function useReturnFocus(
  ref: RefObject<HTMLInputElement | null>,
  busy: boolean,
  { select = false }: { select?: boolean } = {},
): () => void {
  const [request, setRequest] = useState(0);
  const served = useRef(0);

  useEffect(() => {
    if (busy || request === served.current) return;
    served.current = request;

    const input = ref.current;
    if (!input) return;
    input.focus();
    // Number mode re-reads the same box every card, so selecting lets the next
    // number overwrite the last one instead of appending to it.
    if (select) input.select();
  }, [busy, request, ref, select]);

  return useCallback(() => setRequest((n) => n + 1), []);
}
