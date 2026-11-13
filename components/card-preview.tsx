"use client";

import { useEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";

import { cardImageUrl } from "@/lib/scryfall/client";

/** The width a preview likes to be; it shrinks when the page leaves less. */
const PREVIEW_W = 244;
/**
 * Below this it stops being a picture you can recognise a card by, so a
 * preview this narrow overlaps the page rather than shrinking further. Showing
 * the card over the list beats not showing it at all.
 */
const MIN_W = 160;
/** Scryfall's card aspect, so the height follows from whatever width fits. */
const RATIO = 680 / 488;
/** Gap between the anchor and the preview, and the minimum viewport margin. */
const GAP = 12;
const EDGE = 8;

export type PreviewSpot = { left: number; top: number; width: number };

/**
 * Where a preview goes beside something, without leaving the viewport.
 *
 * Two boxes, because for a list they are different elements: the preview sits
 * beside the *list* (so it does not slide left and right as the highlight
 * moves) but is centred on the *row* (so it is clearly about the card you are
 * pointing at). For a single name, both are the name.
 *
 * It takes the roomier side and fits itself to that margin. The pages this
 * runs on are a centred column — `max-w-3xl` or `max-w-4xl` — so at 1600px
 * there is room for the full 244, at 1280 for about 210, and on a 13" laptop
 * for nothing much: a fixed width would mean a preview lying across the
 * legality and ownership badges of the very row being checked. Shrinking
 * keeps it beside the list down to `MIN_W`, and only a window narrower than
 * that overlaps.
 */
export function placeBeside(
  anchor: DOMRect,
  centreOn: DOMRect = anchor,
): PreviewSpot {
  const roomRight = window.innerWidth - anchor.right - GAP - EDGE;
  const roomLeft = anchor.left - GAP - EDGE;

  const width = Math.max(
    MIN_W,
    Math.min(PREVIEW_W, Math.max(roomRight, roomLeft)),
  );
  const onRight = roomRight >= width || roomRight >= roomLeft;

  const left = onRight
    ? Math.min(anchor.right + GAP, window.innerWidth - width - EDGE)
    : Math.max(EDGE, anchor.left - GAP - width);

  // Centred on the row, then clamped into the viewport.
  const height = width * RATIO;
  const wanted = centreOn.top + centreOn.height / 2 - height / 2;
  const top = Math.min(
    Math.max(EDGE, wanted),
    Math.max(EDGE, window.innerHeight - height - EDGE),
  );

  return { left, top, width };
}

/*
 * Shared between the two previews below. `fixed` rather than absolute, in a
 * portal to the body: every list in this app is wrapped in a
 * `rounded-lg overflow-hidden` container to clip its corners, and that clips
 * an absolutely positioned child of a row — the first version of the hover
 * preview showed the bottom two thirds of the card.
 *
 * Hidden below `sm`: a 244px card on a phone would cover the list it is
 * meant to be explaining, and a phone has no hover to trigger it anyway.
 */
const BOX_CLASS = "pointer-events-none fixed z-50 hidden sm:block";

function PreviewImage({ imageId }: { imageId: string }) {
  return (
    /*
     * Plain <img>: the source is Scryfall's CDN, which their terms require us
     * to hotlink rather than re-host, so there is nothing for the Next loader
     * to optimise. The explicit width on the wrapper and `w-full` here are
     * load-bearing — preflight gives images `max-width: 100%; height: auto`,
     * which collapses to nothing inside a box that sizes itself to its
     * contents.
     *
     * No `key` on the element as the id changes: swapping `src` leaves the
     * previous card on screen until the next one has decoded, which is
     * steadier than blanking between rows while arrowing down a list.
     */
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={cardImageUrl(imageId, "normal")}
      alt=""
      width={488}
      height={680}
      className="aspect-[488/680] w-full rounded-xl border border-border bg-surface shadow-xl"
    />
  );
}

/**
 * One card image, floating at a spot already worked out by the caller.
 *
 * For anchors whose preview is driven by an event — a hover or a focus — where
 * the measurement belongs in the handler that caused it.
 */
export function CardPreview({
  imageId,
  at,
}: {
  imageId: string;
  at: PreviewSpot;
}) {
  return createPortal(
    <span
      aria-hidden
      className={BOX_CLASS}
      style={{ left: at.left, top: at.top, width: at.width }}
    >
      <PreviewImage imageId={imageId} />
    </span>,
    document.body,
  );
}

/**
 * The card the highlighted row of an open type-ahead list is about.
 *
 * Why the *active* row rather than only the hovered one: every one of these
 * lists is keyboard-first — type, arrow to the card, Enter — and a preview
 * that needed the mouse would be missing from the flow that matters. Hovering
 * a row sets the active index in all of them, so pointing at a card still
 * previews it; arrowing onto one now does too.
 *
 * The position is written onto the node rather than held in state. A measured
 * position cannot be known before the row is in the DOM, and `setState` from
 * inside an effect cascades a second render — which `react-hooks` rejects
 * outright (see the same note in components/collection-entry.tsx). So the box
 * renders hidden, and the effect that places it makes it visible.
 */
export function ListRowPreview({
  listRef,
  activeIndex,
  imageId,
}: {
  /** The `<ul>` whose `<li>`s are the rows. */
  listRef: RefObject<HTMLElement | null>;
  activeIndex: number;
  /** The active row's printing, or null to show nothing. */
  imageId: string | null;
}) {
  const boxRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    function place() {
      const list = listRef.current;
      const row = list?.querySelectorAll("li")[activeIndex];
      if (!box || !list || !row) return;

      const at = placeBeside(
        list.getBoundingClientRect(),
        row.getBoundingClientRect(),
      );
      box.style.left = `${at.left}px`;
      box.style.top = `${at.top}px`;
      box.style.width = `${at.width}px`;
      box.style.visibility = "visible";
    }

    place();

    // A page scrolled under an open list would leave the preview behind,
    // pointing at nothing. Capture, because the printing picker scrolls
    // inside itself and that scroll does not reach the window.
    window.addEventListener("scroll", place, { passive: true, capture: true });
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, { capture: true });
      window.removeEventListener("resize", place);
    };
  }, [activeIndex, imageId, listRef]);

  if (!imageId) return null;

  return createPortal(
    <span
      ref={boxRef}
      aria-hidden
      className={BOX_CLASS}
      // Hidden until the effect has measured the row, so it never appears at
      // the top left corner for a frame first.
      style={{ visibility: "hidden", width: PREVIEW_W }}
    >
      <PreviewImage imageId={imageId} />
    </span>,
    document.body,
  );
}
