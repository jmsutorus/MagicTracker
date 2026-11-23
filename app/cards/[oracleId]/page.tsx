import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AppFooter } from "@/components/app-footer";
import { AppHeader } from "@/components/app-header";
import { CardGameFacts } from "@/components/card-game-facts";
import { CardPurchaseLinks } from "@/components/card-purchase-links";
import { ColorIdentity, ManaCost } from "@/components/mana-cost";
import { PriceHistory } from "@/components/price-history";
import { PrintingRow } from "@/components/printing-row";
import { WishButton } from "@/components/wish-button";
import { requireUser } from "@/lib/auth/dal";
import { getCardDetail } from "@/lib/cards/search";
import { describeOwnedCopies } from "@/lib/collection/constants";
import {
  listOwnedCopiesForOracle,
  listOwnedLocationsForOracle,
  type OwnedCopies,
} from "@/lib/collection/queries";
import { listDecksForOracle } from "@/lib/decks/queries";
import { CardWhereabouts } from "@/components/card-whereabouts";
import type { GameSlug } from "@/lib/games/constants";
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
  reverse: "reverse holo",
};

/**
 * Flags that explain why a printing exists — and whether it counts toward a
 * set.
 *
 * Every one of these is Magic's vocabulary, read from Scryfall's own flags.
 * The other catalogs publish none of them, so their rows arrive with all four
 * false — which, left alone, printed "non-booster" against every Pokémon and
 * One Piece card in the list. That tag is a real statement about a Magic
 * printing (it cannot be opened in a pack, so it does not count toward the
 * set) and a meaningless one everywhere else, so the whole set of tags is
 * Magic-only rather than filtered one at a time.
 */
function printingTags(
  p: {
    isBooster: boolean;
    isPromo: boolean;
    isVariation: boolean;
    fullArt: boolean;
  },
  game: GameSlug,
): string[] {
  if (game !== "mtg") return [];

  const tags: string[] = [];
  if (p.isPromo) tags.push("promo");
  if (p.isVariation) tags.push("variant");
  if (p.fullArt) tags.push("full art");
  if (!p.isBooster && !p.isPromo) tags.push("non-booster");
  return tags;
}

/**
 * The part of a printing's name that the card's name does not account for:
 * "(Alternate Art)", "(Wanted Poster)", "(SP)".
 *
 * Null when there is nothing to add, and null when what is left is only the
 * collector number repeated — One Piece names some printings
 * "Monkey.D.Luffy (OP15-051)", which would print the number twice on one row,
 * two columns apart.
 */
function variantNote(
  printingName: string,
  cardName: string,
  collectorNumber: string,
): string | null {
  if (printingName === cardName) return null;

  const note = printingName.replace(cardName, "").trim();
  if (note.length === 0) return null;

  const squash = (v: string) => v.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (squash(note) === squash(collectorNumber)) return null;

  return note;
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

  // Both only ever have anything for a card you own, so they cost nothing on
  // the overwhelming majority of card pages.
  const [history, owned, whereabouts, inDecks] = await Promise.all([
    getOwnedPriceHistory(oracleId),
    listOwnedCopiesForOracle(oracleId),
    listOwnedLocationsForOracle(oracleId),
    listDecksForOracle(oracleId),
  ]);

  /*
   * Keyed by printing, because the list below is per printing and a card you
   * collect seriously has copies under several of them.
   */
  const ownedByPrinting = new Map<string, OwnedCopies[]>();
  for (const row of owned) {
    const groups = ownedByPrinting.get(row.printingId);
    if (groups) groups.push(row);
    else ownedByPrinting.set(row.printingId, [row]);
  }
  const ownedCopies = owned.reduce((sum, row) => sum + row.quantity, 0);

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
              {/* Hotlinked, never re-hosted — Scryfall's terms require it
                  and the other catalogs are served the same way. The URL is
                  the stored `printings.image_url`, because only Scryfall's
                  can be derived from the card's id. */}
              <Image
                src={
                  primary.imageUrl ?? cardImageUrl(primary.scryfallId, "normal")
                }
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

            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
              <span>{card.typeLine}</span>
              <ManaCost cost={card.manaCost} size={16} />
            </p>

            {card.oracleText ? (
              <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">
                {card.oracleText}
              </p>
            ) : null}

            {/*
              Magic's facts, for Magic's cards only.

              Colour identity, Commander legality, mana value, EDHREC rank
              and the reserved list are not merely unavailable for a Pokémon
              card — they are meaningless for one. Rendering the block with
              every value empty would be worse than omitting it: it would
              suggest the data was missing rather than inapplicable. The
              other games get their own block below, built from whatever
              their catalog actually publishes.
            */}
            {card.game === "mtg" ? (
            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">
                  Color identity
                </dt>
                <dd>
                  <ColorIdentity colors={card.colorIdentity} />
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
            ) : (
              <CardGameFacts game={card.game} gameData={card.gameData} />
            )}

            <div className="mt-5">
              <WishButton oracleId={card.oracleId} />
            </div>
          </div>
        </div>

        <CardWhereabouts
          cardName={card.name}
          locations={whereabouts}
          decks={inDecks}
        />

        <PriceHistory series={history} />

        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            {card.printings.length}{" "}
            {card.printings.length === 1 ? "printing" : "printings"}
          </h2>

          <p className="mt-1 text-xs text-muted">
            Every version of this card, with the art on hover.
            {ownedCopies > 0 ? (
              <>
                {" "}
                You own{" "}
                <span className="text-ok">
                  {ownedCopies} {ownedCopies === 1 ? "copy" : "copies"}
                </span>{" "}
                across {ownedByPrinting.size}{" "}
                {ownedByPrinting.size === 1 ? "printing" : "printings"}.
              </>
            ) : (
              <>
                {" "}
                Add one from the search on{" "}
                <Link
                  href="/collection/add"
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  Add cards
                </Link>
                , or follow a store link to buy it.
              </>
            )}
          </p>

          <ul className="mt-4 overflow-hidden rounded-lg border border-border bg-surface">
            {card.printings.map((p) => {
              const tags = printingTags(p, card.game);
              const groups = ownedByPrinting.get(p.scryfallId);
              return (
                <PrintingRow
                  key={p.scryfallId}
                  imageId={p.scryfallId}
                  imageUrl={p.imageUrl}
                  /*
                    Owned printings are tinted, so which versions are already
                    yours is answerable by scanning the list rather than by
                    reading every row.
                  */
                  className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border px-4 py-2.5 last:border-0 ${
                    groups ? "bg-surface-muted" : ""
                  }`}
                >
                  {/*
                    w-24: prefixed codes outgrew 16, and One Piece's longest
                    (`OPC-OP15EB04`) then outgrew 20 and truncated.
                  */}
                  <span className="w-24 shrink-0 truncate font-mono text-xs text-muted">
                    {p.setCode.toUpperCase()}
                  </span>
                  {/*
                    whitespace-nowrap, and wider than it needs to be for
                    Magic: One Piece numbers the card within the whole game
                    rather than within the set, so they read `OP05-060` and
                    wrapped onto two lines in a 14-wide column.
                  */}
                  <span className="w-24 shrink-0 whitespace-nowrap font-mono text-xs text-muted">
                    #{p.collectorNumber}
                  </span>
                  <span className="min-w-24 flex-1 truncate text-sm">
                    {p.setName}
                    {/*
                      What this printing adds to the card's name. Magic adds
                      nothing, ever. One Piece prints alternate arts under the
                      base card's number — two rows that were otherwise
                      identical on screen, told apart only by the art on hover.
                    */}
                    {variantNote(p.name, card.name, p.collectorNumber) ? (
                      <span className="ml-2 text-xs text-muted">
                        {variantNote(p.name, card.name, p.collectorNumber)}
                      </span>
                    ) : null}
                    {tags.length > 0 ? (
                      <span className="ml-2 text-xs text-muted">
                        {tags.join(" · ")}
                      </span>
                    ) : null}
                  </span>
                  {groups ? (
                    <span className="shrink-0 whitespace-nowrap text-xs text-ok">
                      {describeOwnedCopies(groups)}
                    </span>
                  ) : null}
                  <span className="shrink-0 font-mono text-xs text-muted">
                    {RARITY_LABEL[p.rarity] ?? p.rarity}
                  </span>
                  {/* Which finishes the printing *exists* in, as against the
                      ones owned above — the answer to "is there a foil of
                      this at all". */}
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
                      game={card.game}
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
                </PrintingRow>
              );
            })}
          </ul>
        </section>
      </main>

      <AppFooter />
    </div>
  );
}
