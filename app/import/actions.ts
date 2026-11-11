"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/dal";
import { MAX_IMPORT_CHARS } from "@/lib/import/constants";
import {
  applyImport,
  type ApplyLine,
  type ApplyTarget,
  type ImportApplied,
} from "@/lib/import/mutations";
import { parseImport } from "@/lib/import/parse";
import { resolveImport, type ResolvedImport } from "@/lib/import/resolve";

/**
 * Server actions for the paste importer.
 *
 * Same rule as the other action files: a server action is a public HTTP
 * endpoint with a generated name, so authorization happens here and value
 * validation happens in lib/import/* where it cannot be skipped.
 *
 * Reviewing is deliberately an action and not a route handler. A paste is a
 * POST body of up to MAX_IMPORT_CHARS, which is well inside the 1 MB default
 * a server action allows, and nothing about it is cacheable or linkable — so
 * a GET endpoint would only add a URL that leaks a decklist into a log.
 */

export type ReviewResult =
  | ({ ok: true; format: "decklist" | "csv"; skipped: number } & ResolvedImport & {
        problems: { lineNumber: number; raw: string; message: string }[];
      })
  | { ok: false; error: string };

export async function reviewPasteAction(text: string): Promise<ReviewResult> {
  await requireUser();

  if (typeof text !== "string") {
    return { ok: false, error: "Paste a list first." };
  }
  // Checked here as well as in the parser: this is the entry point a caller
  // other than the browser would reach, and parsing is not free.
  if (text.length > MAX_IMPORT_CHARS) {
    return {
      ok: false,
      error: `That paste is too long (${MAX_IMPORT_CHARS.toLocaleString()} characters max).`,
    };
  }

  const parsed = parseImport(text);
  if (!parsed.ok) return { ok: false, error: parsed.message };

  const resolved = await resolveImport(parsed.lines);

  return {
    ok: true,
    format: parsed.format,
    skipped: parsed.skipped,
    ...resolved,
    // Flattened to messages here so the client component does not need the
    // parser's reason codes.
    problems: parsed.problems.map((p) => ({
      lineNumber: p.lineNumber,
      raw: p.raw,
      message: describe(p.reason),
    })),
  };
}

function describe(reason: "no-name" | "bad-quantity" | "no-name-column") {
  switch (reason) {
    case "no-name":
      return "No card name on this line.";
    case "bad-quantity":
      return "That quantity is not a number between 1 and 999.";
    case "no-name-column":
      return "This row has no card name.";
  }
}

export async function applyImportAction(
  lines: ApplyLine[],
  target: ApplyTarget,
): Promise<ImportApplied> {
  await requireUser();

  const result = await applyImport(lines, target);

  if (result.ok) {
    /*
     * An import can change what every other screen says: the collection
     * totals, a set's completion, what a deck reports as available, and the
     * dashboard's counts. Cheap to revalidate and confusing not to.
     */
    revalidatePath("/collection");
    revalidatePath("/sets");
    revalidatePath("/decks");
    revalidatePath("/");
    if (result.deckId) revalidatePath(`/decks/${result.deckId}`);
  }

  return result;
}
