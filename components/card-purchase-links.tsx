import {
  manapoolCardUrl,
  manapoolPrintingUrl,
  tcgplayerCardUrl,
} from "@/lib/purchase/links";

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
}: {
  cardName: string;
  tcgplayerId?: number | null;
  /** Given together, these address the exact printing on Mana Pool. */
  setCode?: string | null;
  collectorNumber?: string | null;
}) {
  const manapool =
    setCode && collectorNumber
      ? manapoolPrintingUrl(setCode, collectorNumber, cardName)
      : manapoolCardUrl(cardName);

  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <a
        href={tcgplayerCardUrl(cardName, tcgplayerId)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-muted underline underline-offset-4 hover:text-foreground"
        title={`Buy ${cardName} on TCGplayer`}
      >
        TCGplayer
      </a>
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
    </span>
  );
}
