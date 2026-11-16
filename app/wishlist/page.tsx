import Link from "next/link";

import { AppFooter } from "@/components/app-footer";
import { AppHeader } from "@/components/app-header";
import { CardArt } from "@/components/card-art";
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

  /*
   * The mass-entry handoff is Magic-only, so the list given to the stores is
   * too.
   *
   * Both buttons paste a decklist — "4 Sol Ring (BLB) 123" — into a bulk
   * page that is a Magic bulk page: Mana Pool sells nothing else, and
   * TCGplayer's mass entry is per category. A Pokémon line in that paste
   * does not half-work, it fails to match and silently drops out of the
   * cart, which is the kind of quiet wrong answer this app's buy list exists
   * to avoid.
   */
  const buyable = toBuy.filter((row) => row.game === "mtg");
  const otherGameRows = toBuy.length - buyable.length;

  const entries = buyable.map((row) => ({
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

              {otherGameRows > 0 ? (
                <p className="mt-2 text-sm text-muted">
                  {otherGameRows === 1
                    ? "One of these is not a Magic card, so it is not on the buy list — "
                    : `${otherGameRows} of these are not Magic cards, so they are not on the buy list — `}
                  the stores’ bulk-paste pages take a Magic decklist and
                  nothing else. Each card’s own page has a store link.
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
                    className="flex gap-3 rounded-lg border border-border bg-surface p-3"
                  >
                    <CardArt
                      printingId={row.artPrintingId}
                      src={row.artUrl}
                      className="h-12 w-12"
                    />

                    <div className="min-w-0 flex-1">
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
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </main>

      <AppFooter />
    </div>
  );
}
