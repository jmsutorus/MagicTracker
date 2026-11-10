/**
 * Pure helpers for set completion: validating a scope, describing it, and
 * turning a missing list into a want list.
 *
 * No database and no imports beyond the shared constants, so the formatting
 * rules and the validation can be tested directly.
 */

import {
  COMPLETION_FINISHES,
  DEFAULT_COMPLETION_SCOPE,
  type CompletionFinish,
  type CompletionScope,
} from "@/lib/collection/constants";

export function isCompletionFinish(value: unknown): value is CompletionFinish {
  return (
    typeof value === "string" &&
    (COMPLETION_FINISHES as readonly string[]).includes(value)
  );
}

/**
 * Validates whatever arrived from a form or an action call.
 *
 * Returns null rather than a partly-filled scope: a scope with one field
 * silently reset to its default would change what "complete" means without
 * saying so, which is worse than refusing the change.
 */
export function normalizeScope(input: unknown): CompletionScope | null {
  if (typeof input !== "object" || input === null) return null;

  const raw = input as Record<string, unknown>;

  const boosterOnly = raw.boosterOnly;
  const includePromos = raw.includePromos;
  const includeExtras = raw.includeExtras;
  const finish = raw.finish;

  if (typeof boosterOnly !== "boolean") return null;
  if (typeof includePromos !== "boolean") return null;
  if (typeof includeExtras !== "boolean") return null;
  if (!isCompletionFinish(finish)) return null;

  return { boosterOnly, includePromos, includeExtras, finish };
}

/** True when the scope is the default, so the UI can say "unchanged". */
export function isDefaultScope(scope: CompletionScope): boolean {
  return (
    scope.boosterOnly === DEFAULT_COMPLETION_SCOPE.boosterOnly &&
    scope.includePromos === DEFAULT_COMPLETION_SCOPE.includePromos &&
    scope.includeExtras === DEFAULT_COMPLETION_SCOPE.includeExtras &&
    scope.finish === DEFAULT_COMPLETION_SCOPE.finish
  );
}

/**
 * One sentence saying what this scope counts.
 *
 * `applicable` says whether each flag has anything to exclude in this set. A
 * flag that cannot bite is reported as inert rather than described as active,
 * because "booster-obtainable cards only" is actively misleading on a
 * Commander deck, where no card comes from a booster and the flag is ignored.
 */
export function describeScope(
  scope: CompletionScope,
  applicable: {
    boosterOnly: boolean;
    includePromos: boolean;
    includeExtras: boolean;
  },
): string {
  const parts: string[] = [];

  if (scope.boosterOnly && applicable.boosterOnly) {
    parts.push("booster-obtainable cards only");
  } else {
    parts.push("every card in the set");
  }

  if (scope.includePromos && applicable.includePromos) {
    parts.push("including promos");
  } else if (applicable.includePromos) {
    parts.push("excluding promos");
  }

  if (scope.includeExtras && applicable.includeExtras) {
    parts.push("including art series and tokens");
  }

  parts.push(
    scope.finish === "any" ? "any finish" : `${scope.finish} copies only`,
  );

  return `${parts.join(", ")}.`;
}

export type WantListEntry = {
  name: string;
  collectorNumber: string;
};

/**
 * A want list in the format Moxfield, Archidekt and Deckbox all import:
 *
 *   1 Lightning Bolt (2ED) 162
 *
 * The set code is upper-cased because every one of those tools prints it that
 * way, and the collector number is included so a borderless printing is not
 * resolved to the ordinary one by whoever reads it.
 */
export function formatWantList(
  setCode: string,
  entries: WantListEntry[],
): string {
  const code = setCode.toUpperCase();
  return entries
    .map((entry) => `1 ${entry.name} (${code}) ${entry.collectorNumber}`)
    .join("\n");
}

/** A filename that says what the list is, without needing the page open. */
export function wantListFilename(setCode: string): string {
  const safe = setCode.toLowerCase().replace(/[^a-z0-9-]/g, "");
  return `${safe || "set"}-wantlist.txt`;
}
