import Link from "next/link";
import { notFound } from "next/navigation";

import { AppFooter } from "@/components/app-footer";
import { AppHeader } from "@/components/app-header";
import { CardArt } from "@/components/card-art";
import { CardLink } from "@/components/card-link";
import { CompletionScopeForm } from "@/components/completion-scope-form";
import { ManaCost } from "@/components/mana-cost";
import { ProgressBar } from "@/components/progress-bar";
import { PurchaseButtons } from "@/components/purchase-buttons";
import { requireUser } from "@/lib/auth/dal";
import {
  getSetCompletion,
  listSetPrintings,
  type CompletionBucket,
  type SetPrinting,
} from "@/lib/completion/queries";
import { describeScope } from "@/lib/completion/scope";
import { formatCents } from "@/lib/prices/constants";

export const metadata = { title: "Set completion · MagicTracker" };

/**
 * Which slice of the checklist the table shows.
 *
 * `all` is the default and the point of the table — the gaps only mean
 * something next to what fills them. The other two exist because 281 rows is
 * a lot to scroll when the question is narrower than that: `missing` is the
 * buy list, `owned` is what to put in the binder.
 */
const SHOWS = {
  all: "All",
  owned: "Owned",
  missing: "Missing",
} as const;

type Show = keyof typeof SHOWS;

function isShow(value: string | undefined): value is Show {
  return value !== undefined && value in SHOWS;
}

function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function SetCompletionPage({
  params,
  searchParams,
}: {
  // Next 16: params and searchParams are both Promises.
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();

  const [{ code }, query] = await Promise.all([params, searchParams]);

  // Checked before it reaches a query, and it also keeps a junk URL from
  // looking like a database problem.
  if (!/^[a-z0-9]{1,16}$/i.test(code)) notFound();

  const showParam = one(query.show);
  const show: Show = isShow(showParam) ? showParam : "all";

  const completion = await getSetCompletion(code);
  if (!completion) notFound();

  /*
   * The whole checklist in one query, then split here. Two queries for the
   * two halves would be two chances for them to disagree about the scope,
   * and the halves have to interleave in collector-number order anyway.
   */
  const printings = await listSetPrintings(code);
  const missing = printings.filter((card) => card.ownedCopies === 0);
  const held = printings.length - missing.length;

  const rows =
    show === "owned"
      ? printings.filter((card) => card.ownedCopies > 0)
      : show === "missing"
        ? missing
        : printings;

  const counts: Record<Show, number> = {
    all: printings.length,
    owned: held,
    missing: missing.length,
  };

  const scopeSentence = describeScope(completion.scope, completion.applicable);
  const done = completion.target > 0 && completion.owned >= completion.target;

  /*
   * Summed here rather than in SQL: the rows are already loaded for the table
   * below, and a second query to re-add numbers we are holding would be two
   * sources for one figure.
   */
  const priced = missing.filter((card) => card.priceCents !== null);
  const pricedMissing = priced.length;
  const missingCents = priced.reduce(
    (n, card) => n + (card.priceCents ?? 0),
    0,
  );

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader current="sets" />

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        <Link
          href="/sets"
          className="text-sm text-muted underline underline-offset-4 hover:text-foreground"
        >
          ← All sets
        </Link>

        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {completion.name}
          </h1>
          <span className="font-mono text-sm uppercase text-muted">
            {completion.code}
          </span>
          <span className="text-sm text-muted">
            {completion.setType.replace(/_/g, " ")}
            {completion.releasedAt ? ` · ${completion.releasedAt}` : ""}
          </span>
        </div>

        {completion.parentSetCode ? (
          <p className="mt-1 text-sm text-muted">
            Filed under{" "}
            <Link
              href={`/sets/${completion.parentSetCode}`}
              className="underline underline-offset-4"
            >
              {completion.parentSetCode.toUpperCase()}
            </Link>{" "}
            — counted separately, because it has its own set code and symbol.
          </p>
        ) : null}

        <section className="mt-6 rounded-lg border border-border bg-surface p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <span className="text-3xl font-semibold">
              {completion.owned.toLocaleString()}
              <span className="text-xl text-muted">
                {" / "}
                {completion.target.toLocaleString()}
              </span>
            </span>
            <span className={`text-2xl font-semibold ${done ? "text-ok" : ""}`}>
              {completion.percent}%
            </span>
          </div>
          <ProgressBar percent={completion.percent} className="mt-3" />
          <p className="mt-3 text-sm text-muted">
            Counting {scopeSentence}{" "}
            {completion.target !== completion.setSize ? (
              <>
                The set has {completion.setSize.toLocaleString()} printings in
                all.
              </>
            ) : null}
          </p>
          {done ? (
            <p className="mt-2 text-sm text-ok">Complete under these rules.</p>
          ) : null}
        </section>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <BucketList title="By rarity" buckets={completion.byRarity} />
          <BucketList title="By color" buckets={completion.byColor} />
        </div>

        <div className="mt-6">
          <CompletionScopeForm
            setCode={completion.code}
            scope={completion.scope}
            applicable={completion.applicable}
          />
        </div>

        <section className="mt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              Checklist
            </h2>
            {missing.length > 0 ? (
              <a
                href={`/api/sets/${completion.code}/wantlist`}
                className="text-sm text-muted underline underline-offset-4 hover:text-foreground"
              >
                Download want list
              </a>
            ) : null}
          </div>

          {completion.target === 0 ? (
            <p className="mt-3 rounded-lg border border-border bg-surface p-5 text-sm text-muted">
              Nothing is in scope for this set, so there is no checklist to
              show. Loosen the rules above.
            </p>
          ) : (
            <>
              <nav className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
                {(Object.keys(SHOWS) as Show[]).map((key) => (
                  <Link
                    key={key}
                    href={
                      key === "all"
                        ? `/sets/${completion.code}`
                        : `/sets/${completion.code}?show=${key}`
                    }
                    className={
                      key === show
                        ? "font-medium text-foreground"
                        : "text-muted underline underline-offset-4 hover:text-foreground"
                    }
                    aria-current={key === show ? "true" : undefined}
                  >
                    {SHOWS[key]} ({counts[key].toLocaleString()})
                  </Link>
                ))}
              </nav>

              {missing.length === 0 ? (
                <p className="mt-3 rounded-lg border border-border bg-surface p-5 text-sm text-ok">
                  Nothing missing. Every card in scope is in your collection.
                </p>
              ) : /* Not on the Owned tab: a buy list for cards the tab is
                    deliberately hiding is an answer to a question nobody on
                    that tab is asking. */
              show === "owned" ? null : (
                <div className="mt-3 rounded-lg border border-border bg-surface p-4">
                  <p className="mb-3 text-sm">
                    {pricedMissing === 0 ? (
                      <span className="text-muted">
                        None of the missing cards has a price yet.
                      </span>
                    ) : (
                      <>
                        <strong className="font-semibold">
                          {formatCents(missingCents)}
                        </strong>{" "}
                        <span className="text-muted">
                          to finish
                          {pricedMissing < missing.length
                            ? `, for the ${pricedMissing} of ${missing.length} that have a price`
                            : ""}
                          .
                        </span>
                      </>
                    )}
                  </p>
                  {/*
                    Set codes and collector numbers are included here, unlike
                    a deck buy list: completing a set means these exact
                    printings, not whichever one is cheapest.
                  */}
                  <PurchaseButtons
                    label="every missing card"
                    entries={missing.map((card) => ({
                      quantity: 1,
                      name: card.name,
                      setCode: completion.code,
                      collectorNumber: card.collectorNumber,
                    }))}
                  />
                </div>
              )}

              {rows.length === 0 ? (
                <p className="mt-3 rounded-lg border border-border bg-surface p-5 text-sm text-muted">
                  {show === "owned"
                    ? "You own nothing from this set yet. Every card below the All tab is still open."
                    : "Nothing to show."}
                </p>
              ) : (
                <div className="mt-3 overflow-hidden rounded-lg border border-border bg-surface">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                        {/* The status rail lives on the left edge of every
                            row, so the header reserves the same 2px. */}
                        <th className="border-l-2 border-l-transparent px-4 py-2 font-medium">
                          #
                        </th>
                        {/* No heading: the art is the card, and "Card" is
                            already the heading of the name beside it. */}
                        <th className="w-12 px-0 py-2" />
                        <th className="px-3 py-2 font-medium">Card</th>
                        <th className="hidden px-4 py-2 font-medium sm:table-cell">
                          Cost
                        </th>
                        <th className="hidden px-4 py-2 font-medium sm:table-cell">
                          Rarity
                        </th>
                        <th className="px-4 py-2 font-medium">Have</th>
                        <th className="px-4 py-2 text-right font-medium">
                          Price
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((card) => (
                        <ChecklistRow key={card.scryfallId} card={card} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      </main>

      <AppFooter />
    </div>
  );
}

/**
 * One row of the set checklist, drawn as owned or as a gap.
 *
 * The difference is stated four times over, which is deliberate: the one
 * thing this table is for is being read at a glance down three hundred rows,
 * and a single signal is either too quiet to scan or too loud to live with.
 *
 *   - a green rail on the left edge, which is what the eye follows when
 *     scrolling and the only signal that works without reading anything;
 *   - the art in colour against the art greyed out, the Pokédex trick — an
 *     owned card looks like a card and a gap looks like a slot, while the
 *     greyscale crop stays recognisable enough to shop by;
 *   - a check and a copy count against a dash, which is the accessible
 *     version of all of the above and the only one a screen reader hears;
 *   - full-strength text against muted, so a row's *name* reads as present
 *     or absent even where the rail is off the edge of a narrow screen.
 *
 * Colour is never the only carrier: --ok green and the greyscale art both
 * fall back on the check-or-dash column, which carries real text.
 */
function ChecklistRow({ card }: { card: SetPrinting }) {
  const owned = card.ownedCopies > 0;

  return (
    <tr
      className={`border-b border-border last:border-0 border-l-2 ${
        owned ? "border-l-ok" : "border-l-transparent"
      }`}
    >
      <td className="px-4 py-2 font-mono text-xs text-muted">
        {card.collectorNumber}
      </td>
      <td className="py-2 pl-0 pr-2">
        <CardArt
          printingId={card.scryfallId}
          /*
           * Greyscale carries most of the weight; the opacity is a nudge
           * further back. Not dimmer than this — a crop you cannot make out
           * stops being the picture you know the card by, which was the
           * whole reason for putting art in a table row.
           */
          className={`h-8 w-11 ${owned ? "" : "opacity-60 grayscale"}`}
        />
      </td>
      <td className="px-3 py-2">
        {/* A checklist is exactly where you want to see the card without
            navigating: owned or not, this is the printing you are deciding
            about. */}
        <CardLink
          oracleId={card.oracleId}
          imageId={card.scryfallId}
          name={card.name}
          className={owned ? "" : "text-muted"}
        />
      </td>
      <td className="hidden px-4 py-2 sm:table-cell">
        <ManaCost cost={card.manaCost} />
      </td>
      <td className="hidden px-4 py-2 text-xs text-muted sm:table-cell">
        {card.rarity}
      </td>
      <td className="px-4 py-2 text-xs">
        {owned ? (
          <span className="whitespace-nowrap font-medium text-ok">
            <span aria-hidden>✓</span>
            <span className="sr-only">In collection</span>
            {/* The count only when it is news. "×1" on two hundred rows is
                noise; "×3" is the duplicate you forgot about. */}
            {card.ownedCopies > 1 ? (
              <span className="ml-1 font-mono text-muted">
                ×{card.ownedCopies}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-muted">
            <span aria-hidden>—</span>
            <span className="sr-only">Missing</span>
          </span>
        )}
      </td>
      <td className="px-4 py-2 text-right font-mono text-xs text-muted">
        {card.priceCents === null ? "—" : formatCents(card.priceCents)}
      </td>
    </tr>
  );
}

function BucketList({
  title,
  buckets,
}: {
  title: string;
  buckets: CompletionBucket[];
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
        {title}
      </h2>
      {buckets.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Nothing in scope.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {buckets.map((b) => (
            <li key={b.label}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="capitalize">{b.label}</span>
                <span className="text-muted">
                  {b.owned} / {b.target}
                </span>
              </div>
              <ProgressBar percent={b.percent} className="mt-1" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
