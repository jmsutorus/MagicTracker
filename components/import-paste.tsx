"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { applyImportAction, reviewPasteAction } from "@/app/import/actions";
import type { ReviewResult } from "@/app/import/actions";
import { CARD_CONDITIONS, CARD_FINISHES } from "@/lib/collection/constants";
import {
  CUBE_SIZE_CHOICES,
  DECK_FORMATS,
  DECK_FORMAT_LABELS,
  DEFAULT_CUBE_SIZE,
  MAX_CUBE_SIZE,
  MIN_CUBE_SIZE,
  draftersFor,
  type DeckFormat,
} from "@/lib/decks/constants";
import {
  IMPORT_SECTIONS,
  IMPORT_SECTION_LABELS,
  sectionToBoard,
  type ImportSection,
  type ImportTarget,
} from "@/lib/import/constants";
import { formatCardList } from "@/lib/import/parse";
import type { CardOption, ResolvedLine } from "@/lib/import/resolve";
import { summarizeWanted } from "@/lib/import/summary";

/** The size select's escape hatch, when a cube is not a listed size. */
const CUBE_SIZE_OTHER = "other";

/**
 * The card a line will import as: the user's pick, or the server's match.
 *
 * Outside the component and a pure function of its arguments, so the memo
 * that re-totals the list can depend on `picks` alone. `undefined` means
 * untouched, and an empty string is an explicit "leave it out" — which is not
 * the same as untouched, because an unmatched line starts untouched and must
 * not be imported as anything.
 */
function pickedCard(
  line: ResolvedLine,
  picks: Record<number, string>,
): CardOption | null {
  const pick = picks[line.lineNumber];
  if (pick === undefined) return line.card;
  if (pick === "") return null;
  return (
    line.options.find((o) => o.oracleId === pick) ??
    (line.card?.oracleId === pick ? line.card : null)
  );
}

type LocationOption = { id: string; name: string };
type DeckOption = { id: string; name: string };

/**
 * Paste a list, see what it means, then decide what to do with it.
 *
 * The order is the point. PLAN.md §7 says the real use of this screen is
 * "importing a decklist you found online to check against what you own", so
 * the review comes first and writing anything is a second, separate decision
 * — the destination defaults to "just checking" and nothing is stored until
 * a button marked with the destination is pressed.
 *
 * Every line is accounted for on screen. A line that matched one card shows
 * it, a line that could be several offers the choice, and a line that matched
 * nothing offers the near misses or can be left out. Nothing is silently
 * dropped and nothing is silently guessed: an assumption the server made —
 * a set code it could not place, a printing it picked — is printed on the row
 * that it affected.
 */
export function ImportPaste({
  locations,
  decks,
  defaultLocationId,
}: {
  locations: LocationOption[];
  decks: DeckOption[];
  defaultLocationId: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [text, setText] = useState("");
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    message: string;
    deckId: string | null;
  } | null>(null);

  /**
   * The card chosen for each line, keyed by line number.
   *
   * Only holds the lines the user has *changed*: a resolved line falls back
   * to what the server matched, so the common case needs no state at all and
   * cannot be knocked out of step with the review it came from.
   */
  const [picks, setPicks] = useState<Record<number, string>>({});

  const [target, setTarget] = useState<ImportTarget>("check");
  const [locationId, setLocationId] = useState(defaultLocationId ?? "");
  const [deckId, setDeckId] = useState("");
  const [newDeckName, setNewDeckName] = useState("");
  /*
   * A new deck's format, chosen here rather than afterwards. A pasted cube
   * is the common case for a 360-line list, and creating it as a Commander
   * deck would hold it to rules it was never meant to pass — then there is
   * no way to change it, by design (see components/deck-create-form.tsx).
   */
  const [newDeckFormat, setNewDeckFormat] = useState<DeckFormat>("commander");
  const [newCubeSize, setNewCubeSize] = useState(String(DEFAULT_CUBE_SIZE));
  const [newCubeCustom, setNewCubeCustom] = useState(String(DEFAULT_CUBE_SIZE));

  const wantedCubeSize =
    newCubeSize === CUBE_SIZE_OTHER
      ? Number.parseInt(newCubeCustom, 10)
      : Number(newCubeSize);
  const cubeSizeValid =
    newDeckFormat !== "cube" ||
    (Number.isSafeInteger(wantedCubeSize) &&
      wantedCubeSize >= MIN_CUBE_SIZE &&
      wantedCubeSize <= MAX_CUBE_SIZE);
  const [defaultFinish, setDefaultFinish] = useState("nonfoil");
  const [defaultCondition, setDefaultCondition] = useState("NM");

  // Memoised so it is the same array between renders: the totals below
  // depend on it, and a fresh [] every render would recompute them forever.
  const lines = useMemo(() => (review?.ok ? review.lines : []), [review]);

  const chosenFor = (line: ResolvedLine) => pickedCard(line, picks);

  /* Recomputed as the user resolves lines, so the headline and the buy list
   * follow their decisions rather than the first pass's guesses. */
  const totals = useMemo(
    () =>
      summarizeWanted(
        lines.map((line) => {
          const card = pickedCard(line, picks);
          return {
            quantity: line.quantity,
            section: line.section,
            card: card
              ? {
                  oracleId: card.oracleId,
                  name: card.name,
                  available: card.available,
                }
              : null,
          };
        }),
      ),
    [lines, picks],
  );

  const included = lines.filter((l) => pickedCard(l, picks) !== null);
  const undecided = lines.filter(
    (l) => l.status !== "resolved" && picks[l.lineNumber] === undefined,
  );

  async function check() {
    setBusy(true);
    setError(null);
    setDone(null);
    setPicks({});

    const result = await reviewPasteAction(text);

    setBusy(false);
    if (!result.ok) {
      setReview(null);
      setError(result.error);
      return;
    }
    setReview(result);
  }

  async function apply() {
    setBusy(true);
    setError(null);

    const payload = included.map((line) => {
      const card = pickedCard(line, picks)!;
      return {
        oracleId: card.oracleId,
        /*
         * The printing goes along only when the card is still the one the
         * server matched. Once the user picks a different card, the printing
         * belongs to the old one — sending it would pin the wrong card's
         * printing, so the server chooses a fresh one instead.
         */
        printingId:
          card.oracleId === line.card?.oracleId
            ? (line.printing?.printingId ?? null)
            : null,
        quantity: line.quantity,
        finish: line.finish,
        condition: line.condition,
        board: sectionToBoard(line.section),
      };
    });

    const result = await applyImportAction(
      payload,
      target === "collection"
        ? {
            kind: "collection",
            locationId,
            defaultFinish,
            defaultCondition,
          }
        : deckId === "new"
          ? {
              kind: "new-deck",
              name: newDeckName,
              format: newDeckFormat,
              targetSize: newDeckFormat === "cube" ? wantedCubeSize : null,
            }
          : { kind: "deck", deckId },
    );

    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setDone({
      message:
        `Added ${result.copies} cop${result.copies === 1 ? "y" : "ies"} ` +
        `across ${result.cards} card${result.cards === 1 ? "" : "s"}` +
        (result.deckName ? ` to “${result.deckName}”.` : "."),
      deckId: result.deckId,
    });
    setReview(null);
    setText("");
    startTransition(() => router.refresh());
  }

  function downloadMissing() {
    const text = formatCardList(
      totals.missing.map((m) => ({ name: m.name, quantity: m.need })),
    );
    const blob = new Blob([`${text}\n`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "cards-to-buy.txt";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const canApply =
    included.length > 0 &&
    !busy &&
    (target === "collection"
      ? locationId.length > 0
      : deckId === "new"
        ? newDeckName.trim().length > 0 && cubeSizeValid
        : deckId.length > 0);

  return (
    <div className="space-y-6">
      {/* ---- the paste box -------------------------------------------- */}
      <section className="rounded-lg border border-border bg-surface-muted p-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">
            Paste a decklist or a CSV export. Set codes, foil markers,
            sideboards and section headings are all understood.
          </span>
          <textarea
            value={text}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            spellCheck={false}
            placeholder={
              "Commander\n1 Zinnia, Valley's Voice (BLB) 229\n\nDeck\n1 Sol Ring (LTC) 284\n30 Mountain"
            }
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm outline-none placeholder:text-muted focus:border-accent"
          />
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy || text.trim().length === 0}
            onClick={() => void check()}
            className="cursor-pointer rounded-lg bg-accent px-3 py-2 text-sm text-accent-contrast disabled:opacity-40"
          >
            {busy ? "Reading…" : "Check it"}
          </button>
          {review?.ok ? (
            <button
              type="button"
              onClick={() => {
                setReview(null);
                setPicks({});
              }}
              className="cursor-pointer text-sm text-muted underline underline-offset-4 hover:text-foreground"
            >
              Start again
            </button>
          ) : null}
        </div>
      </section>

      {error ? (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      ) : null}

      {done ? (
        <section className="rounded-lg border border-border bg-surface p-5">
          <p role="status" className="text-sm text-ok">
            {done.message}
          </p>
          <p className="mt-2 text-sm text-muted">
            {done.deckId ? (
              <Link
                href={`/decks/${done.deckId}`}
                className="underline underline-offset-4 hover:text-foreground"
              >
                Open the deck
              </Link>
            ) : (
              <Link
                href="/collection"
                className="underline underline-offset-4 hover:text-foreground"
              >
                Open the collection
              </Link>
            )}
          </p>
        </section>
      ) : null}

      {review?.ok ? (
        <>
          {/* ---- the verdict ------------------------------------------ */}
          <section className="rounded-lg border border-border bg-surface p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <span className="text-3xl font-semibold">
                {totals.covered}
                <span className="text-xl text-muted">
                  {" / "}
                  {totals.covered +
                    totals.missing.reduce((n, m) => n + m.need, 0)}
                </span>
              </span>
              <span className="text-sm text-muted">
                read as {review.format === "csv" ? "a CSV" : "a decklist"} —{" "}
                {review.lines.length} line
                {review.lines.length === 1 ? "" : "s"}, {totals.copies} cop
                {totals.copies === 1 ? "y" : "ies"}
              </span>
            </div>

            <p className="mt-3 text-sm text-muted">
              {totals.missing.length === 0
                ? "You own every card on this list."
                : `You already own ${totals.covered} of them. ${totals.missing.reduce((n, m) => n + m.need, 0)} to buy, across ${totals.missing.length} card${totals.missing.length === 1 ? "" : "s"}.`}
              {review.summary.ambiguous + review.summary.unmatched > 0 ? (
                <>
                  {" "}
                  <span className="text-foreground">
                    {review.summary.unmatched > 0
                      ? `${review.summary.unmatched} name${review.summary.unmatched === 1 ? "" : "s"} matched no card`
                      : ""}
                    {review.summary.unmatched > 0 &&
                    review.summary.ambiguous > 0
                      ? " and "
                      : ""}
                    {review.summary.ambiguous > 0
                      ? `${review.summary.ambiguous} could be more than one card`
                      : ""}
                    .
                  </span>
                </>
              ) : null}
            </p>

            {totals.missing.length > 0 ? (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={downloadMissing}
                  className="cursor-pointer text-sm text-muted underline underline-offset-4 hover:text-foreground"
                >
                  Download what you&rsquo;re missing
                </button>
                <p className="mt-2 text-sm text-muted">
                  {totals.missing
                    .slice(0, 20)
                    .map((m) => (m.need > 1 ? `${m.need}× ${m.name}` : m.name))
                    .join(", ")}
                  {totals.missing.length > 20
                    ? `, and ${totals.missing.length - 20} more`
                    : ""}
                  .
                </p>
              </div>
            ) : null}

            {review.suggestionsTruncated ? (
              <p className="mt-3 text-xs text-muted">
                Too many names matched nothing to look them all up. Fix the
                first few and check again.
              </p>
            ) : null}
          </section>

          {/* ---- lines that could not be parsed at all ---------------- */}
          {review.problems.length > 0 ? (
            <section className="rounded-lg border border-border bg-surface p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
                Lines that are not cards ({review.problems.length})
              </h2>
              <ul className="mt-3 space-y-1 text-sm">
                {review.problems.map((p) => (
                  <li key={p.lineNumber} className="text-muted">
                    <span className="font-mono text-xs">
                      line {p.lineNumber}
                    </span>{" "}
                    <span className="font-mono text-foreground">{p.raw}</span> —{" "}
                    {p.message}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* ---- the review table ------------------------------------- */}
          {IMPORT_SECTIONS.map((section) => {
            const rows = review.lines.filter((l) => l.section === section);
            if (rows.length === 0) return null;
            return (
              <ReviewSection
                key={section}
                section={section}
                rows={rows}
                picks={picks}
                onPick={(lineNumber, oracleId) =>
                  setPicks((p) => ({ ...p, [lineNumber]: oracleId }))
                }
                chosenFor={chosenFor}
              />
            );
          })}

          {/* ---- destination ------------------------------------------ */}
          <section className="rounded-lg border border-border bg-surface-muted p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              Then what?
            </h2>

            <div className="mt-3 flex flex-col gap-2">
              <Choice
                checked={target === "check"}
                onChange={() => setTarget("check")}
                label="Nothing — I was only checking"
                hint="Nothing is stored. The numbers above are the answer."
              />
              <Choice
                checked={target === "collection"}
                onChange={() => setTarget("collection")}
                label="Add to my collection"
                hint="Every line, the maybeboard included: a card is a card you own whichever board a list filed it under."
              />
              <Choice
                checked={target === "deck"}
                onChange={() => setTarget("deck")}
                label="Put it in a deck"
                hint="Nothing moves in your collection. A sideboard lands on the maybeboard, which counts toward nothing."
              />
            </div>

            {target === "collection" ? (
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted">Into</span>
                  <select
                    value={locationId}
                    onChange={(e) => setLocationId(e.target.value)}
                    className="w-56 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
                  >
                    <option value="">Choose a location…</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted">
                    Finish, where the list did not say
                  </span>
                  <select
                    value={defaultFinish}
                    onChange={(e) => setDefaultFinish(e.target.value)}
                    className="w-36 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
                  >
                    {CARD_FINISHES.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted">
                    Condition, where it did not say
                  </span>
                  <select
                    value={defaultCondition}
                    onChange={(e) => setDefaultCondition(e.target.value)}
                    className="w-28 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
                  >
                    {CARD_CONDITIONS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}

            {target === "deck" ? (
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted">Deck</span>
                  <select
                    value={deckId}
                    onChange={(e) => setDeckId(e.target.value)}
                    className="w-56 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
                  >
                    <option value="">Choose a deck…</option>
                    <option value="new">A new deck…</option>
                    {decks.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>

                {deckId === "new" ? (
                  <>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-muted">Called</span>
                      <input
                        value={newDeckName}
                        onChange={(e) => setNewDeckName(e.target.value)}
                        placeholder={
                          newDeckFormat === "cube"
                            ? "Vintage cube…"
                            : "Zinnia, Valley's Voice…"
                        }
                        className="w-64 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent"
                      />
                    </label>

                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-muted">As a</span>
                      <select
                        value={newDeckFormat}
                        onChange={(e) =>
                          setNewDeckFormat(e.target.value as DeckFormat)
                        }
                        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
                      >
                        {DECK_FORMATS.map((option) => (
                          <option key={option} value={option}>
                            {DECK_FORMAT_LABELS[option]}
                          </option>
                        ))}
                      </select>
                    </label>

                    {newDeckFormat === "cube" ? (
                      <>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs text-muted">Size</span>
                          <select
                            value={newCubeSize}
                            onChange={(e) => setNewCubeSize(e.target.value)}
                            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
                          >
                            {CUBE_SIZE_CHOICES.map((size) => {
                              const drafters = draftersFor(size);
                              return (
                                <option key={size} value={String(size)}>
                                  {drafters === null
                                    ? `${size}`
                                    : `${size} — ${drafters} drafters`}
                                </option>
                              );
                            })}
                            <option value={CUBE_SIZE_OTHER}>
                              Another size…
                            </option>
                          </select>
                        </label>

                        {newCubeSize === CUBE_SIZE_OTHER ? (
                          <label className="flex flex-col gap-1">
                            <span className="text-xs text-muted">Cards</span>
                            <input
                              type="number"
                              inputMode="numeric"
                              min={MIN_CUBE_SIZE}
                              max={MAX_CUBE_SIZE}
                              value={newCubeCustom}
                              onChange={(e) => setNewCubeCustom(e.target.value)}
                              className="w-24 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
                            />
                          </label>
                        ) : null}
                      </>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}

            {target !== "check" ? (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={!canApply}
                  onClick={() => void apply()}
                  className="cursor-pointer rounded-lg bg-accent px-3 py-2 text-sm text-accent-contrast disabled:opacity-40"
                >
                  {busy
                    ? "Importing…"
                    : target === "collection"
                      ? `Add ${included.length} line${included.length === 1 ? "" : "s"} to the collection`
                      : `Add ${included.length} line${included.length === 1 ? "" : "s"} to the deck`}
                </button>

                {undecided.length > 0 ? (
                  <span className="text-xs text-muted">
                    {undecided.length} line
                    {undecided.length === 1 ? "" : "s"} still undecided — they
                    will be left out unless you pick a card for them.
                  </span>
                ) : null}
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}

function Choice({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex cursor-pointer items-baseline gap-2">
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        className="mt-1 cursor-pointer accent-[var(--accent)]"
      />
      <span>
        <span className="text-sm">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </label>
  );
}

function ReviewSection({
  section,
  rows,
  picks,
  onPick,
  chosenFor,
}: {
  section: ImportSection;
  rows: ResolvedLine[];
  picks: Record<number, string>;
  onPick: (lineNumber: number, oracleId: string) => void;
  chosenFor: (line: ResolvedLine) => CardOption | null;
}) {
  const copies = rows.reduce((n, r) => n + r.quantity, 0);

  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
        {IMPORT_SECTION_LABELS[section]} ({copies})
        {sectionToBoard(section) === "maybe" ? (
          <span className="ml-2 font-normal normal-case">
            — counts toward nothing
          </span>
        ) : null}
      </h2>

      <div className="mt-3 overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-2 font-medium">Line</th>
              <th className="px-4 py-2 font-medium">Card</th>
              <th className="hidden px-4 py-2 font-medium sm:table-cell">
                Printing
              </th>
              <th className="px-4 py-2 font-medium">Free</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((line) => {
              const chosen = chosenFor(line);
              const pick = picks[line.lineNumber];
              const short = chosen !== null && chosen.available < line.quantity;

              return (
                <tr
                  key={line.lineNumber}
                  className="border-b border-border last:border-0 align-top"
                >
                  <td className="px-4 py-2 font-mono text-xs text-muted">
                    {line.quantity}×
                    <span className="ml-2 hidden sm:inline">{line.raw}</span>
                  </td>

                  <td className="px-4 py-2">
                    {line.status === "resolved" && pick === undefined ? (
                      <Link
                        href={`/cards/${line.card?.oracleId}`}
                        className="hover:underline"
                      >
                        {line.card?.name}
                      </Link>
                    ) : (
                      <>
                        {/*
                         * An ambiguous or unmatched line is a question, so it
                         * is shown as one: what the paste asked for, and a
                         * list of what it could have meant. "Leave it out" is
                         * always available, because a list that mentions a
                         * card this database has never heard of is a real
                         * thing and should not block the other 99 cards.
                         */}
                        <span className="block font-mono text-xs text-bad">
                          {line.status === "unmatched"
                            ? `no card called “${line.wanted}”`
                            : `“${line.wanted}” could be several cards`}
                        </span>
                        <select
                          value={pick ?? ""}
                          onChange={(e) =>
                            onPick(line.lineNumber, e.target.value)
                          }
                          className="mt-1 w-full max-w-xs rounded-lg border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-accent"
                        >
                          <option value="">Leave it out</option>
                          {line.options.map((o) => (
                            <option key={o.oracleId} value={o.oracleId}>
                              {o.name}
                              {o.typeLine ? ` — ${o.typeLine}` : ""}
                              {o.owned > 0 ? ` (own ${o.owned})` : ""}
                            </option>
                          ))}
                        </select>
                        {line.options.length === 0 ? (
                          <span className="mt-1 block text-xs text-muted">
                            Nothing close enough to suggest. Check the spelling,
                            or run the card ingest if it is a brand-new card.
                          </span>
                        ) : null}
                      </>
                    )}

                    {line.notes.length > 0 ? (
                      <ul className="mt-1 space-y-0.5">
                        {line.notes.map((note) => (
                          <li key={note} className="text-xs text-muted">
                            {noteText(note)}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </td>

                  <td className="hidden px-4 py-2 font-mono text-xs text-muted sm:table-cell">
                    {line.printing && pick === undefined
                      ? `${line.printing.setCode.toUpperCase()} #${line.printing.collectorNumber}`
                      : ""}
                  </td>

                  <td
                    className={`px-4 py-2 text-xs ${short ? "text-bad" : "text-muted"}`}
                  >
                    {chosen === null ? "—" : chosen.available}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Wording for a resolution note.
 *
 * Kept here rather than imported from lib/import/resolve.ts: that module
 * reaches the database, and importing it into a client component would pull
 * drizzle into the browser bundle. Same reason the constants live apart.
 */
function noteText(note: string): string {
  switch (note) {
    case "set-ignored":
      return "No set by that name — matched on the card name alone.";
    case "collector-ignored":
      return "That collector number is not in that set — matched on the name.";
    case "printing-guessed":
      return "Printing chosen for you: the newest regular one.";
    case "matched-by-face":
      return "Matched the front face of a double-faced card.";
    case "finish-unavailable":
      return "That printing was not made in that finish — the nearest was used.";
    default:
      return note;
  }
}
