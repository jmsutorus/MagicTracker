"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { resetScopeAction, saveScopeAction } from "@/app/sets/actions";
import {
  COMPLETION_FINISHES,
  type CompletionFinish,
  type CompletionScope,
} from "@/lib/collection/constants";
import { isDefaultScope } from "@/lib/completion/scope";

type Props = {
  setCode: string;
  scope: CompletionScope;
  /** Whether each flag has anything to exclude in this set. */
  applicable: {
    boosterOnly: boolean;
    includePromos: boolean;
    includeExtras: boolean;
  };
};

/**
 * The per-set definition of "complete".
 *
 * A flag with nothing to exclude in this set is shown disabled and labelled
 * as such rather than hidden: "booster-obtainable only" reading as available
 * but inert on a Commander deck is confusing, and hiding it entirely would
 * make the set look like it had fewer options than it does.
 */
export function CompletionScopeForm({ setCode, scope, applicable }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [draft, setDraft] = useState<CompletionScope>(scope);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const dirty =
    draft.boosterOnly !== scope.boosterOnly ||
    draft.includePromos !== scope.includePromos ||
    draft.includeExtras !== scope.includeExtras ||
    draft.finish !== scope.finish;

  async function save() {
    setSaving(true);
    setError(null);
    const result = await saveScopeAction(setCode, draft);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    startTransition(() => router.refresh());
  }

  async function reset() {
    setSaving(true);
    setError(null);
    const result = await resetScopeAction(setCode);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="rounded-lg border border-border bg-surface-muted p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
        What counts as complete
      </h2>

      <div className="mt-3 space-y-2">
        <Toggle
          label="Booster-obtainable cards only"
          hint={
            applicable.boosterOnly
              ? "The set as printed in packs, excluding Collector Booster treatments."
              : "No card in this set comes from a booster, so this is ignored here."
          }
          checked={draft.boosterOnly}
          disabled={!applicable.boosterOnly || saving}
          onChange={(v) => setDraft((d) => ({ ...d, boosterOnly: v }))}
        />
        <Toggle
          label="Include promos"
          hint={
            applicable.includePromos
              ? "Promo-stamped printings filed under this set code."
              : "Every card in this set is a promo, so this is ignored here."
          }
          checked={draft.includePromos}
          disabled={!applicable.includePromos || saving}
          onChange={(v) => setDraft((d) => ({ ...d, includePromos: v }))}
        />
        <Toggle
          label="Include art series and tokens"
          hint={
            applicable.includeExtras
              ? "Cards that are real cardboard but not playable cards."
              : "This set is entirely extras, so this is ignored here."
          }
          checked={draft.includeExtras}
          disabled={!applicable.includeExtras || saving}
          onChange={(v) => setDraft((d) => ({ ...d, includeExtras: v }))}
        />

        <label className="flex flex-col gap-1 pt-2">
          <span className="text-sm">Finish required</span>
          <select
            value={draft.finish}
            disabled={saving}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                finish: e.target.value as CompletionFinish,
              }))
            }
            className="w-48 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          >
            {COMPLETION_FINISHES.map((f) => (
              <option key={f} value={f}>
                {f === "any" ? "any finish" : f}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted">
            Literal: an etched foil does not satisfy a foil target.
          </span>
        </label>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-bad">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving}
          className="cursor-pointer rounded-lg bg-accent px-3 py-2 text-sm text-accent-contrast disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {dirty ? (
          <button
            type="button"
            onClick={() => setDraft(scope)}
            className="cursor-pointer text-sm text-muted underline underline-offset-4 hover:text-foreground"
          >
            Discard changes
          </button>
        ) : null}
        {!isDefaultScope(scope) ? (
          <button
            type="button"
            onClick={() => void reset()}
            disabled={saving}
            className="cursor-pointer text-sm text-muted underline underline-offset-4 hover:text-foreground"
          >
            Back to default
          </button>
        ) : (
          <span className="text-xs text-muted">Using the default.</span>
        )}
      </div>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label
      className={`flex gap-3 ${disabled ? "opacity-50" : "cursor-pointer"}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
      />
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </label>
  );
}
