"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cardImageUrl } from "@/lib/scryfall/client";

const PREVIEW_W = 244;
const PREVIEW_H = 340;
/** Gap between the link and the preview, and the minimum viewport margin. */
const GAP = 12;
const EDGE = 8;

/**
 * A card name that shows the card.
 *
 * On Moxfield and Archidekt, hovering any card name pops its image. It is the
 * most-used affordance on either site, and its absence is why this app's
 * tables felt like a spreadsheet: the only way to see a card was to click
 * through to its page and lose your place in a 100-row list.
 *
 * The preview is deliberately not a tooltip library — it is one image — but
 * it is rendered through a **portal**, fixed to the viewport, rather than
 * positioned inside the link. Every table in this app is wrapped in a
 * `rounded-lg overflow-hidden` container to clip its corners, and an
 * absolutely positioned child of a row is clipped by it: the first version of
 * this showed the bottom two thirds of the card and cut the art off. Nothing
 * in the row's ancestry can clip a fixed element in a portal.
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
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLAnchorElement>(null);

  function show() {
    if (!imageId) return;
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;

    /*
     * Beside the link, flipping to whichever side has room, and never off
     * the screen. A preview you cannot see is worse than none, and the one
     * card it would happen to is always the one being pointed at.
     */
    const fitsRight = box.right + GAP + PREVIEW_W + EDGE <= window.innerWidth;
    const left = fitsRight
      ? box.right + GAP
      : Math.max(EDGE, box.left - GAP - PREVIEW_W);

    // Centred on the row, then clamped into the viewport.
    const wanted = box.top + box.height / 2 - PREVIEW_H / 2;
    const top = Math.min(
      Math.max(EDGE, wanted),
      Math.max(EDGE, window.innerHeight - PREVIEW_H - EDGE),
    );

    setAt({ left, top });
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

      {at && imageId
        ? createPortal(
            <span
              aria-hidden
              className="pointer-events-none fixed z-50 hidden sm:block"
              style={{ left: at.left, top: at.top, width: PREVIEW_W }}
            >
              {/*
                Plain <img>: the source is Scryfall's CDN, which their terms
                require us to hotlink rather than re-host, so there is
                nothing for the Next loader to optimise. The explicit width
                on the span and `w-full` here are load-bearing — preflight
                gives images `max-width: 100%; height: auto`, which collapses
                to nothing inside a box that sizes itself to its contents.
              */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={cardImageUrl(imageId, "normal")}
                alt=""
                width={PREVIEW_W}
                height={PREVIEW_H}
                className="aspect-[488/680] w-full rounded-xl border border-border bg-surface shadow-xl"
              />
            </span>,
            document.body,
          )
        : null}
    </>
  );
}
