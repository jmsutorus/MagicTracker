"use client";

import { useEffect, useId, useState } from "react";

import { setDeckCardCategoryAction } from "@/app/decks/actions";
import { MAX_CATEGORY_LENGTH } from "@/lib/decks/constants";

/**
 * The category box on one card.
 *
 * A free-text input with a datalist rather than a `<select>`, because the
 * set of categories is not fixed: a `<select>` would need a separate "new
 * category…" flow and a modal to type into, where an input with suggestions
 * lets you pick an existing heading or invent one with the same gesture.
 *
 * Committed on blur and on Enter, never on every keystroke — a category is
 * typed a letter at a time and firing a write per letter would be a dozen
 * round trips and a dozen revalidations for one word.
 */
export function DeckCategoryInput({
  deckCardId,
  deckId,
  category,
  /** Existing categories in this deck, plus the suggested starting set. */
  options,
  onSaved,
}: {
  deckCardId: string;
  deckId: string;
  category: string | null;
  options: readonly string[];
  onSaved: () => void;
}) {
  const listId = useId();
  const [value, setValue] = useState(category ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Follow the server when it disagrees — a drag onto another group changes
   * the same field from outside this component. Adjusted during render
   * rather than in an effect, which would flash the stale value first.
   */
  const [lastCategory, setLastCategory] = useState(category);
  if (category !== lastCategory) {
    setLastCategory(category);
    setValue(category ?? "");
  }

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(timer);
  }, [error]);

  async function commit() {
    const next = value.trim();
    // Nothing typed, or nothing changed: no write, no revalidation.
    if (next === (category ?? "")) return;

    setSaving(true);
    const result = await setDeckCardCategoryAction(
      deckCardId,
      next.length === 0 ? null : next,
      deckId,
    );
    setSaving(false);

    if (!result.ok) {
      setError(result.error);
      setValue(category ?? "");
      return;
    }
    onSaved();
  }

  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <input
        value={value}
        list={listId}
        maxLength={MAX_CATEGORY_LENGTH}
        placeholder="Uncategorized"
        aria-label="Category"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            setValue(category ?? "");
            e.currentTarget.blur();
          }
        }}
        className={`w-full min-w-0 rounded border border-border bg-surface px-1.5 py-0.5 text-xs
                    outline-none placeholder:text-muted focus:border-accent ${
                      saving ? "opacity-60" : ""
                    }`}
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      {error ? (
        <span role="alert" className="shrink-0 text-xs text-bad">
          {error}
        </span>
      ) : null}
    </span>
  );
}
