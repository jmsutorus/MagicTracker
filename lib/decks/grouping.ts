import { UNCATEGORISED, type DeckGrouping } from "./constants";

/**
 * Splitting a decklist into headed sections.
 *
 * Pure, and separate from the component that draws it, because the ordering
 * rules are the kind of thing that is easy to get subtly wrong and easy to
 * test: "Land" belongs at the bottom whatever else is going on, a card that
 * is both an artifact and a creature is a creature, and "Uncategorized"
 * sorts last rather than alphabetically under U.
 */

/** The minimum a card needs for any grouping to work. */
export type GroupableCard = {
  name: string;
  typeLine: string | null;
  manaCost: string | null;
  cmc: number | null;
  colorIdentity: string[];
  category: string | null;
  quantity: number;
};

export type CardGroup<T> = {
  /** Heading, and the drop target's identity when grouping by category. */
  key: string;
  label: string;
  cards: T[];
  /** Copies, not rows — the number a player counts. */
  copies: number;
};

/**
 * Broad types in the order a decklist is read, most-played first.
 *
 * Order matters twice: it picks the single bucket for a card with several
 * types, and it orders the sections. A Dryad Arbor is a Land Creature and
 * belongs under Creature; an artifact creature belongs under Creature too,
 * which is why Creature is first and Artifact is further down. Land is last
 * in both senses — it is the one bucket everyone scrolls past.
 */
const TYPE_ORDER = [
  "Creature",
  "Planeswalker",
  "Instant",
  "Sorcery",
  "Artifact",
  "Enchantment",
  "Battle",
  "Land",
] as const;

/** The bucket a card falls in when grouping by type. */
export function typeBucket(typeLine: string | null): string {
  const line = typeLine ?? "";
  /*
   * A modal double-faced card's type line is "Front // Back", and only the
   * front is what you cast off the top of your deck. Grouping Agadeem's
   * Awakening under Land because its back is one would be wrong.
   */
  const front = line.split("//")[0];
  for (const type of TYPE_ORDER) {
    if (front.includes(type)) return type;
  }
  return "Other";
}

const COLOR_LABELS: Record<string, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
};

/** WUBRG, then gold, then colourless — the order a deck page reads in. */
function colorBucket(colorIdentity: string[]): { key: string; label: string } {
  if (colorIdentity.length === 0) return { key: "C", label: "Colorless" };
  if (colorIdentity.length > 1) {
    return { key: "M", label: "Multicolor" };
  }
  const c = colorIdentity[0];
  return { key: c, label: COLOR_LABELS[c] ?? c };
}

/** Sort position for a bucket key, lower first. */
function rank(grouping: DeckGrouping, key: string): number {
  if (grouping === "type") {
    const i = (TYPE_ORDER as readonly string[]).indexOf(key);
    // "Other" has no place in the list, so it sits just before Land.
    return i === -1 ? TYPE_ORDER.length - 1.5 : i;
  }
  if (grouping === "color") {
    const order = ["W", "U", "B", "R", "G", "M", "C"];
    const i = order.indexOf(key);
    return i === -1 ? order.length : i;
  }
  if (grouping === "cmc") {
    const n = Number(key);
    return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
  }
  // Category: everything alphabetical, with the catch-all pinned last so it
  // does not sort into the middle of the owner's own headings.
  return key === UNCATEGORISED ? 1 : 0;
}

export function groupDeckCards<T extends GroupableCard>(
  cards: T[],
  grouping: DeckGrouping,
): CardGroup<T>[] {
  if (grouping === "none") {
    return [
      {
        key: "all",
        label: "",
        cards,
        copies: cards.reduce((n, c) => n + c.quantity, 0),
      },
    ];
  }

  const buckets = new Map<string, CardGroup<T>>();

  for (const card of cards) {
    let key: string;
    let label: string;

    switch (grouping) {
      case "category":
        key = card.category ?? UNCATEGORISED;
        label = key;
        break;
      case "type":
        key = typeBucket(card.typeLine);
        label = key;
        break;
      case "cmc": {
        /*
         * A land has no mana value worth grouping on — every one of them
         * would pile into 0 and swamp the real curve, which is the same
         * reason the curve chart leaves them out.
         */
        const isLand = typeBucket(card.typeLine) === "Land";
        key = isLand ? "land" : String(Math.max(0, Math.round(card.cmc ?? 0)));
        label = isLand ? "Lands" : `${key} mana`;
        break;
      }
      case "color": {
        const bucket = colorBucket(card.colorIdentity);
        key = bucket.key;
        label = bucket.label;
        break;
      }
    }

    const existing = buckets.get(key);
    if (existing) {
      existing.cards.push(card);
      existing.copies += card.quantity;
    } else {
      buckets.set(key, { key, label, cards: [card], copies: card.quantity });
    }
  }

  const groups = [...buckets.values()];

  groups.sort((a, b) => {
    // A land bucket sorts after every mana value, not as value zero.
    if (grouping === "cmc") {
      if (a.key === "land") return 1;
      if (b.key === "land") return -1;
    }
    const byRank = rank(grouping, a.key) - rank(grouping, b.key);
    if (byRank !== 0) return byRank;
    return a.label.localeCompare(b.label);
  });

  return groups;
}
