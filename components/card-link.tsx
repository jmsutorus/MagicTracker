"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import {
  CardPreview,
  placeBeside,
  type PreviewSpot,
} from "@/components/card-preview";

/**
 * A card name that shows the card.
 *
 * On Moxfield and Archidekt, hovering any card name pops its image. It is the
 * most-used affordance on either site, and its absence is why this app's
 * tables felt like a spreadsheet: the only way to see a card was to click
 * through to its page and lose your place in a 100-row list.
 *
 * The preview itself is components/card-preview.tsx, shared with the
 * type-ahead lists; what is particular to a name is that the measurement
 * happens in the hover and focus handlers, which is the only moment a link
 * needs one.
 *
 * It never gates anything: the name is a real link to the card page, the text
 * reads fine without it, keyboard focus shows the same preview as the mouse,
 * and on touch (no hover) the tap goes straight through.
 */
export function CardLink({
  oracleId,
  imageId,
  name,
  children,
  className = "",
}: {
  oracleId: string;
  /** Scryfall printing id for the image. Null when none is known. */
  imageId: string | null;
  name: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const [at, setAt] = useState<PreviewSpot | null>(null);
  const ref = useRef<HTMLAnchorElement>(null);

  function show() {
    if (!imageId) return;
    const box = ref.current?.getBoundingClientRect();
    if (box) setAt(placeBeside(box));
  }

  return (
    <>
      <Link
        ref={ref}
        href={`/cards/${oracleId}`}
        className={`hover:underline ${className}`}
        onMouseEnter={show}
        onMouseLeave={() => setAt(null)}
        onFocus={show}
        onBlur={() => setAt(null)}
      >
        {children ?? name}
      </Link>

      {at && imageId ? <CardPreview imageId={imageId} at={at} /> : null}
    </>
  );
}
