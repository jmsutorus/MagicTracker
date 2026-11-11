"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/dal";
import { createLocation } from "@/lib/collection/mutations";
import { refreshProductContents } from "@/lib/products/contents";
import {
  addProductToCollection,
  removeProductFromCollection,
  type ProductAddInput,
} from "@/lib/products/mutations";

/**
 * Server actions for sealed products.
 *
 * Same rule as the collection and set actions: an action is a public HTTP
 * endpoint with a generated name, so authorization happens here and value
 * validation happens in lib/products/mutations.ts where it cannot be skipped
 * by calling the mutation from somewhere else.
 */

function revalidateProduct(fileName: string) {
  revalidatePath("/products");
  revalidatePath(`/products/${fileName}`);
  // A precon is a hundred cards: the collection, the set progress it moves
  // and the dashboard totals are all stale after one of these.
  revalidatePath("/collection");
  revalidatePath("/sets");
  revalidatePath("/");
}

export async function addProductAction(input: ProductAddInput) {
  await requireUser();
  const result = await addProductToCollection(input);
  if (result.ok) revalidateProduct(input.fileName);
  return result;
}

export async function removeProductAction(input: ProductAddInput) {
  await requireUser();
  const result = await removeProductFromCollection(input);
  if (result.ok) revalidateProduct(input.fileName);
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

/**
 * Creating a location from the add form, so that "put this precon in a new
 * deck box" does not mean leaving the page and losing the form.
 */
export async function createLocationForProductAction(
  name: string,
  kind: string,
) {
  await requireUser();
  const result = await createLocation(name, kind);
  if (result.ok) {
    revalidatePath("/products");
    revalidatePath("/collection/locations");
  }
  return result;
}
