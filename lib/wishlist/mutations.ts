import { sql } from "drizzle-orm";

import { CARD_FINISHES, type CardFinish } from "@/lib/collection/constants";
import { getDb } from "@/lib/db";

/**
 * Writes to the wishlist.
 *
 * Same discipline as the collection and deck mutations: these run from server
 * actions, a server action is a public HTTP endpoint, and every value that
 * reaches a column is checked here against that column's own domain rather
 * than only in the form. The CHECK constraints are the backstop.
 */

export type WishlistError = { ok: false; error: string };
export type WishlistResult = { ok: true } | WishlistError;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Enough to want a playset of a card several times over, and no more. */
export const MAX_WISHLIST_QUANTITY = 99;
export const MAX_WISHLIST_NOTE_LENGTH = 200;

/**
 * Postgres 23503, however deep the driver buried it.
 *
 * Matched on the SQLSTATE and not on the message: drizzle wraps the driver
 * error in its own ("Failed query: ..."), so the text to match moves to
 * `cause`, and a message test silently stops working the day the wrapper
 * changes — which is exactly how this was first written.
 */
function isForeignKeyViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (
      typeof current === "object" &&
      "code" in current &&
      (current as { code?: unknown }).code === "23503"
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export type AddWishInput = {
  oracleId: string;
  /** Omitted or null means any printing. */
  printingId?: string | null;
  /** Omitted or null means any finish. */
  finish?: string | null;
  quantity?: number;
  note?: string | null;
};

function cleanNote(note: string | null | undefined): string | null {
  if (note === null || note === undefined) return null;
  const trimmed = note.trim().replace(/\s+/g, " ");
  return trimmed.length === 0
    ? null
    : trimmed.slice(0, MAX_WISHLIST_NOTE_LENGTH);
}

function isFinish(value: string): value is CardFinish {
  return (CARD_FINISHES as readonly string[]).includes(value);
}

/**
 * Adds a wish, or raises the quantity of one that is already there.
 *
 * Adding the same card twice is the common case — you see it again and want
 * another — so the conflict is an increment rather than an error. The unique
 * key is NULLS NOT DISTINCT, so "any printing" collides with itself the way
 * a reader expects, and "the Secret Lair one" stays a separate row.
 */
export async function addWish(input: AddWishInput): Promise<WishlistResult> {
  const { oracleId } = input;
  if (!UUID_RE.test(oracleId)) return { ok: false, error: "Unknown card." };

  const printingId = input.printingId ?? null;
  if (printingId !== null && !UUID_RE.test(printingId)) {
    return { ok: false, error: "Unknown printing." };
  }

  const finish = input.finish ?? null;
  if (finish !== null && !isFinish(finish)) {
    return { ok: false, error: `Invalid finish "${finish}".` };
  }

  const quantity = input.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { ok: false, error: "Quantity must be a whole number, 1 or more." };
  }
  if (quantity > MAX_WISHLIST_QUANTITY) {
    return {
      ok: false,
      error: `Quantity cannot exceed ${MAX_WISHLIST_QUANTITY}.`,
    };
  }

  const note = cleanNote(input.note);
  const db = getDb();

  try {
    await db.execute(sql`
      INSERT INTO wishlist_items (oracle_id, printing_id, finish, quantity, note)
      VALUES (
        ${oracleId}::uuid,
        ${printingId}::uuid,
        ${finish},
        ${quantity},
        ${note}
      )
      ON CONFLICT ON CONSTRAINT wishlist_items_card_key DO UPDATE
        SET quantity = least(
              wishlist_items.quantity + EXCLUDED.quantity,
              ${MAX_WISHLIST_QUANTITY}
            ),
            note = coalesce(EXCLUDED.note, wishlist_items.note),
            updated_at = now()
    `);
    return { ok: true };
  } catch (error) {
    // A foreign key violation here means the id is not in the card database.
    if (isForeignKeyViolation(error)) {
      return {
        ok: false,
        error: "That card is not in the card database.",
      };
    }
    throw error;
  }
}

export async function removeWish(id: string): Promise<WishlistResult> {
  if (!UUID_RE.test(id)) return { ok: false, error: "Unknown wishlist entry." };

  const db = getDb();
  const result = await db.execute(sql`
    DELETE FROM wishlist_items WHERE id = ${id}::uuid
  `);

  return (result.rowCount ?? 0) > 0
    ? { ok: true }
    : { ok: false, error: "That entry is already gone." };
}

export async function setWishQuantity(
  id: string,
  quantity: number,
): Promise<WishlistResult> {
  if (!UUID_RE.test(id)) return { ok: false, error: "Unknown wishlist entry." };

  if (!Number.isInteger(quantity)) {
    return { ok: false, error: "Quantity must be a whole number." };
  }
  // Zero is how the UI removes the last copy, and reads better than a
  // separate button that means the same thing.
  if (quantity <= 0) return removeWish(id);
  if (quantity > MAX_WISHLIST_QUANTITY) {
    return {
      ok: false,
      error: `Quantity cannot exceed ${MAX_WISHLIST_QUANTITY}.`,
    };
  }

  const db = getDb();
  const result = await db.execute(sql`
    UPDATE wishlist_items
       SET quantity = ${quantity}, updated_at = now()
     WHERE id = ${id}::uuid
  `);

  return (result.rowCount ?? 0) > 0
    ? { ok: true }
    : { ok: false, error: "That entry no longer exists." };
}

export async function setWishNote(
  id: string,
  note: string | null,
): Promise<WishlistResult> {
  if (!UUID_RE.test(id)) return { ok: false, error: "Unknown wishlist entry." };

  const db = getDb();
  const result = await db.execute(sql`
    UPDATE wishlist_items
       SET note = ${cleanNote(note)}, updated_at = now()
     WHERE id = ${id}::uuid
  `);

  return (result.rowCount ?? 0) > 0
    ? { ok: true }
    : { ok: false, error: "That entry no longer exists." };
}

/**
 * Drops every wish already satisfied by the collection.
 *
 * Offered as one action rather than done automatically: buying a card is not
 * the same as no longer wanting it — a playset is four — so the list says
 * "you own this now" and leaves the decision here.
 */
export async function clearOwnedWishes(): Promise<{
  ok: true;
  removed: number;
}> {
  const db = getDb();
  const result = await db.execute(sql`
    DELETE FROM wishlist_items w
     WHERE (
       SELECT coalesce(sum(c.quantity), 0)
         FROM collection_items c
         JOIN printings cp ON cp.scryfall_id = c.printing_id
        WHERE cp.oracle_id = w.oracle_id
          AND (w.printing_id IS NULL OR c.printing_id = w.printing_id)
          AND (w.finish IS NULL OR c.finish = w.finish)
     ) >= w.quantity
  `);
  return { ok: true, removed: result.rowCount ?? 0 };
}
