"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/dal";
import {
  addDeckCard,
  adjustDeckCard,
  createDeck,
  createDeckFromProduct,
  deleteDeck,
  removeDeckCard,
  renameDeck,
  setDeckAllocation,
  setDeckCardBoard,
  setDeckLocation,
  setDeckNotes,
  type AddDeckCardInput,
} from "@/lib/decks/mutations";

/**
 * Server actions for decks.
 *
 * Same rule as the other action files: a server action is a public HTTP
 * endpoint with a generated name, so authorization happens here and value
 * validation happens in lib/decks/mutations.ts where it cannot be skipped.
 */

function revalidateDeck(deckId?: string) {
  revalidatePath("/decks");
  if (deckId) revalidatePath(`/decks/${deckId}`);
  /*
   * Allocation changes what the *collection* reports as free to build with,
   * and a deck built from a precon can move a location's contents, so these
   * are stale too. Cheap to revalidate and confusing not to.
   */
  revalidatePath("/collection");
  revalidatePath("/");
}

export async function createDeckAction(name: string) {
  await requireUser();
  const result = await createDeck(name);
  if (result.ok) revalidateDeck(result.id);
  return result;
}

export async function renameDeckAction(deckId: string, name: string) {
  await requireUser();
  const result = await renameDeck(deckId, name);
  if (result.ok) revalidateDeck(deckId);
  return result;
}

export async function setDeckNotesAction(deckId: string, notes: string) {
  await requireUser();
  const result = await setDeckNotes(deckId, notes);
  if (result.ok) revalidateDeck(deckId);
  return result;
}

export async function deleteDeckAction(deckId: string) {
  await requireUser();
  const result = await deleteDeck(deckId);
  if (result.ok) revalidateDeck();
  return result;
}

export async function setDeckLocationAction(
  deckId: string,
  locationId: string | null,
) {
  await requireUser();
  const result = await setDeckLocation(deckId, locationId);
  if (result.ok) revalidateDeck(deckId);
  return result;
}

export async function addDeckCardAction(input: AddDeckCardInput) {
  await requireUser();
  const result = await addDeckCard(input);
  if (result.ok) revalidateDeck(input.deckId);
  return result;
}

export async function adjustDeckCardAction(
  deckCardId: string,
  delta: number,
  deckId: string,
) {
  await requireUser();
  const result = await adjustDeckCard(deckCardId, delta);
  if (result.ok) revalidateDeck(deckId);
  return result;
}

export async function removeDeckCardAction(deckCardId: string, deckId: string) {
  await requireUser();
  const result = await removeDeckCard(deckCardId);
  if (result.ok) revalidateDeck(deckId);
  return result;
}

export async function setDeckCardBoardAction(
  deckCardId: string,
  board: string,
  deckId: string,
) {
  await requireUser();
  const result = await setDeckCardBoard(deckCardId, board);
  if (result.ok) revalidateDeck(deckId);
  return result;
}

export async function setDeckAllocationAction(
  deckId: string,
  allocated: boolean,
) {
  await requireUser();
  const result = await setDeckAllocation(deckId, allocated);
  if (result.ok) revalidateDeck(deckId);
  return result;
}

/**
 * The other half of "buying a precon is two clicks": the deck, not just the
 * cards. PLAN.md scheduled this in Phase 5 because it needs these tables.
 */
export async function createDeckFromProductAction(
  fileName: string,
  name: string,
  locationId: string | null,
) {
  await requireUser();
  const result = await createDeckFromProduct(fileName, name, locationId);
  if (result.ok) {
    revalidateDeck(result.id);
    revalidatePath(`/products/${fileName}`);
  }
  return result;
}
