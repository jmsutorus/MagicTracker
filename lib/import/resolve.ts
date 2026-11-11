import { sql, type SQL } from "drizzle-orm";

import { searchCards } from "@/lib/cards/search";
import { getDb } from "@/lib/db";

import {
  MAX_SUGGESTION_LOOKUPS,
  SUGGESTIONS_PER_LINE,
  type ImportSection,
} from "./constants";
import type { ImportLine } from "./parse";
import { DEFAULT_PRINTING_ORDER } from "./printing";
import { summarizeWanted, type WantedTotals } from "./summary";

/**
 * Turning what a paste *said* into cards this database holds.
 *
 * The review step PLAN.md §7 asks for is only honest if it can say three
 * different things: this line is that card, this line could be one of these
 * cards, and this line is no card I know. So nothing here guesses silently —
 * a line that cannot be pinned down comes back as `ambiguous` or `unmatched`
 * with options attached, and every assumption that *was* made (a set hint
 * ignored, a printing picked for you) comes back as a note on the line.
 *
 * Everything is batched. A thousand-line CSV resolves in four queries plus at
 * most MAX_SUGGESTION_LOOKUPS fuzzy lookups, not a query per line: the
 * database is a free-tier Neon instance that suspends when idle, and a
 * thousand round trips to it is a minute of staring at a spinner.
 */

export type ResolutionNote =
  /** A set was named and no set by that code or name exists. */
  | "set-ignored"
  /** The set matched, the collector number in it did not. */
  | "collector-ignored"
  /** The printing was chosen here, because the line did not name one. */
  | "printing-guessed"
  /** Matched on the front face of a double-faced card. */
  | "matched-by-face"
  /** The stated finish does not exist for this printing. */
  | "finish-unavailable";

export function describeNote(note: ResolutionNote): string {
  switch (note) {
    case "set-ignored":
      return "No set by that name — matched on the card name alone.";
    case "collector-ignored":
      return "That collector number is not in that set — matched on the card name.";
    case "printing-guessed":
      return "Printing chosen for you (newest regular printing).";
    case "matched-by-face":
      return "Matched the front face of a double-faced card.";
    case "finish-unavailable":
      return "That printing was not made in that finish.";
  }
}

/** A card the user can be offered, as a pick or as a suggestion. */
export type CardOption = {
  oracleId: string;
  name: string;
  typeLine: string | null;
  manaCost: string | null;
  colorIdentity: string[];
  /** Copies in the collection, across every printing of the card. */
  owned: number;
  /** Copies no built deck has claimed. */
  available: number;
};

/** The printing a resolved line will pin. */
export type ResolvedPrinting = {
  printingId: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  finishes: string[];
};

export type LineStatus = "resolved" | "ambiguous" | "unmatched";

export type ResolvedLine = {
  lineNumber: number;
  raw: string;
  /** The name as the paste wrote it, for an unmatched line to show. */
  wanted: string;
  quantity: number;
  section: ImportSection;
  finish: string | null;
  condition: string | null;
  status: LineStatus;
  /** The card, when there is exactly one it can be. */
  card: CardOption | null;
  printing: ResolvedPrinting | null;
  /** Candidates to choose from (ambiguous) or near misses (unmatched). */
  options: CardOption[];
  notes: ResolutionNote[];
};

export type ImportSummary = WantedTotals & {
  resolved: number;
  ambiguous: number;
  unmatched: number;
};

export type ResolvedImport = {
  lines: ResolvedLine[];
  summary: ImportSummary;
  /** True when a fuzzy-suggestion budget ran out, so the UI can say so. */
  suggestionsTruncated: boolean;
};

/**
 * A literal Postgres array of parameters.
 *
 * Not `${values}::text[]`: drizzle expands a JS array in a template into a
 * comma-separated *parameter list*, so that spelling compiles to
 * `($1, $2, $3)::text[]` and Postgres rejects it with 42846, "cannot cast
 * type record to text[]". Building the ARRAY constructor explicitly keeps
 * every element a bound parameter. Same form as the ARRAY literal in
 * lib/decks/queries.ts.
 */
function pgArray(values: string[], type: "text" | "uuid"): SQL {
  const elements = sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );
  return type === "uuid"
    ? sql`ARRAY[${elements}]::uuid[]`
    : sql`ARRAY[${elements}]::text[]`;
}

type OracleRow = {
  key: string;
  oracle_id: string;
  name: string;
  type_line: string | null;
  mana_cost: string | null;
  color_identity: string[] | null;
  how: "exact" | "face";
};

/**
 * Resolves parsed lines against the card database.
 *
 * Pure in spirit: it reads, and writes nothing. The caller hands the result
 * to the review screen, and only an explicit apply touches a table.
 */
export async function resolveImport(
  lines: ImportLine[],
): Promise<ResolvedImport> {
  if (lines.length === 0) {
    return {
      lines: [],
      summary: {
        copies: 0,
        distinct: 0,
        covered: 0,
        missing: [],
        resolved: 0,
        ambiguous: 0,
        unmatched: 0,
      },
      suggestionsTruncated: false,
    };
  }

  const db = getDb();

  /* -- 1. the printings a file named outright ----------------------------- */

  const scryfallIds = unique(
    lines.map((l) => l.scryfallId).filter((id): id is string => id !== null),
  );

  const byScryfallId = new Map<
    string,
    {
      card: Omit<CardOption, "owned" | "available">;
      printing: ResolvedPrinting;
    }
  >();

  if (scryfallIds.length > 0) {
    const { rows } = await db.execute<{
      scryfall_id: string;
      oracle_id: string;
      name: string;
      type_line: string | null;
      mana_cost: string | null;
      color_identity: string[] | null;
      set_code: string;
      set_name: string;
      collector_number: string;
      finishes: string[] | null;
    }>(sql`
      SELECT p.scryfall_id::text AS scryfall_id,
             p.oracle_id::text   AS oracle_id,
             o.name, o.type_line, o.mana_cost, o.color_identity,
             p.set_code, s.name AS set_name, p.collector_number, p.finishes
        FROM printings p
        JOIN oracle_cards o ON o.oracle_id = p.oracle_id
        JOIN sets s ON s.code = p.set_code
       WHERE p.scryfall_id = ANY(${pgArray(scryfallIds, "uuid")})
    `);

    for (const r of rows) {
      byScryfallId.set(r.scryfall_id.toLowerCase(), {
        card: {
          oracleId: r.oracle_id,
          name: r.name,
          typeLine: r.type_line,
          manaCost: r.mana_cost,
          colorIdentity: r.color_identity ?? [],
        },
        printing: {
          printingId: r.scryfall_id,
          setCode: r.set_code,
          setName: r.set_name,
          collectorNumber: r.collector_number,
          finishes: r.finishes ?? [],
        },
      });
    }
  }

  /* -- 2. names ----------------------------------------------------------- */

  const names = unique(
    lines
      .filter((l) => !byScryfallId.has((l.scryfallId ?? "").toLowerCase()))
      .map((l) => l.name.toLowerCase()),
  );

  /**
   * Exact name first, front face as a fallback tier.
   *
   * A decklist often writes only the front of a modal card — "Agadeem's
   * Awakening" for "Agadeem's Awakening // Agadeem, the Undercrypt" — so a
   * front-face match is needed. It is a *fallback* and not an equal: the
   * front face of one card can be the whole name of another, and preferring
   * the exact match means the card actually called that always wins.
   */
  const nameMatches = new Map<string, OracleRow[]>();

  if (names.length > 0) {
    const { rows } = await db.execute<OracleRow>(sql`
      WITH wanted AS (
        SELECT DISTINCT x AS key FROM unnest(${pgArray(names, "text")}) AS x
      )
      SELECT w.key, o.oracle_id::text AS oracle_id, o.name, o.type_line,
             o.mana_cost, o.color_identity, 'exact' AS how
        FROM wanted w
        JOIN oracle_cards o ON lower(o.name) = w.key
      UNION ALL
      SELECT w.key, o.oracle_id::text AS oracle_id, o.name, o.type_line,
             o.mana_cost, o.color_identity, 'face' AS how
        FROM wanted w
        JOIN oracle_cards o
          ON o.name LIKE '% // %'
         AND lower(split_part(o.name, ' // ', 1)) = w.key
    `);

    for (const r of rows) {
      const list = nameMatches.get(r.key);
      if (list) list.push(r);
      else nameMatches.set(r.key, [r]);
    }
  }

  /** The candidates for one name, exact tier only when it is non-empty. */
  function candidatesFor(name: string): { rows: OracleRow[]; byFace: boolean } {
    const all = nameMatches.get(name.toLowerCase()) ?? [];
    const exact = all.filter((r) => r.how === "exact");
    if (exact.length > 0) return { rows: exact, byFace: false };
    return { rows: all, byFace: all.length > 0 };
  }

  /* -- 3. the printing for each (card, set hint, collector number) -------- */

  type PrintingRequest = {
    oracleId: string;
    hint: string | null;
    collectorNumber: string | null;
  };

  const requests: PrintingRequest[] = [];
  const requestIndex = new Map<string, number>();

  const requestKey = (r: PrintingRequest) =>
    `${r.oracleId}|${(r.hint ?? "").toLowerCase()}|${(r.collectorNumber ?? "").toLowerCase()}`;

  const wantPrinting = (r: PrintingRequest): number => {
    const key = requestKey(r);
    const existing = requestIndex.get(key);
    if (existing !== undefined) return existing;
    const index = requests.length;
    requests.push(r);
    requestIndex.set(key, index);
    return index;
  };

  // Decided before the query so the request list is complete.
  const plan = lines.map((line) => {
    const direct = byScryfallId.get((line.scryfallId ?? "").toLowerCase());
    if (direct) {
      return { line, kind: "direct" as const, direct };
    }

    const { rows, byFace } = candidatesFor(line.name);
    if (rows.length === 0) return { line, kind: "unmatched" as const };
    if (rows.length > 1) return { line, kind: "ambiguous" as const, rows };

    const only = rows[0];
    return {
      line,
      kind: "single" as const,
      row: only,
      byFace,
      request: wantPrinting({
        oracleId: only.oracle_id,
        hint: line.setHint,
        collectorNumber: line.collectorNumber,
      }),
    };
  });

  const printings = new Map<
    number,
    {
      printing: ResolvedPrinting;
      setMatched: boolean;
      collectorMatched: boolean;
    }
  >();

  if (requests.length > 0) {
    /*
     * One LATERAL per request, each picking its own best printing.
     *
     * The ORDER BY *is* the policy: a printing from the set that was named
     * beats one that was not, the right collector number inside it beats the
     * wrong one, and with no hint at all the tie-breaks in
     * DEFAULT_PRINTING_ORDER decide. Those live in their own module because
     * the write in lib/import/mutations.ts has to agree with this preview
     * exactly.
     *
     * LEFT JOIN rather than CROSS, so a card with no printing yet (MTGJSON
     * can list one before Scryfall does) still comes back as a row.
     */
    const values = sql.join(
      requests.map(
        (r, i) =>
          sql`(${i}::int, ${r.oracleId}::uuid, ${r.hint}::text, ${r.collectorNumber}::text)`,
      ),
      sql`, `,
    );

    const { rows } = await db.execute<{
      idx: number;
      scryfall_id: string;
      set_code: string;
      set_name: string;
      collector_number: string;
      finishes: string[] | null;
      set_matched: boolean;
      collector_matched: boolean;
    }>(sql`
      WITH req(idx, oracle_id, hint, cn) AS (VALUES ${values})
      SELECT r.idx,
             best.scryfall_id::text AS scryfall_id,
             best.set_code,
             best.set_name,
             best.collector_number,
             best.finishes,
             best.set_matched,
             best.collector_matched
        FROM req r
        LEFT JOIN LATERAL (
          SELECT p.scryfall_id, p.set_code, s.name AS set_name,
                 p.collector_number, p.finishes,
                 (r.hint IS NOT NULL
                  AND (lower(s.code) = lower(r.hint)
                       OR lower(coalesce(s.mtgjson_code, '')) = lower(r.hint)
                       OR lower(s.name) = lower(r.hint))) AS set_matched,
                 (r.cn IS NOT NULL
                  AND lower(p.collector_number) = lower(r.cn)) AS collector_matched
            FROM printings p
            JOIN sets s ON s.code = p.set_code
           WHERE p.oracle_id = r.oracle_id
           ORDER BY set_matched DESC,
                    collector_matched DESC,
                    ${DEFAULT_PRINTING_ORDER}
           LIMIT 1
        ) best ON true
    `);

    for (const r of rows) {
      if (!r.scryfall_id) continue;
      printings.set(r.idx, {
        printing: {
          printingId: r.scryfall_id,
          setCode: r.set_code,
          setName: r.set_name,
          collectorNumber: r.collector_number,
          finishes: r.finishes ?? [],
        },
        setMatched: r.set_matched,
        collectorMatched: r.collector_matched,
      });
    }
  }

  /* -- 4. suggestions for the names that matched nothing ------------------ */

  const unmatchedNames = unique(
    plan.filter((p) => p.kind === "unmatched").map((p) => p.line.name),
  );
  const suggestionBudget = unmatchedNames.slice(0, MAX_SUGGESTION_LOOKUPS);
  const suggestions = new Map<
    string,
    Omit<CardOption, "owned" | "available">[]
  >();

  for (const name of suggestionBudget) {
    const found = await searchCards(name, SUGGESTIONS_PER_LINE);
    suggestions.set(
      name.toLowerCase(),
      found.map((f) => ({
        oracleId: f.oracleId,
        name: f.name,
        typeLine: f.typeLine,
        manaCost: f.manaCost,
        colorIdentity: f.colorIdentity,
      })),
    );
  }

  /* -- 5. what the collection already holds ------------------------------- */

  const oracleIds = unique([
    ...plan.flatMap((p) => {
      if (p.kind === "direct") return [p.direct.card.oracleId];
      if (p.kind === "single") return [p.row.oracle_id];
      if (p.kind === "ambiguous") return p.rows.map((r) => r.oracle_id);
      return [];
    }),
    ...[...suggestions.values()].flatMap((list) => list.map((c) => c.oracleId)),
  ]);

  const holdings = new Map<string, { owned: number; available: number }>();

  if (oracleIds.length > 0) {
    /*
     * Owned and available, the same two numbers the deck editor shows and by
     * the same definition: available is what no *built* deck has claimed. No
     * deck is excluded here, unlike lib/decks/queries.ts, because an import
     * is not yet a deck — there is nothing for it to exclude.
     */
    const { rows } = await db.execute<{
      oracle_id: string;
      owned: number;
      available: number;
    }>(sql`
      SELECT w.key::text AS oracle_id,
             coalesce(owned.n, 0)::int AS owned,
             GREATEST(coalesce(owned.n, 0) - coalesce(claimed.n, 0), 0)::int
               AS available
        FROM unnest(${pgArray(oracleIds, "uuid")}) AS w(key)
        LEFT JOIN LATERAL (
          SELECT sum(c.quantity) AS n
            FROM collection_items c
            JOIN printings p ON p.scryfall_id = c.printing_id
           WHERE p.oracle_id = w.key
        ) owned ON true
        LEFT JOIN LATERAL (
          SELECT sum(dc.quantity) AS n
            FROM deck_cards dc
           WHERE dc.oracle_id = w.key
             AND dc.is_allocated
             AND dc.board <> 'maybe'
        ) claimed ON true
    `);

    for (const r of rows) {
      holdings.set(r.oracle_id, { owned: r.owned, available: r.available });
    }
  }

  const withHoldings = (
    card: Omit<CardOption, "owned" | "available">,
  ): CardOption => ({
    ...card,
    owned: holdings.get(card.oracleId)?.owned ?? 0,
    available: holdings.get(card.oracleId)?.available ?? 0,
  });

  const fromRow = (r: OracleRow): CardOption =>
    withHoldings({
      oracleId: r.oracle_id,
      name: r.name,
      typeLine: r.type_line,
      manaCost: r.mana_cost,
      colorIdentity: r.color_identity ?? [],
    });

  /* -- 6. assemble -------------------------------------------------------- */

  const resolved: ResolvedLine[] = plan.map((p) => {
    const base = {
      lineNumber: p.line.lineNumber,
      raw: p.line.raw,
      wanted: p.line.name,
      quantity: p.line.quantity,
      section: p.line.section,
      finish: p.line.finish,
      condition: p.line.condition,
    };

    if (p.kind === "unmatched") {
      return {
        ...base,
        status: "unmatched" as const,
        card: null,
        printing: null,
        options: (suggestions.get(p.line.name.toLowerCase()) ?? []).map(
          withHoldings,
        ),
        notes: [],
      };
    }

    if (p.kind === "ambiguous") {
      return {
        ...base,
        status: "ambiguous" as const,
        card: null,
        printing: null,
        options: p.rows.map(fromRow),
        notes: [],
      };
    }

    if (p.kind === "direct") {
      const notes: ResolutionNote[] = [];
      if (!finishAvailable(p.line.finish, p.direct.printing.finishes)) {
        notes.push("finish-unavailable");
      }
      return {
        ...base,
        status: "resolved" as const,
        card: withHoldings(p.direct.card),
        printing: p.direct.printing,
        options: [],
        notes,
      };
    }

    const picked = printings.get(p.request);
    const notes: ResolutionNote[] = [];
    if (p.byFace) notes.push("matched-by-face");

    if (picked) {
      if (p.line.setHint !== null && !picked.setMatched) {
        notes.push("set-ignored");
      } else if (p.line.collectorNumber !== null && !picked.collectorMatched) {
        notes.push("collector-ignored");
      } else if (p.line.setHint === null) {
        notes.push("printing-guessed");
      }
      if (!finishAvailable(p.line.finish, picked.printing.finishes)) {
        notes.push("finish-unavailable");
      }
    }

    return {
      ...base,
      status: "resolved" as const,
      card: fromRow(p.row),
      printing: picked?.printing ?? null,
      options: [],
      notes,
    };
  });

  return {
    lines: resolved,
    summary: summarize(resolved),
    suggestionsTruncated: unmatchedNames.length > suggestionBudget.length,
  };
}

/** Whether a stated finish exists for a printing; an unstated one always does. */
function finishAvailable(finish: string | null, finishes: string[]): boolean {
  if (finish === null) return true;
  return finishes.length === 0 || finishes.includes(finish);
}

/**
 * The numbers the review screen leads with.
 *
 * The arithmetic is in lib/import/summary.ts, not here, because the review
 * screen redoes it as the user resolves ambiguous lines. Only the status
 * tallies — which are facts about the resolution, not about the selection —
 * are counted here.
 */
function summarize(lines: ResolvedLine[]): ImportSummary {
  let resolved = 0;
  let ambiguous = 0;
  let unmatched = 0;

  for (const line of lines) {
    if (line.status === "resolved") resolved += 1;
    if (line.status === "ambiguous") ambiguous += 1;
    if (line.status === "unmatched") unmatched += 1;
  }

  const totals = summarizeWanted(
    lines.map((line) => ({
      quantity: line.quantity,
      section: line.section,
      card:
        line.status === "resolved" && line.card
          ? {
              oracleId: line.card.oracleId,
              name: line.card.name,
              available: line.card.available,
            }
          : null,
    })),
  );

  return { ...totals, resolved, ambiguous, unmatched };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
