"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/dal";
import {
  addWish,
  clearOwnedWishes,
  removeWish,
  setWishNote,
  setWishQuantity,
  type AddWishInput,
  type WishlistResult,
} from "@/lib/wishlist/mutations";

/**
 * Server actions for the wishlist.
 *
 * Same rule as the other action files: a server action is a public HTTP
 * endpoint with a generated name, so authorization happens here and value
 * validation happens in lib/wishlist/mutations.ts where it cannot be skipped.
 */

function revalidateWishlist(oracleId?: string) {
  revalidatePath("/wishlist");
  // The card page shows whether a card is already wished for.
  if (oracleId) revalidatePath(`/cards/${oracleId}`);
  revalidatePath("/");
}

export async function addWishAction(
  input: AddWishInput,
): Promise<WishlistResult> {
  await requireUser();
  const result = await addWish(input);
  if (result.ok) revalidateWishlist(input.oracleId);
  return result;
}

export async function removeWishAction(id: string): Promise<WishlistResult> {
  await requireUser();
  const result = await removeWish(id);
  if (result.ok) revalidateWishlist();
  return result;
}

export async function setWishQuantityAction(
  id: string,
  quantity: number,
): Promise<WishlistResult> {
  await requireUser();
  const result = await setWishQuantity(id, quantity);
  if (result.ok) revalidateWishlist();
  return result;
}

export async function setWishNoteAction(
  id: string,
  note: string | null,
): Promise<WishlistResult> {
  await requireUser();
  const result = await setWishNote(id, note);
  if (result.ok) revalidateWishlist();
  return result;
}

export async function clearOwnedWishesAction(): Promise<{
  ok: true;
  removed: number;
}> {
  await requireUser();
  const result = await clearOwnedWishes();
  revalidateWishlist();
  return result;
}
