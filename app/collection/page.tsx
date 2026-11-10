import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { CollectionRowControls } from "@/components/collection-row-controls";
import { requireUser } from "@/lib/auth/dal";
import { CARD_FINISHES } from "@/lib/collection/constants";
import {
  browseCollection,
  getCollectionTotals,
  listCollectedSets,
  listLocations,
} from "@/lib/collection/queries";

export const metadata = { title: "Collection · MagicTracker" };

const RARITIES = ["common", "uncommon", "rare", "mythic", "special", "bonus"];
const PAGE_SIZE = 100;

/** Reads one query-string value, ignoring a repeated parameter. */
function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function CollectionPage({
  searchParams,
}: {
  // Next 16: searchParams is a Promise.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();

  const params = await searchParams;
  const q = one(params.q)?.slice(0, 100) ?? "";
  const setCode = one(params.set) ?? "";
  const locationId = one(params.location) ?? "";
  const finish = one(params.finish) ?? "";
  const rarity = one(params.rarity) ?? "";
  const pageParam = Number.parseInt(one(params.page) ?? "1", 10);
  const page = Number.isSafeInteger(pageParam) && pageParam > 0 ? pageParam : 1;

  const [totals, locations, collectedSets, result] = await Promise.all([
    getCollectionTotals(),
    listLocations(),
    listCollectedSets(),
    browseCollection({
      q: q || undefined,
      setCode: setCode || undefined,
      locationId: locationId || undefined,
      finish: finish || undefined,
      rarity: rarity || undefined,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
  ]);

  const filtered = Boolean(q || setCode || locationId || finish || rarity);
  const lastPage = Math.max(1, Math.ceil(result.matchingRows / PAGE_SIZE));

  const selectClass =
    "rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent";

  function pageHref(target: number) {
    const search = new URLSearchParams();
    if (q) search.set("q", q);
    if (setCode) search.set("set", setCode);
    if (locationId) search.set("location", locationId);
    if (finish) search.set("finish", finish);
    if (rarity) search.set("rarity", rarity);
    if (target > 1) search.set("page", String(target));
    const query = search.toString();
    return query.length > 0 ? `/collection?${query}` : "/collection";
  }

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader current="collection" />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Collection</h1>
          <div className="flex items-center gap-4 text-sm">
            <Link
              href="/collection/locations"
              className="text-muted underline underline-offset-4 hover:text-foreground"
            >
              Locations
            </Link>
            <Link
              href="/collection/add"
              className="rounded-lg bg-accent px-3 py-2 text-accent-contrast"
            >
              Add cards
            </Link>
          </div>
        </div>

        {totals.totalCopies === 0 ? (
          <p className="mt-6 rounded-lg border border-border bg-surface p-5 text-sm text-muted">
            Nothing here yet.{" "}
            <Link
              href="/collection/add"
              className="text-foreground underline underline-offset-4"
            >
              Add your first cards
            </Link>{" "}
            — pin a set and type collector numbers, or search by name.
          </p>
        ) : (
          <>
            <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Cards" value={totals.totalCopies} />
              <Stat label="Distinct printings" value={totals.distinctPrintings} />
              <Stat label="Distinct cards" value={totals.distinctCards} />
              <Stat label="Foils" value={totals.foilCopies} />
            </dl>

            <form className="mt-6 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted">Name contains</span>
                <input
                  name="q"
                  defaultValue={q}
                  placeholder="bolt"
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted">Set</span>
                <select name="set" defaultValue={setCode} className={selectClass}>
                  <option value="">any</option>
                  {collectedSets.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name} ({s.copies})
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted">Location</span>
                <select
                  name="location"
                  defaultValue={locationId}
                  className={selectClass}
                >
                  <option value="">anywhere</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({l.cardCount})
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted">Finish</span>
                <select
                  name="finish"
                  defaultValue={finish}
                  className={selectClass}
                >
                  <option value="">any</option>
                  {CARD_FINISHES.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted">Rarity</span>
                <select
                  name="rarity"
                  defaultValue={rarity}
                  className={selectClass}
                >
                  <option value="">any</option>
                  {RARITIES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="submit"
                className="cursor-pointer rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm hover:text-foreground"
              >
                Filter
              </button>

              {filtered ? (
                <Link
                  href="/collection"
                  className="py-2 text-sm text-muted underline underline-offset-4 hover:text-foreground"
                >
                  Clear
                </Link>
              ) : null}
            </form>

            <p className="mt-4 text-sm text-muted">
              {filtered
                ? `${result.matchingCopies.toLocaleString()} card${result.matchingCopies === 1 ? "" : "s"} in ${result.matchingRows.toLocaleString()} row${result.matchingRows === 1 ? "" : "s"} match.`
                : `${result.matchingRows.toLocaleString()} row${result.matchingRows === 1 ? "" : "s"}.`}
            </p>

            {result.rows.length === 0 ? (
              <p className="mt-6 rounded-lg border border-border bg-surface p-5 text-sm text-muted">
                Nothing matches those filters.
              </p>
            ) : (
              <div className="mt-3 overflow-hidden rounded-lg border border-border bg-surface">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-4 py-2 font-medium">Card</th>
                      <th className="px-4 py-2 font-medium">Set</th>
                      <th className="hidden px-4 py-2 font-medium sm:table-cell">
                        Finish
                      </th>
                      <th className="px-4 py-2 text-right font-medium">
                        Quantity &amp; location
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row) => (
                      <tr key={row.itemId} className="border-b border-border last:border-0">
                        <td className="px-4 py-2 align-top">
                          <Link
                            href={`/cards/${row.oracleId}`}
                            className="hover:underline"
                          >
                            {row.name}
                          </Link>
                          <span className="block text-xs text-muted">
                            {row.typeLine ?? ""}
                          </span>
                        </td>
                        <td className="px-4 py-2 align-top">
                          <span className="font-mono text-xs uppercase">
                            {row.setCode}
                          </span>{" "}
                          <span className="font-mono text-xs text-muted">
                            #{row.collectorNumber}
                          </span>
                          <span className="block text-xs text-muted">
                            {row.rarity}
                          </span>
                        </td>
                        <td className="hidden px-4 py-2 align-top sm:table-cell">
                          <span className="text-xs">
                            {row.finish === "nonfoil" ? "—" : row.finish}
                          </span>
                          <span className="block text-xs text-muted">
                            {row.condition}
                          </span>
                        </td>
                        <td className="px-4 py-2 align-top">
                          <CollectionRowControls
                            itemId={row.itemId}
                            quantity={row.quantity}
                            locationId={row.locationId}
                            locations={locations.map((l) => ({
                              id: l.id,
                              name: l.name,
                            }))}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {lastPage > 1 ? (
              <nav className="mt-4 flex items-center justify-between text-sm">
                {page > 1 ? (
                  <Link
                    href={pageHref(page - 1)}
                    className="text-muted underline underline-offset-4 hover:text-foreground"
                  >
                    ← Previous
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-muted">
                  Page {page} of {lastPage}
                </span>
                {page < lastPage ? (
                  <Link
                    href={pageHref(page + 1)}
                    className="text-muted underline underline-offset-4 hover:text-foreground"
                  >
                    Next →
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 text-xl font-semibold">{value.toLocaleString()}</dd>
    </div>
  );
}
