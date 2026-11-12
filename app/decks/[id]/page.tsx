import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { CubeReportPanel } from "@/components/cube-report";
import { CubeSizeForm } from "@/components/cube-size-form";
import { DeckEditor } from "@/components/deck-editor";
import { DeckCardSearch } from "@/components/deck-card-search";
import { DeckShare } from "@/components/deck-share";
import { DeckStats } from "@/components/deck-stats";
import { DeckToolbar } from "@/components/deck-toolbar";
import { ColorIdentity } from "@/components/mana-cost";
import { ProgressBar } from "@/components/progress-bar";
import { PurchaseButtons } from "@/components/purchase-buttons";
import { requireUser } from "@/lib/auth/dal";
import { listLocations } from "@/lib/collection/queries";
import {
  COMMANDER_DECK_SIZE,
  DECK_FORMAT_LABELS,
} from "@/lib/decks/constants";
import { type LegalityReport } from "@/lib/decks/legality";
import { getDeck } from "@/lib/decks/queries";
import { getShareState } from "@/lib/decks/share";

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

  const [deck, locations, share, requestHeaders] = await Promise.all([
    getDeck(id),
    listLocations(),
    getShareState(id),
    headers(),
  ]);
  if (!deck) notFound();

  /*
   * The origin to print in the share box, taken from the request so it is
   * right at localhost and at the deployed domain without a configured base
   * URL. The Host header is client-controlled, which matters when a value is
   * used to redirect or to send mail — here it only decides what the owner
   * sees in a read-only input next to a Copy button.
   */
  const forwardedHost = requestHeaders.get("x-forwarded-host");
  const host = forwardedHost ?? requestHeaders.get("host") ?? "";
  const proto =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const origin = host ? `${proto}://${host}` : "";

  const counted = deck.cards.filter((c) => c.board !== "maybe");
  const ownedCopies = counted.reduce(
    (n, c) => n + Math.min(c.available, c.quantity),
    0,
  );
  const neededCopies = deck.missing.reduce((n, m) => n + m.need, 0);
  const allocatedCount = deck.cards.filter((c) => c.isAllocated).length;

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
          {deck.verdict.kind === "commander" ? (
            /* Pips, not "WUB": the deck's colours are the first thing a
               player reads off a deck page, and they read them as symbols. */
            <ColorIdentity
              colors={deck.verdict.report.colorIdentity}
              size={16}
            />
          ) : (
            <span className="text-sm text-muted">
              {DECK_FORMAT_LABELS[deck.format]} · {deck.targetSize} cards
            </span>
          )}
        </div>

        {/* ---- the verdict ----------------------------------------------- */}
        {/*
          One panel or the other, never both. The two formats are judged by
          different things — Commander by rules it can break, a cube by a
          target its owner set — so the page asks the deck which it is rather
          than rendering a Commander verdict with the inapplicable checks
          quietly suppressed.
        */}
        {deck.verdict.kind === "commander" ? (
          <CommanderVerdict
            report={deck.verdict.report}
            ownedCopies={ownedCopies}
            neededCopies={neededCopies}
          />
        ) : (
          <CubeReportPanel
            report={deck.verdict.report}
            ownedCopies={ownedCopies}
          >
            <CubeSizeForm deckId={deck.id} targetSize={deck.targetSize} />
          </CubeReportPanel>
        )}

        {/* ---- what the deck is made of ---------------------------------- */}
        <div className="mt-6">
          <DeckStats cards={deck.cards} />
        </div>

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
            {/*
              No set code: a deck needs the card, and any printing will do, so
              the stores are left to pick the cheapest one.
            */}
            <div className="mt-4 border-t border-border pt-4">
              <PurchaseButtons
                label="this list"
                entries={deck.missing.map((m) => ({
                  quantity: m.need,
                  name: m.name,
                }))}
              />
            </div>
          </section>
        ) : null}

        <div className="mt-6">
          <DeckToolbar
            deckId={deck.id}
            name={deck.name}
            locationId={deck.locationId}
            locations={locations.map((l) => ({ id: l.id, name: l.name }))}
            allocatedCount={allocatedCount}
            cardCount={deck.cardCount}
          />
        </div>

        <section className="mt-6 rounded-lg border border-border bg-surface-muted p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Share
          </h2>
          <div className="mt-2">
            <DeckShare
              deckId={deck.id}
              token={share.token}
              createdAt={share.createdAt}
              origin={origin}
            />
          </div>
        </section>

        <div className="mt-6">
          <DeckCardSearch
            deckId={deck.id}
            format={deck.format}
            defaultBoard={
              // A cube has no command zone, so every card goes to the list.
              // A Commander deck starts on the commander, because an empty
              // deck's first card is one and the colour-identity check has
              // nothing to work from until it is there.
              deck.format === "cube" ||
              deck.cards.some((c) => c.board === "commander")
                ? "main"
                : "commander"
            }
          />
        </div>

        {deck.cards.length > 0 ? (
          <DeckEditor
            deckId={deck.id}
            format={deck.format}
            cards={deck.cards}
          />
        ) : null}

        {deck.cards.length === 0 ? (
          <p className="mt-8 rounded-lg border border-border bg-surface p-5 text-sm text-muted">
            {deck.format === "cube" ? (
              <>
                Empty cube. Add cards above one at a time, or{" "}
                <Link
                  href="/import"
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  paste the whole list
                </Link>{" "}
                — {deck.targetSize} names is a paste, not an afternoon.
              </>
            ) : (
              <>
                Empty deck. Add a commander first — the search above starts on
                the command zone, and the colour-identity check works from it.
              </>
            )}
          </p>
        ) : null}
      </main>
    </div>
  );
}

/**
 * The Commander verdict: size, what you own of it, and every rule it breaks.
 *
 * Errors and warnings are separated rather than sorted together, because
 * they mean different things to act on — an error is "this deck is not
 * legal", a warning is "check this before you play it" (see
 * lib/decks/legality.ts on unverifiable commander pairs).
 */
function CommanderVerdict({
  report,
  ownedCopies,
  neededCopies,
}: {
  report: LegalityReport;
  ownedCopies: number;
  neededCopies: number;
}) {
  const ownedPercent =
    report.cardCount === 0
      ? 0
      : Math.min(Math.round((ownedCopies / report.cardCount) * 100), 100);

  const errors = report.problems.filter((p) => p.severity === "error");
  const warnings = report.problems.filter((p) => p.severity === "warning");

  return (
    <section className="mt-6 rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="text-3xl font-semibold tabular-nums">
          {report.cardCount}
          <span className="text-xl text-muted">
            {" / "}
            {COMMANDER_DECK_SIZE}
          </span>
        </span>
        <span
          className={`text-lg font-semibold ${
            report.legal ? "text-ok" : "text-bad"
          }`}
        >
          {report.legal ? "Legal" : "Not legal yet"}
        </span>
      </div>

      <ProgressBar percent={ownedPercent} className="mt-3" />
      <p className="mt-3 text-sm text-muted">
        {ownedCopies} of {report.cardCount} cards available from your collection
        {neededCopies > 0 ? (
          <>
            {" — "}
            <strong className="font-normal text-foreground">
              {neededCopies} still to buy
            </strong>
          </>
        ) : report.cardCount > 0 ? (
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
  );
}
