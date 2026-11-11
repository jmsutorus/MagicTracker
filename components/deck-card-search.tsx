"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { addDeckCardAction } from "@/app/decks/actions";
import {
  DECK_BOARDS,
  DECK_BOARD_LABELS,
  type DeckBoard,
} from "@/lib/decks/constants";

type Candidate = {
  oracleId: string;
  name: string;
  typeLine: string | null;
  manaCost: string | null;
  colorIdentity: string[];
  commanderLegality: string | null;
  available: number;
  owned: number;
  inDeck: boolean;
  inIdentity: boolean;
};

/**
 * Adding a card to a deck, with owned-vs-needed answered in the same row.
 *
 * The whole point of this component is that the decision and the information
 * arrive together: whether you own a copy, whether one is free (another built
 * deck may have claimed it), whether it is legal, and whether it fits the
 * commander's colours — all on the row you are about to press Enter on. Going
 * to look any of that up elsewhere is what makes deck building tedious.
 *
 * Keyboard-first for the same reason the collection entry screen is: arrow
 * keys move, Enter adds, focus stays in the box so the next card follows
 * without touching the mouse.
 */
export function DeckCardSearch({
  deckId,
  defaultBoard = "main",
}: {
  deckId: string;
  defaultBoard?: DeckBoard;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [board, setBoard] = useState<DeckBoard>(defaultBoard);
  const [results, setResults] = useState<Candidate[]>([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  // Debounced so typing a card name is one request, not one per keystroke.
  useEffect(() => {
    const trimmed = query.trim();
    const controller = new AbortController();

    // Every state update happens inside the timeout, never in the effect
    // body: setting state synchronously during an effect cascades a
    // re-render. Same shape as components/collection-entry.tsx.
    const timer = setTimeout(async () => {
      if (trimmed.length === 0) {
        setResults([]);
        return;
      }

      try {
        const res = await fetch(
          `/api/decks/${deckId}/search?q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          setError("Search failed.");
          return;
        }
        const body = (await res.json()) as { results: Candidate[] };
        setResults(body.results);
        setActive(0);
        setError(null);
      } catch (cause) {
        // An aborted request is the expected case while typing.
        if ((cause as Error)?.name !== "AbortError") setError("Search failed.");
      }
    }, 150);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, deckId]);

  async function add(candidate: Candidate) {
    setBusy(true);
    setError(null);

    const result = await addDeckCardAction({
      deckId,
      oracleId: candidate.oracleId,
      board,
    });

    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setAdded(`${candidate.name} → ${DECK_BOARD_LABELS[board]}`);
    setQuery("");
    setResults([]);
    inputRef.current?.focus();
    startTransition(() => router.refresh());
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const candidate = results[active];
      if (candidate) void add(candidate);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface-muted p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
        Add a card
      </h2>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">
            Type a name, arrow to it, Enter to add
          </span>
          <input
            ref={inputRef}
            value={query}
            disabled={busy}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Sol Ring…"
            className="w-72 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Onto</span>
          <select
            value={board}
            disabled={busy}
            onChange={(e) => setBoard(e.target.value as DeckBoard)}
            className="w-40 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          >
            {DECK_BOARDS.map((b) => (
              <option key={b} value={b}>
                {DECK_BOARD_LABELS[b]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-bad">
          {error}
        </p>
      ) : null}

      {added && results.length === 0 ? (
        <p role="status" className="mt-3 text-sm text-ok">
          Added {added}.
        </p>
      ) : null}

      {results.length > 0 ? (
        <ul
          role="listbox"
          className="mt-3 overflow-hidden rounded-lg border border-border bg-surface"
        >
          {results.map((candidate, index) => (
            <li
              key={candidate.oracleId}
              role="option"
              aria-selected={index === active}
            >
              <button
                type="button"
                onMouseEnter={() => setActive(index)}
                onClick={() => void add(candidate)}
                disabled={busy}
                className={`flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-left text-sm ${
                  index === active ? "bg-surface-muted" : ""
                }`}
              >
                <span className="min-w-0 flex-1 truncate">
                  {candidate.name}
                  {candidate.inDeck ? (
                    <span className="ml-2 text-xs text-muted">
                      already in this deck
                    </span>
                  ) : null}
                </span>

                <span className="font-mono text-xs text-muted">
                  {candidate.manaCost ?? ""}
                </span>

                {/* The three facts that make the row worth reading. */}
                <span
                  className={`text-xs ${candidate.available > 0 ? "text-ok" : "text-muted"}`}
                >
                  {candidate.available > 0
                    ? `${candidate.available} free`
                    : candidate.owned > 0
                      ? `${candidate.owned} owned, all claimed`
                      : "not owned"}
                </span>

                {candidate.commanderLegality !== "legal" ? (
                  <span className="text-xs text-bad">
                    {candidate.commanderLegality === "banned"
                      ? "banned"
                      : "not legal"}
                  </span>
                ) : null}

                {!candidate.inIdentity ? (
                  <span className="text-xs text-bad">off-colour</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
