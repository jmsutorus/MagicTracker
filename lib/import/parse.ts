/**
 * Pure parsing for pasted card lists.
 *
 * Nothing here touches a database, so every awkward real-world form — a
 * Moxfield foil marker, a Deckbox condition column, a card name with a comma
 * in it inside a quoted CSV field — can be tested directly. The output is a
 * list of what the paste *said*; deciding which card each line means is
 * lib/import/resolve.ts, and writing anything is lib/import/mutations.ts.
 *
 * The forms below are the ones real exporters emit. They were not guessed at
 * from a single format and generalised: each is a shape one of Arena,
 * Moxfield, Archidekt, Deckstats, TappedOut, MTGGoldfish, Deckbox or ManaBox
 * actually produces, which is why the rules look fussier than a decklist
 * "obviously" needs.
 */

import type { CardCondition, CardFinish } from "@/lib/collection/constants";
import { MAX_ENTRY_QUANTITY } from "@/lib/collection/parse";

import {
  MAX_IMPORT_CHARS,
  MAX_IMPORT_LINES,
  type ImportSection,
} from "./constants";

/** One card line, as written. */
export type ImportLine = {
  /** 1-based line in the pasted text, so the review table can cite it. */
  lineNumber: number;
  /** The line as pasted, for the review table's "as written" column. */
  raw: string;
  quantity: number;
  name: string;
  /**
   * A set hint: a code, or a set's full name.
   *
   * Both, because Deckbox's `Edition` column holds "Commander Legends" where
   * Arena writes "(CMR)", and resolution matches the hint against a set's
   * code, its MTGJSON code and its name. It is a hint and never a
   * requirement — an unrecognised one is reported and ignored rather than
   * failing the line, because Arena's codes diverge from Scryfall's and a bad
   * hint should not lose a card.
   */
  setHint: string | null;
  collectorNumber: string | null;
  /**
   * A Scryfall id straight from the file. ManaBox and Moxfield CSVs carry
   * one, and when they do there is nothing left to guess.
   */
  scryfallId: string | null;
  /**
   * `null` means the paste did not say, which is not the same as nonfoil: the
   * apply step fills a null from the destination's default, and a stated
   * value is never overwritten by one.
   */
  finish: CardFinish | null;
  condition: CardCondition | null;
  section: ImportSection;
};

export type LineProblemReason =
  /** A line with a quantity and no card name: "4x", or a bare number. */
  | "no-name"
  /** A quantity of 0, or one past MAX_ENTRY_QUANTITY. */
  | "bad-quantity"
  /** A CSV row whose name column was empty. */
  | "no-name-column";

export type LineProblem = {
  lineNumber: number;
  raw: string;
  reason: LineProblemReason;
};

export type ImportFormat = "decklist" | "csv";

export type ParseFailureReason = "empty" | "too-long" | "too-many-lines";

export type ParsedImport =
  | { ok: false; reason: ParseFailureReason; message: string }
  | {
      ok: true;
      format: ImportFormat;
      lines: ImportLine[];
      problems: LineProblem[];
      /** Blank lines, comments and section headings. Counted, not a problem. */
      skipped: number;
    };

export function describeLineProblem(reason: LineProblemReason): string {
  switch (reason) {
    case "no-name":
      return "No card name on this line.";
    case "bad-quantity":
      return `Quantity must be between 1 and ${MAX_ENTRY_QUANTITY}.`;
    case "no-name-column":
      return "This row has no card name.";
  }
}

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Section headings, as the exporters write them.
 *
 * Matched exactly after lowercasing and stripping decoration, never by
 * substring: a card called "Sideboard Smuggler" would otherwise vanish into a
 * heading. `about` is listed so Arena's two-line preamble ("About" then
 * "Name My Deck") is dropped — without it, "Name My Deck" parses as one copy
 * of a card by that name.
 */
const SECTION_HEADINGS = new Map<string, ImportSection | "ignored" | "keep">([
  ["commander", "commander"],
  ["commanders", "commander"],
  ["command zone", "commander"],
  ["deck", "main"],
  ["main", "main"],
  ["mainboard", "main"],
  ["main deck", "main"],
  ["maindeck", "main"],
  ["sideboard", "sideboard"],
  ["side", "sideboard"],
  ["sb", "sideboard"],
  ["maybeboard", "maybeboard"],
  ["maybe", "maybeboard"],
  ["considering", "maybeboard"],
  // Kept rather than dropped: both are cards in the box, and the maybeboard
  // counts toward nothing, so neither can make an imported deck illegal.
  ["companion", "maybeboard"],
  ["tokens", "maybeboard"],
  ["token", "maybeboard"],
  ["about", "ignored"],

  /*
   * Card-type group headings, from Archidekt's and Moxfield's grouped
   * exports. They say nothing about which board a card is on, so they are
   * "keep": skipped without changing the section, which leaves the cards
   * under them where the last real heading put them.
   */
  ...(
    [
      "artifact",
      "battle",
      "creature",
      "enchantment",
      "instant",
      "land",
      "planeswalker",
      "sorcery",
      "kindred",
      "tribal",
      "other",
      "unknown",
    ] as const
  ).flatMap(
    (type) =>
      [
        [type, "keep"],
        [`${type}s`, "keep"],
      ] as [string, "keep"][],
  ),
]);

/** Canonical CSV field names this parser understands. */
type CsvField =
  | "quantity"
  | "name"
  | "setCode"
  | "collectorNumber"
  | "scryfallId"
  | "finish"
  | "condition";

/**
 * CSV header aliases, matched exactly on the lowercased, trimmed header.
 *
 * Exact and not substring, because Deckbox ships both `Count` and
 * `Tradelist Count` and a substring rule would read the number of copies you
 * are willing to trade as the number you own.
 */
const CSV_HEADERS = new Map<string, CsvField>([
  ["count", "quantity"],
  ["quantity", "quantity"],
  ["qty", "quantity"],
  ["amount", "quantity"],
  ["number of copies", "quantity"],

  ["name", "name"],
  ["card name", "name"],
  ["card", "name"],
  ["cardname", "name"],

  ["edition", "setCode"],
  ["set", "setCode"],
  ["set code", "setCode"],
  ["setcode", "setCode"],
  ["set_code", "setCode"],
  ["edition code", "setCode"],
  ["expansion", "setCode"],

  ["collector number", "collectorNumber"],
  ["collector_number", "collectorNumber"],
  ["collectornumber", "collectorNumber"],
  ["card number", "collectorNumber"],
  ["card_number", "collectorNumber"],

  ["scryfall id", "scryfallId"],
  ["scryfall_id", "scryfallId"],
  ["scryfallid", "scryfallId"],

  ["foil", "finish"],
  ["finish", "finish"],
  ["printing", "finish"],
  ["is foil", "finish"],

  ["condition", "condition"],
  ["card condition", "condition"],
]);

/**
 * Finish words, from every exporter that writes one.
 *
 * Etched is its own value rather than a kind of foil, matching
 * COMPLETION_FINISHES: an etched foil usually exists alongside the regular
 * foil, so folding one into the other would claim you own a card you do not.
 */
const FINISH_WORDS = new Map<string, CardFinish>([
  ["", "nonfoil"],
  ["0", "nonfoil"],
  ["no", "nonfoil"],
  ["false", "nonfoil"],
  ["normal", "nonfoil"],
  ["nonfoil", "nonfoil"],
  ["non-foil", "nonfoil"],
  ["regular", "nonfoil"],

  ["1", "foil"],
  ["yes", "foil"],
  ["true", "foil"],
  ["foil", "foil"],

  ["etched", "etched"],
  ["etched foil", "etched"],
  ["foil etched", "etched"],
]);

/**
 * Condition words.
 *
 * The grades a marketplace uses are not the five this app stores, so each one
 * is mapped to the nearest. ManaBox's `excellent` and Deckbox's
 * `good (lightly played)` both mean "better than played, worse than mint",
 * which is LP here; `poor` is the lowest grade either of them has, so it maps
 * to DMG rather than to HP.
 */
const CONDITION_WORDS = new Map<string, CardCondition>([
  ["m", "NM"],
  ["mint", "NM"],
  ["nm", "NM"],
  ["near mint", "NM"],
  ["near_mint", "NM"],
  ["nearmint", "NM"],

  ["ex", "LP"],
  ["excellent", "LP"],
  ["lp", "LP"],
  ["lightly played", "LP"],
  ["light_played", "LP"],
  ["lightly_played", "LP"],
  ["good", "LP"],
  ["good (lightly played)", "LP"],

  ["mp", "MP"],
  ["moderately played", "MP"],
  ["moderately_played", "MP"],
  ["played", "MP"],
  ["played (moderately played)", "MP"],

  ["hp", "HP"],
  ["heavily played", "HP"],
  ["heavily_played", "HP"],

  ["d", "DMG"],
  ["dmg", "DMG"],
  ["damaged", "DMG"],
  ["poor", "DMG"],
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* -------------------------------------------------------------------------- */
/* Shared normalisation                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A card name as Scryfall stores it, as far as text alone can get.
 *
 * The `//` rule is the one that matters: a split or modal card is
 * "Fire // Ice" with spaces, and exporters write it every way there is
 * ("Fire//Ice", "Fire / Ice"), so they are all folded onto the stored form
 * before any lookup compares them.
 */
export function normalizeCardName(value: string): string {
  let name = value.trim();

  // Surrounding quotes left over from a CSV field or a copied forum post.
  if (
    (name.startsWith('"') && name.endsWith('"') && name.length > 1) ||
    (name.startsWith("'") && name.endsWith("'") && name.length > 1)
  ) {
    name = name.slice(1, -1).trim();
  }

  return (
    name
      .replace(/\s+/g, " ")
      .replace(/\s*\/\/\s*/g, " // ")
      // A single slash between words is how several exporters write a split
      // card. Done after the `//` pass so a correct name is not doubled.
      .replace(/(\S) \/ (\S)/g, "$1 // $2")
      .trim()
  );
}

/**
 * A set hint from a CSV column, kept as written.
 *
 * Loose on purpose: a column headed `Edition` holds "Commander Legends" as
 * often as it holds "CMR", and resolution matches the hint against a set's
 * code, its MTGJSON code *and* its name. Nothing is uppercased, because a set
 * name reads badly shouted back in an "unrecognised set" note, and the
 * comparison is case-insensitive at both ends anyway.
 */
function normalizeSetHint(value: string): string | null {
  const hint = value.trim().replace(/\s+/g, " ");
  return hint.length > 0 && hint.length <= 80 ? hint : null;
}

/**
 * A set code lifted out of a decklist line, uppercased.
 *
 * Strict where `normalizeSetHint` is loose, and it has to be: this one
 * decides whether a trailing parenthesis is a set code or part of the card's
 * name. "Erase (Not the Urza's Legacy One)" is a real card, so anything with
 * a space in it is not a code.
 */
function normalizeSetCode(value: string): string | null {
  const code = value
    .trim()
    .replace(/^[[(]|[\])]$/g, "")
    .trim();
  return /^[A-Za-z0-9]{2,6}$/.test(code) ? code.toUpperCase() : null;
}

function normalizeCollectorNumber(value: string): string | null {
  const n = value
    .trim()
    .replace(/^#+\s*/, "")
    .replace(/\s+/g, "");
  return n.length > 0 && n.length <= 16 ? n : null;
}

function parseFinishWord(value: string): CardFinish | null {
  return FINISH_WORDS.get(value.trim().toLowerCase()) ?? null;
}

function parseConditionWord(value: string): CardCondition | null {
  return CONDITION_WORDS.get(value.trim().toLowerCase()) ?? null;
}

/** Strips a heading's decoration: `//Main`, `Deck (99)`, `Sideboard:`. */
function headingKey(line: string): string {
  return line
    .replace(/^(\/\/+|#+|-+|\*+)\s*/, "")
    .replace(/\s*\((?:\d+)(?:\s+cards?)?\)\s*$/i, "")
    .replace(/[:\s]+$/, "")
    .trim()
    .toLowerCase();
}

/* -------------------------------------------------------------------------- */
/* Decklist text                                                              */
/* -------------------------------------------------------------------------- */

export type LineOutcome =
  | { kind: "skip" }
  | { kind: "section"; section: ImportSection | "ignored" | "keep" }
  | { kind: "problem"; reason: LineProblemReason }
  | {
      kind: "line";
      quantity: number;
      name: string;
      setCode: string | null;
      collectorNumber: string | null;
      finish: CardFinish | null;
      /** A per-line override, from `SB:` or a `*CMDR*` marker. */
      section: ImportSection | null;
    };

/**
 * One line of a pasted decklist.
 *
 * Exported for its tests. The order of the steps is load-bearing: the set and
 * collector number come off the end *before* a trailing `#` is read as a
 * comment, because `1 Sol Ring (LTC) #284` and
 * `1 [LTC] Sol Ring # !Commander` both exist and the `#` means something
 * different in each.
 */
export function parseDecklistLine(raw: string): LineOutcome {
  let work = raw.trim();
  if (work.length === 0) return { kind: "skip" };

  const heading = SECTION_HEADINGS.get(headingKey(work));
  if (heading) return { kind: "section", section: heading };

  // A comment, now that it is known not to be a `//Main`-style heading.
  if (/^(\/\/|#)/.test(work)) return { kind: "skip" };

  /*
   * An unrecognised group heading.
   *
   * Archidekt and Moxfield group a deck by categories the user invented —
   * "Ramp (12)", "Card Draw (9)" — so the words cannot be enumerated the way
   * the card types above are. What every one of them has in common is a count
   * in parentheses and no quantity in front of it, which no card line has:
   * a card line's number always comes first. Without this, "Ramp (12)" parses
   * as one copy of a card called "Ramp" from set "12".
   */
  if (/\(\d+\)$/.test(work) && !/^\d/.test(work)) return { kind: "skip" };

  let section: ImportSection | null = null;
  let finish: CardFinish | null = null;

  // Classic sideboard prefix, from the days of plain text decklists.
  const sbPrefix = work.match(/^sb:\s*/i);
  if (sbPrefix) {
    section = "sideboard";
    work = work.slice(sbPrefix[0].length).trim();
  }

  // Moxfield writes `*F*` and `*E*`; TappedOut marks the commander `*CMDR*`.
  if (/\*cmdr\*/i.test(work)) {
    section = "commander";
    work = work.replace(/\*cmdr\*/gi, " ");
  }
  const finishMarker = work.match(/\*([fe])\*/i);
  if (finishMarker) {
    finish = finishMarker[1].toLowerCase() === "e" ? "etched" : "foil";
    work = work.replace(/\*[fe]\*/gi, " ");
  }
  work = work.replace(/\s+/g, " ").trim();

  let setCode: string | null = null;
  let collectorNumber: string | null = null;

  /*
   * A trailing bracket group is Archidekt's category list — `[Artifact,Ramp]`
   * — but it is also how MTGGoldfish writes a set code, `[LTC]`. Reading it
   * as a set code only when it looks like one costs nothing when the guess is
   * wrong: a set code is a hint, and an unrecognised one is ignored.
   */
  const trailingBracket = work.match(/\s*\[([^\]]*)\]\s*$/);
  if (trailingBracket) {
    work = work.slice(0, trailingBracket.index).trim();
    setCode = normalizeSetCode(trailingBracket[1]);
  }

  // `(LTC) 284`, `(LTC) #284`, `[LTC] 284`, or the code on its own.
  const tail = work.match(
    /\s[([]([A-Za-z0-9]{2,6})[)\]]\s*(?:#\s*)?([A-Za-z0-9★+-]{1,10})?\s*$/,
  );
  if (tail) {
    const code = normalizeSetCode(tail[1]);
    if (code) {
      work = work.slice(0, tail.index).trim();
      setCode = code;
      if (tail[2]) collectorNumber = normalizeCollectorNumber(tail[2]);
    }
  }

  // A bare `#284` with no set code. Useless on its own for a lookup, but
  // leaving it attached makes the name "Sol Ring #284", which matches nothing.
  if (!collectorNumber) {
    const bare = work.match(/\s#\s*([A-Za-z0-9★+-]{1,10})\s*$/);
    if (bare) {
      work = work.slice(0, bare.index).trim();
      collectorNumber = normalizeCollectorNumber(bare[1]);
    }
  }

  // Whatever `#` is left starts Deckstats' per-line comment, where
  // `!Commander` is the only thing in it this app can use.
  const comment = work.match(/\s+#(.*)$/);
  if (comment) {
    work = work.slice(0, comment.index).trim();
    const note = comment[1].toLowerCase();
    if (note.includes("!commander")) section = "commander";
    if (note.includes("!foil") && finish === null) finish = "foil";
  }

  let quantity = 1;
  const prefixed = work.match(/^(\d{1,4})\s*(?:[xX×]\s*|\s+)/);
  if (prefixed) {
    const parsed = Number.parseInt(prefixed[1], 10);
    work = work.slice(prefixed[0].length).trim();
    if (
      !Number.isSafeInteger(parsed) ||
      parsed < 1 ||
      parsed > MAX_ENTRY_QUANTITY
    ) {
      return { kind: "problem", reason: "bad-quantity" };
    }
    quantity = parsed;
  }

  // Deckstats puts the set before the name: `1 [LTC] Sol Ring`.
  const leading = work.match(/^[([]([A-Za-z0-9]{2,6})[)\]]\s+/);
  if (leading) {
    const code = normalizeSetCode(leading[1]);
    if (code) {
      setCode = setCode ?? code;
      work = work.slice(leading[0].length).trim();
    }
  }

  const name = normalizeCardName(work);
  // A name has to contain a letter. This rejects `4x`, a stray `284`, and a
  // row of dashes used as a separator, all of which otherwise become cards.
  if (!/\p{L}/u.test(name)) return { kind: "problem", reason: "no-name" };

  return {
    kind: "line",
    quantity,
    name,
    setCode,
    collectorNumber,
    finish,
    section,
  };
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                        */
/* -------------------------------------------------------------------------- */

export type CsvRow = { fields: string[]; lineNumber: number };

/**
 * Splits CSV text into rows, honouring quoted fields.
 *
 * A character scanner rather than `split(",")` because card names are full of
 * commas — "Erebos, God of the Dead" — and splitting on the delimiter turns
 * one card into two fields and shifts every column after it. A quoted field
 * may also contain the newline itself, so rows are found here rather than by
 * cutting the text into lines first; `lineNumber` is tracked as the scan goes
 * so a problem can still say where it was.
 */
export function parseCsvRows(text: string, delimiter: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  let started = false;

  const endRow = () => {
    fields.push(field);
    field = "";
    // A trailing newline must not produce a row of one empty field.
    if (fields.length > 1 || fields[0].trim().length > 0) {
      rows.push({ fields, lineNumber: rowLine });
    }
    fields = [];
    started = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (!started) {
      rowLine = line;
      started = true;
    }

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        if (ch === "\n") line += 1;
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      fields.push(field);
      field = "";
    } else if (ch === "\r") {
      // Half of a CRLF; the \n does the work.
    } else if (ch === "\n") {
      endRow();
      line += 1;
    } else {
      field += ch;
    }
  }

  if (started || field.length > 0 || fields.length > 0) endRow();

  return rows;
}

/** The delimiter a header line uses: comma, tab or semicolon. */
export function detectDelimiter(headerLine: string): string {
  const counts = [",", "\t", ";"].map((d) => ({
    d,
    n: headerLine.split(d).length - 1,
  }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ",";
}

/** Maps a header row onto canonical fields. The first column to claim a
 *  field keeps it, so Deckbox's `Count` beats its `Tradelist Count`. */
export function mapCsvHeader(
  fields: string[],
): Partial<Record<CsvField, number>> {
  const map: Partial<Record<CsvField, number>> = {};
  fields.forEach((header, index) => {
    const field = CSV_HEADERS.get(header.trim().toLowerCase());
    if (field && map[field] === undefined) map[field] = index;
  });
  return map;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Decides whether a paste is a CSV.
 *
 * The test is a header row that names a card-name column, not the presence of
 * commas: "1 Erebos, God of the Dead" is a decklist line with a comma in it,
 * and reading it as two CSV fields would import a card called "1 Erebos".
 */
function looksLikeCsv(firstLine: string): {
  delimiter: string;
  header: Partial<Record<CsvField, number>>;
} | null {
  const delimiter = detectDelimiter(firstLine);
  const fields = parseCsvRows(firstLine, delimiter)[0]?.fields ?? [];
  if (fields.length < 2) return null;

  const header = mapCsvHeader(fields);
  if (header.name === undefined) return null;
  // A name column alone could be a one-column list, so a second recognised
  // column is required before a paste is treated as a table.
  return Object.keys(header).length >= 2 ? { delimiter, header } : null;
}

export function parseImport(input: string): ParsedImport {
  if (input.trim().length === 0) {
    return { ok: false, reason: "empty", message: "Paste a list first." };
  }
  if (input.length > MAX_IMPORT_CHARS) {
    return {
      ok: false,
      reason: "too-long",
      message: `That paste is ${input.length.toLocaleString()} characters; the limit is ${MAX_IMPORT_CHARS.toLocaleString()}. Split it into a few smaller pastes.`,
    };
  }

  const rawLines = input.split(/\r?\n/);
  if (rawLines.length > MAX_IMPORT_LINES) {
    return {
      ok: false,
      reason: "too-many-lines",
      message: `That paste has ${rawLines.length.toLocaleString()} lines; the limit is ${MAX_IMPORT_LINES.toLocaleString()}. Split it into a few smaller pastes.`,
    };
  }

  const firstContentLine = rawLines.find((l) => l.trim().length > 0) ?? "";
  const csv = looksLikeCsv(firstContentLine);

  return csv
    ? parseCsv(input, csv.delimiter, csv.header)
    : parseDecklist(rawLines);
}

function parseDecklist(rawLines: string[]): ParsedImport {
  const lines: ImportLine[] = [];
  const problems: LineProblem[] = [];
  let skipped = 0;
  let section: ImportSection = "main";
  let ignoring = false;

  rawLines.forEach((raw, index) => {
    const lineNumber = index + 1;
    const outcome = parseDecklistLine(raw);

    if (outcome.kind === "skip") {
      skipped += 1;
      return;
    }

    if (outcome.kind === "section") {
      skipped += 1;
      if (outcome.section === "ignored") {
        ignoring = true;
      } else if (outcome.section !== "keep") {
        ignoring = false;
        section = outcome.section;
      }
      return;
    }

    // Arena's "About" preamble: its lines are prose, not cards.
    if (ignoring) {
      skipped += 1;
      return;
    }

    if (outcome.kind === "problem") {
      problems.push({ lineNumber, raw: raw.trim(), reason: outcome.reason });
      return;
    }

    lines.push({
      lineNumber,
      raw: raw.trim(),
      quantity: outcome.quantity,
      name: outcome.name,
      setHint: outcome.setCode,
      collectorNumber: outcome.collectorNumber,
      scryfallId: null,
      finish: outcome.finish,
      condition: null,
      section: outcome.section ?? section,
    });
  });

  return { ok: true, format: "decklist", lines, problems, skipped };
}

function parseCsv(
  text: string,
  delimiter: string,
  header: Partial<Record<CsvField, number>>,
): ParsedImport {
  const rows = parseCsvRows(text, delimiter);
  const lines: ImportLine[] = [];
  const problems: LineProblem[] = [];
  let skipped = 0;

  const at = (fields: string[], field: CsvField): string => {
    const index = header[field];
    return index === undefined ? "" : (fields[index] ?? "").trim();
  };

  rows.forEach((row, index) => {
    // Row 0 is the header itself.
    if (index === 0) {
      skipped += 1;
      return;
    }

    if (row.fields.every((f) => f.trim().length === 0)) {
      skipped += 1;
      return;
    }

    const rawText = row.fields
      .join(delimiter === "\t" ? " " : delimiter)
      .trim();

    const name = normalizeCardName(at(row.fields, "name"));
    if (!/\p{L}/u.test(name)) {
      problems.push({
        lineNumber: row.lineNumber,
        raw: rawText,
        reason: "no-name-column",
      });
      return;
    }

    let quantity = 1;
    const rawQuantity = at(row.fields, "quantity");
    if (rawQuantity.length > 0) {
      const parsed = Number.parseInt(rawQuantity, 10);
      if (
        !Number.isSafeInteger(parsed) ||
        parsed < 1 ||
        parsed > MAX_ENTRY_QUANTITY
      ) {
        problems.push({
          lineNumber: row.lineNumber,
          raw: rawText,
          reason: "bad-quantity",
        });
        return;
      }
      quantity = parsed;
    }

    const scryfallId = at(row.fields, "scryfallId");

    lines.push({
      lineNumber: row.lineNumber,
      raw: rawText,
      quantity,
      name,
      setHint: normalizeSetHint(at(row.fields, "setCode")),
      collectorNumber: normalizeCollectorNumber(
        at(row.fields, "collectorNumber"),
      ),
      scryfallId: UUID_RE.test(scryfallId) ? scryfallId.toLowerCase() : null,
      /*
       * A missing column and an empty cell are different answers. A file with
       * no foil column never said anything about finish, so the destination's
       * default applies; Deckbox leaves its Foil cell blank for a nonfoil
       * card, which *is* a statement, and FINISH_WORDS maps "" accordingly.
       */
      finish:
        header.finish === undefined
          ? null
          : parseFinishWord(at(row.fields, "finish")),
      condition:
        header.condition === undefined
          ? null
          : parseConditionWord(at(row.fields, "condition")),
      // A CSV is a collection export, not a decklist: it has no sections.
      section: "main",
    });
  });

  return { ok: true, format: "csv", lines, problems, skipped };
}

/* -------------------------------------------------------------------------- */
/* Writing a list back out                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The inverse of the parser: a plain decklist, one `"<n> <name>"` per line.
 *
 * Deliberately the same shape `formatBuyList` in lib/decks/queries.ts emits,
 * and for the same reason — no set codes, because any printing will do when
 * the point is "buy me this card". It lives here so the review screen, which
 * is a client component, can offer the download without reaching into a
 * module that touches the database.
 */
export function formatCardList(
  cards: { name: string; quantity: number }[],
): string {
  return cards.map((c) => `${c.quantity} ${c.name}`).join("\n");
}
