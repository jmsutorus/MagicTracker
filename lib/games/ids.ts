import { createHash } from "node:crypto";

import type { GameSlug } from "@/lib/games/constants";

/**
 * Stable UUIDs for games that do not hand out UUIDs.
 *
 * `printings.scryfall_id` is a `uuid` primary key, and six tables reference
 * it — collection_items, wishlist_items, deck_cards, precon_cards,
 * price_snapshots and the share-link machinery. Widening it to `text` so that
 * Pokémon's `sv8-1` and One Piece's `OP01-077` could be stored verbatim would
 * have meant dropping and recreating every one of those foreign keys and
 * rewriting every `::uuid` cast in the app, with 1,826 rows of real,
 * irreplaceable collection data sitting underneath the whole operation.
 *
 * So the id stays a UUID and the other games get one *derived* from the id
 * they do have. UUIDv5 (RFC 4122 §4.3) is exactly this: a SHA-1 of a
 * namespace and a name, with the version and variant bits overwritten. It is
 * deterministic, so re-running an ingest produces the same id and upserts
 * rather than duplicating; it is collision-free in practice; and the source
 * id is stored alongside in `printings.external_id`, so nothing is lost —
 * the derivation never has to be run backwards.
 *
 * (Node has no uuidv5 builtin and `crypto.randomUUID` is v4, which is random
 * and therefore useless here. Hashing by hand avoids a dependency for forty
 * lines of well-specified bit-twiddling.)
 */

/**
 * A namespace of this app's own, generated once and then fixed forever.
 *
 * It must never change: every derived id in the database, and every
 * collection row pointing at one, is a function of this constant.
 */
const NAMESPACE = "6f8d2c41-5b3e-4a7d-9c1f-2e0b8a4d6517";

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}

const NAMESPACE_BYTES = uuidToBytes(NAMESPACE);

/** RFC 4122 §4.3, with SHA-1 — a version 5 UUID. */
function uuidv5(name: string): string {
  const hash = createHash("sha1")
    .update(NAMESPACE_BYTES)
    .update(Buffer.from(name, "utf8"))
    .digest();

  const bytes = Buffer.from(hash.subarray(0, 16));

  // Version 5 in the high nibble of octet 6, and the RFC 4122 variant in the
  // top two bits of octet 8. Without these the string is a hash that merely
  // looks like a UUID, and Postgres's `uuid` type would still accept it —
  // which is precisely why it is worth doing properly rather than trusting
  // the column to complain.
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/**
 * The primary key for one printing of a non-Magic card.
 *
 * Keyed on the game and the source's own card id — `sv8-1`, `OP01-077` —
 * which are the stable identifiers those catalogs are built around. The game
 * is part of the name so that two sources reusing a string cannot collide.
 *
 * Never called for Magic: a Scryfall card already has a UUID, and deriving a
 * second one would orphan every collection row.
 */
export function printingId(game: GameSlug, externalId: string): string {
  if (game === "mtg") {
    throw new Error(
      "Magic printings are keyed by their Scryfall id, which is already a " +
        "UUID. Deriving one would not match the 110k rows already stored.",
    );
  }
  return uuidv5(`${game}:printing:${externalId}`);
}

/**
 * The oracle id a non-Magic printing hangs off.
 *
 * Magic has a real oracle id because it has a real concept of one card
 * printed many times. The other games have the same *shape* — one Pikachu,
 * forty printings of it — without an identifier for it, so the card's name is
 * the identity, normalized so that spacing and case cannot split one card in
 * two.
 *
 * This is why `/cards/<id>` works unchanged for every game: every printing of
 * a name lands on one page, which is what someone asking "do I have that
 * card" means.
 */
export function oracleId(game: GameSlug, name: string): string {
  if (game === "mtg") {
    throw new Error("Magic cards carry Scryfall's own oracle_id.");
  }
  return uuidv5(`${game}:oracle:${normalizeCardName(name)}`);
}

/**
 * The form of a name that decides whether two printings are the same card.
 *
 * Case and run-together whitespace are noise. Punctuation is deliberately
 * kept: One Piece's "Monkey.D.Luffy" and Pokémon's "Mr. Mime" carry it in
 * the printed name, and stripping it would fold genuinely distinct cards
 * together more often than it would join split spellings.
 */
export function normalizeCardName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}
