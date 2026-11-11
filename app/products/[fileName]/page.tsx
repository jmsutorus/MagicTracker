import Link from "next/link";
import { notFound } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import {
  ProductAddForm,
  type BoardSummary,
} from "@/components/product-add-form";
import { requireUser } from "@/lib/auth/dal";
import { listLocations } from "@/lib/collection/queries";
import {
  PRECON_BOARDS,
  PRECON_BOARD_LABELS,
  isPreconFileName,
  type PreconBoard,
} from "@/lib/products/constants";
import { ensureProductContents } from "@/lib/products/contents";
import {
  getProduct,
  listProductCards,
  type ProductCardRow,
} from "@/lib/products/queries";

export const metadata = { title: "Product · MagicTracker" };

export default async function ProductPage({
  params,
}: {
  // Next 16: params is a Promise.
  params: Promise<{ fileName: string }>;
}) {
  await requireUser();

  const { fileName: raw } = await params;

  // Next has already percent-decoded the segment, which matters: thirteen
  // products have non-ASCII letters in their file name.
  const fileName = decodeURIComponent(raw);
  if (!isPreconFileName(fileName)) notFound();

  const product = await getProduct(fileName);
  if (!product) notFound();

  /*
   * The card list is fetched here, on first open, rather than ingested for
   * all 3,144 products — see lib/products/contents.ts for why. So this one
   * page load may make a ~0.5 MB request to MTGJSON; every later one will
   * not. A failure is reported rather than thrown, because the product still
   * has a name, a set and a release date worth showing.
   */
  const contents = await ensureProductContents(fileName);
  const cards = contents.ok ? await listProductCards(fileName) : [];
  const locations = await listLocations();

  const boards = summarizeBoards(cards);
  const unresolved = cards.filter((c) => c.printingId === null);
  const totalCopies = cards.reduce((n, c) => n + c.quantity, 0);
  const ownedCopies = cards.reduce(
    (n, c) => n + Math.min(c.ownedInFinish, c.quantity),
    0,
  );

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader current="products" />

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        <Link
          href="/products"
          className="text-sm text-muted underline underline-offset-4 hover:text-foreground"
        >
          ← All products
        </Link>

        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {product.name}
          </h1>
          <span className="font-mono text-sm uppercase text-muted">
            {product.setCode ?? product.mtgjsonSetCode.toLowerCase()}
          </span>
        </div>

        <p className="mt-1 text-sm text-muted">
          {product.productType}
          {product.releasedAt ? ` · released ${product.releasedAt}` : ""}
          {product.setCode ? (
            <>
              {" · "}
              <Link
                href={`/sets/${product.setCode}`}
                className="underline underline-offset-4"
              >
                {product.setName}
              </Link>
            </>
          ) : (
            // MTGJSON's Q01-Q08 Challenger decks have no Scryfall set, so
            // there is nothing to link to. Said plainly rather than left as a
            // dead link or a blank.
            <> · no matching Scryfall set</>
          )}
        </p>

        {!contents.ok ? (
          <p
            role="alert"
            className="mt-6 rounded-lg border border-border bg-surface p-5 text-sm text-bad"
          >
            {contents.error}
          </p>
        ) : (
          <>
            <section className="mt-6 rounded-lg border border-border bg-surface p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <span className="text-3xl font-semibold">
                  {totalCopies.toLocaleString()}
                  <span className="ml-2 text-base font-normal text-muted">
                    cards in the box
                  </span>
                </span>
                <span className="text-sm text-muted">
                  {ownedCopies.toLocaleString()} already in your collection
                </span>
              </div>

              {unresolved.length > 0 ? (
                <p className="mt-3 text-sm text-muted">
                  {unresolved.length} card
                  {unresolved.length === 1 ? "" : "s"} could not be matched to a
                  printing in the card database, so{" "}
                  {unresolved.length === 1 ? "it" : "they"} cannot be added yet.
                  This happens with a brand-new product and fixes itself once
                  the weekly card ingest catches up.
                </p>
              ) : null}

              {product.source ? (
                <p className="mt-3 text-xs text-muted">
                  Card list from MTGJSON {product.contentsVersion ?? ""} ·{" "}
                  <a
                    href={product.source}
                    rel="noreferrer noopener"
                    target="_blank"
                    className="underline underline-offset-4"
                  >
                    Wizards&rsquo; decklist
                  </a>
                </p>
              ) : null}
            </section>

            <div className="mt-6">
              <ProductAddForm
                fileName={product.fileName}
                productName={product.name}
                boards={boards}
                locations={locations.map((l) => ({ id: l.id, name: l.name }))}
              />
            </div>

            {boards.map((board) => (
              <BoardTable
                key={board.board}
                board={board.board}
                cards={cards.filter((c) => c.board === board.board)}
              />
            ))}
          </>
        )}
      </main>
    </div>
  );
}

/** Boards in print order, skipping the ones this product does not have. */
function summarizeBoards(cards: ProductCardRow[]): BoardSummary[] {
  return PRECON_BOARDS.map((board) => {
    const own = cards.filter((c) => c.board === board);
    return {
      board,
      lines: own.length,
      copies: own.reduce((n, c) => n + c.quantity, 0),
      unresolved: own
        .filter((c) => c.printingId === null)
        .reduce((n, c) => n + c.quantity, 0),
    };
  }).filter((b) => b.lines > 0);
}

function BoardTable({
  board,
  cards,
}: {
  board: PreconBoard;
  cards: ProductCardRow[];
}) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
        {PRECON_BOARD_LABELS[board]} ({cards.length})
      </h2>

      <div className="mt-3 overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-2 font-medium">#</th>
              <th className="px-4 py-2 font-medium">Card</th>
              <th className="hidden px-4 py-2 font-medium sm:table-cell">
                Finish
              </th>
              <th className="px-4 py-2 font-medium">Owned</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((card, index) => (
              <tr
                key={`${card.printingId ?? card.cardName}-${index}`}
                className="border-b border-border last:border-0"
              >
                <td className="px-4 py-2 font-mono text-xs text-muted">
                  {card.quantity > 1 ? `${card.quantity}× ` : ""}
                  {card.collectorNumber ?? ""}
                </td>
                <td className="px-4 py-2">
                  {card.oracleId ? (
                    <Link
                      href={`/cards/${card.oracleId}`}
                      className="hover:underline"
                    >
                      {card.cardName}
                    </Link>
                  ) : (
                    <span className="text-muted">
                      {card.cardName}{" "}
                      <span className="text-xs">(no matching printing)</span>
                    </span>
                  )}
                </td>
                <td className="hidden px-4 py-2 text-xs text-muted sm:table-cell">
                  {card.wantFinish ?? "—"}
                  {/*
                   * A clamp worth showing: the product ships the card foil but
                   * the printing has no foil version, so an added copy lands
                   * as nonfoil. Silently storing the other finish would make
                   * the owned column disagree with itself.
                   */}
                  {card.isFoil && card.wantFinish !== "foil" ? (
                    <span className="ml-1">(ships foil)</span>
                  ) : null}
                  {card.isEtched && card.wantFinish !== "etched" ? (
                    <span className="ml-1">(ships etched)</span>
                  ) : null}
                </td>
                <td
                  className={`px-4 py-2 text-xs ${
                    card.ownedInFinish >= card.quantity
                      ? "text-ok"
                      : "text-muted"
                  }`}
                >
                  {card.ownedInFinish} / {card.quantity}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
