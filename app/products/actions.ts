"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/dal";
import { refreshProductContents } from "@/lib/products/contents";
import {
  addPrecon,
  removePrecon,
  type PreconAddInput,
  type PreconUndoToken,
} from "@/lib/products/precon";

/**
 * Server actions for sealed products.
 *
 * Same rule as the collection and set actions: an action is a public HTTP
 * endpoint with a generated name, so authorization happens here and value
 * validation happens in lib/products/precon.ts and the mutations it calls,
 * where it cannot be skipped by reaching the mutation another way.
 */

function revalidateProduct(fileName: string) {
  revalidatePath("/products");
  revalidatePath(`/products/${fileName}`);
  // A precon is a hundred cards and, now, a deck and a box to keep them in:
  // the collection, its locations, the set progress it moves, the deck list
  // and the dashboard totals are all stale after one of these.
  revalidatePath("/collection");
  revalidatePath("/collection/locations");
  revalidatePath("/decks");
  revalidatePath("/sets");
  revalidatePath("/");
}

/**
 * The one press: cards into a box, decklist built, cards claimed for it.
 */
export async function addPreconAction(input: PreconAddInput) {
  await requireUser();
  const result = await addPrecon(input);
  if (result.ok) revalidateProduct(input.fileName);
  return result;
}

/** And the one press that takes all of it back. */
export async function undoPreconAction(undo: PreconUndoToken) {
  await requireUser();
  const result = await removePrecon(undo);
  if (result.ok) revalidateProduct(undo.fileName);
  return result;
}

/**
 * Re-fetches a product's card list from MTGJSON.
 *
 * Offered because a card list can be wrong in a way only the person holding
 * the physical box can see — a brand-new product MTGJSON published before
 * Scryfall had the cards shows unresolved rows, and they start resolving once
 * the weekly card ingest catches up. This is the button for not waiting.
 */
export async function refreshProductAction(fileName: string) {
  await requireUser();
  const result = await refreshProductContents(fileName);
  if (result.ok) revalidateProduct(fileName);
  return result;
}
