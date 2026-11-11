import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { CardPurchaseLinks } from "@/components/card-purchase-links";
import { PriceHistory } from "@/components/price-history";
import { WishButton } from "@/components/wish-button";
import { requireUser } from "@/lib/auth/dal";
import { getCardDetail } from "@/lib/cards/search";
import { getOwnedPriceHistory } from "@/lib/prices/queries";
import { cardImageUrl } from "@/lib/scryfall/client";

const RARITY_LABEL: Record<string, string> = {
  common: "C",
  uncommon: "U",
  rare: "R",
  mythic: "M",
  special: "S",
  bonus: "B",
};

const FINISH_LABEL: Record<string, string> = {
  nonfoil: "nonfoil",
  foil: "foil",
  etched: "etched",
};

/** Flags that explain why a printing exists — and whether it counts toward a set. */
function printingTags(p: {
  isBooster: boolean;
  isPromo: boolean;
  isVariation: boolean;
  fullArt: boolean;
}): string[] {
  const tags: string[] = [];
  if (p.isPromo) tags.push("promo");
  if (p.isVariation) tags.push("variant");
  if (p.fullArt) tags.push("full art");
  if (!p.isBooster && !p.isPromo) tags.push("non-booster");
  return tags;
}

export default async function CardDetailPage({
  params,
}: {
  params: Promise<{ oracleId: string }>;
}) {
  await requireUser();

  // params is a Promise in Next 16.
  const { oracleId } = await params;

  // Guard before hitting the database: a non-UUID would make the ::uuid cast
  // throw rather than simply return no rows.
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      oracleId,
    )
  ) {
    notFound();
  }

  const card = await getCardDetail(oracleId);
  if (!card) notFound();

  // Only ever has anything for a card you own, so it costs nothing on the
  // overwhelming majority of card pages.
  const history = await getOwnedPriceHistory(oracleId);

  const primary = card.printings[0];
  const commanderLegality = card.legalities?.commander ?? "unknown";

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader current="cards" />

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        <Link
          href="/cards"
          className="text-sm text-muted underline underline-offset-4 hover:text-foreground"
        >
          ← Search
        </Link>

        <div className="mt-5 flex flex-col gap-6 sm:flex-row">
          {primary ? (
            <div className="shrink-0">
              {/* Hotlinked from Scryfall's CDN, never re-hosted — their terms
                  require it, and the URL is derived from the card id. */}
              <Image
                src={cardImageUrl(primary.scryfallId, "normal")}
                alt={card.name}
                width={244}
                height={340}
                className="rounded-xl border border-border"
                unoptimized
              />
            </div>
          ) : null}

          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {card.name}
            </h1>

            <p className="mt-1 text-sm text-muted">
              {card.typeLine}
              {card.manaCost ? (
                <span className="ml-2 font-mono">{card.manaCost}</span>
              ) : null}
            </p>

            {card.oracleText ? (
              <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">
                {card.oracleText}
              </p>
            ) : null}

            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">
                  Color identity
                </dt>
                <dd className="font-mono">
                  {card.colorIdentity.length > 0
                    ? card.colorIdentity.join("")
                    : "colorless"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">
                  Commander
                </dt>
                <dd
                  className={
                    commanderLegality === "legal"
                      ? "text-ok"
                      : commanderLegality === "banned"
                        ? "text-bad"
                        : "text-muted"
                  }
                >
                  {commanderLegality}
                </dd>
              </div>
              {card.cmc !== null ? (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted">
                    Mana value
                  </dt>
                  <dd className="font-mono">{card.cmc}</dd>
                </div>
              ) : null}
              {card.edhrecRank !== null ? (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted">
                    EDHREC rank
                  </dt>
                  <dd className="font-mono">
                    #{card.edhrecRank.toLocaleString()}
                  </dd>
                </div>
              ) : null}
              {card.reserved ? (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted">
                    Reserved list
                  </dt>
                  <dd className="text-warn">yes</dd>
                </div>
              ) : null}
            </dl>

            <div className="mt-5">
              <WishButton oracleId={card.oracleId} />
            </div>
          </div>
        </div>

        <PriceHistory series={history} />

        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            {card.printings.length}{" "}
            {card.printings.length === 1 ? "printing" : "printings"}
          </h2>

          <p className="mt-1 text-xs text-muted">
            Every printing in the card database. Add one from the search on{" "}
            <Link
              href="/collection/add"
              className="underline underline-offset-4 hover:text-foreground"
            >
              Add cards
            </Link>
            , or follow a store link to buy it.
          </p>

          <ul className="mt-4 overflow-hidden rounded-lg border border-border bg-surface">
            {card.printings.map((p) => {
              const tags = printingTags(p);
              return (
                <li
                  key={p.scryfallId}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border px-4 py-2.5 last:border-0"
                >
                  <span className="w-16 shrink-0 font-mono text-xs text-muted">
                    {p.setCode.toUpperCase()}
                  </span>
                  <span className="w-14 shrink-0 font-mono text-xs text-muted">
                    #{p.collectorNumber}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {p.setName}
                    {tags.length > 0 ? (
                      <span className="ml-2 text-xs text-muted">
                        {tags.join(" · ")}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-muted">
                    {RARITY_LABEL[p.rarity] ?? p.rarity}
                  </span>
                  <span className="hidden shrink-0 text-xs text-muted sm:inline">
                    {p.finishes.map((f) => FINISH_LABEL[f] ?? f).join(", ")}
                  </span>
                  {/*
                    Its own line on a phone: sharing one row with the set name
                    squeezed the name down to an ellipsis.
                  */}
                  <span className="flex w-full shrink-0 items-baseline gap-3 sm:w-auto">
                    <CardPurchaseLinks
                      cardName={card.name}
                      tcgplayerId={p.tcgplayerId}
                      setCode={p.setCode}
                      collectorNumber={p.collectorNumber}
                    />
                    <span className="text-border">·</span>
                    {/* This exact printing, as opposed to the any-printing
                        button above, which is the usual kind of wish. */}
                    <WishButton
                      oracleId={card.oracleId}
                      printingId={p.scryfallId}
                      label="Want"
                      compact
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </main>
    </div>
  );
}
