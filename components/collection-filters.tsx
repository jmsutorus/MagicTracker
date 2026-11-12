"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import {
  CARD_FINISHES,
  COLLECTION_SORTS,
  COLLECTION_SORT_LABELS,
} from "@/lib/collection/constants";

/** How long after the last keystroke the name filter runs. */
const TYPING_QUIET_MS = 300;

const RARITIES = ["common", "uncommon", "rare", "mythic", "special", "bonus"];

/**
 * The collection filter bar.
 *
 * This used to be five selects and a Filter button: you chose a set, chose a
 * location, and then had to find and press a button before anything
 * happened. Every tool this app is compared with filters as you type.
 *
 * So the selects apply on change and the text box applies after a short
 * pause. The URL stays the source of truth — each change is a router
 * navigation, not local state — which keeps the filtered view linkable,
 * survivable across a reload, and correct in the back button. Paging resets
 * to the first page on any change, because page 4 of a different filter is
 * nobody's intent.
 */
export function CollectionFilters({
  sets,
  locations,
}: {
  sets: { code: string; name: string; copies: number }[];
  locations: { id: string; name: string; cardCount: number }[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const q = params.get("q") ?? "";
  const [text, setText] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /*
   * Follow the URL when it changes from outside this component — the Clear
   * link, the back button. Adjusted during render rather than in an effect,
   * which would show the stale text for a frame.
   */
  const [lastQ, setLastQ] = useState(q);
  if (q !== lastQ) {
    setLastQ(q);
    setText(q);
  }

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const apply = useCallback(
    (patch: Record<string, string>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      // Any filter change invalidates the page number.
      if (!("page" in patch)) next.delete("page");

      const query = next.toString();
      startTransition(() => {
        /*
         * `scroll: false` — re-filtering a list you are part way down should
         * not throw you back to the top of the page on every keystroke.
         */
        router.replace(query ? `/collection?${query}` : "/collection", {
          scroll: false,
        });
      });
    },
    [params, router],
  );

  function onType(value: string) {
    setText(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => apply({ q: value }), TYPING_QUIET_MS);
  }

  const selectClass =
    "rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent";

  const filtered = ["q", "set", "location", "finish", "rarity"].some((k) =>
    params.get(k),
  );

  return (
    <div
      className={`mt-6 flex flex-wrap items-end gap-3 transition-opacity ${
        pending ? "opacity-60" : ""
      }`}
    >
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Name contains</span>
        <input
          name="q"
          value={text}
          onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => {
            // Enter applies immediately rather than waiting out the pause.
            if (e.key === "Enter") {
              if (timer.current) clearTimeout(timer.current);
              apply({ q: text });
            }
          }}
          placeholder="bolt"
          type="search"
          autoComplete="off"
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Set</span>
        <select
          value={params.get("set") ?? ""}
          onChange={(e) => apply({ set: e.target.value })}
          className={selectClass}
        >
          <option value="">any</option>
          {sets.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name} ({s.copies})
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Location</span>
        <select
          value={params.get("location") ?? ""}
          onChange={(e) => apply({ location: e.target.value })}
          className={selectClass}
        >
          <option value="">anywhere</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} ({l.cardCount})
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Finish</span>
        <select
          value={params.get("finish") ?? ""}
          onChange={(e) => apply({ finish: e.target.value })}
          className={selectClass}
        >
          <option value="">any</option>
          {CARD_FINISHES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Rarity</span>
        <select
          value={params.get("rarity") ?? ""}
          onChange={(e) => apply({ rarity: e.target.value })}
          className={selectClass}
        >
          <option value="">any</option>
          {RARITIES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>

      {/*
        Sort lives beside the filters as well as on the column headings:
        "most valuable" and "recently added" have no column to click.
      */}
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Sort</span>
        <select
          value={params.get("sort") ?? "name"}
          onChange={(e) => apply({ sort: e.target.value })}
          className={selectClass}
        >
          {COLLECTION_SORTS.map((s) => (
            <option key={s} value={s}>
              {COLLECTION_SORT_LABELS[s]}
            </option>
          ))}
        </select>
      </label>

      {filtered ? (
        <button
          type="button"
          onClick={() =>
            apply({ q: "", set: "", location: "", finish: "", rarity: "" })
          }
          className="cursor-pointer py-2 text-sm text-muted underline underline-offset-4 hover:text-foreground"
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}
