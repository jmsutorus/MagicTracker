import { sql } from "drizzle-orm";

import {
  CARD_CONDITIONS,
  type CardCondition,
} from "@/lib/collection/constants";
import { createLocation, deleteLocation } from "@/lib/collection/mutations";
import { getDb } from "@/lib/db";
import { MAX_DECK_NAME_LENGTH } from "@/lib/decks/constants";
import {
  cleanDeckName,
  createDeckFromProduct,
  deleteDeck,
  setDeckAllocation,
} from "@/lib/decks/mutations";

import { PRECON_BOARDS, isPreconFileName, type PreconBoard } from "./constants";
import {
  addProductToCollection,
  removeProductFromCollection,
} from "./mutations";

/**
 * Opening a box, as one action.
 *
 * Adding a precon used to be four presses in three places: make a deck box,
 * add the cards to it, build the decklist, mark the deck built. Each step is
 * a real thing the app records, but a person who just bought a deck did not
 * do four things — they bought a deck. This module is the single call that
 * does all four, and the single call that takes all four back.
 *
 * It is not a transaction. The pieces it calls are each atomic, and two of
 * them (the location, the deck) have to commit before the next can reference
 * them. So instead it unwinds: if a later step fails, the earlier ones are
 * reversed before the error is returned, and the caller is left where it
 * started rather than holding half a precon.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Most people own one or two copies of a precon; 20 is far past generous. */
const MAX_NAME_ATTEMPTS = 20;

export type PreconError = { ok: false; error: string };

export type PreconAddInput = {
  fileName: string;
  /** An existing location, or null to file the box in a box of its own. */
  locationId: string | null;
  /** Name for that new box. Only read when `locationId` is null. */
  locationName: string;
  condition: string;
  boards: string[];
  /** Also build the decklist and claim the cards for it. */
  buildDeck: boolean;
  /** Name for that deck. Only read when `buildDeck`. */
  deckName: string;
};

/**
 * Everything the undo needs, handed back by the add.
 *
 * The client does not reassemble this from its own state: the add may have
 * created a location it did not ask for by name, or renamed the deck around
 * a collision, and an undo built from the form's values would miss both.
 */
export type PreconUndoToken = {
  fileName: string;
  locationId: string;
  condition: CardCondition;
  boards: PreconBoard[];
  deckId: string | null;
  /** True only if this add made the location, so the undo may remove it. */
  locationCreated: boolean;
};

export type PreconAdded = {
  ok: true;
  copies: number;
  skipped: number;
  skippedNames: string[];
  location: { id: string; name: string; created: boolean };
  deck: {
    id: string;
    name: string;
    /** Cards claimed for the deck — "marked as built", done for you. */
    allocated: number;
    /** Cards the claim could not cover, almost always 0 for a fresh box. */
    unavailable: number;
  } | null;
  undo: PreconUndoToken;
};

export type PreconRemoved = {
  ok: true;
  copies: number;
  deckDeleted: boolean;
  locationDeleted: boolean;
};

function isCondition(value: string): value is CardCondition {
  return (CARD_CONDITIONS as readonly string[]).includes(value);
}

function isBoard(value: string): value is PreconBoard {
  return (PRECON_BOARDS as readonly string[]).includes(value);
}

function cleanName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * "Multiverse Reforged", or "Multiverse Reforged (2)" if that is taken.
 *
 * Deck names are unique, and buying a second copy of a precon is an ordinary
 * thing to do. Failing the whole one-press add over a name the person never
 * typed would be the app being pedantic about its own constraint, so the
 * name moves aside instead.
 */
async function freeDeckName(wanted: string): Promise<string> {
  const db = getDb();

  const { rows } = await db.execute<{ name: string }>(sql`
    SELECT name FROM decks
     WHERE name = ${wanted} OR name LIKE ${`${wanted} (%)`}
  `);
  const taken = new Set(rows.map((r) => r.name));
  if (!taken.has(wanted)) return wanted;

  for (let n = 2; n <= MAX_NAME_ATTEMPTS; n += 1) {
    const suffix = ` (${n})`;
    // Trimmed from the left so the suffix survives a name already at the
    // limit; a deck called "(2)" would be no use to anyone.
    const base = wanted.slice(0, MAX_DECK_NAME_LENGTH - suffix.length).trim();
    const candidate = `${base}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }

  // Out of polite options. Let createDeckFromProduct report the collision.
  return wanted;
}

/**
 * The box the cards go in: the one that was picked, the one that already has
 * this name, or a new one.
 *
 * Reusing an existing location of the same name rather than making
 * "Multiverse Reforged (2)" is deliberate — a second copy of a precon goes
 * in the same box as the first about as often as not, and a duplicate box is
 * easier to make by accident than to notice afterwards.
 */
async function resolveLocation(
  input: PreconAddInput,
): Promise<{ id: string; name: string; created: boolean } | PreconError> {
  const db = getDb();

  if (input.locationId !== null) {
    if (!UUID_RE.test(input.locationId)) {
      return { ok: false, error: "Unknown location." };
    }
    const { rows } = await db.execute<{ id: string; name: string }>(sql`
      SELECT id::text AS id, name FROM locations WHERE id = ${input.locationId}::uuid
    `);
    const found = rows[0];
    if (!found) return { ok: false, error: "That location no longer exists." };
    return { id: found.id, name: found.name, created: false };
  }

  const name = cleanName(input.locationName);
  if (name.length === 0) {
    return { ok: false, error: "The new box needs a name." };
  }

  const { rows } = await db.execute<{ id: string; name: string }>(sql`
    SELECT id::text AS id, name FROM locations WHERE name = ${name}
  `);
  const existing = rows[0];
  if (existing) {
    return { id: existing.id, name: existing.name, created: false };
  }

  const made = await createLocation(name, "deck");
  if (!made.ok) return made;
  return { id: made.id, name: made.name, created: true };
}

/**
 * Puts a whole box away: cards in a location, decklist built, cards claimed.
 */
export async function addPrecon(
  input: PreconAddInput,
): Promise<PreconAdded | PreconError> {
  if (!isPreconFileName(input.fileName)) {
    return { ok: false, error: "Unknown product." };
  }
  if (!isCondition(input.condition)) {
    return { ok: false, error: `Invalid condition "${input.condition}".` };
  }

  const boards = [...new Set(input.boards)];
  for (const board of boards) {
    if (!isBoard(board)) {
      return { ok: false, error: `Invalid board "${board}".` };
    }
  }
  if (boards.length === 0) {
    return { ok: false, error: "Pick at least one part of the box to add." };
  }

  const condition = input.condition;
  const validBoards = boards as PreconBoard[];

  const location = await resolveLocation(input);
  if ("ok" in location) return location;

  const added = await addProductToCollection({
    fileName: input.fileName,
    locationId: location.id,
    condition,
    boards: validBoards,
  });

  if (!added.ok) {
    if (location.created) await deleteLocation(location.id);
    return added;
  }

  const undo: PreconUndoToken = {
    fileName: input.fileName,
    locationId: location.id,
    condition,
    boards: validBoards,
    deckId: null,
    locationCreated: location.created,
  };

  if (!input.buildDeck) {
    return {
      ok: true,
      copies: added.copies,
      skipped: added.skipped,
      skippedNames: added.skippedNames,
      location,
      deck: null,
      undo,
    };
  }

  const wanted = cleanDeckName(input.deckName);
  if (wanted.length === 0) {
    await rollback(undo);
    return { ok: false, error: "The deck needs a name." };
  }

  const deck = await createDeckFromProduct(
    input.fileName,
    await freeDeckName(wanted.slice(0, MAX_DECK_NAME_LENGTH)),
    location.id,
  );

  if (!deck.ok) {
    await rollback(undo);
    return deck;
  }

  /*
   * Claiming is the last step and the only one allowed to fail quietly. The
   * cards are in the collection and the decklist exists either way; an
   * unclaimed deck is a correct, if less useful, state, and tearing all of
   * that down over it would be the worse outcome.
   */
  const claim = await setDeckAllocation(deck.id, true);

  return {
    ok: true,
    copies: added.copies,
    skipped: added.skipped,
    skippedNames: added.skippedNames,
    location,
    deck: {
      id: deck.id,
      name: deck.name,
      allocated: claim.ok ? claim.cards : 0,
      unavailable: claim.ok ? claim.skipped : 0,
    },
    undo: { ...undo, deckId: deck.id },
  };
}

/** The unwind used when a later step fails; same work as the user's undo. */
async function rollback(undo: PreconUndoToken): Promise<void> {
  await removePrecon(undo);
}

/**
 * Takes the whole box back out — the undo for `addPrecon`.
 *
 * Order matters: the deck goes first so that nothing still claims the cards,
 * then the cards, then the box if this add is what made it. The location is
 * only removed when it was created here and is now empty, so an undo can
 * never delete a shelf that was already holding something.
 */
export async function removePrecon(
  undo: PreconUndoToken,
): Promise<PreconRemoved | PreconError> {
  if (!isPreconFileName(undo.fileName)) {
    return { ok: false, error: "Unknown product." };
  }
  if (!UUID_RE.test(undo.locationId)) {
    return { ok: false, error: "Unknown location." };
  }
  if (!isCondition(undo.condition)) {
    return { ok: false, error: `Invalid condition "${undo.condition}".` };
  }
  for (const board of undo.boards) {
    if (!isBoard(board)) {
      return { ok: false, error: `Invalid board "${board}".` };
    }
  }

  let deckDeleted = false;
  if (undo.deckId !== null) {
    const removed = await deleteDeck(undo.deckId);
    // A deck already deleted by hand is not an error to report back: the
    // undo's job is to end with it gone, and it is gone.
    deckDeleted = removed.ok;
  }

  const taken = await removeProductFromCollection({
    fileName: undo.fileName,
    locationId: undo.locationId,
    condition: undo.condition,
    boards: undo.boards,
  });
  if (!taken.ok) return taken;

  let locationDeleted = false;
  if (undo.locationCreated) {
    const gone = await deleteLocation(undo.locationId);
    // Refused when the box still holds something somebody else put there,
    // which is the right answer — so this is reported, not raised.
    locationDeleted = gone.ok;
  }

  return {
    ok: true,
    copies: taken.copies,
    deckDeleted,
    locationDeleted,
  };
}
