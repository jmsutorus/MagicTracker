import { sectionToBoard, type ImportSection } from "./constants";

/**
 * What a list of wanted cards adds up to.
 *
 * Pure, and in its own module, because both ends need it. The server
 * summarises the resolution so the review screen has numbers the moment it
 * opens; the review screen re-summarises as the user resolves ambiguous
 * lines, so the headline and the buy list follow their choices instead of
 * freezing at whatever the first pass guessed. One definition, or the two
 * would drift and the screen would start contradicting itself.
 */

export type WantedRow = {
  quantity: number;
  section: ImportSection;
  /** Null for a line that is not going to be imported. */
  card: { oracleId: string; name: string; available: number } | null;
};

export type WantedTotals = {
  /** Copies across every row, the maybeboard included. */
  copies: number;
  /** Distinct cards on the boards that count. */
  distinct: number;
  /** Copies the collection can supply, on the boards that count. */
  covered: number;
  /** Copies it cannot, grouped by card. */
  missing: { name: string; need: number }[];
};

export function summarizeWanted(rows: WantedRow[]): WantedTotals {
  let copies = 0;

  /** Card → how many are wanted on the counted boards, and how many are free. */
  const counted = new Map<
    string,
    { name: string; wanted: number; available: number }
  >();

  for (const row of rows) {
    copies += row.quantity;
    if (row.card === null) continue;
    // The maybeboard counts toward nothing, here as everywhere else.
    if (sectionToBoard(row.section) === "maybe") continue;

    const existing = counted.get(row.card.oracleId);
    if (existing) existing.wanted += row.quantity;
    else {
      counted.set(row.card.oracleId, {
        name: row.card.name,
        wanted: row.quantity,
        available: row.card.available,
      });
    }
  }

  const missing: { name: string; need: number }[] = [];
  let covered = 0;

  /*
   * Grouped by card and not by line. Two lines of the same card need one copy
   * between them if you own one, so a per-line answer would tell you to buy
   * two — the same reason the deck buy list groups.
   */
  for (const entry of counted.values()) {
    const supplied = Math.min(entry.wanted, entry.available);
    covered += supplied;
    const need = entry.wanted - supplied;
    if (need > 0) missing.push({ name: entry.name, need });
  }

  missing.sort((a, b) => b.need - a.need || a.name.localeCompare(b.name));

  return { copies, distinct: counted.size, covered, missing };
}
