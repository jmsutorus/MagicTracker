"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";

import {
  renameDeckCategoryAction,
  setDeckCardCategoryAction,
} from "@/app/decks/actions";
import { CardLink } from "@/components/card-link";
import { DeckCardControls } from "@/components/deck-card-controls";
import { DeckCategoryInput } from "@/components/deck-category-input";
import {
  setDeckGrouping,
  setDeckView,
  useDeckPrefs,
} from "@/components/deck-view-store";
import { ManaCost } from "@/components/mana-cost";
import {
  DECK_BOARDS,
  DECK_GROUPINGS,
  DECK_GROUPING_LABELS,
  SUGGESTED_CATEGORIES,
  UNCATEGORISED,
  boardLabel,
  isDeckGrouping,
  type DeckFormat,
} from "@/lib/decks/constants";
import { groupDeckCards, type CardGroup } from "@/lib/decks/grouping";
import type { DeckCardRow } from "@/lib/decks/queries";
import { cardImageUrl } from "@/lib/scryfall/client";

/**
 * The deck list: every board, grouped, as pictures or as rows.
 *
 * One component for the whole list rather than one per board, because the
 * two controls at the top — how to show it, and how to group it — are one
 * decision about the page. Three independent toolbars let the command zone
 * disagree with the deck about whether it was showing pictures.
 *
 * Grouping is the feature this page was most obviously missing. A hundred
 * cards in one alphabetical run answers no question anybody asks of a
 * decklist; "eleven ramp, nine removal, thirty-eight lands" answers most of
 * them. Category is stored per card; type, mana value and colour are derived
 * at render time, so a freshly pasted deck groups usefully before anyone has
 * typed anything.
 */
export function DeckEditor({
  deckId,
  format,
  cards,
}: {
  deckId: string;
  format: DeckFormat;
  cards: DeckCardRow[];
}) {
  const { view, grouping } = useDeckPrefs();
  const router = useRouter();
  const [, startTransition] = useTransition();

  /** The row being dragged, so a group can show it is a target. */
  const [dragging, setDragging] = useState<string | null>(null);

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);

  /*
   * Every category already used in this deck, plus the suggestions. Offered
   * in each card's box so the second card you file is a pick rather than a
   * retype — and so a deck does not end up with "Removal" and "removal".
   */
  const categoryOptions = useMemo(() => {
    const used = new Set<string>();
    for (const card of cards) if (card.category) used.add(card.category);
    for (const s of SUGGESTED_CATEGORIES) used.add(s);
    return [...used].sort((a, b) => a.localeCompare(b));
  }, [cards]);

  /** Drops are only meaningful where the group *is* the stored field. */
  const canDrop = grouping === "category";

  const move = useCallback(
    async (deckCardId: string, category: string | null) => {
      const result = await setDeckCardCategoryAction(
        deckCardId,
        category,
        deckId,
      );
      if (result.ok) refresh();
    },
    [deckId, refresh],
  );

  const boards = DECK_BOARDS.filter((b) =>
    cards.some((c) => c.board === b),
  );

  return (
    <section className="mt-8">
      {/* ---- the two controls, once, above everything they scope -------- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          The list
        </h2>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-muted">
            Group by
            <select
              value={grouping}
              onChange={(e) => {
                const next = e.target.value;
                if (isDeckGrouping(next)) setDeckGrouping(next);
              }}
              className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-foreground outline-none focus:border-accent"
            >
              {DECK_GROUPINGS.map((g) => (
                <option key={g} value={g}>
                  {DECK_GROUPING_LABELS[g]}
                </option>
              ))}
            </select>
          </label>

          <div
            role="group"
            aria-label="How to show the list"
            className="flex overflow-hidden rounded-lg border border-border text-xs"
          >
            {(["grid", "table"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setDeckView(option)}
                aria-pressed={view === option}
                className={`cursor-pointer px-2.5 py-1.5 ${
                  view === option
                    ? "bg-surface-muted text-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {option === "grid" ? "Cards" : "List"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {canDrop ? (
        <p className="mt-2 text-xs text-muted">
          Drag a card onto a heading to file it there, or type in its category
          box.
        </p>
      ) : null}

      {boards.map((board) => {
        const boardCards = cards.filter((c) => c.board === board);
        const copies = boardCards.reduce((n, c) => n + c.quantity, 0);
        /*
         * The command zone is never grouped. It holds one or two cards by
         * rule, and a "Creature" heading over a single commander is a
         * heading that explains nothing.
         */
        const groups =
          board === "commander"
            ? [{ key: "all", label: "", cards: boardCards, copies }]
            : groupDeckCards(boardCards, grouping);

        return (
          <div key={board} className="mt-7">
            <h3 className="border-b border-border pb-1.5 text-sm font-semibold">
              {boardLabel(format, board)}{" "}
              <span className="font-normal text-muted">({copies})</span>
              {board === "maybe" ? (
                <span className="ml-2 text-xs font-normal text-muted">
                  — counts toward nothing
                </span>
              ) : null}
            </h3>

            {groups.map((group, index) => (
              <Group
                key={`${board}-${group.key}`}
                group={group}
                deckId={deckId}
                format={format}
                view={view}
                showHeading={groups.length > 1 || group.label !== ""}
                /*
                 * Column headings once per board, not once per group: eight
                 * identical CARD / COST / HAVE / IN DECK rows down a grouped
                 * list is noise, and the columns line up without them
                 * because the table is fixed-layout.
                 */
                showHead={index === 0}
                categoryOptions={categoryOptions}
                showCategoryInput={grouping === "category" && board !== "commander"}
                dropTarget={canDrop && board !== "commander"}
                dragging={dragging}
                onDragStart={setDragging}
                onDragEnd={() => setDragging(null)}
                onDrop={(deckCardId) => {
                  setDragging(null);
                  void move(
                    deckCardId,
                    group.key === UNCATEGORISED ? null : group.key,
                  );
                }}
                onRename={
                  canDrop && group.key !== UNCATEGORISED
                    ? async (to) => {
                        const result = await renameDeckCategoryAction(
                          deckId,
                          group.key,
                          to,
                        );
                        if (result.ok) refresh();
                      }
                    : undefined
                }
                onSaved={refresh}
              />
            ))}
          </div>
        );
      })}
    </section>
  );
}

function Group({
  group,
  deckId,
  format,
  view,
  showHeading,
  showHead,
  categoryOptions,
  showCategoryInput,
  dropTarget,
  dragging,
  onDragStart,
  onDragEnd,
  onDrop,
  onRename,
  onSaved,
}: {
  group: CardGroup<DeckCardRow>;
  deckId: string;
  format: DeckFormat;
  view: "grid" | "table";
  showHeading: boolean;
  /** Whether this group prints the column headings (the first one does). */
  showHead: boolean;
  categoryOptions: readonly string[];
  showCategoryInput: boolean;
  dropTarget: boolean;
  dragging: string | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDrop: (deckCardId: string) => void;
  onRename?: (to: string) => Promise<void>;
  onSaved: () => void;
}) {
  const [over, setOver] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(group.label);

  const dropProps = dropTarget
    ? {
        onDragOver: (e: React.DragEvent) => {
          // Without preventDefault the browser refuses the drop outright.
          e.preventDefault();
          e.dataTransfer.dropEffect = "move" as const;
          if (!over) setOver(true);
        },
        onDragLeave: () => setOver(false),
        onDrop: (e: React.DragEvent) => {
          e.preventDefault();
          setOver(false);
          const id = e.dataTransfer.getData("text/deck-card");
          if (id) onDrop(id);
        },
      }
    : {};

  return (
    <section
      {...dropProps}
      className={`mt-4 rounded-lg transition-colors ${
        over
          ? "bg-surface-muted outline-2 outline-dashed outline-accent"
          : dragging && dropTarget
            ? "outline-2 outline-dashed outline-border"
            : ""
      }`}
    >
      {showHeading ? (
        <div className="flex flex-wrap items-baseline gap-2 px-1 pt-1">
          {renaming && onRename ? (
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                setRenaming(false);
                if (draft.trim() && draft.trim() !== group.label) {
                  void onRename(draft.trim());
                }
              }}
            >
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => setRenaming(false)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setDraft(group.label);
                    setRenaming(false);
                  }
                }}
                aria-label={`Rename ${group.label}`}
                className="rounded border border-border bg-surface px-1.5 py-0.5 text-xs outline-none focus:border-accent"
              />
            </form>
          ) : (
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">
              {group.label}{" "}
              <span className="font-normal tabular-nums">({group.copies})</span>
            </h4>
          )}

          {onRename && !renaming ? (
            <button
              type="button"
              onClick={() => {
                setDraft(group.label);
                setRenaming(true);
              }}
              className="cursor-pointer text-[10px] text-muted underline underline-offset-4 hover:text-foreground"
            >
              rename
            </button>
          ) : null}
        </div>
      ) : null}

      {view === "grid" ? (
        <CardGrid
          cards={group.cards}
          deckId={deckId}
          format={format}
          showLegality={format === "commander"}
          showCategoryInput={showCategoryInput}
          categoryOptions={categoryOptions}
          draggable={dropTarget}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onSaved={onSaved}
        />
      ) : (
        <CardTable
          cards={group.cards}
          deckId={deckId}
          format={format}
          showHead={showHead}
          showLegality={format === "commander"}
          showCategoryInput={showCategoryInput}
          categoryOptions={categoryOptions}
          draggable={dropTarget}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onSaved={onSaved}
        />
      )}
    </section>
  );
}

type ListProps = {
  cards: DeckCardRow[];
  deckId: string;
  format: DeckFormat;
  showLegality: boolean;
  showCategoryInput: boolean;
  categoryOptions: readonly string[];
  draggable: boolean;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onSaved: () => void;
};

/** Shared by both views: start a drag carrying this row's id. */
function dragHandlers(
  card: DeckCardRow,
  draggable: boolean,
  onDragStart: (id: string) => void,
  onDragEnd: () => void,
) {
  if (!draggable) return {};
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      /*
       * A private type, not "text/plain": dropping a card onto a text field
       * elsewhere on the page should not paste a UUID into it.
       */
      e.dataTransfer.setData("text/deck-card", card.id);
      e.dataTransfer.effectAllowed = "move";
      onDragStart(card.id);
    },
    onDragEnd,
  };
}

function CardGrid({
  cards,
  deckId,
  format,
  showLegality,
  showCategoryInput,
  categoryOptions,
  draggable,
  onDragStart,
  onDragEnd,
  onSaved,
}: ListProps) {
  return (
    <ul className="mt-2 grid grid-cols-2 gap-3 p-1 sm:grid-cols-3 lg:grid-cols-4">
      {cards.map((card) => {
        const short = card.board !== "maybe" && card.available < card.quantity;
        return (
          <li
            key={card.id}
            {...dragHandlers(card, draggable, onDragStart, onDragEnd)}
            className={`flex flex-col ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
          >
            <div className="relative">
              {card.imageId ? (
                /*
                 * Hotlinked from Scryfall's CDN, which their terms require,
                 * so there is nothing for the Next loader to optimise. The
                 * ratio is fixed and the dimensions are given, so a grid of
                 * forty of these does not reflow as they arrive.
                 */
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={cardImageUrl(card.imageId, "normal")}
                  alt={card.name}
                  width={488}
                  height={680}
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  className="aspect-[488/680] w-full rounded-xl border border-border bg-surface-muted object-cover"
                />
              ) : (
                /* No printing on record — show the name rather than a gap. */
                <div className="flex aspect-[488/680] w-full items-center justify-center rounded-xl border border-border bg-surface-muted px-3 text-center text-xs text-muted">
                  {card.name}
                </div>
              )}

              {/* The count, where a player expects to read it off a stack. */}
              {card.quantity > 1 ? (
                <span className="absolute left-2 top-2 rounded-md bg-foreground/85 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-background">
                  {card.quantity}×
                </span>
              ) : null}

              {short ? (
                <span className="absolute right-2 top-2 rounded-md bg-bad px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
                  {card.available === 0
                    ? "not owned"
                    : `${card.available} of ${card.quantity}`}
                </span>
              ) : null}

              {showLegality && card.commanderLegality !== "legal" ? (
                <span className="absolute bottom-2 left-2 rounded-md bg-bad px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
                  {card.commanderLegality === "banned" ? "banned" : "not legal"}
                </span>
              ) : null}
            </div>

            <div className="mt-1.5 flex items-baseline gap-2">
              <CardLink
                oracleId={card.oracleId}
                imageId={card.imageId}
                name={card.name}
                className="min-w-0 flex-1 truncate text-xs"
              />
              <ManaCost cost={card.manaCost} size={12} />
            </div>

            <div className="mt-1">
              <DeckCardControls
                deckCardId={card.id}
                deckId={deckId}
                format={format}
                board={card.board}
                quantity={card.quantity}
              />
            </div>

            {showCategoryInput ? (
              <div className="mt-1">
                <DeckCategoryInput
                  deckCardId={card.id}
                  deckId={deckId}
                  category={card.category}
                  options={categoryOptions}
                  onSaved={onSaved}
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function CardTable({
  cards,
  deckId,
  format,
  showHead,
  showLegality,
  showCategoryInput,
  categoryOptions,
  draggable,
  onDragStart,
  onDragEnd,
  onSaved,
}: ListProps & { showHead: boolean }) {
  /*
   * `table-fixed` with a width on every column but the name.
   *
   * Each group is its own table, and with automatic layout each one sized
   * its columns to its own contents — so the Cost column sat in a different
   * place under Creature than under Instant, and the eye had to re-find it
   * at every heading. Fixed layout makes the whole list one set of columns.
   */
  const head = (
    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
      <th className="px-4 py-2 font-medium">Card</th>
      <th className="hidden px-4 py-2 font-medium sm:table-cell sm:w-36">
        Cost
      </th>
      {showCategoryInput ? (
        <th className="hidden px-4 py-2 font-medium md:table-cell md:w-40">
          Category
        </th>
      ) : null}
      <th className="w-16 px-4 py-2 font-medium">Have</th>
      {/* 272px is what the stepper, the board select and Remove measure
          on one line; anything less wraps them onto three. */}
      <th className="w-72 px-4 py-2 font-medium">In deck</th>
    </tr>
  );

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-border bg-surface">
      <table className="w-full table-fixed text-sm">
        <thead>
          {/*
            The headings print once per board. Later groups still need the
            same row to exist so fixed layout has widths to read, so it is
            rendered into a zero-height, screen-reader-hidden head.
          */}
          {showHead ? (
            head
          ) : (
            <tr aria-hidden className="invisible h-0 text-xs">
              <th className="h-0 overflow-hidden p-0" />
              <th className="hidden h-0 overflow-hidden p-0 sm:table-cell sm:w-36" />
              {showCategoryInput ? (
                <th className="hidden h-0 overflow-hidden p-0 md:table-cell md:w-40" />
              ) : null}
              <th className="h-0 w-16 overflow-hidden p-0" />
              <th className="h-0 w-72 overflow-hidden p-0" />
            </tr>
          )}
        </thead>
        <tbody>
          {cards.map((card) => {
            const short =
              card.board !== "maybe" && card.available < card.quantity;
            return (
              <tr
                key={card.id}
                {...dragHandlers(card, draggable, onDragStart, onDragEnd)}
                className={`border-b border-border last:border-0 ${
                  draggable ? "cursor-grab active:cursor-grabbing" : ""
                }`}
              >
                <td className="px-4 py-2">
                  <CardLink
                    oracleId={card.oracleId}
                    imageId={card.imageId}
                    name={card.name}
                  />
                  {card.isAllocated ? (
                    <span className="ml-2 text-xs text-muted">claimed</span>
                  ) : null}
                  {/* A cube has no ban list, so the badge would be a
                      verdict nobody asked for. */}
                  {showLegality && card.commanderLegality !== "legal" ? (
                    <span className="ml-2 text-xs text-bad">
                      {card.commanderLegality === "banned"
                        ? "banned"
                        : "not legal"}
                    </span>
                  ) : null}
                </td>
                <td className="hidden px-4 py-2 sm:table-cell">
                  <ManaCost cost={card.manaCost} />
                </td>
                {showCategoryInput ? (
                  <td className="hidden px-4 py-2 md:table-cell">
                    <DeckCategoryInput
                      deckCardId={card.id}
                      deckId={deckId}
                      category={card.category}
                      options={categoryOptions}
                      onSaved={onSaved}
                    />
                  </td>
                ) : null}
                <td
                  className={`px-4 py-2 text-xs ${short ? "text-bad" : "text-muted"}`}
                >
                  {/*
                   * "Available", not "owned": a copy another built deck has
                   * claimed is not one you can put in this deck, and showing
                   * it as available is how you plan two decks that cannot
                   * both exist.
                   */}
                  {card.available}
                  {card.owned !== card.available ? ` of ${card.owned}` : ""}
                </td>
                <td className="px-4 py-2">
                  <DeckCardControls
                    deckCardId={card.id}
                    deckId={deckId}
                    format={format}
                    board={card.board}
                    quantity={card.quantity}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
