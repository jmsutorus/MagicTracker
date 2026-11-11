"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  addProductAction,
  createLocationForProductAction,
  removeProductAction,
} from "@/app/products/actions";
import {
  CARD_CONDITIONS,
  type CardCondition,
} from "@/lib/collection/constants";
import {
  DEFAULT_PRECON_BOARDS,
  PRECON_BOARD_LABELS,
  type PreconBoard,
} from "@/lib/products/constants";

export type BoardSummary = {
  board: PreconBoard;
  /** Distinct cards on this board. */
  lines: number;
  /** Total copies on this board. */
  copies: number;
  /** Copies whose card did not resolve to a printing we hold. */
  unresolved: number;
};

type LocationOption = { id: string; name: string };

type Props = {
  fileName: string;
  productName: string;
  boards: BoardSummary[];
  locations: LocationOption[];
};

/**
 * "Add this product to my collection" — the two clicks Phase 4 exists for.
 *
 * The shape of it: pick where it goes, tick what goes in, press the button.
 * The defaults are chosen so the common case needs neither of the first two
 * steps — the first location in the list and the deck as sold.
 *
 * It reports what happened in terms of cards rather than rows, and offers an
 * undo. The undo matters: this is the only screen in the app that writes a
 * hundred rows to the irreplaceable table from a single click, and a misread
 * location should not mean an evening of manual deletion.
 */
export function ProductAddForm({
  fileName,
  productName,
  boards,
  locations,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [condition, setCondition] = useState<CardCondition>("NM");
  const [selected, setSelected] = useState<PreconBoard[]>(() =>
    boards
      .filter((b) => DEFAULT_PRECON_BOARDS.includes(b.board))
      .map((b) => b.board),
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    copies: number;
    skipped: number;
    skippedNames: string[];
    locationName: string;
    boards: PreconBoard[];
    condition: CardCondition;
    undone: boolean;
  } | null>(null);

  const [newLocation, setNewLocation] = useState("");
  const [creating, setCreating] = useState(false);

  const chosenCopies = boards
    .filter((b) => selected.includes(b.board))
    .reduce((n, b) => n + b.copies, 0);

  const locationName =
    locations.find((l) => l.id === locationId)?.name ?? "that location";

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

    const result = await addProductAction({
      fileName,
      locationId,
      condition,
      boards: selected,
    });

    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setDone({
      copies: result.copies,
      skipped: result.skipped,
      skippedNames: result.skippedNames,
      locationName,
      // Captured rather than read back from state at undo time, so that
      // changing the form after an add cannot make the undo remove something
      // the add never touched.
      boards: selected,
      condition,
      undone: false,
    });
    startTransition(() => router.refresh());
  }

  async function undo() {
    if (!done) return;

    setBusy(true);
    setError(null);

    const result = await removeProductAction({
      fileName,
      locationId,
      condition: done.condition,
      boards: done.boards,
    });

    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setDone({ ...done, copies: result.copies, undone: true });
    startTransition(() => router.refresh());
  }

  async function createNewLocation() {
    const name = newLocation.trim();
    if (name.length === 0) return;

    setCreating(true);
    setError(null);

    const result = await createLocationForProductAction(name, "deck");

    setCreating(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setNewLocation("");
    setLocationId(result.id);
    startTransition(() => router.refresh());
  }

  if (locations.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface-muted p-4 text-sm text-muted">
        There is nowhere to put these cards yet. Create a location first.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface-muted p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
        Add to collection
      </h2>

      <div className="mt-3 flex flex-wrap gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm">Where it goes</span>
          <select
            value={locationId}
            disabled={busy}
            onChange={(e) => setLocationId(e.target.value)}
            className="w-56 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Condition</span>
          <select
            value={condition}
            disabled={busy}
            onChange={(e) => setCondition(e.target.value as CardCondition)}
            className="w-28 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          >
            {CARD_CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Or a new deck box</span>
          <span className="flex gap-2">
            <input
              value={newLocation}
              disabled={creating || busy}
              placeholder={`${productName.slice(0, 24)}…`}
              onChange={(e) => setNewLocation(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void createNewLocation();
                }
              }}
              className="w-48 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent"
            />
            <button
              type="button"
              onClick={() => void createNewLocation()}
              disabled={newLocation.trim().length === 0 || creating || busy}
              className="cursor-pointer rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:text-foreground disabled:opacity-40"
            >
              {creating ? "…" : "Create"}
            </button>
          </span>
          <span className="text-xs text-muted">
            Created as a deck, and selected above.
          </span>
        </label>
      </div>

      <fieldset className="mt-4">
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
                  {b.copies} card{b.copies === 1 ? "" : "s"}
                  {b.unresolved > 0 ? `, ${b.unresolved} unmatched` : ""}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-bad">
          {error}
        </p>
      ) : null}

      {done ? (
        <div
          role="status"
          className="mt-3 rounded-lg border border-border bg-surface p-3 text-sm"
        >
          {done.undone ? (
            <span>
              Took {done.copies} card{done.copies === 1 ? "" : "s"} back out of{" "}
              {done.locationName}.
            </span>
          ) : (
            <>
              <span className="text-ok">
                Added {done.copies} card{done.copies === 1 ? "" : "s"} to{" "}
                {done.locationName}.
              </span>
              {done.skipped > 0 ? (
                <span className="mt-1 block text-muted">
                  {done.skipped} card{done.skipped === 1 ? "" : "s"} could not
                  be matched to a printing and{" "}
                  {done.skipped === 1 ? "was" : "were"} left out
                  {done.skippedNames.length > 0
                    ? `: ${done.skippedNames.join(", ")}`
                    : ""}
                  .
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => void undo()}
                disabled={busy}
                className="mt-2 cursor-pointer text-sm text-muted underline underline-offset-4 hover:text-foreground disabled:opacity-40"
              >
                Undo
              </button>
            </>
          )}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void add()}
          disabled={busy || selected.length === 0 || chosenCopies === 0}
          className="cursor-pointer rounded-lg bg-accent px-4 py-2 text-sm text-accent-contrast disabled:opacity-40"
        >
          {busy
            ? "Working…"
            : `Add ${chosenCopies} card${chosenCopies === 1 ? "" : "s"}`}
        </button>
        {selected.length === 0 ? (
          <span className="text-xs text-muted">Tick something to add.</span>
        ) : null}
      </div>
    </div>
  );
}
