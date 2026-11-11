import { sql, type SQL } from "drizzle-orm";

import {
  CARD_CONDITIONS,
  type CardCondition,
} from "@/lib/collection/constants";
import { MAX_ENTRY_QUANTITY } from "@/lib/collection/parse";
import { getDb } from "@/lib/db";

import { PRECON_BOARDS, isPreconFileName, type PreconBoard } from "./constants";
import { finishExpr } from "./queries";

/**
 * Putting a whole sealed product into the collection, and taking it back out.
 *
 * Both are a single SQL statement, which is the point of this file. A precon
 * is about a hundred lines; doing that as a hundred round trips would be slow,
 * and — far worse — a failure halfway would leave the collection holding half
 * a deck with no record of which half. One statement is atomic by definition,
 * so an add either happens completely or not at all.
 *
 * The same validation discipline as lib/collection/mutations.ts applies: these
 * run from server actions, a server action is a public HTTP endpoint, and
 * every value reaching a column is checked against that column's domain first.
 */

export type ProductMutationError = { ok: false; error: string };

export type AddProductResult =
  | {
      ok: true;
      /** Copies actually written. */
      copies: number;
      /** Distinct collection rows touched. */
      rows: number;
      /**
       * Lines that could not be added: MTGJSON has no Scryfall id for them,
       * or the printing is not in our card database yet. Reported rather than
       * swallowed, so a product that went in incomplete says so.
       */
      skipped: number;
      skippedNames: string[];
    }
  | ProductMutationError;

export type RemoveProductResult =
  { ok: true; copies: number; rows: number } | ProductMutationError;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isCondition(value: string): value is CardCondition {
  return (CARD_CONDITIONS as readonly string[]).includes(value);
}

function isBoard(value: string): value is PreconBoard {
  return (PRECON_BOARDS as readonly string[]).includes(value);
}

export type ProductAddInput = {
  fileName: string;
  locationId: string;
  condition: string;
  boards: string[];
};

type ValidInput = {
  fileName: string;
  locationId: string;
  condition: CardCondition;
  boards: PreconBoard[];
};

function validate(input: ProductAddInput): ValidInput | ProductMutationError {
  if (!isPreconFileName(input.fileName)) {
    return { ok: false, error: "Unknown product." };
  }
  if (!UUID_RE.test(input.locationId)) {
    return { ok: false, error: "Unknown location." };
  }
  if (!isCondition(input.condition)) {
    return { ok: false, error: `Invalid condition "${input.condition}".` };
  }

  // De-duplicated, because the board list arrives from a form and `main`
  // twice would double every copy in the deck.
  const boards = [...new Set(input.boards)];
  for (const board of boards) {
    if (!isBoard(board)) {
      return { ok: false, error: `Invalid board "${board}".` };
    }
  }
  if (boards.length === 0) {
    return { ok: false, error: "Pick at least one board to add." };
  }

  return {
    fileName: input.fileName,
    locationId: input.locationId,
    condition: input.condition,
    boards: boards as PreconBoard[],
  };
}

/**
 * The lines of a product that resolve to a real printing, with the finish an
 * added copy should land in and the quantity to add.
 *
 * Grouped by (printing, finish) so that the same card appearing on two
 * selected boards — a commander also listed in the main board, say — becomes
 * one row of the summed quantity rather than two inserts that would collide
 * on the unique key.
 */
function wantedCte(input: ValidInput): SQL {
  const boardList = sql.join(
    input.boards.map((b) => sql`${b}`),
    sql`, `,
  );

  return sql`
    wanted AS (
      SELECT printing_id,
             finish,
             LEAST(sum(quantity), ${MAX_ENTRY_QUANTITY})::int AS quantity
        FROM (
          SELECT pc.scryfall_id AS printing_id,
                 ${finishExpr}  AS finish,
                 pc.quantity
            FROM precon_cards pc
            JOIN printings p ON p.scryfall_id = pc.scryfall_id
           WHERE pc.file_name = ${input.fileName}
             AND pc.board IN (${boardList})
        ) lines
       -- Null means the printing records no finish this copy could be, so
       -- there is no row it could legally become.
       WHERE finish IS NOT NULL
       GROUP BY printing_id, finish
    )
  `;
}

/**
 * Adds every resolvable card of a product to one location, in one statement.
 *
 * `ON CONFLICT ... DO UPDATE` means adding the same precon twice gives you two
 * copies of each card, which is correct: that is what buying two boxes is.
 *
 * Quantities are capped at MAX_ENTRY_QUANTITY by the same LEAST() the manual
 * entry path uses, so a repeated add cannot push a row past what the rest of
 * the app will let you edit back down.
 */
export async function addProductToCollection(
  input: ProductAddInput,
): Promise<AddProductResult> {
  const valid = validate(input);
  if ("ok" in valid) return valid;

  const db = getDb();

  // The location has to exist before the insert, or the foreign key failure
  // would be reported as a generic database error rather than a sentence.
  const { rows: locationRows } = await db.execute<{ id: string }>(
    sql`SELECT id::text AS id FROM locations WHERE id = ${valid.locationId}::uuid`,
  );
  if (locationRows.length === 0) {
    return { ok: false, error: "That location no longer exists." };
  }

  const boardList = sql.join(
    valid.boards.map((b) => sql`${b}`),
    sql`, `,
  );

  try {
    const { rows } = await db.execute<{
      copies: number;
      rows: number;
      skipped: number;
      skipped_names: string[] | null;
    }>(sql`
      WITH ${wantedCte(valid)},
      inserted AS (
        INSERT INTO collection_items
          (printing_id, finish, condition, location_id, quantity)
        SELECT printing_id, finish, ${valid.condition},
               ${valid.locationId}::uuid, quantity
          FROM wanted
        ON CONFLICT (printing_id, finish, condition, location_id) DO UPDATE
          SET quantity   = LEAST(
                collection_items.quantity + EXCLUDED.quantity,
                ${MAX_ENTRY_QUANTITY}
              ),
              updated_at = now()
        RETURNING id
      ),
      /*
       * A line is skipped when MTGJSON gave no Scryfall id, or when the id is
       * for a printing we have not ingested. Both are the same thing to the
       * user — "this card did not go in" — and both are counted here rather
       * than inferred from the difference between two totals, which would
       * silently read zero if the add itself were wrong.
       */
      skipped AS (
        SELECT pc.card_name
          FROM precon_cards pc
          LEFT JOIN printings p ON p.scryfall_id = pc.scryfall_id
         WHERE pc.file_name = ${valid.fileName}
           AND pc.board IN (${boardList})
           AND (p.scryfall_id IS NULL OR ${finishExpr} IS NULL)
         GROUP BY pc.card_name
         ORDER BY pc.card_name
      )
      SELECT (SELECT coalesce(sum(quantity), 0) FROM wanted)::int AS copies,
             (SELECT count(*) FROM inserted)::int                 AS rows,
             (SELECT count(*) FROM skipped)::int                  AS skipped,
             (SELECT array_agg(card_name) FROM skipped)   AS skipped_names
    `);

    const result = rows[0];
    if (!result) return { ok: false, error: "The add did not take effect." };

    if (result.copies === 0 && result.skipped === 0) {
      return {
        ok: false,
        error:
          "This product has no card list loaded yet. Reload the page and " +
          "try again.",
      };
    }

    return {
      ok: true,
      copies: result.copies,
      rows: result.rows,
      skipped: result.skipped,
      // Capped: a product whose whole list failed to resolve should report a
      // readable sentence, not a hundred card names.
      skippedNames: (result.skipped_names ?? []).slice(0, 8),
    };
  } catch (error) {
    return { ok: false, error: describeDbError(error, "add that product") };
  }
}

/**
 * Takes a product's cards back out of one location — the undo for an add.
 *
 * Subtracts rather than deleting: if the precon's Sol Ring was already in that
 * box before the add, removing the product must leave the one that was always
 * there. Each row gives up at most what the product contributed
 * (`LEAST(c.quantity, w.quantity)`) and rows that reach zero are deleted,
 * because `collection_items` forbids a stored zero.
 *
 * It is honest rather than exact: a quantity edited between the add and the
 * undo means the undo takes what it can and reports the number of copies it
 * actually removed.
 */
export async function removeProductFromCollection(
  input: ProductAddInput,
): Promise<RemoveProductResult> {
  const valid = validate(input);
  if ("ok" in valid) return valid;

  const db = getDb();

  try {
    const { rows } = await db.execute<{ copies: number; rows: number }>(sql`
      WITH ${wantedCte(valid)},
      matched AS (
        SELECT c.id,
               LEAST(c.quantity, w.quantity) AS take,
               c.quantity AS held
          FROM collection_items c
          JOIN wanted w
            ON c.printing_id = w.printing_id
           AND c.finish      = w.finish
         WHERE c.condition   = ${valid.condition}
           AND c.location_id = ${valid.locationId}::uuid
      ),
      decremented AS (
        UPDATE collection_items c
           SET quantity   = c.quantity - m.take,
               updated_at = now()
          FROM matched m
         WHERE c.id = m.id
           AND m.held > m.take
        RETURNING m.take
      ),
      deleted AS (
        DELETE FROM collection_items c
         USING matched m
         WHERE c.id = m.id
           AND m.held <= m.take
        RETURNING m.take
      )
      SELECT (
               (SELECT coalesce(sum(take), 0) FROM decremented)
             + (SELECT coalesce(sum(take), 0) FROM deleted)
             )::int AS copies,
             (
               (SELECT count(*) FROM decremented)
             + (SELECT count(*) FROM deleted)
             )::int AS rows
    `);

    const result = rows[0];
    if (!result)
      return { ok: false, error: "The removal did not take effect." };

    return { ok: true, copies: result.copies, rows: result.rows };
  } catch (error) {
    return { ok: false, error: describeDbError(error, "remove that product") };
  }
}

/**
 * Digs the SQLSTATE out of a thrown error.
 *
 * Drizzle wraps the driver's error in a DrizzleQueryError and hangs the real
 * one off `.cause`, so the code is never on the object you catch. Reading only
 * the top level turns every expected constraint violation into the generic
 * fallback and logs the failing query and its parameters for what was really
 * just a duplicate. Same walk as lib/collection/mutations.ts.
 */
function pgCode(error: unknown): string | null {
  let current: unknown = error;

  for (
    let depth = 0;
    depth < 5 && current !== null && current !== undefined;
    depth += 1
  ) {
    if (typeof current !== "object") return null;

    if ("code" in current) {
      const code = (current as { code?: unknown }).code;
      if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    }

    current = (current as { cause?: unknown }).cause;
  }

  return null;
}

function describeDbError(error: unknown, attempting: string): string {
  switch (pgCode(error)) {
    case "23503":
      return "That location no longer exists.";
    case "23505":
      return "Those cards are already recorded that way.";
    case "23514":
      return "That would leave an invalid quantity — the change was rejected.";
    default:
      console.error(`products: failed to ${attempting}`, error);
      return `Could not ${attempting}. The error was logged.`;
  }
}
