/**
 * The games this tracker holds cards for.
 *
 * Like lib/collection/constants.ts, this file has no imports at all, so it is
 * safe to pull into a client component; lib/db/schema.ts reads from it so the
 * check constraint in the database and the tabs on screen can never drift
 * apart.
 *
 * Magic is not merely the first entry, it is the *privileged* one, and the
 * code says so rather than pretending otherwise:
 *
 *   - `mtg` is the default of every `game` column, so the 110k printings and
 *     1,826 collection rows that existed before this file did are correctly
 *     labelled without a backfill that could get it wrong.
 *   - Magic set codes are stored bare (`blb`), every other game's are
 *     prefixed (`pkm-sv8`). Every existing URL, bookmark and set code in the
 *     database therefore still means what it meant.
 *   - Decks, sealed products, cubes, format legality and set completion stay
 *     Magic-only. They are not "not yet ported" — a Pokémon collection has no
 *     commander and no booster-only completion target, and pretending it did
 *     would be worse than not offering it.
 */

/**
 * Stored in `sets.game`, `oracle_cards.game` and `printings.game`.
 *
 * Short and lowercase because these are column values that also appear in
 * query strings (`/collection?game=pokemon`).
 */
export const GAMES = ["mtg", "pokemon", "onepiece"] as const;
export type GameSlug = (typeof GAMES)[number];

export const DEFAULT_GAME: GameSlug = "mtg";

export type GameInfo = {
  slug: GameSlug;
  /** Full name, for a page heading or an empty state. */
  name: string;
  /** Short name, for a tab or a badge where width is scarce. */
  shortName: string;
  /**
   * Prefix for this game's set codes, including the trailing hyphen.
   *
   * Every Magic set code in the database is lowercase alphanumeric and at
   * most six characters — checked against all 1,068 of them — so a code
   * containing a hyphen cannot collide with one, and an unprefixed code is
   * unambiguously Magic's. That is what lets `sets.code` stay a single
   * primary key shared by every game instead of becoming a composite that
   * every foreign key and every `/sets/[code]` URL would have to carry.
   */
  setCodePrefix: string;
  /** Where this game's catalog comes from, named on the status page. */
  source: string;
  sourceUrl: string;
};

export const GAME_INFO: Record<GameSlug, GameInfo> = {
  mtg: {
    slug: "mtg",
    name: "Magic: The Gathering",
    shortName: "Magic",
    setCodePrefix: "",
    source: "Scryfall",
    sourceUrl: "https://scryfall.com",
  },
  pokemon: {
    slug: "pokemon",
    name: "Pokémon Trading Card Game",
    shortName: "Pokémon",
    setCodePrefix: "pkm-",
    source: "pokemon-tcg-data",
    sourceUrl: "https://github.com/PokemonTCG/pokemon-tcg-data",
  },
  onepiece: {
    slug: "onepiece",
    name: "One Piece Card Game",
    shortName: "One Piece",
    setCodePrefix: "opc-",
    source: "OPTCG API",
    sourceUrl: "https://optcgapi.com",
  },
};

/** The games, in the order they should appear in a tab bar or a filter. */
export const GAME_LIST: GameInfo[] = GAMES.map((slug) => GAME_INFO[slug]);

export function isGameSlug(value: unknown): value is GameSlug {
  return typeof value === "string" && (GAMES as readonly string[]).includes(value);
}

/** The slug if it names a game, else null — for reading a query string. */
export function parseGame(value: unknown): GameSlug | null {
  return isGameSlug(value) ? value : null;
}

export function gameName(slug: string): string {
  return isGameSlug(slug) ? GAME_INFO[slug].name : slug;
}

export function gameShortName(slug: string): string {
  return isGameSlug(slug) ? GAME_INFO[slug].shortName : slug;
}

/**
 * This game's set code for a set the upstream source calls `nativeCode`.
 *
 * Lowercased because `findPrintingsByCollectorNumber` compares against
 * `lower(set_code)`, and hyphens are squeezed out of the native part so that
 * One Piece's `OP-01` becomes `opc-op01` rather than the `opc-op-01` that
 * reads like it has two prefixes.
 */
export function setCodeFor(game: GameSlug, nativeCode: string): string {
  const prefix = GAME_INFO[game].setCodePrefix;
  const native = nativeCode.trim().toLowerCase();
  return prefix ? `${prefix}${native.replace(/-/g, "")}` : native;
}

/**
 * Which game a set code belongs to, read back from the code itself.
 *
 * Used where a code arrives from a URL and the row has not been loaded yet.
 * Anything unprefixed is Magic's, which is exactly the rule `setCodeFor`
 * writes.
 */
export function gameForSetCode(code: string): GameSlug {
  const lower = code.toLowerCase();
  for (const info of GAME_LIST) {
    if (info.setCodePrefix && lower.startsWith(info.setCodePrefix)) {
      return info.slug;
    }
  }
  return "mtg";
}

/**
 * Features that exist for Magic and have no honest equivalent elsewhere.
 *
 * Checked in the places that would otherwise offer a Pokémon card a format
 * legality or a commander. Kept as one predicate so that adding a game is a
 * line in GAMES and not a hunt through the app for `=== "mtg"`.
 */
export function hasDecks(game: GameSlug): boolean {
  return game === "mtg";
}

export function hasSetCompletion(game: GameSlug): boolean {
  return game === "mtg";
}

export function hasSealedProducts(game: GameSlug): boolean {
  return game === "mtg";
}

/**
 * Whether this game's catalog carries prices.
 *
 * The One Piece source publishes a daily market price per card; the Pokémon
 * bulk data publishes none at all. The value pages read this so that a total
 * covering only part of a collection says so, instead of quietly reporting a
 * number that is too low.
 */
export function hasPrices(game: GameSlug): boolean {
  return game === "mtg" || game === "onepiece";
}

/**
 * Which finishes to offer while entering this game's cards.
 *
 * A convenience for the picker, not the rule. The rule is
 * `printings.finishes` — what this particular card was made in — and
 * addCopies() checks it on the server and rejects a copy the printing has no
 * version of. This only keeps the dropdown from offering an etched Pokémon
 * card or a reverse-holo Magic card, neither of which exists in any set.
 */
export function finishesForGame(game: GameSlug): string[] {
  switch (game) {
    case "pokemon":
      return ["nonfoil", "reverse", "foil"];
    case "onepiece":
      return ["nonfoil", "foil"];
    default:
      return ["nonfoil", "foil", "etched"];
  }
}
