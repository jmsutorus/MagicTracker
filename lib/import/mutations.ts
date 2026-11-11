import { sql, type SQL } from "drizzle-orm";

import {
  CARD_CONDITIONS,
  CARD_FINISHES,
  type CardCondition,
  type CardFinish,
} from "@/lib/collection/constants";
import { MAX_ENTRY_QUANTITY } from "@/lib/collection/parse";
import { getDb } from "@/lib/db";
import {
  DECK_BOARDS,
  MAX_DECK_CARD_QUANTITY,
  type DeckBoard,
} from "@/lib/decks/constants";
import {
  checkDeckName,
  checkDeckShape,
  cleanDeckName,
} from "@/lib/decks/mutations";

import { MAX_IMPORT_LINES } from "./constants";
import { DEFAULT_PRINTING_ORDER } from "./printing";

/**
 * Committing a reviewed import.
 *
 * What arrives here is the *reviewed* list — the cards the user accepted,
 * with their own picks for whatever was ambiguous — and not the pasted text.
 * Re-parsing the text at this point would throw away every choice they just
 * made, which is the one thing a review step must not do.
 *
 * It is still a public HTTP endpoint's payload, so nothing in it is trusted:
 * every id is shape-checked, every finish and condition is checked against
 * its column's domain, and the quantities are re-clamped. A printing the
 * client did not name is chosen here rather than accepted as null, by the
 * same ordering lib/import/resolve.ts previewed.
 *
 * Each destination is one statement, so a half-written import cannot happen —
 * the same rule as the precon add, and for the same reason: `collection_items`
 * is the irreplaceable table.
 */

export type ImportError = { ok: false; error: string };

export type ImportApplied =
  | {
      ok: true;
      /** Distinct rows written or merged into. */
      cards: number;
      /** Copies added. */
      copies: number;
      /** Set when the destination created a deck. */
      deckId: string | null;
      deckName: string | null;
    }
  | ImportError;

/** One accepted line, as the review screen holds it. */
export type ApplyLine = {
  oracleId: string;
  /** The printing the review showed. Null means "choose one for me". */
  printingId?: string | null;
  quantity: number;
  /** Only read by the collection destination. */
  finish?: string | null;
  condition?: string | null;
  /** commander | main | maybe. Only read by a deck destination. */
  board?: string | null;
};

export type ApplyTarget =
  | {
      kind: "collection";
      locationId: string;
      /** Used for any line whose paste did not state one. */
      defaultFinish: string;
      defaultCondition: string;
    }
  | { kind: "deck"; deckId: string }
  | {
      kind: "new-deck";
      name: string;
      /**
       * `commander` when unset, which is what the paste box defaulted to
       * before cubes existed. A cube arrives this way far more often than a
       * Commander deck does — a 360-card list is a paste, not an afternoon
       * of typing — so the destination carries the format rather than
       * leaving the deck to be created and then mislabelled.
       */
      format?: string | null;
      targetSize?: number | null;
    };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isFinish(value: string): value is CardFinish {
  return (CARD_FINISHES as readonly string[]).includes(value);
}

function isCondition(value: string): value is CardCondition {
  return (CARD_CONDITIONS as readonly string[]).includes(value);
}

function isBoard(value: string): value is DeckBoard {
  return (DECK_BOARDS as readonly string[]).includes(value);
}

type CleanLine = {
  oracleId: string;
  printingId: string | null;
  quantity: number;
  finish: CardFinish;
  condition: CardCondition;
  board: DeckBoard;
};

/**
 * Validates the payload, returning either clean lines or the first problem.
 *
 * Deliberately fails the whole import on one bad line rather than skipping
 * it. A partly-applied import is the worst outcome available: you cannot tell
 * what landed without comparing the list by hand, and running it again would
 * double everything that did.
 */
function validate(
  lines: ApplyLine[],
  target: ApplyTarget,
): { ok: true; lines: CleanLine[] } | ImportError {
  /*
   * Shape before content.
   *
   * A server action is a public HTTP endpoint with a generated name, and
   * TypeScript's parameter types are gone by the time one is called: a POST
   * with the wrong body reaches here as whatever it sent. Without these two
   * checks a string in place of the array iterates as characters, and a
   * missing target throws on `target.kind` — a 500 where an error message
   * belongs.
   */
  if (!Array.isArray(lines)) {
    return { ok: false, error: "That import payload is not a list of cards." };
  }
  if (
    target === null ||
    typeof target !== "object" ||
    !["collection", "deck", "new-deck"].includes(
      (target as { kind?: unknown }).kind as string,
    )
  ) {
    return { ok: false, error: "That is not a place cards can go." };
  }
  if (lines.length === 0) {
    return { ok: false, error: "Nothing to import." };
  }
  if (lines.length > MAX_IMPORT_LINES) {
    return {
      ok: false,
      error: `That is more than ${MAX_IMPORT_LINES.toLocaleString()} lines.`,
    };
  }

  const defaultFinish =
    target.kind === "collection" ? target.defaultFinish : "nonfoil";
  const defaultCondition =
    target.kind === "collection" ? target.defaultCondition : "NM";

  if (!isFinish(defaultFinish)) {
    return { ok: false, error: `Invalid finish "${defaultFinish}".` };
  }
  if (!isCondition(defaultCondition)) {
    return { ok: false, error: `Invalid condition "${defaultCondition}".` };
  }

  const maxQuantity =
    target.kind === "collection" ? MAX_ENTRY_QUANTITY : MAX_DECK_CARD_QUANTITY;

  const clean: CleanLine[] = [];

  for (const line of lines) {
    if (line === null || typeof line !== "object") {
      return { ok: false, error: "One of those lines is not a card." };
    }
    if (!UUID_RE.test(line.oracleId)) {
      return { ok: false, error: "One of those cards is not a card." };
    }

    const printingId = line.printingId ?? null;
    if (printingId !== null && !UUID_RE.test(printingId)) {
      return { ok: false, error: "One of those printings is not a printing." };
    }

    const quantity = Math.trunc(line.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      return { ok: false, error: "Every line needs a quantity of at least 1." };
    }

    const finish = line.finish ?? defaultFinish;
    if (!isFinish(finish)) {
      return { ok: false, error: `Invalid finish "${finish}".` };
    }

    const condition = line.condition ?? defaultCondition;
    if (!isCondition(condition)) {
      return { ok: false, error: `Invalid condition "${condition}".` };
    }

    const board = line.board ?? "main";
    if (!isBoard(board)) {
      return { ok: false, error: `Invalid board "${board}".` };
    }

    clean.push({
      oracleId: line.oracleId,
      printingId,
      // Clamped rather than rejected: the review showed this number, and
      // the per-row cap is the storage limit, not the user's mistake.
      quantity: Math.min(quantity, maxQuantity),
      finish,
      condition,
      board,
    });
  }

  return { ok: true, lines: clean };
}

/**
 * The default printing for a card, as a correlated subquery.
 *
 * Literally the same ordering lib/import/resolve.ts previewed — see
 * DEFAULT_PRINTING_ORDER — so what the review screen showed is what gets
 * written.
 */
const defaultPrinting = (oracleRef: SQL): SQL => sql`
  (SELECT p.scryfall_id
     FROM printings p
     JOIN sets s ON s.code = p.set_code
    WHERE p.oracle_id = ${oracleRef}
    ORDER BY ${DEFAULT_PRINTING_ORDER}
    LIMIT 1)
`;

/**
 * Checks every card can actually be stored, before anything is written.
 *
 * Without this the write would simply drop a line whose card has no printing
 * — MTGJSON can name a card days before Scryfall resolves it — and a silent
 * drop in an import of 300 cards is undetectable. Naming the card instead
 * costs one query.
 */
async function findUnstorable(lines: CleanLine[]): Promise<string[]> {
  const db = getDb();
  const oracleIds = [...new Set(lines.map((l) => l.oracleId))];

  const { rows } = await db.execute<{ name: string | null }>(sql`
    SELECT o.name
      FROM unnest(${pgArray(oracleIds)}) AS w(key)
      LEFT JOIN oracle_cards o ON o.oracle_id = w.key
     WHERE o.oracle_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM printings p WHERE p.oracle_id = w.key)
  `);

  return rows.map((r) => r.name ?? "an unknown card");
}

/** A literal Postgres uuid[] of bound parameters. See pgArray in
 *  lib/import/resolve.ts for why `${ids}::uuid[]` does not work. */
function pgArray(values: string[]): SQL {
  return sql`ARRAY[${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )}]::uuid[]`;
}

/** VALUES rows for the collection write. */
function collectionValues(lines: CleanLine[]): SQL {
  return sql.join(
    lines.map(
      (l) =>
        sql`(${l.oracleId}::uuid, ${l.printingId}::uuid, ${l.finish}::text, ${l.condition}::text, ${l.quantity}::int)`,
    ),
    sql`, `,
  );
}

/** VALUES rows for a deck write. */
function deckValues(lines: CleanLine[]): SQL {
  return sql.join(
    lines.map(
      (l) =>
        sql`(${l.oracleId}::uuid, ${l.printingId}::uuid, ${l.board}::text, ${l.quantity}::int)`,
    ),
    sql`, `,
  );
}

export async function applyImport(
  lines: ApplyLine[],
  target: ApplyTarget,
): Promise<ImportApplied> {
  const checked = validate(lines, target);
  if (!checked.ok) return checked;

  const unstorable = await findUnstorable(checked.lines);
  if (unstorable.length > 0) {
    const shown = unstorable.slice(0, 5).join(", ");
    const rest =
      unstorable.length > 5 ? ` and ${unstorable.length - 5} more` : "";
    return {
      ok: false,
      error:
        `No printing of ${shown}${rest} has been ingested yet, so there is ` +
        "nothing to store. Run the card ingest and try again.",
    };
  }

  try {
    switch (target.kind) {
      case "collection":
        return await applyToCollection(checked.lines, target.locationId);
      case "deck":
        return await applyToDeck(checked.lines, target.deckId, null);
      case "new-deck":
        return await applyToNewDeck(checked.lines, target.name, {
          format: target.format,
          targetSize: target.targetSize,
        });
    }
  } catch (error) {
    return { ok: false, error: describeDbError(error, "import those cards") };
  }
}

async function applyToCollection(
  lines: CleanLine[],
  locationId: string,
): Promise<ImportApplied> {
  if (!UUID_RE.test(locationId)) {
    return { ok: false, error: "Unknown location." };
  }

  const db = getDb();

  /*
   * One statement.
   *
   * `grouped` is not an optimisation: an INSERT ... ON CONFLICT DO UPDATE
   * whose VALUES contain the same conflict key twice fails outright
   * ("cannot affect row a second time"), and a pasted list repeats cards all
   * the time — basics split across sections, a card listed in two
   * categories. Summing them first is what makes the write possible at all,
   * and it has to happen in SQL rather than in JS because the finish each
   * line lands on is only known after the clamp below.
   */
  const { rows } = await db.execute<{ cards: number; copies: number }>(sql`
    WITH input(oracle_id, printing_id, finish, condition, quantity)
           AS (VALUES ${collectionValues(lines)}),
    chosen AS (
      SELECT coalesce(i.printing_id, ${defaultPrinting(sql`i.oracle_id`)})
               AS printing_id,
             i.finish, i.condition, i.quantity
        FROM input i
    ),
    clamped AS (
      /*
       * The finish has to be one this printing was actually made in. There is
       * no foil version of a nonfoil-only card, and storing one would corrupt
       * every later count of foils — the same clamp, and the same reason, as
       * finishExpr in lib/products/queries.ts.
       */
      SELECT c.printing_id,
             CASE
               WHEN c.finish = ANY(p.finishes)    THEN c.finish
               WHEN 'nonfoil' = ANY(p.finishes)   THEN 'nonfoil'
               ELSE p.finishes[1]
             END AS finish,
             c.condition,
             c.quantity
        FROM chosen c
        JOIN printings p ON p.scryfall_id = c.printing_id
    ),
    grouped AS (
      SELECT printing_id, finish, condition,
             LEAST(sum(quantity), ${MAX_ENTRY_QUANTITY})::int AS quantity
        FROM clamped
       WHERE finish IS NOT NULL
       GROUP BY printing_id, finish, condition
    ),
    written AS (
      INSERT INTO collection_items
        (printing_id, finish, condition, location_id, quantity)
      SELECT printing_id, finish, condition, ${locationId}::uuid, quantity
        FROM grouped
      ON CONFLICT (printing_id, finish, condition, location_id) DO UPDATE
        SET quantity = LEAST(
              collection_items.quantity + EXCLUDED.quantity,
              ${MAX_ENTRY_QUANTITY}
            ),
            updated_at = now()
      RETURNING id, quantity
    )
    SELECT (SELECT count(*) FROM written)::int AS cards,
           (SELECT coalesce(sum(quantity), 0) FROM grouped)::int AS copies
  `);

  return {
    ok: true,
    cards: rows[0]?.cards ?? 0,
    copies: rows[0]?.copies ?? 0,
    deckId: null,
    deckName: null,
  };
}

async function applyToDeck(
  lines: CleanLine[],
  deckId: string,
  deckName: string | null,
): Promise<ImportApplied> {
  if (!UUID_RE.test(deckId)) return { ok: false, error: "Unknown deck." };

  const db = getDb();

  const { rows: deckRows } = await db.execute<{ name: string }>(sql`
    SELECT name FROM decks WHERE id = ${deckId}::uuid
  `);
  if (deckRows.length === 0) return { ok: false, error: "Unknown deck." };

  const { rows } = await db.execute<{ cards: number; copies: number }>(
    deckInsert(lines, sql`${deckId}::uuid`),
  );

  await db.execute(
    sql`UPDATE decks SET updated_at = now() WHERE id = ${deckId}::uuid`,
  );

  return {
    ok: true,
    cards: rows[0]?.cards ?? 0,
    copies: rows[0]?.copies ?? 0,
    deckId,
    deckName: deckName ?? deckRows[0].name,
  };
}

async function applyToNewDeck(
  lines: CleanLine[],
  name: string,
  shapeInput: { format?: string | null; targetSize?: number | null },
): Promise<ImportApplied> {
  const trimmed = cleanDeckName(name);
  const nameError = checkDeckName(trimmed);
  if (nameError) return { ok: false, error: nameError };

  // The same check the deck form goes through, for the same reason: this is
  // a public endpoint's payload, not a typed call.
  const shape = checkDeckShape(shapeInput);
  if (!shape.ok) return { ok: false, error: shape.error };

  const db = getDb();

  // The deck and its cards together: an import that created an empty deck and
  // then failed would leave something to clean up by hand.
  return await db.transaction(async (tx) => {
    const { rows: deckRows } = await tx.execute<{ id: string; name: string }>(
      sql`
        INSERT INTO decks (name, format, target_size)
        VALUES (${trimmed}, ${shape.format}, ${shape.targetSize})
        RETURNING id::text AS id, name
      `,
    );

    const deck = deckRows[0];
    if (!deck) return { ok: false, error: "The deck was not created." };

    const { rows } = await tx.execute<{ cards: number; copies: number }>(
      deckInsert(lines, sql`${deck.id}::uuid`),
    );

    return {
      ok: true as const,
      cards: rows[0]?.cards ?? 0,
      copies: rows[0]?.copies ?? 0,
      deckId: deck.id,
      deckName: deck.name,
    };
  });
}

/**
 * The deck write, shared by both deck destinations.
 *
 * Grouped by (card, board) for the same reason the collection write is: the
 * unique key is (deck, board, oracle_id), and a list that names a card twice
 * on one board would otherwise abort the statement. `min(printing_id::text)`
 * picks one printing to pin — arbitrarily but deterministically — and casts
 * through text because Postgres has no `min()` for uuid (SQLSTATE 42883).
 */
function deckInsert(lines: CleanLine[], deckRef: SQL): SQL {
  return sql`
    WITH input(oracle_id, printing_id, board, quantity)
           AS (VALUES ${deckValues(lines)}),
    grouped AS (
      SELECT oracle_id, board,
             LEAST(sum(quantity), ${MAX_DECK_CARD_QUANTITY})::int AS quantity,
             min(printing_id::text)::uuid AS printing_id
        FROM input
       GROUP BY oracle_id, board
    ),
    written AS (
      INSERT INTO deck_cards (deck_id, oracle_id, board, quantity, printing_id)
      SELECT ${deckRef}, oracle_id, board, quantity, printing_id
        FROM grouped
      ON CONFLICT (deck_id, board, oracle_id) DO UPDATE
        SET quantity = LEAST(
              deck_cards.quantity + EXCLUDED.quantity,
              ${MAX_DECK_CARD_QUANTITY}
            ),
            printing_id = coalesce(EXCLUDED.printing_id, deck_cards.printing_id)
      RETURNING id
    )
    SELECT (SELECT count(*) FROM written)::int AS cards,
           (SELECT coalesce(sum(quantity), 0) FROM grouped)::int AS copies
  `;
}

/**
 * Digs the SQLSTATE out of a thrown error.
 *
 * Drizzle wraps the driver's error in a DrizzleQueryError and hangs the real
 * one off `.cause`, so the code is never on the object you catch. Same walk
 * as lib/collection/mutations.ts and lib/decks/mutations.ts.
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
      return "A deck by that name already exists.";
    case "23503":
      return "One of those cards, printings or locations no longer exists.";
    case "23514":
      return "That would store an invalid value — the import was rejected.";
    default:
      console.error(`import: failed to ${attempting}`, error);
      return `Could not ${attempting}. The error was logged.`;
  }
}
