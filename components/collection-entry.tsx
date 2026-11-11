"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import {
  addCopiesAction,
  adjustQuantityAction,
  createLocationAction,
} from "@/app/collection/actions";
import type { CardSearchResult } from "@/lib/cards/search";
import type {
  EntryPrinting,
  EntrySet,
  LocationRow,
} from "@/lib/collection/queries";
import {
  CARD_CONDITIONS,
  CARD_FINISHES,
  LOCATION_KINDS,
  LOCATION_KIND_LABELS,
  type CardCondition,
  type CardFinish,
} from "@/lib/collection/constants";

const DEBOUNCE_MS = 150;
const MAX_LOG = 25;

type Mode = "number" | "name";

type LogEntry = {
  key: string;
  itemId: string;
  label: string;
  added: number;
  locationName: string;
  undone: boolean;
};

type Props = {
  locations: LocationRow[];
  sets: EntrySet[];
  defaultLocationId: string;
};

/**
 * The collection entry screen.
 *
 * Two modes, because the two ways cards arrive are genuinely different:
 *
 * - **Number mode** is for sealed. A freshly opened pack is in set order with
 *   the collector number printed on every card, so pinning the set once and
 *   then typing `123` ⏎ `87` ⏎ is faster than any name-based flow — and it is
 *   unambiguous, so there is no printing to disambiguate.
 * - **Name mode** is for singles, where you know the card and not the number.
 *
 * Everything is built so the hand never leaves the keyboard: focus returns to
 * the input after every add, finish/condition/location stay put between
 * entries, and every add is logged with an undo. Entering a few hundred cards
 * with a mouse is the thing that makes people abandon collection trackers.
 */
export function CollectionEntry({ locations, sets, defaultLocationId }: Props) {
  const [mode, setMode] = useState<Mode>("number");

  // Sticky across entries — the whole point. A pack is one finish and one
  // condition going into one place, so asking again per card would be absurd.
  const [finish, setFinish] = useState<CardFinish>("nonfoil");
  const [condition, setCondition] = useState<CardCondition>("NM");
  const [locationId, setLocationId] = useState(defaultLocationId);
  const [knownLocations, setKnownLocations] = useState(locations);

  const [log, setLog] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const locationName =
    knownLocations.find((l) => l.id === locationId)?.name ?? "Unsorted";

  const commit = useCallback(
    async (
      printing: { scryfallId: string; label: string },
      quantity: number,
    ) => {
      setBusy(true);
      setError(null);
      try {
        const result = await addCopiesAction({
          printingId: printing.scryfallId,
          finish,
          condition,
          locationId,
          quantity,
        });

        if (!result.ok) {
          setError(result.error);
          return false;
        }

        setLog((prev) =>
          [
            {
              key: `${result.itemId}-${Date.now()}-${Math.random()}`,
              itemId: result.itemId,
              label: result.label,
              added: result.added,
              locationName,
              undone: false,
            },
            ...prev,
          ].slice(0, MAX_LOG),
        );
        return true;
      } catch {
        setError("That did not reach the server. Check your connection.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [condition, finish, locationId, locationName],
  );

  const undo = useCallback(async (entry: LogEntry) => {
    setError(null);
    // Marked optimistically so a slow round trip cannot produce a second undo
    // of the same entry from an impatient second click.
    setLog((prev) =>
      prev.map((e) => (e.key === entry.key ? { ...e, undone: true } : e)),
    );

    const result = await adjustQuantityAction(entry.itemId, -entry.added);
    if (!result.ok) {
      setError(result.error);
      setLog((prev) =>
        prev.map((e) => (e.key === entry.key ? { ...e, undone: false } : e)),
      );
    }
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <ModeButton
          active={mode === "number"}
          onClick={() => setMode("number")}
          label="Collector number"
          hint="for sealed"
        />
        <ModeButton
          active={mode === "name"}
          onClick={() => setMode("name")}
          label="Card name"
          hint="for singles"
        />
      </div>

      <StickyControls
        finish={finish}
        setFinish={setFinish}
        condition={condition}
        setCondition={setCondition}
        locationId={locationId}
        setLocationId={setLocationId}
        locations={knownLocations}
        onLocationCreated={(created) => {
          setKnownLocations((prev) =>
            [
              ...prev,
              {
                id: created.id,
                name: created.name,
                kind: "box" as const,
                sortOrder: 0,
                itemCount: 0,
                cardCount: 0,
              },
            ].sort(
              (a, b) =>
                a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
            ),
          );
          setLocationId(created.id);
        }}
        onError={setError}
      />

      {mode === "number" ? (
        <NumberMode
          sets={sets}
          onCommit={commit}
          busy={busy}
          onError={setError}
        />
      ) : (
        <NameMode onCommit={commit} busy={busy} onError={setError} />
      )}

      {error ? (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      ) : null}

      <EntryLog log={log} onUndo={undo} />
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`cursor-pointer rounded-lg border px-3 py-2 text-left text-sm ${
        active
          ? "border-accent bg-surface text-foreground"
          : "border-border bg-surface-muted text-muted hover:text-foreground"
      }`}
    >
      <span className="block">{label}</span>
      <span className="block text-xs text-muted">{hint}</span>
    </button>
  );
}

function StickyControls({
  finish,
  setFinish,
  condition,
  setCondition,
  locationId,
  setLocationId,
  locations,
  onLocationCreated,
  onError,
}: {
  finish: CardFinish;
  setFinish: (f: CardFinish) => void;
  condition: CardCondition;
  setCondition: (c: CardCondition) => void;
  locationId: string;
  setLocationId: (id: string) => void;
  locations: LocationRow[];
  onLocationCreated: (created: { id: string; name: string }) => void;
  onError: (message: string | null) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<string>("box");

  async function create() {
    const result = await createLocationAction(newName, newKind);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    onLocationCreated({ id: result.id, name: result.name });
    setNewName("");
    setCreating(false);
    onError(null);
  }

  const selectClass =
    "rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent";

  return (
    <div className="rounded-lg border border-border bg-surface-muted p-4">
      <p className="text-xs uppercase tracking-wide text-muted">
        Applies to every card you enter, until you change it
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Finish</span>
          <select
            value={finish}
            onChange={(e) => setFinish(e.target.value as CardFinish)}
            className={selectClass}
          >
            {CARD_FINISHES.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Condition</span>
          <select
            value={condition}
            onChange={(e) => setCondition(e.target.value as CardCondition)}
            className={selectClass}
          >
            {CARD_CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Location</span>
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className={selectClass}
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} — {LOCATION_KIND_LABELS[l.kind]}
              </option>
            ))}
          </select>
        </label>

        {creating ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">New location</span>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void create();
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setCreating(false);
                  }
                }}
                placeholder="Binder A"
                autoFocus
                className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </label>
            <select
              value={newKind}
              onChange={(e) => setNewKind(e.target.value)}
              className={selectClass}
            >
              {LOCATION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {LOCATION_KIND_LABELS[k]}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void create()}
              className="cursor-pointer rounded-lg bg-accent px-3 py-2 text-sm text-accent-contrast"
            >
              Create
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="cursor-pointer py-2 text-sm text-muted underline underline-offset-4 hover:text-foreground"
          >
            New location
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------- number mode ------------------------------ */

function NumberMode({
  sets,
  onCommit,
  busy,
  onError,
}: {
  sets: EntrySet[];
  onCommit: (
    printing: { scryfallId: string; label: string },
    quantity: number,
  ) => Promise<boolean>;
  busy: boolean;
  onError: (message: string | null) => void;
}) {
  const [pinned, setPinned] = useState<EntrySet | null>(null);
  const [value, setValue] = useState("");
  const [candidates, setCandidates] = useState<EntryPrinting[]>([]);
  const [pendingQuantity, setPendingQuantity] = useState(1);
  const [activeIndex, setActiveIndex] = useState(0);
  const [note, setNote] = useState<string | null>(null);

  const numberRef = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);

  const focusNumber = useCallback(() => {
    numberRef.current?.focus();
    numberRef.current?.select();
  }, []);

  const add = useCallback(
    async (printing: EntryPrinting, quantity: number) => {
      const ok = await onCommit(
        {
          scryfallId: printing.scryfallId,
          label: `${printing.name} · ${printing.setCode.toUpperCase()} #${printing.collectorNumber}`,
        },
        quantity,
      );
      if (ok) {
        setValue("");
        setCandidates([]);
        setNote(null);
        focusNumber();
      }
      return ok;
    },
    [focusNumber, onCommit],
  );

  const lookup = useCallback(async () => {
    if (!pinned) {
      onError("Pin a set first.");
      return;
    }
    if (inFlight.current) return;

    inFlight.current = true;
    onError(null);
    setNote(null);

    try {
      const res = await fetch(
        `/api/collection/lookup?set=${encodeURIComponent(pinned.code)}&number=${encodeURIComponent(value)}`,
      );
      const data = (await res.json()) as {
        error?: string;
        quantity?: number;
        collectorNumber?: string;
        candidates?: EntryPrinting[];
      };

      if (!res.ok) {
        onError(data.error ?? `Lookup failed (${res.status})`);
        focusNumber();
        return;
      }

      const found = data.candidates ?? [];
      const quantity = data.quantity ?? 1;

      if (found.length === 0) {
        onError(
          `No card #${data.collectorNumber} in ${pinned.code.toUpperCase()} (${pinned.name}).`,
        );
        focusNumber();
        return;
      }

      if (found.length === 1) {
        await add(found[0], quantity);
        return;
      }

      // More than one printing really does share this number in this set, so
      // the choice is the user's. Not a failure — just rare.
      setPendingQuantity(quantity);
      setCandidates(found);
      setActiveIndex(0);
      setNote(
        `${found.length} printings share #${data.collectorNumber} — pick one.`,
      );
    } catch {
      onError("That did not reach the server. Check your connection.");
    } finally {
      inFlight.current = false;
    }
  }, [add, focusNumber, onError, pinned, value]);

  return (
    <div className="space-y-4">
      <SetPicker
        sets={sets}
        pinned={pinned}
        onPin={(s) => {
          setPinned(s);
          setCandidates([]);
          setNote(null);
          onError(null);
          // Pinning is the setup step; the number box is where the work
          // happens, so land there immediately.
          setTimeout(() => numberRef.current?.focus(), 0);
        }}
      />

      {pinned ? (
        <div>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">
              Collector number in {pinned.code.toUpperCase()} — type and press
              Enter
            </span>
            <input
              ref={numberRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void lookup();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setValue("");
                  setCandidates([]);
                  setNote(null);
                  onError(null);
                } else if (candidates.length > 0 && e.key === "ArrowDown") {
                  e.preventDefault();
                  setActiveIndex((i) => (i + 1) % candidates.length);
                } else if (candidates.length > 0 && e.key === "ArrowUp") {
                  e.preventDefault();
                  setActiveIndex(
                    (i) => (i - 1 + candidates.length) % candidates.length,
                  );
                }
              }}
              inputMode="text"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              disabled={busy}
              placeholder="123   ·   4x 123   ·   #123"
              className="w-full rounded-lg border border-border bg-surface px-4 py-3 font-mono text-lg
                         outline-none placeholder:font-sans placeholder:text-base
                         placeholder:text-muted focus:border-accent disabled:opacity-60"
            />
          </label>

          <p className="mt-2 text-xs text-muted">
            A pack is in set order, so you can read straight down it. Prefix a
            quantity with a space — <span className="font-mono">4x 123</span>.
          </p>

          {note ? <p className="mt-2 text-sm text-warn">{note}</p> : null}

          {candidates.length > 0 ? (
            <ul
              role="listbox"
              className="mt-3 overflow-hidden rounded-lg border border-border bg-surface"
            >
              {candidates.map((c, i) => (
                <li
                  key={c.scryfallId}
                  role="option"
                  aria-selected={i === activeIndex}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => void add(c, pendingQuantity)}
                  className={`flex cursor-pointer items-baseline gap-3 border-b border-border px-4 py-2.5 last:border-0 ${
                    i === activeIndex ? "bg-surface-muted" : ""
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {c.lang} · {c.rarity}
                    {c.isExtra ? " · extra" : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted">
          Pin the set you are entering, then type bare collector numbers.
        </p>
      )}
    </div>
  );
}

/**
 * Searchable set picker.
 *
 * The full set list is handed over in the page payload rather than queried per
 * keystroke: there are about a thousand sets and they change when a set is
 * released, so filtering locally makes pinning instant and costs one small
 * payload on load.
 */
function SetPicker({
  sets,
  pinned,
  onPin,
}: {
  sets: EntrySet[];
  pinned: EntrySet | null;
  onPin: (set: EntrySet) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();

  const needle = query.trim().toLowerCase();
  const matches = (
    needle.length === 0
      ? sets
      : sets.filter(
          (s) =>
            s.code.toLowerCase().includes(needle) ||
            s.name.toLowerCase().includes(needle),
        )
  ).slice(0, 12);

  function choose(index: number) {
    const picked = matches[index];
    if (!picked) return;
    onPin(picked);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className="relative">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Set</span>
        <div className="flex flex-wrap items-center gap-2">
          {pinned ? (
            <span className="rounded-lg border border-accent bg-surface px-3 py-2 text-sm">
              <span className="font-mono uppercase">{pinned.code}</span>{" "}
              {pinned.name}{" "}
              <span className="text-muted">
                · {pinned.printingCount.toLocaleString()} cards
              </span>
            </span>
          ) : null}
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setActiveIndex(0);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setOpen(true);
                setActiveIndex((i) => (i + 1) % Math.max(matches.length, 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex(
                  (i) =>
                    (i - 1 + Math.max(matches.length, 1)) %
                    Math.max(matches.length, 1),
                );
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(activeIndex);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setOpen(false);
              }
            }}
            role="combobox"
            aria-expanded={open && matches.length > 0}
            aria-controls={listboxId}
            placeholder={pinned ? "Change set…" : "Bloomburrow, or blb…"}
            autoComplete="off"
            className="min-w-56 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm
                       outline-none placeholder:text-muted focus:border-accent"
          />
        </div>
      </label>

      {open && matches.length > 0 ? (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-border bg-surface shadow-lg"
        >
          {matches.map((s, i) => (
            <li
              key={s.code}
              role="option"
              aria-selected={i === activeIndex}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseDown={(e) => {
                // mousedown, not click: blur would close the list first.
                e.preventDefault();
                choose(i);
              }}
              className={`flex cursor-pointer items-baseline gap-3 border-b border-border px-3 py-2 text-sm last:border-0 ${
                i === activeIndex ? "bg-surface-muted" : ""
              }`}
            >
              <span className="w-12 shrink-0 font-mono text-xs uppercase text-muted">
                {s.code}
              </span>
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              <span className="shrink-0 text-xs text-muted">
                {s.releasedAt?.slice(0, 4) ?? "—"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* -------------------------------- name mode ------------------------------- */

function NameMode({
  onCommit,
  busy,
  onError,
}: {
  onCommit: (
    printing: { scryfallId: string; label: string },
    quantity: number,
  ) => Promise<boolean>;
  busy: boolean;
  onError: (message: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CardSearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);

  // When a card has more than one printing, the choice has to be made, so the
  // list of them replaces the results until it is.
  const [printings, setPrintings] = useState<EntryPrinting[] | null>(null);
  const [printingIndex, setPrintingIndex] = useState(0);
  const [chosenName, setChosenName] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setQuery("");
    setResults([]);
    setPrintings(null);
    setChosenName(null);
    setActiveIndex(0);
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    const controller = new AbortController();

    // Every state update happens inside the timeout, never in the effect
    // body: setting state synchronously during an effect cascades a re-render.
    const timer = setTimeout(async () => {
      if (trimmed.length === 0) {
        setResults([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const res = await fetch(
          `/api/cards/search?q=${encodeURIComponent(trimmed)}&limit=8`,
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error(`Search failed (${res.status})`);
        const data = (await res.json()) as { results: CardSearchResult[] };
        setResults(data.results);
        setActiveIndex(0);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        onError(err instanceof Error ? err.message : "Search failed");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [onError, query]);

  const addPrinting = useCallback(
    async (printing: EntryPrinting) => {
      const ok = await onCommit(
        {
          scryfallId: printing.scryfallId,
          label: `${printing.name} · ${printing.setCode.toUpperCase()} #${printing.collectorNumber}`,
        },
        1,
      );
      if (ok) reset();
    },
    [onCommit, reset],
  );

  const chooseCard = useCallback(
    async (result: CardSearchResult) => {
      onError(null);

      // One printing means there is nothing to pick, so skip the step
      // entirely rather than making the user confirm the only option.
      if (result.printingCount === 1) {
        await onCommit(
          {
            scryfallId: result.newestPrintingId,
            label: `${result.name} · ${result.newestSetCode.toUpperCase()}`,
          },
          1,
        );
        reset();
        return;
      }

      try {
        const res = await fetch(
          `/api/cards/printings?oracleId=${encodeURIComponent(result.oracleId)}`,
        );
        if (!res.ok)
          throw new Error(`Could not load printings (${res.status})`);
        const data = (await res.json()) as { printings: EntryPrinting[] };
        setPrintings(data.printings);
        setPrintingIndex(0);
        setChosenName(result.name);
      } catch (err) {
        onError(
          err instanceof Error ? err.message : "Could not load printings",
        );
      }
    },
    [onCommit, onError, reset],
  );

  return (
    <div className="space-y-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">
          Card name — Enter picks, then Enter again picks the printing
        </span>
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPrintings(null);
            setChosenName(null);
          }}
          onKeyDown={(e) => {
            if (printings) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setPrintingIndex((i) => (i + 1) % printings.length);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setPrintingIndex(
                  (i) => (i - 1 + printings.length) % printings.length,
                );
              } else if (e.key === "Enter") {
                e.preventDefault();
                const picked = printings[printingIndex];
                if (picked) void addPrinting(picked);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setPrintings(null);
                setChosenName(null);
              }
              return;
            }

            if (results.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIndex((i) => (i + 1) % results.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIndex((i) => (i - 1 + results.length) % results.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              const picked = results[activeIndex];
              if (picked) void chooseCard(picked);
            } else if (e.key === "Escape") {
              e.preventDefault();
              reset();
            }
          }}
          placeholder="Lightning Bolt…"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          disabled={busy}
          className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-base
                     outline-none placeholder:text-muted focus:border-accent disabled:opacity-60"
        />
      </label>

      {loading ? <p className="text-xs text-muted">Searching…</p> : null}

      {printings ? (
        <div>
          <p className="text-sm text-muted">
            Which printing of{" "}
            <span className="text-foreground">{chosenName}</span>?
          </p>
          <ul
            role="listbox"
            className="mt-2 max-h-80 overflow-auto rounded-lg border border-border bg-surface"
          >
            {printings.map((p, i) => (
              <li
                key={p.scryfallId}
                role="option"
                aria-selected={i === printingIndex}
                onMouseEnter={() => setPrintingIndex(i)}
                onClick={() => void addPrinting(p)}
                className={`flex cursor-pointer items-baseline gap-3 border-b border-border px-4 py-2 text-sm last:border-0 ${
                  i === printingIndex ? "bg-surface-muted" : ""
                }`}
              >
                <span className="w-12 shrink-0 font-mono text-xs uppercase text-muted">
                  {p.setCode}
                </span>
                <span className="min-w-0 flex-1 truncate">{p.setName}</span>
                <span className="shrink-0 font-mono text-xs text-muted">
                  #{p.collectorNumber}
                </span>
                <span className="shrink-0 text-xs text-muted">{p.rarity}</span>
                {p.ownedQuantity > 0 ? (
                  <span className="shrink-0 text-xs text-ok">
                    own {p.ownedQuantity}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : results.length > 0 ? (
        <ul
          role="listbox"
          className="overflow-hidden rounded-lg border border-border bg-surface"
        >
          {results.map((r, i) => (
            <li
              key={r.oracleId}
              role="option"
              aria-selected={i === activeIndex}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => void chooseCard(r)}
              className={`flex cursor-pointer items-baseline gap-3 border-b border-border px-4 py-2.5 last:border-0 ${
                i === activeIndex ? "bg-surface-muted" : ""
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{r.name}</span>
                <span className="block truncate text-xs text-muted">
                  {r.typeLine ?? ""}
                </span>
              </span>
              <span className="shrink-0 text-xs text-muted">
                {r.printingCount}{" "}
                {r.printingCount === 1 ? "printing" : "printings"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* --------------------------------- the log -------------------------------- */

function EntryLog({
  log,
  onUndo,
}: {
  log: LogEntry[];
  onUndo: (entry: LogEntry) => void;
}) {
  if (log.length === 0) {
    return (
      <p className="text-sm text-muted">
        Nothing entered yet this session. Everything you add shows up here with
        an undo.
      </p>
    );
  }

  const total = log
    .filter((e) => !e.undone)
    .reduce((sum, e) => sum + e.added, 0);

  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="flex items-baseline justify-between border-b border-border px-4 py-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          This session
        </h2>
        <span className="text-sm text-muted">
          {total} card{total === 1 ? "" : "s"}
        </span>
      </div>
      <ul>
        {log.map((entry) => (
          <li
            key={entry.key}
            className="flex items-baseline gap-3 border-b border-border px-4 py-2 text-sm last:border-0"
          >
            <span className="w-10 shrink-0 font-mono text-xs text-muted">
              {entry.added}×
            </span>
            <span
              className={`min-w-0 flex-1 truncate ${
                entry.undone ? "text-muted line-through" : ""
              }`}
            >
              {entry.label}
            </span>
            <span className="shrink-0 text-xs text-muted">
              {entry.locationName}
            </span>
            {entry.undone ? (
              <span className="shrink-0 text-xs text-muted">undone</span>
            ) : (
              <button
                type="button"
                onClick={() => onUndo(entry)}
                className="shrink-0 cursor-pointer text-xs text-muted underline underline-offset-4 hover:text-foreground"
              >
                undo
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
