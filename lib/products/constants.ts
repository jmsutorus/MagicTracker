/**
 * Sealed-product domain values, shared by the schema, the server and the
 * browser.
 *
 * Zero imports, for the same reason lib/collection/constants.ts has none: the
 * add form is a client component, and importing these from lib/db/schema.ts
 * would drag drizzle-orm into the browser bundle. schema.ts re-exports from
 * here so there is one definition of each.
 */

/**
 * The boards a precon ships with, named as this app names them.
 *
 * MTGJSON calls them `commander`, `mainBoard`, `sideBoard`, `tokens`,
 * `planes` and `schemes`. The short names are stored instead because `main`
 * is what the UI says and because a column value should not have to carry
 * another project's camelCase.
 */
export const PRECON_BOARDS = [
  "commander",
  "main",
  "side",
  "token",
  "plane",
  "scheme",
] as const;
export type PreconBoard = (typeof PRECON_BOARDS)[number];

/**
 * Which boards an "add this product" starts with ticked.
 *
 * Commander and main board are the deck as sold. Tokens, planes and schemes
 * are in the box too, but they are not the deck and they are `is_extra`
 * printings that set completion excludes by default — so they are offered and
 * left off rather than added silently. A sideboard is rare on a precon and is
 * off for the same reason: it is a choice, not a default.
 */
export const DEFAULT_PRECON_BOARDS: readonly PreconBoard[] = [
  "commander",
  "main",
];

export const PRECON_BOARD_LABELS: Record<PreconBoard, string> = {
  commander: "Commander",
  main: "Main deck",
  side: "Sideboard",
  token: "Tokens",
  plane: "Planes",
  scheme: "Schemes",
};

/**
 * The product type the picker opens on.
 *
 * "I mostly play Commander and sealed", and a Commander precon is the one
 * product whose contents are deterministic — which is what makes adding it in
 * one action meaningful at all. See the note in lib/products/queries.ts.
 */
export const DEFAULT_PRODUCT_TYPE = "Commander Deck";

/**
 * File names are MTGJSON's identifier for a deck and this app's URL slug for
 * a product. Thirteen of the 3,144 contain non-ASCII letters
 * (`ArtistSeriesVéroniqueMeignaud_SLD`, `MahōGakuinSeishunHakusho_SLD`), so
 * the pattern is Unicode-aware: `[A-Za-z0-9_]` would 404 those thirteen.
 */
export const PRECON_FILE_NAME_RE = /^[\p{L}\p{N}_]{1,120}$/u;

export function isPreconFileName(value: string): boolean {
  return PRECON_FILE_NAME_RE.test(value);
}
