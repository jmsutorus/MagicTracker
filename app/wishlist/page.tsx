import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { ManaCost } from "@/components/mana-cost";
import { PurchaseButtons } from "@/components/purchase-buttons";
import { WishlistAdd } from "@/components/wishlist-add";
import { WishlistRowControls } from "@/components/wishlist-row-controls";
import { requireUser } from "@/lib/auth/dal";
import { formatCents } from "@/lib/prices/constants";
import { listWishlist, type WishlistRow } from "@/lib/wishlist/queries";

import { ClearOwnedButton } from "./clear-owned-button";

export const metadata = { title: "Wishlist · MagicTracker" };

/** What a row is, in the fewest words that distinguish it from its siblings. */
function describe(row: WishlistRow): string {
  const parts: string[] = [];
  if (row.setCode && row.collectorNumber) {
    parts.push(`${row.setCode.toUpperCase()} #${row.collectorNumber}`);
  } else {
    parts.push("any printing");
  }
  if (row.finish) parts.push(row.finish);
  return parts.join(" · ");
}

export default async function WishlistPage() {
  await requireUser();

  const { rows, wantedCopies, totalCents, unpricedRows, ownedRows } =
    await listWishlist();

  /*
   * Only rows you do not already own go to the store. Buying a card you just
   * bought is the one mistake this page exists to prevent, and quietly
   * including it in the mass-entry list would cause exactly that.
   */
  const toBuy = rows.filter((row) => row.ownedCopies < row.quantity);
  const entries = toBuy.map((row) => ({
    quantity: row.quantity - row.ownedCopies,
    name: row.name,
    // A row that named a printing means that printing; one that did not will
    // take whichever the store prices cheapest.
    setCode: row.setCode,
    collectorNumber: row.collectorNumber,
  }));

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader current="wishlist" />

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Wishlist</h1>
        <p className="mt-2 text-sm text-muted">
          Cards you want that aren&rsquo;t tied to a set you&rsquo;re completing
          or a deck you&rsquo;ve built.
        </p>

        <section className="mt-6 rounded-lg border border-border bg-surface p-5">
          <WishlistAdd />
        </section>

        {rows.length === 0 ? (
          <p className="mt-6 rounded-lg border border-border bg-surface-muted p-5 text-sm text-muted">
            Nothing on the list yet. Add a card above, or use{" "}
            <strong className="font-medium text-foreground">
              Add to wishlist
            </strong>{" "}
            on any card&rsquo;s page.
          </p>
        ) : (
          <>
            <section className="mt-6 rounded-lg border border-border bg-surface p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                <p className="text-sm">
                  <strong className="text-lg font-semibold">
                    {formatCents(totalCents)}
                  </strong>{" "}
                  <span className="text-muted">
                    for {wantedCopies.toLocaleString()} card
                    {wantedCopies === 1 ? "" : "s"}
                    {unpricedRows > 0 ? `, with ${unpricedRows} unpriced` : ""}.
                  </span>
                </p>
                {ownedRows > 0 ? <ClearOwnedButton count={ownedRows} /> : null}
              </div>

              {ownedRows > 0 ? (
                <p className="mt-2 text-sm text-warn">
                  {ownedRows === 1
                    ? "One of these is already in your collection."
                    : `${ownedRows} of these are already in your collection.`}{" "}
                  <span className="text-muted">
                    They are left off the buy list below.
                  </span>
                </p>
              ) : null}

              {entries.length > 0 ? (
                <div className="mt-4 border-t border-border pt-4">
                  <PurchaseButtons label="the wishlist" entries={entries} />
                </div>
              ) : null}
            </section>

            <ul className="mt-6 space-y-2">
              {rows.map((row) => {
                const have = row.ownedCopies >= row.quantity;
                return (
                  <li
                    key={row.id}
                    className="rounded-lg border border-border bg-surface px-4 py-3"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <Link
                        href={`/cards/${row.oracleId}`}
                        className="font-medium hover:underline"
                      >
                        {row.name}
                      </Link>
                      <ManaCost cost={row.manaCost} size={13} />
                      <span className="min-w-0 flex-1 truncate text-xs text-muted">
                        {describe(row)}
                      </span>
                      <span className="shrink-0 font-mono text-sm">
                        {row.priceCents === null
                          ? "—"
                          : formatCents(row.priceCents * row.quantity)}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                      <WishlistRowControls
                        id={row.id}
                        quantity={row.quantity}
                        name={row.name}
                      />
                      {row.ownedCopies > 0 ? (
                        <span
                          className={`text-xs ${have ? "text-ok" : "text-muted"}`}
                        >
                          {have
                            ? `You own ${row.ownedCopies} — got it.`
                            : `You own ${row.ownedCopies} of ${row.quantity}.`}
                        </span>
                      ) : null}
                    </div>

                    {row.note ? (
                      <p className="mt-2 text-xs text-muted">{row.note}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
