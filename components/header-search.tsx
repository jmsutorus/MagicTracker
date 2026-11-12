"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { CardArt } from "@/components/card-art";
import { ManaCost } from "@/components/mana-cost";
import type { CardSearchResult } from "@/lib/cards/search";

const DEBOUNCE_MS = 150;

/**
 * Card search, in the header, on every page.
 *
 * Search used to be a *destination* — a nav link to /cards, where the search
 * box lived. That is backwards for the thing people do most: looking a card
 * up is an interruption of whatever you were doing, not a place you go, and
 * every tool this is compared with keeps a search field permanently visible.
 *
 * Slash focuses it from anywhere, which is the shortcut every one of those
 * tools uses, and Escape gives the page back.
 */
export function HeaderSearch() {
  const router = useRouter();
  const listboxId = useId();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CardSearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trimmed = query.trim();
    const controller = new AbortController();

    /*
     * Every state update is inside the timeout, never in the effect body:
     * setting state synchronously during an effect cascades a render, which
     * React and the lint rule both object to.
     */
    const timer = setTimeout(async () => {
      if (trimmed.length === 0) {
        setResults([]);
        return;
      }
      try {
        const res = await fetch(
          `/api/cards/search?q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { results: CardSearchResult[] };
        setResults(data.results.slice(0, 8));
        setActiveIndex(0);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setResults([]);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  /* Slash to focus, the way every other card site does it. */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "/") return;
      const target = event.target as HTMLElement | null;
      // Not while someone is typing a deck name or a category.
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* A click anywhere else closes the list. */
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function go(result: CardSearchResult) {
    setOpen(false);
    setQuery("");
    setResults([]);
    router.push(`/cards/${result.oracleId}`);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
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
        if (results[activeIndex]) go(results[activeIndex]);
        break;
    }
  }

  const showList = open && results.length > 0;

  return (
    <div ref={boxRef} className="relative w-full sm:max-w-xs">
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search cards…"
        aria-label="Search cards"
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listboxId}
        aria-activedescendant={
          showList ? `${listboxId}-${activeIndex}` : undefined
        }
        className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm
                   outline-none placeholder:text-muted focus:border-accent"
      />

      {showList ? (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-border bg-surface shadow-xl"
        >
          {results.map((result, index) => (
            <li
              key={result.oracleId}
              id={`${listboxId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => go(result)}
              className={`flex cursor-pointer items-center gap-2 border-b border-border px-3 py-2 last:border-0 ${
                index === activeIndex ? "bg-surface-muted" : ""
              }`}
            >
              <CardArt
                printingId={result.newestPrintingId}
                className="h-6 w-8"
              />
              <span className="min-w-0 flex-1 truncate text-sm">
                {result.name}
              </span>
              <ManaCost cost={result.manaCost} size={12} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
