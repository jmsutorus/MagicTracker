"use client";

import { useSyncExternalStore } from "react";

import {
  isDeckGrouping,
  type DeckGrouping,
} from "@/lib/decks/constants";

export type DeckView = "grid" | "table";

type Prefs = { view: DeckView; grouping: DeckGrouping };

const KEYS = {
  view: "magictracker.deckView",
  grouping: "magictracker.deckGrouping",
} as const;

const DEFAULTS: Prefs = { view: "grid", grouping: "type" };

/**
 * How the deck page is laid out, remembered per browser.
 *
 * A module-level store rather than state in the editor, for three reasons:
 *
 *  1. The preference is one thing, not one per board. With component state,
 *     switching the deck to a list left the command zone as pictures.
 *  2. It reads localStorage through `useSyncExternalStore`, which is the API
 *     for a value React does not own. Reading it in an effect and calling
 *     setState renders the wrong view once and then corrects itself, and the
 *     lint rule against cascading renders is right to object.
 *  3. The `storage` event is subscribed to, so the preference follows the
 *     person between tabs instead of going stale in the one they left open.
 *
 * The default grouping is by card type rather than by category: a deck that
 * was just pasted in has no categories, and "Creature / Instant / Land" is
 * immediately useful where a single "Uncategorized" heading is not.
 */

let cache: Prefs | null = null;
const listeners = new Set<() => void>();

function read(): Prefs {
  if (cache) return cache;
  let next = DEFAULTS;
  try {
    const view = window.localStorage.getItem(KEYS.view);
    const grouping = window.localStorage.getItem(KEYS.grouping);
    next = {
      view: view === "grid" || view === "table" ? view : DEFAULTS.view,
      grouping: isDeckGrouping(grouping) ? grouping : DEFAULTS.grouping,
    };
  } catch {
    // Private window, blocked site data, or a browser that throws on access.
    // The defaults are correct, so there is nothing to recover.
  }
  cache = next;
  return cache;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);

  /*
   * Another tab changing a preference. `storage` does not fire in the tab
   * that made the change, which is why the setters notify directly.
   */
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== KEYS.view && event.key !== KEYS.grouping) {
      return;
    }
    cache = null;
    onChange();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function write(patch: Partial<Prefs>) {
  cache = { ...read(), ...patch };
  try {
    if (patch.view) window.localStorage.setItem(KEYS.view, patch.view);
    if (patch.grouping) {
      window.localStorage.setItem(KEYS.grouping, patch.grouping);
    }
  } catch {
    // Not remembering the choice is survivable; failing the click is not.
  }
  for (const listener of listeners) listener();
}

export const setDeckView = (view: DeckView) => write({ view });
export const setDeckGrouping = (grouping: DeckGrouping) => write({ grouping });

/*
 * The server snapshot is a stable object — returning a fresh one each call
 * would make useSyncExternalStore loop forever during hydration. It is also
 * what the first client render produces, so the markup matches.
 */
const SERVER_SNAPSHOT: Prefs = DEFAULTS;

export function useDeckPrefs(): Prefs {
  return useSyncExternalStore(subscribe, read, () => SERVER_SNAPSHOT);
}
