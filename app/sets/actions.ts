"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/dal";
import { resetScope, saveScope } from "@/lib/completion/mutations";

/**
 * Server actions for the per-set completion scope.
 *
 * Same rule as the collection actions: an action is a public HTTP endpoint
 * with a generated name, so authorization happens here and value validation
 * happens in lib/completion/mutations.ts where it cannot be bypassed.
 */

function revalidateSets(setCode: string) {
  revalidatePath("/sets");
  revalidatePath(`/sets/${setCode.toLowerCase()}`);
}

export async function saveScopeAction(setCode: string, scope: unknown) {
  await requireUser();
  const result = await saveScope(setCode, scope);
  if (result.ok) revalidateSets(setCode);
  return result;
}

export async function resetScopeAction(setCode: string) {
  await requireUser();
  const result = await resetScope(setCode);
  if (result.ok) revalidateSets(setCode);
  return result;
}
