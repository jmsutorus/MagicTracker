import {
  DRAFT_PACKS_PER_PLAYER,
  DRAFT_PACK_SIZE,
  draftersFor,
  type DeckBoard,
} from "./constants";
import { copyLimit, sortColors } from "./legality";

/**
 * What there is to say about a cube, as pure functions over card facts.
 *
 * A cube has almost no rules — that is the point of one. There is no ban
 * list, no colour identity to stay inside, and no deck size the rules
 * impose: a cube is a pool somebody curated, and the only authority on what
 * belongs in it is its owner. So this file does not pass a verdict the way
 * lib/decks/legality.ts does. It reports two things a cube owner cannot see
 * by looking at a list of 360 names:
 *
 *   - whether the stack is the size it is meant to be, and what that seats
 *   - how it is distributed — colour, curve and card type
 *
 * Both are arithmetic over the list, which is exactly the kind of thing
 * worth having a computer do and not worth being wrong about, so they are
 * pure and tested rather than computed in a template.
 *
 * Duplicates are the one thing flagged, and only as a warning. Singleton is
 * the overwhelming convention and a cube with two Sol Rings is usually a
 * paste that went in twice — but intentional duplicates are a real cube
 * archetype, so this says "most cubes are singleton" and leaves the decision
 * where it belongs.
 */

/** What a cube report needs to know about a card. Columns, no judgment. */
export type CubeCard = {
  oracleId: string;
  name: string;
  typeLine: string | null;
  oracleText: string | null;
  /** `oracle_cards.colors`: the card's own colours, not its identity. */
  colors: string[] | null;
  /** Used only as the fallback when `colors` is missing. */
  colorIdentity: string[];
  cmc: number | null;
  board: DeckBoard;
  quantity: number;
};

export type CubeProblem = {
  severity: "error" | "warning";
  code: "duplicate" | "command_zone";
  message: string;
  cards: { oracleId: string; name: string }[];
};

export type CubeBucket = {
  /** Stable key, for React and for tests. */
  key: string;
  label: string;
  cards: number;
  /** Share of the bucketed total, 0-100, rounded. */
  percent: number;
};

export type CubeReport = {
  /** Cards on the counted boards. */
  cardCount: number;
  /** The size the owner is aiming at. */
  targetSize: number;
  /** cardCount - targetSize: negative is short, positive is over. */
  difference: number;
  /** At the target size, with nothing flagged as an error. */
  ready: boolean;
  /** Drafters the *target* seats, or null when it does not divide evenly. */
  drafters: number | null;
  problems: CubeProblem[];
  /** W/U/B/R/G, multicolour, colourless — by the cards' own colours. */
  colors: CubeBucket[];
  /** Mana value 0-6 and 7+, lands excluded. */
  curve: CubeBucket[];
  /** Card types, each card counted once. */
  types: CubeBucket[];
  /** Lands in the cube, which the curve leaves out. */
  lands: number;
};

const COLOR_BUCKETS = [
  { key: "W", label: "White" },
  { key: "U", label: "Blue" },
  { key: "B", label: "Black" },
  { key: "R", label: "Red" },
  { key: "G", label: "Green" },
  { key: "multi", label: "Multicolour" },
  { key: "colorless", label: "Colourless" },
] as const;

/**
 * Card types, in the order a card is attributed to one.
 *
 * A card has one bucket so the buckets sum to the cube, and the first match
 * wins — a Steel Hellkite is a creature that happens to be an artifact, and
 * an Urza's Saga is a land. Creature before artifact and land before
 * everything is how cube lists are actually counted.
 */
const TYPE_BUCKETS = [
  { key: "land", label: "Land", test: /\bLand\b/ },
  { key: "creature", label: "Creature", test: /\bCreature\b/ },
  { key: "planeswalker", label: "Planeswalker", test: /\bPlaneswalker\b/ },
  { key: "instant", label: "Instant", test: /\bInstant\b/ },
  { key: "sorcery", label: "Sorcery", test: /\bSorcery\b/ },
  { key: "artifact", label: "Artifact", test: /\bArtifact\b/ },
  { key: "enchantment", label: "Enchantment", test: /\bEnchantment\b/ },
  { key: "battle", label: "Battle", test: /\bBattle\b/ },
] as const;

/** The highest curve bucket, which collects everything above it. */
const CURVE_TOP = 7;

function isLand(card: { typeLine: string | null }): boolean {
  return /\bLand\b/.test(card.typeLine ?? "");
}

/**
 * Which colour bucket a card falls in.
 *
 * `colors` and not `color_identity`, which is the opposite of what the
 * Commander rules use and is right here: identity counts the mana symbols in
 * a card's text, so it files a Mox Diamond as colourless but Bloodghast as
 * black-red — and a cube's colour balance is about what you can *cast* with
 * which colours of mana. A card with no `colors` row at all falls back to
 * identity rather than being silently called colourless.
 */
function colorKey(card: CubeCard): string {
  const colors = card.colors ?? card.colorIdentity ?? [];
  if (colors.length === 0) return "colorless";
  if (colors.length > 1) return "multi";
  const single = sortColors(colors)[0];
  return single ?? "colorless";
}

function bucketize(
  counts: Map<string, number>,
  order: readonly { key: string; label: string }[],
  total: number,
): CubeBucket[] {
  return order.map(({ key, label }) => {
    const cards = counts.get(key) ?? 0;
    return {
      key,
      label,
      cards,
      percent: total === 0 ? 0 : Math.round((cards / total) * 100),
    };
  });
}

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

/**
 * Describes a cube.
 *
 * `cards` are the rows on the counted boards — the caller filters the
 * maybeboard out, for the same reason the Commander check does: a card you
 * are considering is not in the cube, and letting it count would make the
 * size and the colour balance both wrong.
 */
export function checkCube(cards: CubeCard[], targetSize: number): CubeReport {
  const problems: CubeProblem[] = [];

  const cardCount = cards.reduce((n, c) => n + c.quantity, 0);

  /*
   * Basics and the "any number of cards named ~" cards are exempt, by the
   * same function the Commander singleton check uses. A cube with ten Wastes
   * in it has ten Wastes on purpose.
   */
  const duplicates = cards.filter((c) => c.quantity > copyLimit(c));
  if (duplicates.length > 0) {
    problems.push({
      severity: "warning",
      code: "duplicate",
      message: `${duplicates
        .map((c) => `${c.quantity}× ${c.name}`)
        .join(
          ", ",
        )} — most cubes are singleton, so this is worth a look. Keep them if it is deliberate.`,
      cards: duplicates.map((c) => ({ oracleId: c.oracleId, name: c.name })),
    });
  }

  // A cube has no command zone. Cards can still be sitting in one — a
  // Commander deck pasted into a cube, or a format changed after the fact —
  // and they do count toward the size, so saying nothing would leave an
  // unexplained row in the list.
  const inCommandZone = cards.filter((c) => c.board === "commander");
  if (inCommandZone.length > 0) {
    problems.push({
      severity: "warning",
      code: "command_zone",
      message: `${inCommandZone.map((c) => c.name).join(", ")} ${plural(
        inCommandZone.length,
        "is",
        "are",
      )} in the command zone. A cube has no commander — move ${plural(
        inCommandZone.length,
        "it",
        "them",
      )} to the cube list.`,
      cards: inCommandZone.map((c) => ({
        oracleId: c.oracleId,
        name: c.name,
      })),
    });
  }

  // ---- distribution -----------------------------------------------------
  const colorCounts = new Map<string, number>();
  const curveCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();

  let lands = 0;
  let nonLandCards = 0;

  for (const card of cards) {
    const n = card.quantity;

    const color = colorKey(card);
    colorCounts.set(color, (colorCounts.get(color) ?? 0) + n);

    const typeKey =
      TYPE_BUCKETS.find((bucket) => bucket.test.test(card.typeLine ?? ""))
        ?.key ?? "other";
    typeCounts.set(typeKey, (typeCounts.get(typeKey) ?? 0) + n);

    if (isLand(card)) {
      lands += n;
      continue;
    }

    nonLandCards += n;
    // Floor, because split cards and the like carry fractional mana values
    // in Scryfall's data (Little Girl's 0.5), and a curve has whole columns.
    const cmc = Math.max(0, Math.floor(card.cmc ?? 0));
    const key = String(Math.min(cmc, CURVE_TOP));
    curveCounts.set(key, (curveCounts.get(key) ?? 0) + n);
  }

  const curveOrder = Array.from({ length: CURVE_TOP + 1 }, (_, i) => ({
    key: String(i),
    label: i === CURVE_TOP ? `${CURVE_TOP}+` : String(i),
  }));

  const typeOrder: { key: string; label: string }[] = TYPE_BUCKETS.map(
    ({ key, label }) => ({ key, label }),
  );
  if ((typeCounts.get("other") ?? 0) > 0) {
    typeOrder.push({ key: "other", label: "Other" });
  }

  return {
    cardCount,
    targetSize,
    difference: cardCount - targetSize,
    ready:
      cardCount === targetSize && problems.every((p) => p.severity !== "error"),
    drafters: draftersFor(targetSize),
    problems,
    colors: bucketize(colorCounts, COLOR_BUCKETS, cardCount),
    curve: bucketize(curveCounts, curveOrder, nonLandCards),
    types: bucketize(typeCounts, typeOrder, cardCount),
    lands,
  };
}

/**
 * "8 drafters at 3 packs of 15", or null when the size does not divide.
 *
 * Spelled out rather than left as a number, because the number only means
 * something next to the pack maths it comes from.
 */
export function describeDraft(targetSize: number): string | null {
  const drafters = draftersFor(targetSize);
  if (drafters === null) return null;
  return `${drafters} ${plural(drafters, "drafter")} at ${DRAFT_PACKS_PER_PLAYER} packs of ${DRAFT_PACK_SIZE}`;
}
