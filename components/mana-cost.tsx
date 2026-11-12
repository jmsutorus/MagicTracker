/**
 * Mana costs, as pips.
 *
 * Scryfall gives a cost as a brace string — `{3}{W}{U}`, `{2/R}`, `{W/P}` —
 * and the app used to print it verbatim in a monospace span. Magic players
 * read pips, not braces: `{3}{W}{U}` is three characters of noise where a
 * cost should be, and it is the single loudest tell that a tool was built
 * around a database rather than around the game.
 *
 * The glyph is Scryfall's own symbol SVG, hotlinked from svgs.scryfall.io
 * (already whitelisted in next.config.ts, and what their terms ask for).
 * There are about twenty distinct symbols in practice, every one of them
 * cached by the browser after the first card, so a 100-card deck page costs
 * roughly twenty tiny requests rather than one per pip.
 *
 * Failure is designed for rather than ignored: each pip is a coloured circle
 * with the symbol's own text as the image's alt, so when Scryfall is slow,
 * blocked or offline the cost still reads — `3 W U` in correctly coloured
 * circles — instead of collapsing to a row of broken-image icons. That is
 * also what makes it legible to a screen reader.
 */

/** Which token in the circle behind the glyph, per mana colour. */
const PIP_BACKGROUND: Record<string, string> = {
  W: "var(--mana-w)",
  U: "var(--mana-u)",
  B: "var(--mana-b)",
  R: "var(--mana-r)",
  G: "var(--mana-g)",
};

/**
 * Scryfall's file naming, derived from the brace body: strip the slashes and
 * upcase. `{W/U}` → `WU.svg`, `{2/W}` → `2W.svg`, `{W/P}` → `WP.svg`,
 * `{T}` → `T.svg`, `{1000000}` → `1000000.svg`. The few symbols that break
 * the pattern (`{½}`, `{∞}`) resolve to a URL that 404s, and the alt text
 * carries them — which is why the fallback matters.
 */
function symbolFile(body: string): string {
  return body.replace(/\//g, "").toUpperCase();
}

/**
 * The circle colour for a pip.
 *
 * A single coloured symbol takes its own colour. A hybrid takes the two at
 * 45°, in the order written, which is how the printed card shows it. Generic,
 * colorless, snow, tap and the rest take the neutral — "no colour" should
 * read as absent rather than as a sixth colour.
 */
function pipBackground(body: string): string {
  const parts = body.split("/");
  const colored = parts.filter((p) => p in PIP_BACKGROUND);

  if (colored.length === 2) {
    const [a, b] = colored;
    return `linear-gradient(135deg, ${PIP_BACKGROUND[a]} 0 50%, ${PIP_BACKGROUND[b]} 50% 100%)`;
  }
  if (colored.length === 1) return PIP_BACKGROUND[colored[0]];
  return "var(--mana-c)";
}

/**
 * Splits a cost into its brace bodies. Anything outside braces is dropped:
 * a multi-faced card's cost arrives as `{2}{R} // {3}{R}`, and the separator
 * is handled by the caller rendering each face, not by printing a stray
 * slash between pips.
 */
export function parseManaCost(cost: string): string[] {
  return [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
}

export function ManaCost({
  cost,
  className = "",
  size = 14,
  label,
}: {
  cost: string | null | undefined;
  className?: string;
  /** Pip diameter in px. 14 suits a table row; 18 a card heading. */
  size?: number;
  /** Overrides the accessible name, for pips that are not a cost. */
  label?: string;
}) {
  if (!cost) return null;

  /*
   * Faces, not one run of pips. `{1}{W} // {4}{W}` is two costs, and running
   * them together reads as a single five-mana spell that does not exist.
   */
  const faces = cost.split("//").map((face) => parseManaCost(face.trim()));
  if (faces.every((face) => face.length === 0)) return null;

  return (
    <span
      className={`inline-flex items-center gap-[0.15em] align-middle ${className}`}
      /*
       * The whole cost is one label. Twenty separate pip images each
       * announcing themselves turns "three generic, one white" into a
       * stream of single letters, so the images are hidden from the
       * accessibility tree and the string is given once, verbatim.
       */
      role="img"
      aria-label={label ?? `Mana cost ${cost}`}
    >
      {faces.map((pips, faceIndex) => (
        <span
          key={faceIndex}
          className="inline-flex items-center gap-[0.15em]"
        >
          {faceIndex > 0 ? (
            /* Braced: a bare `//` in JSX children reads as a comment. */
            <span aria-hidden className="px-0.5 text-muted">
              {"//"}
            </span>
          ) : null}
          {pips.map((body, i) => (
            <span
              key={`${faceIndex}-${i}-${body}`}
              aria-hidden
              style={{
                width: size,
                height: size,
                background: pipBackground(body),
                fontSize: size * 0.62,
              }}
              className="inline-flex shrink-0 items-center justify-center overflow-hidden
                         rounded-full font-semibold leading-none text-white
                         shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]"
            >
              {/*
                Plain <img>, not next/image: these are 16px vector files on a
                CDN that must not be re-hosted, so there is no optimisation
                for the loader to do and a fill-parent Image would only add
                a wrapper. The alt is what shows if the CDN never answers.
              */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://svgs.scryfall.io/card-symbols/${symbolFile(body)}.svg`}
                alt={body}
                width={size}
                height={size}
                loading="lazy"
                decoding="async"
                className="size-full"
              />
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}

/**
 * A colour identity, as pips — `["W","U"]` → two circles.
 *
 * Separate from ManaCost because an identity is a set of colours and not a
 * cost: it has no generic component, no hybrids, and colourless is a real
 * answer rather than the absence of one.
 */
export function ColorIdentity({
  colors,
  size = 14,
  className = "",
}: {
  colors: string[];
  size?: number;
  className?: string;
}) {
  if (colors.length === 0) {
    return (
      <span className={`text-sm text-muted ${className}`}>Colorless</span>
    );
  }

  // WUBRG, always, whatever order the database handed back.
  const order = ["W", "U", "B", "R", "G"];
  const sorted = [...colors].sort(
    (a, b) => order.indexOf(a) - order.indexOf(b),
  );

  const names: Record<string, string> = {
    W: "white",
    U: "blue",
    B: "black",
    R: "red",
    G: "green",
  };

  return (
    <ManaCost
      cost={sorted.map((c) => `{${c}}`).join("")}
      size={size}
      className={className}
      label={`Color identity: ${sorted.map((c) => names[c] ?? c).join(", ")}`}
    />
  );
}
