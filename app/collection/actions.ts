"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/dal";
import {
  addCopies,
  adjustQuantity,
  createLocation,
  deleteLocation,
  moveItem,
  removeItem,
  renameLocation,
  type AddCopiesInput,
} from "@/lib/collection/mutations";

/**
 * Server actions for everything that writes to the collection.
 *
 * A server action is a public HTTP endpoint with a generated name, not a
 * private function call — the browser can invoke it with any arguments at all.
 * So every one of these starts with requireUser(), which is the secure check
 * from lib/auth/dal.ts. proxy.ts does not stand in for this: it only looks for
 * a session cookie, and it never sees an action's POST body.
 *
 * Validation of the values themselves lives in lib/collection/mutations.ts so
 * that it cannot be skipped by calling a mutation from somewhere else.
 */

function revalidateCollection() {
  revalidatePath("/collection");
  revalidatePath("/collection/add");
  revalidatePath("/collection/locations");
  // Owned counts show on the dashboard.
  revalidatePath("/");
}

export async function addCopiesAction(input: AddCopiesInput) {
  await requireUser();
  const result = await addCopies(input);
  if (result.ok) revalidateCollection();
  return result;
}

export async function adjustQuantityAction(itemId: string, delta: number) {
  await requireUser();
  const result = await adjustQuantity(itemId, delta);
  if (result.ok) revalidateCollection();
  return result;
}

export async function removeItemAction(itemId: string) {
  await requireUser();
  const result = await removeItem(itemId);
  if (result.ok) revalidateCollection();
  return result;
}

export async function moveItemAction(itemId: string, locationId: string) {
  await requireUser();
  const result = await moveItem(itemId, locationId);
  if (result.ok) revalidateCollection();
  return result;
}

export async function createLocationAction(name: string, kind: string) {
  await requireUser();
  const result = await createLocation(name, kind);
  if (result.ok) revalidateCollection();
  return result;
}

export async function renameLocationAction(id: string, name: string) {
  await requireUser();
  const result = await renameLocation(id, name);
  if (result.ok) revalidateCollection();
  return result;
}

export async function deleteLocationAction(id: string) {
  await requireUser();
  const result = await deleteLocation(id);
  if (result.ok) revalidateCollection();
  return result;
}
