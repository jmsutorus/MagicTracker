import { sql } from "drizzle-orm";

import type { CompletionScope } from "@/lib/collection/constants";
import { getDb } from "@/lib/db";

import { normalizeScope } from "./scope";

export type ScopeResult =
  | { ok: true; scope: CompletionScope }
  | { ok: false; error: string };

/** Set codes are short lowercase alphanumerics; checked before any query. */
const SET_CODE_RE = /^[a-z0-9]{1,16}$/;

/**
 * Stores what "complete" means for one set.
 *
 * An upsert, because the absence of a row means "use the default" rather than
 * "not configured" — so there is nothing to create before editing, and
 * resetScope deletes rather than writing the defaults back. That keeps one
 * representation of the default instead of two that can drift.
 */
export async function saveScope(
  setCode: string,
  input: unknown,
): Promise<ScopeResult> {
  const code = typeof setCode === "string" ? setCode.toLowerCase() : "";
  if (!SET_CODE_RE.test(code)) {
    return { ok: false, error: "Unknown set." };
  }

  const scope = normalizeScope(input);
  if (!scope) {
    return { ok: false, error: "Those completion settings were not valid." };
  }

  const db = getDb();

  try {
    // The foreign key would catch this too, but a named set beats a
    // constraint name, and this way the error says which thing was unknown.
    const { rows: setRows } = await db.execute<{ code: string }>(sql`
      SELECT code FROM sets WHERE code = ${code}
    `);
    if (setRows.length === 0) {
      return { ok: false, error: `There is no set with code "${code}".` };
    }

    await db.execute(sql`
      INSERT INTO completion_targets
        (set_code, booster_only, include_promos, include_extras, finish)
      VALUES
        (${code}, ${scope.boosterOnly}, ${scope.includePromos},
         ${scope.includeExtras}, ${scope.finish})
      ON CONFLICT (set_code) DO UPDATE
        SET booster_only   = EXCLUDED.booster_only,
            include_promos = EXCLUDED.include_promos,
            include_extras = EXCLUDED.include_extras,
            finish         = EXCLUDED.finish,
            updated_at     = now()
    `);

    return { ok: true, scope };
  } catch (error) {
    console.error("completion: failed to save scope", error);
    return { ok: false, error: "Could not save those settings." };
  }
}

/** Back to the default, by deleting the row rather than storing the defaults. */
export async function resetScope(setCode: string): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const code = typeof setCode === "string" ? setCode.toLowerCase() : "";
  if (!SET_CODE_RE.test(code)) {
    return { ok: false, error: "Unknown set." };
  }

  const db = getDb();
  try {
    await db.execute(
      sql`DELETE FROM completion_targets WHERE set_code = ${code}`,
    );
    return { ok: true };
  } catch (error) {
    console.error("completion: failed to reset scope", error);
    return { ok: false, error: "Could not reset those settings." };
  }
}
