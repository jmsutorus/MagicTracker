import Link from "next/link";
import { notFound } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { DeckCardControls } from "@/components/deck-card-controls";
import { DeckCardSearch } from "@/components/deck-card-search";
import { DeckToolbar } from "@/components/deck-toolbar";
import { ProgressBar } from "@/components/progress-bar";
import { requireUser } from "@/lib/auth/dal";
import { listLocations } from "@/lib/collection/queries";
import {
  COMMANDER_DECK_SIZE,
  DECK_BOARDS,
  DECK_BOARD_LABELS,
  type DeckBoard,
} from "@/lib/decks/constants";
import { formatColorIdentity } from "@/lib/decks/legality";
import { getDeck, type DeckCardRow } from "@/lib/decks/queries";

export const metadata = { title: "Deck · MagicTracker" };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function DeckPage({
  params,
}: {
  // Next 16: params is a Promise.
  params: Promise<{ id: string }>;
}) {
  await requireUser();

  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const [deck, locations] = await Promise.all([getDeck(id), listLocations()]);
  if (!deck) notFound();

  const counted = deck.cards.filter((c) => c.board !== "maybe");
  const ownedCopies = counted.reduce(
    (n, c) => n + Math.min(c.available, c.quantity),
    0,
  );
  const neededCopies = deck.missing.reduce((n, m) => n + m.need, 0);
  const allocatedCount = deck.cards.filter((c) => c.isAllocated).length;

  const ownedPercent =
    deck.legality.cardCount === 0
      ? 0
      : Math.min(
          Math.round((ownedCopies / deck.legality.cardCount) * 100),
          100,
        );

  const errors = deck.legality.problems.filter((p) => p.severity === "error");
  const warnings = deck.legality.problems.filter(
    (p) => p.severity === "warning",
  );

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader current="decks" />

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        <Link
          href="/decks"
          className="text-sm text-muted underline underline-offset-4 hover:text-foreground"
        >
          ← All decks
        </Link>

        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{deck.name}</h1>
          <span className="font-mono text-sm uppercase text-muted">
            {formatColorIdentity(deck.legality.colorIdentity)}
          </span>
        </div>

        {/* ---- the verdict ------------------------------------------------ */}
        <section className="mt-6 rounded-lg border border-border bg-surface p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <span className="text-3xl font-semibold">
              {deck.legality.cardCount}
              <span className="text-xl text-muted">
                {" / "}
                {COMMANDER_DECK_SIZE}
              </span>
            </span>
            <span
              className={`text-lg font-semibold ${
                deck.legality.legal ? "text-ok" : "text-bad"
              }`}
            >
              {deck.legality.legal ? "Legal" : "Not legal yet"}
            </span>
          </div>

          <ProgressBar percent={ownedPercent} className="mt-3" />
          <p className="mt-3 text-sm text-muted">
            {ownedCopies} of {deck.legality.cardCount} cards available from your
            collection
            {neededCopies > 0 ? (
              <>
                {" — "}
                <strong className="font-normal text-foreground">
                  {neededCopies} still to buy
                </strong>
              </>
            ) : deck.legality.cardCount > 0 ? (
              " — you own the whole deck"
            ) : (
              ""
            )}
            .
          </p>

          {errors.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {errors.map((problem) => (
                <li key={problem.code + problem.message} className="text-sm">
                  <span className="text-bad">✗</span> {problem.message}
                </li>
              ))}
            </ul>
          ) : null}

          {warnings.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {warnings.map((problem) => (
                <li
                  key={problem.code + problem.message}
                  className="text-sm text-muted"
                >
                  <span>!</span> {problem.message}
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {/* ---- buy list -------------------------------------------------- */}
        {deck.missing.length > 0 ? (
          <section className="mt-6 rounded-lg border border-border bg-surface p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
                Cards you don&rsquo;t own ({deck.missing.length})
              </h2>
              <a
                href={`/api/decks/${deck.id}/buylist`}
                className="text-sm text-muted underline underline-offset-4 hover:text-foreground"
              >
                Download buy list
              </a>
            </div>
            <p className="mt-2 text-sm text-muted">
              {deck.missing
                .slice(0, 24)
                .map((m) => (m.need > 1 ? `${m.need}× ${m.name}` : m.name))
                .join(", ")}
              {deck.missing.length > 24
                ? `, and ${deck.missing.length - 24} more`
                : ""}
              .
            </p>
          </section>
        ) : null}

        <div className="mt-6">
          <DeckToolbar
            deckId={deck.id}
            name={deck.name}
            locationId={deck.locationId}
            locations={locations.map((l) => ({ id: l.id, name: l.name }))}
            allocatedCount={allocatedCount}
            cardCount={deck.legality.cardCount}
          />
        </div>

        <div className="mt-6">
          <DeckCardSearch
            deckId={deck.id}
            defaultBoard={
              deck.cards.some((c) => c.board === "commander")
                ? "main"
                : "commander"
            }
          />
        </div>

        {DECK_BOARDS.map((board) => {
          const cards = deck.cards.filter((c) => c.board === board);
          if (cards.length === 0) return null;
          return (
            <BoardSection
              key={board}
              board={board}
              cards={cards}
              deckId={deck.id}
            />
          );
        })}

        {deck.cards.length === 0 ? (
          <p className="mt-8 rounded-lg border border-border bg-surface p-5 text-sm text-muted">
            Empty deck. Add a commander first — the search above starts on the
            command zone, and the colour-identity check works from it.
          </p>
        ) : null}
      </main>
    </div>
  );
}

function BoardSection({
  board,
  cards,
  deckId,
}: {
  board: DeckBoard;
  cards: DeckCardRow[];
  deckId: string;
}) {
  const copies = cards.reduce((n, c) => n + c.quantity, 0);

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
        {DECK_BOARD_LABELS[board]} ({copies})
        {board === "maybe" ? (
          <span className="ml-2 font-normal normal-case">
            — counts toward nothing
          </span>
        ) : null}
      </h2>

      <div className="mt-3 overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-2 font-medium">Card</th>
              <th className="hidden px-4 py-2 font-medium sm:table-cell">
                Cost
              </th>
              <th className="px-4 py-2 font-medium">Have</th>
              <th className="px-4 py-2 font-medium">In deck</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((card) => {
              const short =
                card.board !== "maybe" && card.available < card.quantity;
              return (
                <tr
                  key={card.id}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-4 py-2">
                    <Link
                      href={`/cards/${card.oracleId}`}
                      className="hover:underline"
                    >
                      {card.name}
                    </Link>
                    {card.isAllocated ? (
                      <span className="ml-2 text-xs text-muted">claimed</span>
                    ) : null}
                    {card.commanderLegality !== "legal" ? (
                      <span className="ml-2 text-xs text-bad">
                        {card.commanderLegality === "banned"
                          ? "banned"
                          : "not legal"}
                      </span>
                    ) : null}
                  </td>
                  <td className="hidden px-4 py-2 font-mono text-xs text-muted sm:table-cell">
                    {card.manaCost ?? ""}
                  </td>
                  <td
                    className={`px-4 py-2 text-xs ${short ? "text-bad" : "text-muted"}`}
                  >
                    {/*
                     * "Available", not "owned": a copy another built deck has
                     * claimed is not one you can put in this deck, and
                     * showing it as available is how you plan two decks that
                     * cannot both exist. The owned total is shown alongside
                     * when the two differ, so the claim is visible rather
                     * than looking like a missing card.
                     */}
                    {card.available}
                    {card.owned !== card.available ? ` of ${card.owned}` : ""}
                  </td>
                  <td className="px-4 py-2">
                    <DeckCardControls
                      deckCardId={card.id}
                      deckId={deckId}
                      board={card.board}
                      quantity={card.quantity}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
