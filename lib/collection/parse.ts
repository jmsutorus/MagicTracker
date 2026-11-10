/**
 * Pure parsing for the collection entry screen.
 *
 * Kept separate from anything that touches a database so the fiddly cases —
 * quantity prefixes, collector numbers that are not numbers — can be tested
 * directly. Every function here is a pure function of its input.
 */

/** Nobody owns a thousand of one printing, and a typo like "1234x 5" should
 *  be rejected rather than silently entered. */
export const MAX_ENTRY_QUANTITY = 999;

export type CollectorNumberEntry = {
  quantity: number;
  collectorNumber: string;
};

export type ParseFailure =
  /** Nothing but whitespace. */
  | "empty"
  /** `123x4` — could be 4 copies of #123 or 123 copies of #4. */
  | "ambiguous"
  /** A prefix like `0x` or `1000x`. */
  | "bad-quantity";

export type ParseResult =
  | ({ ok: true } & CollectorNumberEntry)
  | { ok: false; reason: ParseFailure };

/**
 * Parses one line of collector-number entry.
 *
 * This is the input path that matters most for sealed product: a freshly
 * opened pack is in set order with the number printed on every card, so
 * typing `123` ⏎ `87` ⏎ is faster than any name-based flow.
 *
 * Accepted:
 *   123         →  1 × "123"
 *   #123        →  1 × "123"      (the # is printed on the card; ignore it)
 *   4x 123      →  4 × "123"
 *   4x 123a     →  4 × "123a"
 *   4x123a      →  4 × "123a"     (unambiguous: "123a" is not a bare number)
 *   123a        →  1 × "123a"     (letters are part of the number)
 *   ★15         →  1 × "★15"      (so are symbols)
 *   A-45        →  1 × "A-45"
 *
 * Rejected as ambiguous:
 *   123x4, 4x123  — digits on both sides of the x.
 *
 * That last rule is the important one. `4x123` and `123x4` are mirror images,
 * so any rule that reads a quantity out of one has to read the other
 * backwards: `123x4` would enter *123 copies of card #4*. Entering a hundred
 * wrong cards silently is far worse than asking for a space, so a quantity
 * prefix counts only when the x is followed by whitespace, or when what
 * follows it is not purely digits.
 */
export function parseCollectorNumberEntry(input: string): ParseResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, reason: "empty" };

  // Capture the whitespace after the x, because its presence is what settles
  // the 4x123 / 123x4 ambiguity.
  const prefixed = trimmed.match(/^(\d{1,4})\s*[x×](\s*)(.+)$/i);

  if (prefixed) {
    const [, rawQuantity, gap, remainder] = prefixed;
    const rest = remainder.trim();
    const restIsBareNumber = /^\d+$/.test(rest);

    if (gap.length > 0 || !restIsBareNumber) {
      const quantity = Number.parseInt(rawQuantity, 10);
      if (
        !Number.isSafeInteger(quantity) ||
        quantity < 1 ||
        quantity > MAX_ENTRY_QUANTITY
      ) {
        return { ok: false, reason: "bad-quantity" };
      }

      const collectorNumber = normalizeCollectorNumber(rest);
      if (collectorNumber.length === 0) return { ok: false, reason: "empty" };

      return { ok: true, quantity, collectorNumber };
    }

    // Digits, an x, and digits, with nothing to break the tie.
    return { ok: false, reason: "ambiguous" };
  }

  // No quantity prefix: the whole thing is a collector number. If it is not a
  // real one, the lookup against the pinned set says so — which is a better
  // place to find out than a guess here.
  const collectorNumber = normalizeCollectorNumber(trimmed);
  if (collectorNumber.length === 0) return { ok: false, reason: "empty" };

  return { ok: true, quantity: 1, collectorNumber };
}

/** A sentence to show the user for each way parsing can fail. */
export function describeParseFailure(reason: ParseFailure): string {
  switch (reason) {
    case "empty":
      return "Type a collector number.";
    case "ambiguous":
      return "Ambiguous — write it as “4x 123”, with a space, so it is clear which number is the quantity.";
    case "bad-quantity":
      return `Quantity must be between 1 and ${MAX_ENTRY_QUANTITY}.`;
  }
}

/**
 * Trims a collector number to the form Scryfall stores.
 *
 * The leading `#` is printed on the card but is not part of the number, and
 * internal whitespace never is either. Case is left alone: lookup compares
 * case-insensitively, because "123A" and "123a" are the same card but
 * Alchemy's "A-123" really is capitalised.
 */
export function normalizeCollectorNumber(value: string): string {
  return value
    .trim()
    .replace(/^#+\s*/, "")
    .replace(/\s+/g, "");
}

/**
 * How a printing reads in an entry log or a confirmation line:
 * "Lightning Bolt · 2ED #162".
 */
export function formatPrintingLabel(printing: {
  name: string;
  setCode: string;
  collectorNumber: string;
}): string {
  return `${printing.name} · ${printing.setCode.toUpperCase()} #${printing.collectorNumber}`;
}

/**
 * Where a quantity lands after an adjustment, clamped at zero.
 *
 * Zero is meaningful to the caller: a `collection_items` row is never allowed
 * to hold 0 (there is a CHECK constraint saying so), so a result of 0 means
 * "delete the row" rather than "store a zero".
 */
export function nextQuantity(current: number, delta: number): number {
  const next = current + delta;
  if (next < 0) return 0;
  if (next > MAX_ENTRY_QUANTITY) return MAX_ENTRY_QUANTITY;
  return next;
}
