import { sql, type SQL } from "drizzle-orm";

/**
 * Which printing to pick when a pasted line does not name one.
 *
 * One definition, imported by both the resolver that previews the choice and
 * the write that makes it. Two copies would drift, and the moment they did
 * the review screen would start showing a printing other than the one it
 * stored — a quiet lie, and the hardest kind to notice.
 *
 * Any query using this must have `printings` aliased `p` and `sets` aliased
 * `s`, joined on `s.code = p.set_code`.
 *
 * The order *is* the policy, and each line earns its place:
 *
 *   is_extra      — an art series card is literally named
 *                   "Lightning Bolt // Lightning Bolt"; it is not the card.
 *   digital       — this tracks cardboard, and an Alchemy or Arena-only
 *                   printing cannot be owned in paper. Belt and braces: the
 *                   card ingest already drops digital-only printings
 *                   (scripts/ingest-cards.ts), so today this clause has
 *                   nothing to sort. It costs nothing and the failure it
 *                   guards — an un-ownable printing written into the
 *                   collection — is both severe and easy to miss, so it
 *                   stays. import-smoke asserts the ingest invariant that
 *                   actually does the work.
 *   lang          — English, since that is what the collection is in.
 *   is_promo      — a prerelease stamp is not the normal card.
 *   is_booster    — something you could actually open.
 *   numeric       — a collector number that is not a plain number marks a
 *                   special product. The List is the case that forced this:
 *                   its entries are numbered after the set they reprint
 *                   ("CLB-187"), and because each is dated when it was
 *                   re-inserted, the newest printing of a staple like
 *                   Lightning Bolt was The List rather than a real set. The
 *                   test is on the printed text and *not* on
 *                   `collector_number_num`, which is a digits-only
 *                   extraction: for "CLB-187" it holds 187, so it cannot
 *                   tell a real #187 from a List entry.
 *   released_at   — newest, the printing most likely to be in a shop.
 */
export const DEFAULT_PRINTING_ORDER: SQL = sql`
  p.is_extra ASC,
  s.digital ASC,
  (p.lang = 'en') DESC,
  p.is_promo ASC,
  p.is_booster DESC,
  (p.collector_number ~ '^[0-9]+$') DESC,
  p.released_at DESC NULLS LAST,
  p.collector_number_num ASC NULLS LAST
`;
