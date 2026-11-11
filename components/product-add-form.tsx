"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { addPreconAction, undoPreconAction } from "@/app/products/actions";
import {
  CARD_CONDITIONS,
  LOCATION_EXPLAINER,
  LOCATION_KIND_LABELS,
  type CardCondition,
  type LocationKind,
} from "@/lib/collection/constants";
import {
  DEFAULT_PRECON_BOARDS,
  PRECON_BOARD_LABELS,
  type PreconBoard,
} from "@/lib/products/constants";
import type { PreconAdded, PreconUndoToken } from "@/lib/products/precon";

export type BoardSummary = {
  board: PreconBoard;
  /** Distinct cards on this board. */
  lines: number;
  /** Total copies on this board. */
  copies: number;
  /** Copies whose card did not resolve to a printing we hold. */
  unresolved: number;
};

type LocationOption = {
  id: string;
  name: string;
  kind: LocationKind;
  /** Cards already filed there, so the dropdown says what each one is. */
  cardCount: number;
};

/** The select value that means "make a box for this, named below". */
const NEW_BOX = "__new__";

/** "Shelf — Storage box · 412 cards", the whole answer on one line. */
function describeLocation(location: LocationOption): string {
  const kind = LOCATION_KIND_LABELS[location.kind];
  const cards =
    location.cardCount === 1 ? "1 card" : `${location.cardCount} cards`;
  return `${location.name} — ${kind} · ${cards}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

type Props = {
  fileName: string;
  productName: string;
  boards: BoardSummary[];
  locations: LocationOption[];
  /** True for a Commander Deck, the one product that is also a decklist. */
  canBuildDeck?: boolean;
  /** Copies of this box's cards already in the collection. */
  ownedCopies?: number;
};

/**
 * Adding a precon, in one press.
 *
 * It used to take four, in three places: make a deck box, add the cards to
 * it, build the decklist, mark the deck built. Each is a real thing the app
 * records, but nobody who just bought a deck did four things — they bought a
 * deck. So the default path is one button that does all four and one Undo
 * that takes all four back, and every knob that used to be on the way there
 * now lives behind "Change what happens", where it is still exact for the
 * person pulling a box apart for singles.
 */
export function ProductAddForm({
  fileName,
  productName,
  boards,
  locations,
  canBuildDeck = false,
  ownedCopies = 0,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  /*
   * A Commander deck defaults to its own box, because keeping it together is
   * what a precon is for. Anything else — a bundle, a Jumpstart pack — is a
   * pile of cards, so it defaults to wherever cards already go.
   */
  const [destination, setDestination] = useState(
    canBuildDeck || locations.length === 0
      ? NEW_BOX
      : (locations[0]?.id ?? NEW_BOX),
  );
  const [boxName, setBoxName] = useState(productName);
  const [deckName, setDeckName] = useState(productName);
  const [buildDeck, setBuildDeck] = useState(canBuildDeck);
  const [condition, setCondition] = useState<CardCondition>("NM");
  const [selected, setSelected] = useState<PreconBoard[]>(() =>
    boards
      .filter((b) => DEFAULT_PRECON_BOARDS.includes(b.board))
      .map((b) => b.board),
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<PreconAdded | null>(null);
  const [undone, setUndone] = useState<string | null>(null);

  const copies = boards
    .filter((b) => selected.includes(b.board))
    .reduce((n, b) => n + b.copies, 0);

  const boxLabel =
    destination === NEW_BOX
      ? boxName.trim().length > 0
        ? `a new box called “${boxName.trim()}”`
        : "a new box"
      : (locations.find((l) => l.id === destination)?.name ?? "that box");

  function toggle(board: PreconBoard) {
    setSelected((current) =>
      current.includes(board)
        ? current.filter((b) => b !== board)
        : [...current, board],
    );
  }

  async function add() {
    setBusy(true);
    setError(null);
    setDone(null);
    setUndone(null);

    const result = await addPreconAction({
      fileName,
      locationId: destination === NEW_BOX ? null : destination,
      locationName: boxName,
      condition,
      boards: selected,
      buildDeck,
      deckName,
    });

    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setDone(result);
    startTransition(() => router.refresh());
  }

  async function undo(token: PreconUndoToken) {
    setBusy(true);
    setError(null);

    const result = await undoPreconAction(token);

    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setUndone(
      [
        `Put it back: took out ${plural(result.copies, "card")}`,
        result.deckDeleted ? "deleted the deck" : null,
        result.locationDeleted ? "removed the box" : null,
      ]
        .filter(Boolean)
        .join(", ") + ".",
    );
    setDone(null);
    startTransition(() => router.refresh());
  }

  return (
    <div className="rounded-lg border border-border bg-surface-muted p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
        {canBuildDeck ? "I bought this deck" : "I bought this"}
      </h2>

      {/*
       * Adding twice is allowed — two boxes is two boxes — but it is also
       * the obvious way to double your collection by accident, since the
       * page looks the same before and after. So it says so first.
       */}
      {ownedCopies > 0 && done === null ? (
        <p className="mt-2 text-sm text-muted">
          You already own {plural(ownedCopies, "card")} from this box. Pressing
          this adds another copy of it.
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={() => void add()}
          disabled={
            busy ||
            copies === 0 ||
            (destination === NEW_BOX && boxName.trim().length === 0)
          }
          className="cursor-pointer rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-contrast disabled:opacity-40"
        >
          {busy
            ? "Working…"
            : buildDeck
              ? "Add the deck"
              : `Add ${plural(copies, "card")}`}
        </button>

        {copies === 0 ? (
          <span className="text-xs text-muted">
            Nothing is ticked to add — see “Change what happens”.
          </span>
        ) : null}
      </div>

      {/*
       * One sentence, built from the settings that are actually in force, so
       * that opening the options and changing something cannot leave the
       * promise and the behaviour disagreeing.
       */}
      <p className="mt-3 text-sm text-muted">
        Puts {plural(copies, "card")} into {boxLabel}
        {buildDeck
          ? ", builds the decklist, and marks the deck built — so other decks stop counting those cards as free."
          : "."}{" "}
        One press, and one Undo if it was the wrong box.
      </p>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-bad">
          {error}
        </p>
      ) : null}

      {undone ? (
        <p role="status" className="mt-3 text-sm text-muted">
          {undone}
        </p>
      ) : null}

      {done ? (
        <div
          role="status"
          className="mt-3 rounded-lg border border-border bg-surface p-3 text-sm"
        >
          <span className="text-ok">
            Added {plural(done.copies, "card")} to {done.location.name}
            {done.location.created ? " (new box)" : ""}
            {done.deck
              ? `, built “${done.deck.name}” and claimed ${plural(done.deck.allocated, "card")} for it.`
              : "."}
          </span>

          {done.deck && done.deck.unavailable > 0 ? (
            <span className="mt-1 block text-muted">
              {plural(done.deck.unavailable, "card")} could not be claimed —
              another built deck already has{" "}
              {done.deck.unavailable === 1 ? "it" : "them"}.
            </span>
          ) : null}

          {done.skipped > 0 ? (
            <span className="mt-1 block text-muted">
              {plural(done.skipped, "card")} could not be matched to a printing
              and {done.skipped === 1 ? "was" : "were"} left out
              {done.skippedNames.length > 0
                ? `: ${done.skippedNames.join(", ")}`
                : ""}
              .
            </span>
          ) : null}

          <span className="mt-3 flex flex-wrap items-center gap-4">
            {done.deck ? (
              <Link
                href={`/decks/${done.deck.id}`}
                className="rounded-lg border border-border bg-surface-muted px-3 py-1.5 hover:text-foreground"
              >
                Open the deck →
              </Link>
            ) : (
              <Link
                href="/collection"
                className="rounded-lg border border-border bg-surface-muted px-3 py-1.5 hover:text-foreground"
              >
                Open the collection →
              </Link>
            )}
            <button
              type="button"
              onClick={() => void undo(done.undo)}
              disabled={busy}
              className="cursor-pointer text-muted underline underline-offset-4 hover:text-foreground disabled:opacity-40"
            >
              Undo all of it
            </button>
          </span>
        </div>
      ) : null}

      <details className="mt-4 border-t border-border pt-3">
        <summary className="cursor-pointer text-sm text-muted hover:text-foreground">
          Change what happens
        </summary>

        <div className="mt-4 space-y-5">
          {canBuildDeck ? (
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={buildDeck}
                disabled={busy}
                onChange={(e) => setBuildDeck(e.target.checked)}
                className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
              />
              <span className="min-w-0">
                <span className="block text-sm">
                  Build the decklist as well
                </span>
                <span className="block text-xs text-muted">
                  Leave this off if you are pulling the box apart for singles —
                  the cards still go into your collection.
                </span>
              </span>
            </label>
          ) : null}

          {buildDeck ? (
            <label className="flex flex-col gap-1">
              <span className="text-sm">Deck name</span>
              <input
                value={deckName}
                disabled={busy}
                onChange={(e) => setDeckName(e.target.value)}
                className="w-72 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </label>
          ) : null}

          <div>
            <p className="text-sm">Where the cards go</p>
            <p className="mt-1 text-xs text-muted">
              {LOCATION_EXPLAINER}{" "}
              <Link
                href="/collection/locations"
                className="underline underline-offset-4 hover:text-foreground"
              >
                See all {locations.length}
              </Link>
              .
            </p>

            <div className="mt-3 flex flex-wrap items-end gap-4">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted">Box</span>
                <select
                  value={destination}
                  disabled={busy}
                  onChange={(e) => setDestination(e.target.value)}
                  className="w-72 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
                >
                  <option value={NEW_BOX}>A new box of its own</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {describeLocation(l)}
                    </option>
                  ))}
                </select>
              </label>

              {destination === NEW_BOX ? (
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted">New box name</span>
                  <input
                    value={boxName}
                    disabled={busy}
                    onChange={(e) => setBoxName(e.target.value)}
                    className="w-56 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
                  />
                </label>
              ) : null}

              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted">Condition</span>
                <select
                  value={condition}
                  disabled={busy}
                  onChange={(e) =>
                    setCondition(e.target.value as CardCondition)
                  }
                  className="w-28 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
                >
                  {CARD_CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {destination === NEW_BOX ? (
              <p className="mt-2 text-xs text-muted">
                Nothing is created until you press the button above. A box of
                this name that already exists is used as it is, not duplicated.
              </p>
            ) : null}
          </div>

          <fieldset>
            <legend className="text-sm">What goes in</legend>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
              {boards.map((b) => (
                <label
                  key={b.board}
                  className={`flex gap-2 ${busy ? "opacity-50" : "cursor-pointer"}`}
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(b.board)}
                    disabled={busy}
                    onChange={() => toggle(b.board)}
                    className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm">
                      {PRECON_BOARD_LABELS[b.board]}
                    </span>
                    <span className="block text-xs text-muted">
                      {plural(b.copies, "card")}
                      {b.unresolved > 0 ? `, ${b.unresolved} unmatched` : ""}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </details>
    </div>
  );
}
