"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { ManaCost } from "@/components/mana-cost";
import type { CardSearchResult } from "@/lib/cards/search";

const DEBOUNCE_MS = 150;

/**
 * Keyboard-first card search.
 *
 * This component is the seed of Phase 2's fast-entry screen, so the
 * interaction model matters more than the styling: type, arrow to the right
 * card, Enter. The hand never has to leave the keyboard, because entering a
 * few hundred cards with a mouse is the thing that makes people give up on
 * collection trackers.
 */
export function CardSearch() {
  const router = useRouter();
  const listboxId = useId();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CardSearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const trimmed = query.trim();

    /**
     * Every state update lives inside the timeout callback, never in the
     * effect body. Setting state synchronously during an effect triggers a
     * cascading re-render, which React (and the lint rule) rightly object to.
     *
     * The cleanup aborts any in-flight request, which is what keeps a slow
     * early response from landing after a fast later one and overwriting it
     * with stale results.
     */
    const controller = new AbortController();

    const timer = setTimeout(async () => {
      if (trimmed.length === 0) {
        setResults([]);
        setError(null);
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const res = await fetch(
          `/api/cards/search?q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal },
        );

        if (!res.ok) {
          throw new Error(
            res.status === 401
              ? "Session expired — reload the page."
              : `Search failed (${res.status})`,
          );
        }

        const data = (await res.json()) as { results: CardSearchResult[] };
        setResults(data.results);
        setActiveIndex(0);
        setError(null);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Search failed");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const openCard = useCallback(
    (result: CardSearchResult) => {
      router.push(`/cards/${result.oracleId}`);
    },
    [router],
  );

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % results.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((i) => (i - 1 + results.length) % results.length);
        break;
      case "Enter":
        event.preventDefault();
        if (results[activeIndex]) openCard(results[activeIndex]);
        break;
      case "Escape":
        event.preventDefault();
        setQuery("");
        break;
    }
  }

  return (
    <div className="w-full">
      <div className="relative">
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search any card…"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={listboxId}
          aria-activedescendant={
            results.length > 0 ? `${listboxId}-${activeIndex}` : undefined
          }
          className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-base
                     outline-none placeholder:text-muted focus:border-accent"
        />
        {loading ? (
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-muted">
            …
          </span>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-bad">
          {error}
        </p>
      ) : null}

      {results.length > 0 ? (
        <ul
          id={listboxId}
          role="listbox"
          className="mt-3 overflow-hidden rounded-lg border border-border bg-surface"
        >
          {results.map((result, index) => (
            <li
              key={result.oracleId}
              id={`${listboxId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => openCard(result)}
              className={`flex cursor-pointer items-baseline gap-3 border-b border-border px-4 py-2.5 last:border-0 ${
                index === activeIndex ? "bg-surface-muted" : ""
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{result.name}</span>
                <span className="block truncate text-xs text-muted">
                  {result.typeLine ?? ""}
                </span>
              </span>
              <ManaCost cost={result.manaCost} size={13} className="shrink-0" />
              <span className="shrink-0 text-xs text-muted">
                {result.printingCount}{" "}
                {result.printingCount === 1 ? "printing" : "printings"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {query.trim().length > 0 && !loading && !error && results.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          No cards match “{query.trim()}”.
        </p>
      ) : null}

      <p className="mt-3 text-xs text-muted">
        <kbd className="font-mono">↑</kbd>{" "}
        <kbd className="font-mono">↓</kbd> to move,{" "}
        <kbd className="font-mono">Enter</kbd> to open,{" "}
        <kbd className="font-mono">Esc</kbd> to clear
      </p>
    </div>
  );
}
