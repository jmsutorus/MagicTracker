import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { ProgressBar } from "@/components/progress-bar";
import { requireUser } from "@/lib/auth/dal";
import { DEFAULT_PRODUCT_TYPE } from "@/lib/products/constants";
import { listProductTypes, listProducts } from "@/lib/products/queries";

export const metadata = { title: "Sealed products · MagicTracker" };

const PAGE_SIZE = 40;

function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function ProductsPage({
  searchParams,
}: {
  // Next 16: searchParams is a Promise.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();

  const params = await searchParams;
  const q = one(params.q)?.slice(0, 60) ?? "";

  /*
   * The type filter defaults to Commander Deck rather than "everything".
   *
   * The catalog holds 3,144 decks, of which 782 are Secret Lair drops and 570
   * are Jumpstart packs — opening on all of them would bury the 206 products
   * this is for. `type=all` is the escape hatch.
   */
  const rawType = one(params.type);
  const productType =
    rawType === "all" ? undefined : (rawType ?? DEFAULT_PRODUCT_TYPE);

  const page = Math.max(Number.parseInt(one(params.page) ?? "1", 10) || 1, 1);

  const [types, result] = await Promise.all([
    listProductTypes(),
    listProducts({
      q,
      productType,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
  ]);

  const pages = Math.max(Math.ceil(result.total / PAGE_SIZE), 1);

  function href(overrides: Record<string, string | undefined>): string {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (rawType) next.set("type", rawType);
    if (page > 1) next.set("page", String(page));
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    }
    const query = next.toString();
    return query ? `/products?${query}` : "/products";
  }

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader current="products" />

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Sealed products
        </h1>
        <p className="mt-2 text-sm text-muted">
          Preconstructed decks with a known card list. Open one and its whole
          contents go into your collection in a single step.
        </p>

        <form className="mt-6 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Search by name or set</span>
            <input
              name="q"
              defaultValue={q}
              placeholder="Family Matters, or BLC…"
              className="w-64 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Product type</span>
            <select
              name="type"
              defaultValue={rawType ?? DEFAULT_PRODUCT_TYPE}
              className="w-56 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            >
              <option value="all">Every type</option>
              {types.map((t) => (
                <option key={t.productType} value={t.productType}>
                  {t.productType} ({t.count})
                </option>
              ))}
            </select>
          </label>

          <button
            type="submit"
            className="cursor-pointer rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm hover:text-foreground"
          >
            Search
          </button>

          {q || rawType ? (
            <Link
              href="/products"
              className="py-2 text-sm text-muted underline underline-offset-4 hover:text-foreground"
            >
              Reset
            </Link>
          ) : null}
        </form>

        <p className="mt-5 text-sm text-muted">
          {result.total.toLocaleString()} product
          {result.total === 1 ? "" : "s"}
          {productType ? ` of type “${productType}”` : ""}
          {q ? ` matching “${q}”` : ""}.
        </p>

        {result.rows.length === 0 ? (
          <p className="mt-3 rounded-lg border border-border bg-surface p-5 text-sm text-muted">
            Nothing matches. Try “Every type”, or a shorter search.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {result.rows.map((p) => {
              // Cards owned out of the product's distinct cards. Null until
              // someone opens the product and its card list is fetched, which
              // is why this reads "not loaded yet" rather than "0%".
              const known = p.distinctCount !== null && p.distinctCount > 0;
              const percent = known
                ? Math.min(
                    Math.round((p.ownedDistinct / p.distinctCount!) * 100),
                    100,
                  )
                : 0;

              return (
                <li key={p.fileName}>
                  <Link
                    href={`/products/${encodeURIComponent(p.fileName)}`}
                    className="block rounded-lg border border-border bg-surface px-4 py-3 hover:border-accent"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-mono text-xs uppercase text-muted">
                        {p.setCode ?? p.mtgjsonSetCode.toLowerCase()}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <span className="text-xs text-muted">
                        {p.releasedAt?.slice(0, 4) ?? "—"}
                      </span>
                      {known ? (
                        <span
                          className={`text-sm ${percent >= 100 ? "text-ok" : "text-muted"}`}
                        >
                          {p.ownedDistinct} / {p.distinctCount} owned
                        </span>
                      ) : (
                        <span className="text-xs text-muted">
                          card list not loaded
                        </span>
                      )}
                    </div>

                    {known ? (
                      <ProgressBar percent={percent} className="mt-2" />
                    ) : null}

                    <div className="mt-1 text-xs text-muted">
                      {p.productType}
                      {p.setName ? ` · ${p.setName}` : ""}
                      {p.cardCount ? ` · ${p.cardCount} cards` : ""}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {pages > 1 ? (
          <nav className="mt-6 flex items-center gap-4 text-sm">
            {page > 1 ? (
              <Link
                href={href({ page: String(page - 1) })}
                className="text-muted underline underline-offset-4 hover:text-foreground"
              >
                ← Previous
              </Link>
            ) : null}
            <span className="text-muted">
              Page {page} of {pages}
            </span>
            {page < pages ? (
              <Link
                href={href({ page: String(page + 1) })}
                className="text-muted underline underline-offset-4 hover:text-foreground"
              >
                Next →
              </Link>
            ) : null}
          </nav>
        ) : null}
      </main>
    </div>
  );
}
