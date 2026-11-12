/**
 * Card art, at list size.
 *
 * Every list in this app was a wall of text — a Magic collection rendered as
 * a spreadsheet, where the one thing a player actually recognises a card by
 * was the only thing missing. These are Scryfall's `art_crop` images, which
 * are the illustration alone with the frame, the title bar and the rules text
 * cropped away: at 44px wide a full card is an unreadable grey rectangle,
 * while the art is still the picture you know.
 *
 * Hotlinked from Scryfall's CDN rather than re-hosted, which their terms
 * require, and `loading="lazy"` so a hundred-row page fetches the dozen that
 * are on screen. The crops are a few KB each at this size.
 *
 * Plain <img>, not next/image, for the same reason components/mana-cost.tsx
 * gives: the file must not be re-hosted, so there is nothing for the loader
 * to optimise and a fill-parent Image would only add a wrapper.
 */

/** Scryfall's URL shape, matching cardImageUrl() in lib/scryfall/client.ts. */
function artUrl(printingId: string): string {
  return `https://cards.scryfall.io/art_crop/front/${printingId[0]}/${printingId[1]}/${printingId}.jpg`;
}

export function CardArt({
  printingId,
  className = "h-8 w-11",
}: {
  /**
   * The printing's Scryfall id — a specific printing, so a specific art.
   *
   * Null is a real case rather than an error: a cube has no commander, and
   * a commander deck has none until one is chosen. It renders the empty
   * tile, which holds the row's alignment instead of letting one row's text
   * start further left than its neighbours'.
   */
  printingId: string | null;
  /** Size and shape; the default suits a table row. */
  className?: string;
}) {
  if (!printingId) {
    return (
      <span
        aria-hidden
        className={`block shrink-0 rounded bg-surface-muted ${className}`}
      />
    );
  }

  return (
    <span
      className={`block shrink-0 overflow-hidden rounded bg-surface-muted ${className}`}
      /*
       * The art is decoration beside a name that is already there, so it is
       * hidden from the accessibility tree outright rather than given an alt
       * that repeats the row. A screen reader hearing "Sol Ring, image: Sol
       * Ring" is worse off than one that never heard about the image.
       */
      aria-hidden
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={artUrl(printingId)}
        alt=""
        loading="lazy"
        decoding="async"
        className="size-full object-cover"
      />
    </span>
  );
}

/**
 * The same art, as a wide strip behind a heading.
 *
 * One deck gets this; a list of decks gets tiles. The gradient is what makes
 * it a banner rather than a picture with text on top of it — it fades the
 * illustration into the page background so the heading sits on flat colour
 * and stays readable over art nobody chose for its contrast. Two stops, both
 * in `--background`, so it works in either mode without a second rule.
 *
 * Renders nothing at all when there is no printing. An empty banner is worse
 * than no banner: it reserves a strip of page for a picture that never
 * arrives and pushes the heading down for no reason.
 */
export function CardArtBanner({
  printingId,
  children,
}: {
  printingId: string | null;
  /** The heading and whatever sits with it, overlaid on the fade. */
  children: React.ReactNode;
}) {
  if (!printingId) return <>{children}</>;

  return (
    <div className="relative isolate overflow-hidden rounded-xl border border-border">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={artUrl(printingId)}
        alt=""
        aria-hidden
        decoding="async"
        className="absolute inset-0 size-full object-cover object-center"
      />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to top, var(--background) 6%, transparent 90%)",
        }}
      />
      {/* `pt-24` is the art that is left visible above the heading; the
          heading itself sits on the solid end of the fade. */}
      <div className="relative px-4 pb-4 pt-24 sm:pt-32">{children}</div>
    </div>
  );
}

/**
 * A set's symbol — the little rarity-coloured glyph stamped on every card.
 *
 * Scryfall serves these as single-colour SVGs that are black on transparent,
 * so on a dark surface they would be an invisible smudge. `.set-symbol` in
 * globals.css inverts them under `prefers-color-scheme: dark`; it has to be a
 * class rather than an inline style because the branch is a media query.
 *
 * Falls back to the set code, which is what the rows printed before and is
 * still the thing you would type into a search box.
 */
export function SetSymbol({
  uri,
  code,
  className = "size-4",
}: {
  uri: string | null;
  code: string;
  className?: string;
}) {
  if (!uri) {
    return (
      <span className="shrink-0 font-mono text-xs uppercase text-muted">
        {code}
      </span>
    );
  }

  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={uri}
      alt=""
      aria-hidden
      loading="lazy"
      decoding="async"
      className={`set-symbol shrink-0 ${className}`}
    />
  );
}
