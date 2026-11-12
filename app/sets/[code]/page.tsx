import Link from "next/link";
import { notFound } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { CardLink } from "@/components/card-link";
import { CompletionScopeForm } from "@/components/completion-scope-form";
import { ManaCost } from "@/components/mana-cost";
import { ProgressBar } from "@/components/progress-bar";
import { PurchaseButtons } from "@/components/purchase-buttons";
import { requireUser } from "@/lib/auth/dal";
import {
  getSetCompletion,
  listMissingPrintings,
  type CompletionBucket,
} from "@/lib/completion/queries";
import { describeScope } from "@/lib/completion/scope";
import { formatCents } from "@/lib/prices/constants";

export const metadata = { title: "Set completion · MagicTracker" };

export default async function SetCompletionPage({
  params,
}: {
  // Next 16: params is a Promise.
  params: Promise<{ code: string }>;
}) {
  await requireUser();

  const { code } = await params;

  // Checked before it reaches a query, and it also keeps a junk URL from
  // looking like a database problem.
  if (!/^[a-z0-9]{1,16}$/i.test(code)) notFound();

  const completion = await getSetCompletion(code);
  if (!completion) notFound();

  const missing = await listMissingPrintings(code);

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
              Missing ({missing.length.toLocaleString()})
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

          {missing.length === 0 ? (
            <p className="mt-3 rounded-lg border border-border bg-surface p-5 text-sm text-muted">
              {completion.target === 0
                ? "Nothing is in scope for this set, so there is nothing to be missing. Loosen the rules above."
                : "Nothing missing. Every card in scope is in your collection."}
            </p>
          ) : (
            <>
              {/*
                Set codes and collector numbers are included here, unlike a
                deck buy list: completing a set means these exact printings,
                not whichever one is cheapest.
              */}
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
              <div className="mt-3 overflow-hidden rounded-lg border border-border bg-surface">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-4 py-2 font-medium">#</th>
                      <th className="px-4 py-2 font-medium">Card</th>
                      <th className="hidden px-4 py-2 font-medium sm:table-cell">
                        Cost
                      </th>
                      <th className="px-4 py-2 font-medium">Rarity</th>
                      <th className="px-4 py-2 text-right font-medium">
                        Price
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {missing.map((card) => (
                      <tr
                        key={card.scryfallId}
                        className="border-b border-border last:border-0"
                      >
                        <td className="px-4 py-2 font-mono text-xs text-muted">
                          {card.collectorNumber}
                        </td>
                        <td className="px-4 py-2">
                          {/* The missing-cards list is exactly where you want
                              to see the card without navigating: these are
                              printings you are deciding whether to buy. */}
                          <CardLink
                            oracleId={card.oracleId}
                            imageId={card.scryfallId}
                            name={card.name}
                          />
                        </td>
                        <td className="hidden px-4 py-2 sm:table-cell">
                          <ManaCost cost={card.manaCost} />
                        </td>
                        <td className="px-4 py-2 text-xs text-muted">
                          {card.rarity}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs text-muted">
                          {card.priceCents === null
                            ? "—"
                            : formatCents(card.priceCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
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
