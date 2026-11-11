import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";

import {
  DECK_BOARDS,
  MAX_DECK_CARD_QUANTITY,
  MAX_DECK_NAME_LENGTH,
  type DeckBoard,
} from "./constants";

/**
 * Writes to the deck tables.
 *
 * Same discipline as lib/collection/mutations.ts: these run from server
 * actions, a server action is a public HTTP endpoint, and every value that
 * reaches a column is checked against that column's own domain here rather
 * than only in the UI. The CHECK constraints are the backstop.
 */

export type DeckError = { ok: false; error: string };
export type DeckOk = { ok: true };
export type DeckResult = DeckOk | DeckError;
export type DeckCreated = { ok: true; id: string; name: string } | DeckError;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isBoard(value: string): value is DeckBoard {
  return (DECK_BOARDS as readonly string[]).includes(value);
}

/** Exported so lib/import/mutations.ts validates a deck name the one way. */
export function cleanDeckName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function checkDeckName(name: string): string | null {
  if (name.length === 0) return "A deck needs a name.";
  if (name.length > MAX_DECK_NAME_LENGTH) {
    return `That name is too long (${MAX_DECK_NAME_LENGTH} characters max).`;
  }
  return null;
}

/** Marks the deck changed, so the list can order by recency. */
function touch(deckId: string) {
  return sql`UPDATE decks SET updated_at = now() WHERE id = ${deckId}::uuid`;
}

export async function createDeck(
  name: string,
  notes?: string | null,
): Promise<DeckCreated> {
  const trimmed = cleanDeckName(name);
  const nameError = checkDeckName(trimmed);
  if (nameError) return { ok: false, error: nameError };

  const db = getDb();
  try {
    const { rows } = await db.execute<{ id: string; name: string }>(sql`
      INSERT INTO decks (name, notes)
      VALUES (${trimmed}, ${notes ?? null})
      RETURNING id::text AS id, name
    `);
    const row = rows[0];
    if (!row) return { ok: false, error: "The deck was not created." };
    return { ok: true, id: row.id, name: row.name };
  } catch (error) {
    if (pgCode(error) === "23505") {
      return {
        ok: false,
        error: `You already have a deck called "${trimmed}".`,
      };
    }
    return { ok: false, error: describeDbError(error, "create that deck") };
  }
}

export async function renameDeck(
  deckId: string,
  name: string,
): Promise<DeckResult> {
  if (!UUID_RE.test(deckId)) return { ok: false, error: "Unknown deck." };

  const trimmed = cleanDeckName(name);
  const nameError = checkDeckName(trimmed);
  if (nameError) return { ok: false, error: nameError };

  const db = getDb();
  try {
    const { rows } = await db.execute<{ id: string }>(sql`
      UPDATE decks SET name = ${trimmed}, updated_at = now()
       WHERE id = ${deckId}::uuid
      RETURNING id::text AS id
    `);
    if (rows.length === 0) {
      return { ok: false, error: "That deck no longer exists." };
    }
    return { ok: true };
  } catch (error) {
    if (pgCode(error) === "23505") {
      return {
        ok: false,
        error: `You already have a deck called "${trimmed}".`,
      };
    }
    return { ok: false, error: describeDbError(error, "rename that deck") };
  }
}

export async function setDeckNotes(
  deckId: string,
  notes: string,
): Promise<DeckResult> {
  if (!UUID_RE.test(deckId)) return { ok: false, error: "Unknown deck." };
  if (notes.length > 4000) {
    return { ok: false, error: "Those notes are too long (4000 max)." };
  }

  const db = getDb();
  try {
    await db.execute(sql`
      UPDATE decks
         SET notes = ${notes.length > 0 ? notes : null}, updated_at = now()
       WHERE id = ${deckId}::uuid
    `);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeDbError(error, "save those notes") };
  }
}

/**
 * Deletes a deck and its card list.
 *
 * Unlike a location, a deck does not refuse to be deleted when it holds
 * cards — the cards are rows in `deck_cards`, not physical copies, and
 * `collection_items` is untouched by this. Allocation claims disappear with
 * the rows, which is correct: an unbuilt deck claims nothing.
 */
export async function deleteDeck(deckId: string): Promise<DeckResult> {
  if (!UUID_RE.test(deckId)) return { ok: false, error: "Unknown deck." };

  const db = getDb();
  try {
    const { rows } = await db.execute<{ id: string }>(sql`
      DELETE FROM decks WHERE id = ${deckId}::uuid RETURNING id::text AS id
    `);
    if (rows.length === 0) {
      return { ok: false, error: "That deck no longer exists." };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeDbError(error, "delete that deck") };
  }
}

export async function setDeckLocation(
  deckId: string,
  locationId: string | null,
): Promise<DeckResult> {
  if (!UUID_RE.test(deckId)) return { ok: false, error: "Unknown deck." };
  if (locationId !== null && !UUID_RE.test(locationId)) {
    return { ok: false, error: "Unknown location." };
  }

  const db = getDb();
  try {
    const { rows } = await db.execute<{ id: string }>(sql`
      UPDATE decks
         SET location_id = ${locationId}::uuid, updated_at = now()
       WHERE id = ${deckId}::uuid
      RETURNING id::text AS id
    `);
    if (rows.length === 0) {
      return { ok: false, error: "That deck no longer exists." };
    }
    return { ok: true };
  } catch (error) {
    if (pgCode(error) === "23503") {
      return { ok: false, error: "That location no longer exists." };
    }
    return {
      ok: false,
      error: describeDbError(error, "set the deck's location"),
    };
  }
}

export type AddDeckCardInput = {
  deckId: string;
  oracleId: string;
  board?: string;
  quantity?: number;
  printingId?: string | null;
};

/**
 * Adds a card to a deck, or adds to its quantity if it is already on that
 * board.
 *
 * Nothing here enforces singleton. That is deliberate: the rules engine
 * reports an illegal deck rather than refusing to hold one, because a deck
 * mid-edit is illegal almost all of the time — it is 40 cards with no
 * commander — and a tool that refused every intermediate state would be
 * unusable. The legality panel is the verdict; this is just storage.
 */
export async function addDeckCard(
  input: AddDeckCardInput,
): Promise<DeckResult> {
  const { deckId, oracleId } = input;

  if (!UUID_RE.test(deckId)) return { ok: false, error: "Unknown deck." };
  if (!UUID_RE.test(oracleId)) return { ok: false, error: "Unknown card." };

  const board = input.board ?? "main";
  if (!isBoard(board)) return { ok: false, error: `Invalid board "${board}".` };

  const printingId = input.printingId ?? null;
  if (printingId !== null && !UUID_RE.test(printingId)) {
    return { ok: false, error: "Unknown printing." };
  }

  const quantity = Math.trunc(input.quantity ?? 1);
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    return { ok: false, error: "Quantity must be at least 1." };
  }
  if (quantity > MAX_DECK_CARD_QUANTITY) {
    return {
      ok: false,
      error: `Quantity cannot exceed ${MAX_DECK_CARD_QUANTITY}.`,
    };
  }

  const db = getDb();
  try {
    const { rows } = await db.execute<{ id: string }>(sql`
      INSERT INTO deck_cards (deck_id, oracle_id, board, quantity, printing_id)
      VALUES (${deckId}::uuid, ${oracleId}::uuid, ${board}, ${quantity},
              ${printingId}::uuid)
      ON CONFLICT (deck_id, board, oracle_id) DO UPDATE
        SET quantity = LEAST(
              deck_cards.quantity + EXCLUDED.quantity,
              ${MAX_DECK_CARD_QUANTITY}
            ),
            -- A pinned printing is only set, never cleared by a later add
            -- that did not name one.
            printing_id = coalesce(EXCLUDED.printing_id, deck_cards.printing_id)
      RETURNING id::text AS id
    `);

    if (rows.length === 0) {
      return { ok: false, error: "The card was not added." };
    }

    await db.execute(touch(deckId));
    return { ok: true };
  } catch (error) {
    if (pgCode(error) === "23503") {
      return {
        ok: false,
        error: "That deck or card no longer exists.",
      };
    }
    return { ok: false, error: describeDbError(error, "add that card") };
  }
}

/**
 * Moves a card's quantity by a delta, deleting the row at zero.
 *
 * One statement, like the collection's version, so two concurrent decrements
 * cannot both read 1 and both write 0 — and because the CHECK forbids a
 * stored zero, the delete is not optional.
 */
export async function adjustDeckCard(
  deckCardId: string,
  delta: number,
): Promise<{ ok: true; quantity: number; deleted: boolean } | DeckError> {
  if (!UUID_RE.test(deckCardId)) return { ok: false, error: "Unknown card." };

  const step = Math.trunc(delta);
  if (!Number.isSafeInteger(step) || step === 0) {
    return { ok: false, error: "Adjustment must be a non-zero whole number." };
  }
  if (Math.abs(step) > MAX_DECK_CARD_QUANTITY) {
    return { ok: false, error: "Adjustment is too large." };
  }

  const db = getDb();
  try {
    const { rows } = await db.execute<{
      quantity: number;
      deck_id: string;
    }>(sql`
      WITH updated AS (
        UPDATE deck_cards
           SET quantity = LEAST(quantity + ${step}, ${MAX_DECK_CARD_QUANTITY})
         WHERE id = ${deckCardId}::uuid
           AND quantity + ${step} > 0
        RETURNING quantity, deck_id
      ),
      removed AS (
        DELETE FROM deck_cards
         WHERE id = ${deckCardId}::uuid
           AND quantity + ${step} <= 0
        RETURNING 0 AS quantity, deck_id
      )
      SELECT quantity, deck_id::text AS deck_id FROM updated
      UNION ALL
      SELECT quantity, deck_id::text AS deck_id FROM removed
    `);

    const row = rows[0];
    if (!row)
      return { ok: false, error: "That card is no longer in the deck." };

    await db.execute(touch(row.deck_id));
    return { ok: true, quantity: row.quantity, deleted: row.quantity === 0 };
  } catch (error) {
    return { ok: false, error: describeDbError(error, "change that quantity") };
  }
}

export async function removeDeckCard(deckCardId: string): Promise<DeckResult> {
  if (!UUID_RE.test(deckCardId)) return { ok: false, error: "Unknown card." };

  const db = getDb();
  try {
    const { rows } = await db.execute<{ deck_id: string }>(sql`
      DELETE FROM deck_cards WHERE id = ${deckCardId}::uuid
      RETURNING deck_id::text AS deck_id
    `);
    if (rows.length === 0) {
      return { ok: false, error: "That card is no longer in the deck." };
    }
    await db.execute(touch(rows[0].deck_id));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeDbError(error, "remove that card") };
  }
}

/**
 * Moves a card between boards — which is how a card becomes the commander.
 *
 * Merges rather than failing when the destination board already holds that
 * card, for the same reason `moveItem` merges in the collection: colliding
 * with a unique key is a confusing way to be told "it is already there".
 */
export async function setDeckCardBoard(
  deckCardId: string,
  board: string,
): Promise<DeckResult> {
  if (!UUID_RE.test(deckCardId)) return { ok: false, error: "Unknown card." };
  if (!isBoard(board)) return { ok: false, error: `Invalid board "${board}".` };

  const db = getDb();
  try {
    const { rows } = await db.execute<{ moved: number; deck_id: string }>(sql`
      WITH source AS (
        SELECT * FROM deck_cards WHERE id = ${deckCardId}::uuid
      ),
      merged AS (
        UPDATE deck_cards t
           SET quantity = LEAST(
                 t.quantity + source.quantity,
                 ${MAX_DECK_CARD_QUANTITY}
               )
          FROM source
         WHERE t.deck_id   = source.deck_id
           AND t.oracle_id = source.oracle_id
           AND t.board     = ${board}
           AND t.id <> source.id
        RETURNING t.id
      ),
      dropped AS (
        DELETE FROM deck_cards
         WHERE id = ${deckCardId}::uuid
           AND EXISTS (SELECT 1 FROM merged)
        RETURNING id
      ),
      moved AS (
        UPDATE deck_cards
           SET board = ${board}
         WHERE id = ${deckCardId}::uuid
           AND NOT EXISTS (SELECT 1 FROM merged)
        RETURNING id
      )
      SELECT (
               (SELECT count(*) FROM dropped) + (SELECT count(*) FROM moved)
             )::int AS moved,
             (SELECT deck_id::text FROM source) AS deck_id
    `);

    const row = rows[0];
    if (!row || row.moved === 0) {
      return { ok: false, error: "That card is no longer in the deck." };
    }

    await db.execute(touch(row.deck_id));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeDbError(error, "move that card") };
  }
}

/**
 * Claims, or releases, the physical copies for a whole deck.
 *
 * Claiming only ever marks cards the collection can actually supply — a card
 * you do not own cannot be sitting in the deck box, and marking it allocated
 * would subtract a copy that does not exist from every other deck's
 * availability. So this allocates what is available and reports the rest as
 * still missing.
 *
 * Nothing in `collection_items` moves; see the note on `deck_cards`.
 */
export async function setDeckAllocation(
  deckId: string,
  allocated: boolean,
): Promise<{ ok: true; cards: number; skipped: number } | DeckError> {
  if (!UUID_RE.test(deckId)) return { ok: false, error: "Unknown deck." };

  const db = getDb();

  try {
    if (!allocated) {
      const { rows } = await db.execute<{ n: number }>(sql`
        WITH released AS (
          UPDATE deck_cards SET is_allocated = false
           WHERE deck_id = ${deckId}::uuid AND is_allocated
          RETURNING id
        )
        SELECT count(*)::int AS n FROM released
      `);
      await db.execute(touch(deckId));
      return { ok: true, cards: rows[0]?.n ?? 0, skipped: 0 };
    }

    const { rows } = await db.execute<{ claimed: number; skipped: number }>(sql`
      WITH candidate AS (
        SELECT dc.id,
               dc.quantity,
               GREATEST(
                 coalesce((
                   SELECT sum(c.quantity) FROM collection_items c
                     JOIN printings p ON p.scryfall_id = c.printing_id
                    WHERE p.oracle_id = dc.oracle_id
                 ), 0)
                 - coalesce((
                   SELECT sum(other.quantity) FROM deck_cards other
                    WHERE other.oracle_id = dc.oracle_id
                      AND other.is_allocated
                      AND other.board <> 'maybe'
                      AND other.deck_id <> ${deckId}::uuid
                 ), 0),
                 0
               ) AS available
          FROM deck_cards dc
         WHERE dc.deck_id = ${deckId}::uuid
           AND dc.board <> 'maybe'
      ),
      claimed AS (
        UPDATE deck_cards SET is_allocated = true
          FROM candidate
         WHERE deck_cards.id = candidate.id
           AND candidate.available >= candidate.quantity
           AND NOT deck_cards.is_allocated
        RETURNING deck_cards.id
      )
      SELECT (SELECT count(*) FROM claimed)::int AS claimed,
             (SELECT count(*) FROM candidate
               WHERE candidate.available < candidate.quantity)::int AS skipped
    `);

    const row = rows[0];
    await db.execute(touch(deckId));
    return {
      ok: true,
      cards: row?.claimed ?? 0,
      skipped: row?.skipped ?? 0,
    };
  } catch (error) {
    return {
      ok: false,
      error: describeDbError(error, "change the deck's allocation"),
    };
  }
}

/**
 * Creates a deck from a precon, copying its commander and main board.
 *
 * This is the half of Phase 4 that PLAN.md scheduled here, because it needs
 * these tables. The copy is by `oracle_id` with the precon's printing pinned
 * as `printing_id`, so the deck knows both which card it wants and which
 * printing the box shipped.
 *
 * One statement for the cards, so a product that half-copies cannot happen.
 * The maybeboard, tokens, planes and schemes are left out: they are in the
 * box but they are not the deck.
 */
export async function createDeckFromProduct(
  fileName: string,
  name: string,
  locationId: string | null,
): Promise<DeckCreated> {
  const trimmed = cleanDeckName(name);
  const nameError = checkDeckName(trimmed);
  if (nameError) return { ok: false, error: nameError };

  if (locationId !== null && !UUID_RE.test(locationId)) {
    return { ok: false, error: "Unknown location." };
  }

  const db = getDb();

  const { rows: productRows } = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM precon_cards
     WHERE file_name = ${fileName} AND board IN ('commander', 'main')
  `);
  if ((productRows[0]?.n ?? 0) === 0) {
    return {
      ok: false,
      error:
        "That product has no card list loaded yet. Open the product page " +
        "first so its contents are fetched.",
    };
  }

  try {
    return await db.transaction(async (tx) => {
      const { rows: deckRows } = await tx.execute<{
        id: string;
        name: string;
      }>(sql`
        INSERT INTO decks (name, location_id)
        VALUES (${trimmed}, ${locationId}::uuid)
        RETURNING id::text AS id, name
      `);

      const deck = deckRows[0];

      /*
       * Grouped by oracle id, not copied row for row. A precon can ship two
       * printings of the same card — a foil and a nonfoil commander, or two
       * basics from different frames — and `deck_cards` is keyed on
       * (deck, board, oracle_id), so two rows would collide. `min(...)`
       * picks one printing to pin, arbitrarily but deterministically.
       */
      await tx.execute(sql`
        INSERT INTO deck_cards (deck_id, oracle_id, board, quantity, printing_id)
        SELECT ${deck.id}::uuid,
               p.oracle_id,
               pc.board,
               LEAST(sum(pc.quantity), ${MAX_DECK_CARD_QUANTITY})::int,
               -- Cast through text: Postgres has no min() for uuid, so
               -- min(scryfall_id) raises 42883 ("no function matches").
               min(pc.scryfall_id::text)::uuid
          FROM precon_cards pc
          JOIN printings p ON p.scryfall_id = pc.scryfall_id
         WHERE pc.file_name = ${fileName}
           AND pc.board IN ('commander', 'main')
         GROUP BY p.oracle_id, pc.board
      `);

      return { ok: true as const, id: deck.id, name: deck.name };
    });
  } catch (error) {
    if (pgCode(error) === "23505") {
      return {
        ok: false,
        error: `You already have a deck called "${trimmed}".`,
      };
    }
    return {
      ok: false,
      error: describeDbError(error, "create a deck from that product"),
    };
  }
}

/**
 * Digs the SQLSTATE out of a thrown error.
 *
 * Drizzle wraps the driver's error in a DrizzleQueryError and hangs the real
 * one off `.cause`, so the code is never on the object you catch. Same walk
 * as lib/collection/mutations.ts.
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
    case "23505":
      return "There is already an entry like that.";
    case "23001":
      return "Something still refers to that — it is in use and was not removed.";
    case "23503":
      return "That deck, card or location no longer exists.";
    case "23514":
      return "That would leave an invalid value — the change was rejected.";
    default:
      console.error(`decks: failed to ${attempting}`, error);
      return `Could not ${attempting}. The error was logged.`;
  }
}
