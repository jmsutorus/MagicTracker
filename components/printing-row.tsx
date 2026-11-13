"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  CardPreview,
  placeBeside,
  type PreviewSpot,
} from "@/components/card-preview";

/**
 * One row of the printings list on a card page, which shows its own art.
 *
 * The printings list is the one place in the app where every row is the same
 * card and the *picture* is the difference between them — borderless against
 * normal, the retro frame, the showcase treatment, four different arts of the
 * same creature. A list of set codes cannot answer "which one is the pretty
 * one", so pointing at a row shows it, the same way pointing at a card name
 * does elsewhere (components/card-link.tsx).
 *
 * The preview sits beside the *list* but is centred on the *row*, so it does
 * not slide left and right as the pointer moves down a long list of
 * printings. All of that measuring is components/card-preview.tsx; what is
 * particular to a row here is when to measure.
 *
 * Only the behaviour lives in this client component. The row's contents and
 * its layout classes are passed in, which keeps the markup of a page that is
 * otherwise entirely server-rendered on the server.
 */
export function PrintingRow({
  imageId,
  className = "",
  children,
}: {
  /** Scryfall printing id — this printing's own art, not the card's. */
  imageId: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const [at, setAt] = useState<PreviewSpot | null>(null);
  const ref = useRef<HTMLLIElement>(null);

  const show = useCallback(() => {
    const row = ref.current;
    const list = row?.closest("ul");
    if (!row || !list) return;
    setAt(
      placeBeside(list.getBoundingClientRect(), row.getBoundingClientRect()),
    );
  }, []);

  /*
   * A printings list runs to fifty rows for a card like Lightning Bolt, so it
   * is normal to scroll with one open. The pointer usually ends up over a
   * different row, which re-measures by itself, but a short scroll leaves it
   * on the same row with the preview now pointing at the wrong place.
   */
  const open = at !== null;
  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", show, { passive: true });
    window.addEventListener("resize", show);
    return () => {
      window.removeEventListener("scroll", show);
      window.removeEventListener("resize", show);
    };
  }, [open, show]);

  return (
    <li
      ref={ref}
      className={className}
      onMouseEnter={show}
      onMouseLeave={() => setAt(null)}
      /*
       * Focus as well as hover: the row holds a Want button and two store
       * links, so it is reachable by keyboard, and a preview only the mouse
       * could summon would be missing from the half of the flow that matters.
       * Moving between the row's own controls must not blink it, hence the
       * check for where focus actually went.
       */
      onFocus={show}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget)) return;
        setAt(null);
      }}
    >
      {children}
      {at ? <CardPreview imageId={imageId} at={at} /> : null}
    </li>
  );
}
