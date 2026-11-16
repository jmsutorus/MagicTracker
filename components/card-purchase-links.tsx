import {
  manapoolCardUrl,
  manapoolPrintingUrl,
  tcgplayerCardUrl,
} from "@/lib/purchase/links";
import type { GameSlug } from "@/lib/games/constants";

/**
 * Where to buy one printing — a pair of inline links, no JavaScript.
 *
 * Deliberately not a client component: these are plain anchors, and the
 * printings table on a card page renders dozens of them.
 */
export function CardPurchaseLinks({
  cardName,
  tcgplayerId,
  setCode,
  collectorNumber,
  game = "mtg",
}: {
  cardName: string;
  tcgplayerId?: number | null;
  /** Given together, these address the exact printing on Mana Pool. */
  setCode?: string | null;
  collectorNumber?: string | null;
  /** Picks the TCGplayer category, and hides Mana Pool for non-Magic. */
  game?: GameSlug;
}) {
  /*
   * Mana Pool is a Magic marketplace. Linking a Pokémon card there would
   * send you to a 404 dressed as a buy link, which is worse than one link
   * where there used to be two.
   */
  const manapool =
    game !== "mtg"
      ? null
      : setCode && collectorNumber
        ? manapoolPrintingUrl(setCode, collectorNumber, cardName)
        : manapoolCardUrl(cardName);

  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <a
        href={tcgplayerCardUrl(cardName, tcgplayerId, game)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-muted underline underline-offset-4 hover:text-foreground"
        title={`Buy ${cardName} on TCGplayer`}
      >
        TCGplayer
      </a>
      {manapool ? (
        <>
          <span className="text-border">·</span>
          <a
            href={manapool}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted underline underline-offset-4 hover:text-foreground"
            title={`Buy ${cardName} on Mana Pool`}
          >
            Mana Pool
          </a>
        </>
      ) : null}
    </span>
  );
}
