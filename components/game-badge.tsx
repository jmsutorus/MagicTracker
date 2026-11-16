import { GAME_INFO, isGameSlug } from "@/lib/games/constants";

/**
 * Which game a card belongs to, where a list can hold more than one.
 *
 * Shown for everything except Magic. That asymmetry is deliberate rather than
 * lazy: Magic is the overwhelming majority of this collection — 110,963
 * printings against 25,000 — so badging it would put a label on almost every
 * row to tell you the thing you already assumed. Badging only the others
 * makes the badge mean "this is not the usual one", which is the question a
 * mixed list actually raises.
 *
 * A plain word, not a colour-coded pill. The rows these sit in already carry
 * a rarity, a set symbol, a finish and a price; another saturated chip would
 * compete with the card's own name for attention.
 */
export function GameBadge({
  game,
  className = "",
}: {
  game: string;
  className?: string;
}) {
  if (!isGameSlug(game) || game === "mtg") return null;

  return (
    <span
      className={`shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] leading-none text-muted ${className}`}
    >
      {GAME_INFO[game].shortName}
    </span>
  );
}
