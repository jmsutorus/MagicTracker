import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { DeckCreateForm } from "@/components/deck-create-form";
import { ProgressBar } from "@/components/progress-bar";
import { requireUser } from "@/lib/auth/dal";
import { DECK_FORMAT_LABELS } from "@/lib/decks/constants";
import { formatColorIdentity } from "@/lib/decks/legality";
import { listDecks } from "@/lib/decks/queries";

export const metadata = { title: "Decks · MagicTracker" };

export default async function DecksPage() {
  await requireUser();

  const decks = await listDecks();

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader current="decks" />

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Decks</h1>
        <p className="mt-2 text-sm text-muted">
          Commander decks, checked against the rules, and cubes, checked against
          the size you set — both against what you own.
        </p>

        <div className="mt-6">
          <DeckCreateForm />
        </div>

        {decks.length === 0 ? (
          <p className="mt-8 rounded-lg border border-border bg-surface p-5 text-sm text-muted">
            No decks yet. Name one above, or open a{" "}
            <Link
              href="/products"
              className="underline underline-offset-4 hover:text-foreground"
            >
              precon
            </Link>{" "}
            and build the deck from it in one step.
          </p>
        ) : (
          <ul className="mt-8 space-y-2">
            {decks.map((deck) => {
              const percent =
                deck.cardCount === 0
                  ? 0
                  : Math.min(
                      Math.round((deck.ownedCopies / deck.cardCount) * 100),
                      100,
                    );
              const complete = deck.cardCount === deck.targetSize;

              return (
                <li key={deck.id}>
                  <Link
                    href={`/decks/${deck.id}`}
                    className="block rounded-lg border border-border bg-surface px-4 py-3 hover:border-accent"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="min-w-0 flex-1 truncate">
                        {deck.name}
                      </span>
                      {/* A cube has no commander and so no colour identity
                          to print — "colorless" would be a wrong answer to a
                          question nobody asked. */}
                      {deck.format === "commander" ? (
                        <span className="font-mono text-xs uppercase text-muted">
                          {formatColorIdentity(deck.colorIdentity)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted">
                          {DECK_FORMAT_LABELS[deck.format]}
                        </span>
                      )}
                      <span
                        className={`text-sm tabular-nums ${complete ? "" : "text-muted"}`}
                      >
                        {deck.cardCount} / {deck.targetSize}
                      </span>
                      <span
                        className={`text-sm ${percent >= 100 ? "text-ok" : "text-muted"}`}
                      >
                        {deck.ownedCopies} owned
                      </span>
                    </div>

                    <ProgressBar percent={percent} className="mt-2" />

                    <div className="mt-1 text-xs text-muted">
                      {deck.format === "cube"
                        ? `${deck.targetSize}-card cube`
                        : deck.commanderNames.length > 0
                          ? deck.commanderNames.join(" + ")
                          : "no commander yet"}
                      {deck.allocatedCopies > 0
                        ? ` · built${deck.locationName ? ` in ${deck.locationName}` : ""}`
                        : deck.locationName
                          ? ` · ${deck.locationName}`
                          : ""}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
