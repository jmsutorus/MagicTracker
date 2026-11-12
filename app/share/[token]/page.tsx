import { notFound } from "next/navigation";

import { CubeReportPanel } from "@/components/cube-report";
import { ManaCost } from "@/components/mana-cost";
import { DECK_FORMAT_LABELS, boardLabel } from "@/lib/decks/constants";
import { formatColorIdentity } from "@/lib/decks/legality";
import { getSharedDeck } from "@/lib/decks/share";

/**
 * A shared decklist, read-only and signed out.
 *
 * The only page in the app that renders without `requireUser()`. It gets its
 * own layout chrome rather than `AppHeader`, because every link in that
 * header goes somewhere a visitor cannot follow — handing them a nav bar of
 * redirects to /login would be a worse welcome than no nav at all.
 *
 * `robots: noindex` is inherited from the root layout, so an unlisted link
 * stays unlisted even if it ends up in a crawler's path.
 */

export const metadata = { title: "Shared deck · MagicTracker" };

export default async function SharedDeckPage({
  params,
}: {
  // Next 16: params is a Promise.
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const deck = await getSharedDeck(token);

  // 404 rather than "this link was turned off": a revoked token and a token
  // that never existed should look identical from outside.
  if (!deck) notFound();

  const commander =
    deck.verdict.kind === "commander" ? deck.verdict.report : null;

  /*
   * Commander and Standard both pass a verdict a visitor can act on — "this
   * list is legal" is a fact about the deck, not about its owner — and a
   * cube has none to pass. Both reports carry `legal` and `problems`, which
   * is all this page reads off either.
   */
  const judged = deck.verdict.kind === "cube" ? null : deck.verdict.report;
  const errors = judged
    ? judged.problems.filter((p) => p.severity === "error")
    : [];

  /* Every copy in the list, sideboard included — the headline is about what
     was shared, and the verdict's own count is the sixty. */
  const copies = deck.boards.reduce(
    (total, board) => total + board.cards.reduce((n, c) => n + c.quantity, 0),
    0,
  );

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border">
        <div className="mx-auto w-full max-w-3xl px-4 py-4">
          <span className="text-lg font-semibold tracking-tight">
            MagicTracker
          </span>
          <span className="ml-3 text-sm text-muted">shared decklist</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{deck.name}</h1>
          {commander ? (
            <span className="font-mono text-sm uppercase text-muted">
              {formatColorIdentity(commander.colorIdentity)}
            </span>
          ) : null}
        </div>

        <p className="mt-2 text-sm text-muted">
          {copies} card{copies === 1 ? "" : "s"} ·{" "}
          {DECK_FORMAT_LABELS[deck.format]}
          {judged ? (
            <>
              {" · "}
              <span className={judged.legal ? "text-ok" : "text-bad"}>
                {judged.legal ? "legal" : "not legal"}
              </span>
            </>
          ) : null}{" "}
          · updated {deck.updatedAt.slice(0, 10)}
        </p>

        {/*
          No `ownedCopies`: a visitor is shown the cube, not the collection
          behind it. The panel takes null for exactly this case.
        */}
        {deck.verdict.kind === "cube" ? (
          <CubeReportPanel report={deck.verdict.report} />
        ) : null}

        {errors.length > 0 ? (
          <ul className="mt-4 space-y-1">
            {errors.map((problem) => (
              <li key={problem.code + problem.message} className="text-sm">
                <span className="text-bad">✗</span> {problem.message}
              </li>
            ))}
          </ul>
        ) : null}

        <p className="mt-4">
          <a
            href={`/api/share/${token}/decklist`}
            className="text-sm text-muted underline underline-offset-4 hover:text-foreground"
          >
            Download the list as text
          </a>
        </p>

        {deck.boards.map(({ board, cards }) => {
          const copies = cards.reduce((n, c) => n + c.quantity, 0);
          return (
            <section key={board} className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
                {boardLabel(deck.format, board)} ({copies})
              </h2>
              <div className="mt-3 overflow-hidden rounded-lg border border-border bg-surface">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-4 py-2 font-medium">Card</th>
                      <th className="hidden px-4 py-2 font-medium sm:table-cell">
                        Cost
                      </th>
                      <th className="px-4 py-2 text-right font-medium">
                        Copies
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {cards.map((card) => (
                      <tr
                        key={`${board}-${card.oracleId}`}
                        className="border-b border-border last:border-0"
                      >
                        <td className="px-4 py-2">
                          {card.name}
                          {card.setCode ? (
                            <span className="ml-2 font-mono text-xs uppercase text-muted">
                              {card.setCode}
                              {card.collectorNumber
                                ? ` #${card.collectorNumber}`
                                : ""}
                            </span>
                          ) : null}
                          <span className="block text-xs text-muted">
                            {card.typeLine ?? ""}
                          </span>
                        </td>
                        <td className="hidden px-4 py-2 sm:table-cell">
                          <ManaCost cost={card.manaCost} />
                        </td>
                        <td className="px-4 py-2 text-right [font-variant-numeric:tabular-nums]">
                          {card.quantity}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}

        <p className="mt-10 text-xs text-muted">
          A read-only copy, shared by a link that can be turned off at any time.
          Card data from Scryfall.
        </p>
      </main>
    </div>
  );
}
