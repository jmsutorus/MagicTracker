import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  CARD_CONDITIONS,
  CARD_FINISHES,
  LOCATION_KINDS,
  type CardCondition,
  type CardFinish,
  type LocationKind,
} from "@/lib/collection/constants";

import { MAX_ENTRY_QUANTITY, formatPrintingLabel } from "./parse";

/**
 * Writes to the human-owned tables.
 *
 * Validation lives here rather than only in the UI, because these run from
 * server actions and a server action is a public HTTP endpoint: anything the
 * browser can call, anything else can call with whatever body it likes. Every
 * value that reaches a column is checked against the column's own domain
 * first, and the CHECK constraints in the schema are the backstop for
 * whatever this misses.
 */

export type MutationError = { ok: false; error: string };
export type AddResult =
  | {
      ok: true;
      itemId: string;
      /** The quantity of the row after the add, not the amount added. */
      quantity: number;
      added: number;
      label: string;
    }
  | MutationError;

function isFinish(value: string): value is CardFinish {
  return (CARD_FINISHES as readonly string[]).includes(value);
}

function isCondition(value: string): value is CardCondition {
  return (CARD_CONDITIONS as readonly string[]).includes(value);
}

function isLocationKind(value: string): value is LocationKind {
  return (LOCATION_KINDS as readonly string[]).includes(value);
}

/** Postgres rejects a malformed uuid with a 22P02 rather than an empty
 *  result, so ids are shape-checked before they reach a cast. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AddCopiesInput = {
  printingId: string;
  finish: string;
  condition: string;
  locationId: string;
  quantity: number;
  acquiredPriceCents?: number | null;
  notes?: string | null;
};

/**
 * Adds copies, merging into an existing row when one matches.
 *
 * The upsert is the whole reason `collection_items` has that unique key:
 * entering the same card twice means quantity 2, not two rows that later
 * disagree about where the card is.
 *
 * `acquired_price_cents` is set only when the row is created and is never
 * overwritten by a merge — once two purchases at different prices are one
 * quantity, no single price is true, and Phase 7 compares this against market
 * value where a confidently wrong number is worse than a null.
 */
export async function addCopies(input: AddCopiesInput): Promise<AddResult> {
  const { printingId, finish, condition, locationId } = input;

  if (!UUID_RE.test(printingId)) return { ok: false, error: "Unknown printing." };
  if (!UUID_RE.test(locationId)) return { ok: false, error: "Unknown location." };
  if (!isFinish(finish)) return { ok: false, error: `Invalid finish "${finish}".` };
  if (!isCondition(condition)) {
    return { ok: false, error: `Invalid condition "${condition}".` };
  }

  const quantity = Math.trunc(input.quantity);
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    return { ok: false, error: "Quantity must be at least 1." };
  }
  if (quantity > MAX_ENTRY_QUANTITY) {
    return { ok: false, error: `Quantity cannot exceed ${MAX_ENTRY_QUANTITY}.` };
  }

  const price = input.acquiredPriceCents;
  if (price !== undefined && price !== null) {
    if (!Number.isSafeInteger(price) || price < 0) {
      return { ok: false, error: "Price must be a whole number of cents." };
    }
  }

  const db = getDb();

  // The printing has to exist, and the finish has to be one this printing was
  // actually made in: there is no foil version of a nonfoil-only card, and
  // storing one would quietly corrupt every later count of foils.
  const { rows: printingRows } = await db.execute<{
    name: string;
    set_code: string;
    collector_number: string;
    finishes: string[] | null;
  }>(sql`
    SELECT name, set_code, collector_number, finishes
      FROM printings
     WHERE scryfall_id = ${printingId}::uuid
  `);

  const printing = printingRows[0];
  if (!printing) return { ok: false, error: "Unknown printing." };

  const available = printing.finishes ?? [];
  if (available.length > 0 && !available.includes(finish)) {
    return {
      ok: false,
      error: `${printing.name} was not printed in ${finish} — only ${available.join(", ")}.`,
    };
  }

  try {
    const { rows } = await db.execute<{ id: string; quantity: number }>(sql`
      INSERT INTO collection_items
        (printing_id, finish, condition, location_id, quantity,
         acquired_price_cents, notes)
      VALUES
        (${printingId}::uuid, ${finish}, ${condition}, ${locationId}::uuid,
         ${quantity}, ${price ?? null}, ${input.notes ?? null})
      ON CONFLICT (printing_id, finish, condition, location_id) DO UPDATE
        SET quantity   = collection_items.quantity + EXCLUDED.quantity,
            updated_at = now()
      RETURNING id::text AS id, quantity
    `);

    const row = rows[0];
    if (!row) return { ok: false, error: "The add did not take effect." };

    return {
      ok: true,
      itemId: row.id,
      quantity: row.quantity,
      added: quantity,
      label: formatPrintingLabel({
        name: printing.name,
        setCode: printing.set_code,
        collectorNumber: printing.collector_number,
      }),
    };
  } catch (error) {
    return { ok: false, error: describeDbError(error, "add those copies") };
  }
}

export type AdjustResult =
  | { ok: true; quantity: number; deleted: boolean }
  | MutationError;

/**
 * Moves one row's quantity by a delta, deleting it when it reaches zero.
 *
 * Done in a single statement rather than read-then-write so that two
 * concurrent adjustments cannot both read 1 and both write 0. The CHECK
 * constraint forbids a stored zero, so the delete is not optional.
 */
export async function adjustQuantity(
  itemId: string,
  delta: number,
): Promise<AdjustResult> {
  if (!UUID_RE.test(itemId)) return { ok: false, error: "Unknown item." };

  const step = Math.trunc(delta);
  if (!Number.isSafeInteger(step) || step === 0) {
    return { ok: false, error: "Adjustment must be a non-zero whole number." };
  }
  if (Math.abs(step) > MAX_ENTRY_QUANTITY) {
    return { ok: false, error: "Adjustment is too large." };
  }

  const db = getDb();

  try {
    const { rows } = await db.execute<{ quantity: number }>(sql`
      WITH updated AS (
        UPDATE collection_items
           SET quantity   = LEAST(quantity + ${step}, ${MAX_ENTRY_QUANTITY}),
               updated_at = now()
         WHERE id = ${itemId}::uuid
           AND quantity + ${step} > 0
        RETURNING quantity
      ),
      removed AS (
        DELETE FROM collection_items
         WHERE id = ${itemId}::uuid
           AND quantity + ${step} <= 0
        RETURNING 0 AS quantity
      )
      SELECT quantity FROM updated
      UNION ALL
      SELECT quantity FROM removed
    `);

    const row = rows[0];
    if (!row) return { ok: false, error: "That item no longer exists." };

    return { ok: true, quantity: row.quantity, deleted: row.quantity === 0 };
  } catch (error) {
    return { ok: false, error: describeDbError(error, "change that quantity") };
  }
}

export async function removeItem(itemId: string): Promise<AdjustResult> {
  if (!UUID_RE.test(itemId)) return { ok: false, error: "Unknown item." };

  const db = getDb();
  try {
    const { rows } = await db.execute<{ id: string }>(sql`
      DELETE FROM collection_items
       WHERE id = ${itemId}::uuid
      RETURNING id::text AS id
    `);
    if (rows.length === 0) {
      return { ok: false, error: "That item no longer exists." };
    }
    return { ok: true, quantity: 0, deleted: true };
  } catch (error) {
    return { ok: false, error: describeDbError(error, "remove that item") };
  }
}

export type MoveResult = { ok: true } | MutationError;

/**
 * Moves a row to another location, merging if the destination already holds
 * the same printing in the same finish and condition.
 *
 * The merge is why this is not a bare UPDATE: changing location_id into a
 * combination that already exists would violate the unique key and fail,
 * which is a confusing way to be told "you already have one of those there".
 */
export async function moveItem(
  itemId: string,
  locationId: string,
): Promise<MoveResult> {
  if (!UUID_RE.test(itemId)) return { ok: false, error: "Unknown item." };
  if (!UUID_RE.test(locationId)) {
    return { ok: false, error: "Unknown location." };
  }

  const db = getDb();

  try {
    const { rows } = await db.execute<{ moved: number }>(sql`
      WITH source AS (
        SELECT * FROM collection_items WHERE id = ${itemId}::uuid
      ),
      merged AS (
        UPDATE collection_items t
           SET quantity   = t.quantity + source.quantity,
               updated_at = now()
          FROM source
         WHERE t.printing_id = source.printing_id
           AND t.finish      = source.finish
           AND t.condition   = source.condition
           AND t.location_id = ${locationId}::uuid
           AND t.id <> source.id
        RETURNING t.id
      ),
      dropped AS (
        DELETE FROM collection_items
         WHERE id = ${itemId}::uuid
           AND EXISTS (SELECT 1 FROM merged)
        RETURNING id
      ),
      relocated AS (
        UPDATE collection_items
           SET location_id = ${locationId}::uuid,
               updated_at  = now()
         WHERE id = ${itemId}::uuid
           AND NOT EXISTS (SELECT 1 FROM merged)
        RETURNING id
      )
      SELECT (
        (SELECT count(*) FROM dropped) + (SELECT count(*) FROM relocated)
      )::int AS moved
    `);

    if ((rows[0]?.moved ?? 0) === 0) {
      return { ok: false, error: "That item no longer exists." };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeDbError(error, "move that item") };
  }
}

/** How many rows one bulk action may touch, so a bad request stays cheap. */
export const MAX_BULK_ITEMS = 500;

export type BulkResult = { ok: true; affected: number } | MutationError;

/**
 * Validates a list of item ids arriving from a server action.
 *
 * Deduplicated, because the same id twice in a move would merge a row with
 * itself and double-count the report.
 */
function checkItemIds(
  itemIds: unknown,
): { ok: true; ids: string[] } | MutationError {
  if (!Array.isArray(itemIds) || itemIds.length === 0) {
    return { ok: false, error: "Nothing selected." };
  }
  if (itemIds.length > MAX_BULK_ITEMS) {
    return {
      ok: false,
      error: `That is more than ${MAX_BULK_ITEMS} rows at once.`,
    };
  }
  const ids = [...new Set(itemIds)];
  for (const id of ids) {
    if (typeof id !== "string" || !UUID_RE.test(id)) {
      return { ok: false, error: "Unknown item." };
    }
  }
  return { ok: true, ids: ids as string[] };
}

/**
 * Moves many rows to one location in a single statement.
 *
 * Not a loop over `moveItem`: re-filing a binder is a hundred rows, and a
 * hundred round trips can half-fail and leave the collection in a state
 * nobody asked for. One statement either moves them all or moves none.
 *
 * The merge case is the reason this is not a plain UPDATE. Moving a row into
 * a location that already holds the same printing in the same finish and
 * condition has to *add* to that row, because the unique index forbids two —
 * so the move is "fold into the existing row and delete this one", and only
 * the rows with nothing to fold into are relocated in place.
 */
export async function moveItems(
  itemIds: string[],
  locationId: string,
): Promise<BulkResult> {
  const checked = checkItemIds(itemIds);
  if (!checked.ok) return checked;
  if (!UUID_RE.test(locationId)) {
    return { ok: false, error: "Unknown location." };
  }

  const db = getDb();
  try {
    const { rows } = await db.execute<{ affected: number }>(sql`
      WITH source AS (
        SELECT * FROM collection_items
         WHERE id = ANY(${checked.ids}::uuid[])
           AND location_id <> ${locationId}::uuid
      ),
      /*
       * Sum first: two selected rows can be the same card in the same
       * finish heading for the same destination, and folding them one at a
       * time would lose one of them to the unique index.
       */
      folded AS (
        SELECT printing_id, finish, condition, sum(quantity)::int AS quantity
          FROM source
         GROUP BY printing_id, finish, condition
      ),
      merged AS (
        UPDATE collection_items t
           SET quantity   = t.quantity + folded.quantity,
               updated_at = now()
          FROM folded
         WHERE t.printing_id = folded.printing_id
           AND t.finish      = folded.finish
           AND t.condition   = folded.condition
           AND t.location_id = ${locationId}::uuid
        RETURNING t.printing_id, t.finish, t.condition
      ),
      dropped AS (
        DELETE FROM collection_items c
         USING merged m
         WHERE c.id IN (SELECT id FROM source)
           AND c.printing_id = m.printing_id
           AND c.finish      = m.finish
           AND c.condition   = m.condition
        RETURNING c.id
      ),
      relocated AS (
        UPDATE collection_items
           SET location_id = ${locationId}::uuid,
               updated_at  = now()
         WHERE id IN (SELECT id FROM source)
           AND id NOT IN (SELECT id FROM dropped)
        RETURNING id
      )
      SELECT (
        (SELECT count(*) FROM dropped) + (SELECT count(*) FROM relocated)
      )::int AS affected
    `);

    return { ok: true, affected: rows[0]?.affected ?? 0 };
  } catch (error) {
    return { ok: false, error: describeDbError(error, "move those cards") };
  }
}

/** Deletes many rows outright. Copies, not one each. */
export async function removeItems(itemIds: string[]): Promise<BulkResult> {
  const checked = checkItemIds(itemIds);
  if (!checked.ok) return checked;

  const db = getDb();
  try {
    const { rows } = await db.execute<{ affected: number }>(sql`
      WITH dropped AS (
        DELETE FROM collection_items
         WHERE id = ANY(${checked.ids}::uuid[])
        RETURNING id
      )
      SELECT count(*)::int AS affected FROM dropped
    `);

    return { ok: true, affected: rows[0]?.affected ?? 0 };
  } catch (error) {
    return { ok: false, error: describeDbError(error, "remove those cards") };
  }
}

export type LocationResult =
  | { ok: true; id: string; name: string }
  | MutationError;

export async function createLocation(
  name: string,
  kind: string,
): Promise<LocationResult> {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) {
    return { ok: false, error: "A location needs a name." };
  }
  if (trimmed.length > 80) {
    return { ok: false, error: "That name is too long (80 characters max)." };
  }
  if (!isLocationKind(kind)) {
    return { ok: false, error: `Invalid location kind "${kind}".` };
  }

  const db = getDb();
  try {
    const { rows } = await db.execute<{ id: string; name: string }>(sql`
      INSERT INTO locations (name, kind)
      VALUES (${trimmed}, ${kind})
      RETURNING id::text AS id, name
    `);
    const row = rows[0];
    if (!row) return { ok: false, error: "The location was not created." };
    return { ok: true, id: row.id, name: row.name };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: `You already have a location called "${trimmed}".` };
    }
    return { ok: false, error: describeDbError(error, "create that location") };
  }
}

export async function renameLocation(
  id: string,
  name: string,
): Promise<LocationResult> {
  if (!UUID_RE.test(id)) return { ok: false, error: "Unknown location." };

  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) {
    return { ok: false, error: "A location needs a name." };
  }
  if (trimmed.length > 80) {
    return { ok: false, error: "That name is too long (80 characters max)." };
  }

  const db = getDb();
  try {
    const { rows } = await db.execute<{ id: string; name: string }>(sql`
      UPDATE locations
         SET name = ${trimmed}
       WHERE id = ${id}::uuid
      RETURNING id::text AS id, name
    `);
    const row = rows[0];
    if (!row) return { ok: false, error: "That location no longer exists." };
    return { ok: true, id: row.id, name: row.name };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: `You already have a location called "${trimmed}".` };
    }
    return { ok: false, error: describeDbError(error, "rename that location") };
  }
}

/**
 * Deletes a location, but only an empty one.
 *
 * The foreign key is ON DELETE RESTRICT, so the database would refuse anyway;
 * checking first is what turns that into a sentence rather than a constraint
 * name. Deleting a location that still holds cards would mean either losing
 * the collection rows or silently moving them somewhere the user did not
 * choose, and neither is a reasonable reading of "delete this binder".
 */
export async function deleteLocation(id: string): Promise<MoveResult> {
  if (!UUID_RE.test(id)) return { ok: false, error: "Unknown location." };

  const db = getDb();

  try {
    const { rows } = await db.execute<{ card_count: number; name: string }>(sql`
      SELECT l.name,
             coalesce(sum(c.quantity), 0)::int AS card_count
        FROM locations l
        LEFT JOIN collection_items c ON c.location_id = l.id
       WHERE l.id = ${id}::uuid
       GROUP BY l.name
    `);

    const found = rows[0];
    if (!found) return { ok: false, error: "That location no longer exists." };
    if (found.card_count > 0) {
      return {
        ok: false,
        error: `"${found.name}" still holds ${found.card_count} card${found.card_count === 1 ? "" : "s"}. Move them somewhere else first.`,
      };
    }

    await db.execute(sql`DELETE FROM locations WHERE id = ${id}::uuid`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeDbError(error, "delete that location") };
  }
}

/**
 * Digs the SQLSTATE out of a thrown error.
 *
 * Drizzle does not rethrow the driver's error: it wraps it in a
 * DrizzleQueryError and hangs the real one off `.cause`. So the code is never
 * on the object you catch, and reading only the top level quietly turned
 * every expected constraint violation into the generic fallback message --
 * and logged the failing query and its parameters for what was really just a
 * duplicate name. Hence the walk down the cause chain.
 */
function pgCode(error: unknown): string | null {
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current !== null && current !== undefined; depth += 1) {
    if (typeof current !== "object") return null;

    if ("code" in current) {
      const code = (current as { code?: unknown }).code;
      // Postgres SQLSTATEs are five characters; Node's own error codes
      // (ECONNREFUSED, ERR_*) are not, and must not be read as one.
      if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    }

    current = (current as { cause?: unknown }).cause;
  }

  return null;
}

function isUniqueViolation(error: unknown): boolean {
  return pgCode(error) === "23505";
}

/**
 * Turns a driver error into something worth reading, without leaking a
 * connection string or a stack trace into the browser.
 */
function describeDbError(error: unknown, attempting: string): string {
  const code = pgCode(error);

  switch (code) {
    case "23505":
      return "You already have an entry like that.";
    case "23001":
      // ON DELETE RESTRICT, which is what guards the collection. deleteLocation
      // pre-checks the card count and gives a better message, so reaching here
      // means something was added in the gap between that check and the delete.
      return "Something still refers to that — it is in use and was not removed.";
    case "23503":
      return "That card or location no longer exists.";
    case "23514":
      return "That would leave an invalid value — the change was rejected.";
    default:
      console.error(`collection: failed to ${attempting}`, error);
      return `Could not ${attempting}. The error was logged.`;
  }
}
