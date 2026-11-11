"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { addWishAction } from "@/app/wishlist/actions";

type Candidate = {
  oracleId: string;
  name: string;
  typeLine: string | null;
  manaCost: string | null;
  newestSetCode: string;
};

/**
 * Type a name, Enter to want it.
 *
 * Keyboard-first like the collection and deck entry boxes, and for the same
 * reason: a wishlist is written in bursts — you remember four cards at once —
 * so focus stays in the box and the next name follows without the mouse.
 *
 * It adds "any printing, any finish", which is what a wish usually is. A
 * specific printing is wished for from that printing's row on the card page,
 * where you can see which one you are picking.
 */
export function WishlistAdd() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    const controller = new AbortController();

    /*
     * Every state update lives inside the timeout callback, never in the
     * effect body — setting state synchronously during an effect cascades a
     * second render, which React and the lint rule both object to. Same
     * shape as components/card-search.tsx for the same reason.
     */
    const timer = setTimeout(async () => {
      if (trimmed.length < 2) {
        setResults([]);
        return;
      }
      try {
        const response = await fetch(
          `/api/cards/search?q=${encodeURIComponent(trimmed)}&limit=8`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("search failed");
        const data = (await response.json()) as { results: Candidate[] };
        setResults(data.results);
        setActiveIndex(0);
        setError(null);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError("Search failed.");
      }
    }, 180);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  function add(card: Candidate) {
    startTransition(async () => {
      const result = await addWishAction({ oracleId: card.oracleId });
      if (result.ok) {
        setMessage(`Added ${card.name}.`);
        setError(null);
        setQuery("");
        setResults([]);
        inputRef.current?.focus();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const card = results[activeIndex];
      if (card) add(card);
    }
  }

  return (
    <div>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">
          Type a name, arrow to it, Enter to want it
        </span>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Smothering Tithe…"
          className="w-full max-w-md rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent"
        />
      </label>

      {results.length > 0 ? (
        <ul className="mt-2 max-w-md overflow-hidden rounded-lg border border-border bg-surface">
          {results.map((card, index) => (
            <li key={card.oracleId}>
              <button
                type="button"
                onClick={() => add(card)}
                onMouseEnter={() => setActiveIndex(index)}
                className={`flex w-full items-baseline gap-3 px-3 py-2 text-left text-sm ${
                  index === activeIndex ? "bg-surface-muted" : ""
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{card.name}</span>
                <span className="shrink-0 font-mono text-xs uppercase text-muted">
                  {card.newestSetCode}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-2 text-xs" role="status" aria-live="polite">
        {error ? (
          <span className="text-bad">{error}</span>
        ) : message ? (
          <span className="text-muted">{message}</span>
        ) : (
          <span className="text-muted">
            Adds the card, any printing. For one particular printing, use the
            button on its row on the card&rsquo;s page.
          </span>
        )}
      </p>
    </div>
  );
}
