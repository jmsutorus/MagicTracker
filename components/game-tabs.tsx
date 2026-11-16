import Link from "next/link";

import { GAME_INFO, type GameSlug } from "@/lib/games/constants";

/**
 * Which game's cards a page is showing.
 *
 * Tabs rather than a sixth entry in the filter bar, because this is not a
 * filter in the same sense. "Set" and "rarity" narrow a list of your cards;
 * "game" chooses which collection you are looking at, and it changes what
 * the other filters can even offer — a Pokémon rarity list and a Magic one
 * share no values. Putting it on its own line above them says that.
 *
 * Renders nothing at all for a collection that is all one game. Someone who
 * only plays Magic should not be shown a chooser with one option and a
 * concept they do not need; the tabs appear the moment a second game's card
 * is entered, and disappear again if it is removed.
 */
export function GameTabs({
  games,
  current,
  hrefFor,
}: {
  /** Games present, with how many cards each has. From listCollectedGames. */
  games: { game: GameSlug; copies: number }[];
  /** The selected game, or null for all of them. */
  current: GameSlug | null;
  /**
   * The link for a tab. The caller owns it because each page carries its own
   * other query parameters, and a tab must keep the ones that still apply
   * while dropping the ones that cannot — a set code from another game.
   */
  hrefFor: (game: GameSlug | null) => string;
}) {
  if (games.length < 2) return null;

  const total = games.reduce((sum, g) => sum + g.copies, 0);

  const tabClass = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm whitespace-nowrap ${
      active
        ? "bg-surface-muted text-foreground"
        : "text-muted hover:text-foreground"
    }`;

  return (
    <nav
      aria-label="Game"
      className="mt-4 flex flex-wrap items-center gap-1 rounded-lg border border-border bg-surface p-1"
    >
      <Link
        href={hrefFor(null)}
        aria-current={current === null ? "page" : undefined}
        className={tabClass(current === null)}
      >
        All <span className="tabular-nums text-muted">{total.toLocaleString()}</span>
      </Link>

      {games.map(({ game, copies }) => (
        <Link
          key={game}
          href={hrefFor(game)}
          aria-current={current === game ? "page" : undefined}
          className={tabClass(current === game)}
        >
          {GAME_INFO[game].shortName}{" "}
          <span className="tabular-nums text-muted">
            {copies.toLocaleString()}
          </span>
        </Link>
      ))}
    </nav>
  );
}
