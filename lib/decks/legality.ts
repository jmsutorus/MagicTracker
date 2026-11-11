import {
  COMMANDER_DECK_SIZE,
  MAX_COMMANDERS,
  type DeckBoard,
} from "./constants";

/**
 * The Commander rules, as pure functions over card facts.
 *
 * Pure and separately tested because these are the claims the app makes that
 * a person will act on — "this deck is legal" is advice about what to take to
 * a table, and being confidently wrong is worse than saying nothing. Every
 * rule here is checkable against a card's own columns; anything that needs
 * judgment is reported as a warning rather than asserted as a verdict.
 *
 * Rules enforced:
 *
 *   - Exactly 100 cards, commanders included.
 *   - Singleton: one copy of each card, except basic lands and cards that
 *     say otherwise in their own text.
 *   - Every card's color identity within the commanders' combined identity.
 *   - No card banned in Commander, and no card not in the format at all.
 *   - One commander, or two when something allows a pair.
 *   - A commander must be able to be one.
 */

/** What a rule needs to know about a card. Columns, no interpretation. */
export type LegalityCard = {
  oracleId: string;
  name: string;
  typeLine: string | null;
  oracleText: string | null;
  /** W/U/B/R/G, from `oracle_cards.color_identity`. Never null. */
  colorIdentity: string[];
  keywords: string[] | null;
  /** `legalities->>'commander'`: legal | not_legal | banned. */
  commanderLegality: string | null;
  board: DeckBoard;
  quantity: number;
};

export type Severity = "error" | "warning";

export type LegalityProblem = {
  severity: Severity;
  /** Stable identifier, for testing and for grouping in the UI. */
  code:
    | "deck_size"
    | "no_commander"
    | "too_many_commanders"
    | "invalid_commander"
    | "unverified_pair"
    | "banned"
    | "not_legal"
    | "singleton"
    | "color_identity";
  message: string;
  /** The cards the problem is about, for linking from the UI. */
  cards: { oracleId: string; name: string }[];
};

export type LegalityReport = {
  legal: boolean;
  /** Cards on the counted boards, commanders included. */
  cardCount: number;
  /** Combined color identity of the commanders, sorted in WUBRG order. */
  colorIdentity: string[];
  problems: LegalityProblem[];
};

const WUBRG = ["W", "U", "B", "R", "G"] as const;

/** WUBRG order rather than alphabetical, which is how Magic writes colors. */
export function sortColors(colors: Iterable<string>): string[] {
  const set = new Set(colors);
  return WUBRG.filter((c) => set.has(c));
}

export function formatColorIdentity(colors: string[]): string {
  return colors.length === 0 ? "colorless" : sortColors(colors).join("");
}

/** `A deck can have up to nine cards named Nazgûl` — spelled, not numeric. */
const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

/**
 * How many copies of this card a deck may hold.
 *
 * Singleton has three exceptions, and all three are readable off the card:
 *
 *   - Basic lands, by type line.
 *   - "A deck can have any number of cards named ~" (Relentless Rats,
 *     Shadowborn Apostle, Rat Colony, Persistent Petitioners, Slime Against
 *     Humanity, Dragon's Approach).
 *   - "A deck can have up to nine cards named ~" (Nazgûl, Seven Dwarves).
 *
 * Reading the rule off the card rather than keeping a list means a new card
 * with the ability works the day it is ingested, with no code change.
 */
export function copyLimit(card: {
  typeLine: string | null;
  oracleText: string | null;
}): number {
  // Not `startsWith("Basic Land")`: Scryfall writes snow basics as
  // "Basic Snow Land — Forest", and there are six of them, so a prefix test
  // would call a perfectly legal snow deck illegal. "Land" is still required,
  // because "Basic Creature — Shapeshifter" also exists and is not a land.
  if (/^Basic\b.*\bLand\b/.test(card.typeLine ?? "")) {
    return Number.POSITIVE_INFINITY;
  }

  const text = card.oracleText ?? "";

  if (/A deck can have any number of cards named/i.test(text)) {
    return Number.POSITIVE_INFINITY;
  }

  const upTo = text.match(/A deck can have up to (\w+) cards named/i);
  if (upTo) {
    const word = upTo[1].toLowerCase();
    const n = NUMBER_WORDS[word] ?? Number.parseInt(word, 10);
    if (Number.isSafeInteger(n) && n > 0) return n;
  }

  return 1;
}

/**
 * Whether a card can be a commander at all.
 *
 * Three ways in:
 *
 *  - A legendary creature.
 *  - A card whose own text says it can be your commander. All 49 such
 *    non-creature cards name themselves (`Teferi, Temporal Archmage can be
 *    your commander.`), so matching the phrase does not catch cards that
 *    merely grant the ability to something else.
 *  - A Background. These are the exception that forced this function to exist
 *    rather than being one expression: a Background is a Legendary
 *    Enchantment, not a creature, and only 1 of the 31 printed says the
 *    phrase — so both of the other rules reject 30 real commanders. A
 *    Background still needs a partner that chooses it, which
 *    `checkCommanderDeck` tests separately.
 */
export function canBeCommander(card: {
  typeLine: string | null;
  oracleText: string | null;
}): boolean {
  const type = card.typeLine ?? "";
  if (/^Legendary/.test(type) && /Creature/.test(type)) return true;
  if (/Background/.test(type)) return true;
  return /can be your commander/i.test(card.oracleText ?? "");
}

/**
 * Whether this card permits a second commander.
 *
 * Four printed abilities do: Partner, Partner with, Friends forever and
 * Doctor's companion. Choose a Background is the fifth and is handled
 * separately, because it is a pairing between a card and a Background rather
 * than between two commanders.
 *
 * `keywords` is checked for the first three and the oracle text for Friends
 * forever, which Scryfall does not reliably keyword. "Companion" is
 * deliberately NOT matched: that is Ikoria's companion mechanic on 12 cards
 * and has nothing to do with commanders — matching it by substring would let
 * two unrelated creatures sit in the command zone.
 */
export function allowsPartner(card: {
  oracleText: string | null;
  keywords: string[] | null;
}): boolean {
  const keywords = card.keywords ?? [];
  for (const keyword of keywords) {
    const k = keyword.toLowerCase();
    if (k === "partner" || k === "partner with" || k === "doctor's companion") {
      return true;
    }
  }

  const text = card.oracleText ?? "";
  return (
    /\bfriends forever\b/i.test(text) ||
    /\bpartner\b/i.test(text) ||
    /\bdoctor's companion\b/i.test(text)
  );
}

function isBackground(card: { typeLine: string | null }): boolean {
  return /Background/.test(card.typeLine ?? "");
}

function choosesBackground(card: { oracleText: string | null }): boolean {
  return /choose a background/i.test(card.oracleText ?? "");
}

/**
 * Whether a pair of commanders is a pairing the rules allow.
 *
 * Returns true when it can be verified and false when it cannot — the caller
 * reports an unverifiable pair as a warning, not an error, because a legal
 * pairing this does not recognize should not be called illegal.
 */
function pairIsAllowed(a: LegalityCard, b: LegalityCard): boolean {
  if (allowsPartner(a) && allowsPartner(b)) return true;
  if (isBackground(a) && choosesBackground(b)) return true;
  if (isBackground(b) && choosesBackground(a)) return true;
  return false;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

/**
 * Checks a deck.
 *
 * `cards` are the rows on the counted boards — the maybeboard is excluded by
 * the caller, because a card being considered is not a card in the deck.
 */
export function checkCommanderDeck(cards: LegalityCard[]): LegalityReport {
  const problems: LegalityProblem[] = [];

  const commanders = cards.filter((c) => c.board === "commander");
  const cardCount = cards.reduce((n, c) => n + c.quantity, 0);

  // ---- commanders -------------------------------------------------------
  if (commanders.length === 0) {
    problems.push({
      severity: "error",
      code: "no_commander",
      message:
        "No commander. Promote a legendary creature to the command zone.",
      cards: [],
    });
  }

  if (commanders.length > MAX_COMMANDERS) {
    problems.push({
      severity: "error",
      code: "too_many_commanders",
      message: `${commanders.length} commanders — a deck can have at most ${MAX_COMMANDERS}, and only with Partner, Friends forever, Doctor's companion or a Background.`,
      cards: commanders.map((c) => ({ oracleId: c.oracleId, name: c.name })),
    });
  }

  const invalidCommanders = commanders.filter((c) => !canBeCommander(c));
  if (invalidCommanders.length > 0) {
    problems.push({
      severity: "error",
      code: "invalid_commander",
      message: `${invalidCommanders
        .map((c) => c.name)
        .join(
          ", ",
        )} cannot be a commander — that needs a legendary creature, or a card that says it can be your commander.`,
      cards: invalidCommanders.map((c) => ({
        oracleId: c.oracleId,
        name: c.name,
      })),
    });
  }

  // A Background on its own is not a commander. It is legendary and it is
  // allowed in the command zone, but only alongside a creature that chooses
  // it — so this is an error rather than the generic "cannot be a commander",
  // which would be both wrong and unhelpful.
  if (commanders.length === 1 && isBackground(commanders[0])) {
    problems.push({
      severity: "error",
      code: "invalid_commander",
      message: `${commanders[0].name} is a Background. It needs a commander with "Choose a Background" alongside it.`,
      cards: [{ oracleId: commanders[0].oracleId, name: commanders[0].name }],
    });
  }

  // A pair that cannot be verified is a warning: the rules grow, and calling
  // a legal pairing illegal is the worse failure.
  if (commanders.length === 2 && invalidCommanders.length === 0) {
    const [a, b] = commanders;
    if (!pairIsAllowed(a, b)) {
      problems.push({
        severity: "warning",
        code: "unverified_pair",
        message: `${a.name} and ${b.name} may not be a legal pair — neither has Partner, Friends forever or Doctor's companion, and neither is a Background the other can choose. Check before you play it.`,
        cards: [a, b].map((c) => ({ oracleId: c.oracleId, name: c.name })),
      });
    }
  }

  const commanderQuantityProblem = commanders.filter((c) => c.quantity !== 1);
  if (commanderQuantityProblem.length > 0) {
    problems.push({
      severity: "error",
      code: "singleton",
      message: `${commanderQuantityProblem
        .map((c) => `${c.quantity}× ${c.name}`)
        .join(", ")} in the command zone — a commander is a single card.`,
      cards: commanderQuantityProblem.map((c) => ({
        oracleId: c.oracleId,
        name: c.name,
      })),
    });
  }

  // ---- size -------------------------------------------------------------
  if (cardCount !== COMMANDER_DECK_SIZE) {
    const diff = cardCount - COMMANDER_DECK_SIZE;
    problems.push({
      severity: "error",
      code: "deck_size",
      message:
        diff < 0
          ? `${cardCount} cards — ${-diff} ${plural(-diff, "card")} short of ${COMMANDER_DECK_SIZE}.`
          : `${cardCount} cards — ${diff} over ${COMMANDER_DECK_SIZE}.`,
      cards: [],
    });
  }

  // ---- legality ---------------------------------------------------------
  const banned = cards.filter((c) => c.commanderLegality === "banned");
  if (banned.length > 0) {
    problems.push({
      severity: "error",
      code: "banned",
      message: `Banned in Commander: ${banned.map((c) => c.name).join(", ")}.`,
      cards: banned.map((c) => ({ oracleId: c.oracleId, name: c.name })),
    });
  }

  const notLegal = cards.filter((c) => c.commanderLegality === "not_legal");
  if (notLegal.length > 0) {
    problems.push({
      severity: "error",
      code: "not_legal",
      message: `Not a Commander-legal card: ${notLegal
        .map((c) => c.name)
        .join(
          ", ",
        )}. Usually an Acorn card, a Conspiracy or a digital-only printing.`,
      cards: notLegal.map((c) => ({ oracleId: c.oracleId, name: c.name })),
    });
  }

  // ---- singleton --------------------------------------------------------
  const overLimit = cards.filter(
    (c) => c.board !== "commander" && c.quantity > copyLimit(c),
  );
  if (overLimit.length > 0) {
    problems.push({
      severity: "error",
      code: "singleton",
      message: `Too many copies: ${overLimit
        .map((c) => {
          const limit = copyLimit(c);
          return `${c.quantity}× ${c.name} (limit ${Number.isFinite(limit) ? limit : "any"})`;
        })
        .join(", ")}.`,
      cards: overLimit.map((c) => ({ oracleId: c.oracleId, name: c.name })),
    });
  }

  // ---- color identity ---------------------------------------------------
  const identity = new Set<string>();
  for (const commander of commanders) {
    for (const color of commander.colorIdentity) identity.add(color);
  }

  // Checked only when there is a command zone to check against. With no
  // commander, every colored card would be reported as off-identity — a
  // hundred errors for one missing card, which tells you nothing.
  if (commanders.length > 0) {
    const offIdentity = cards.filter(
      (c) =>
        c.board !== "commander" &&
        c.colorIdentity.some((color) => !identity.has(color)),
    );

    if (offIdentity.length > 0) {
      problems.push({
        severity: "error",
        code: "color_identity",
        message: `Outside the commander's ${formatColorIdentity([...identity])} identity: ${offIdentity
          .map((c) => `${c.name} (${formatColorIdentity(c.colorIdentity)})`)
          .join(", ")}.`,
        cards: offIdentity.map((c) => ({
          oracleId: c.oracleId,
          name: c.name,
        })),
      });
    }
  }

  return {
    legal: problems.every((p) => p.severity !== "error"),
    cardCount,
    colorIdentity: sortColors(identity),
    problems,
  };
}
