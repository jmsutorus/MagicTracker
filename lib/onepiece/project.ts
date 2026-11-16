import type {
  CatalogOracle,
  CatalogPrinting,
  CatalogSet,
} from "@/lib/games/catalog";
import { setCodeFor } from "@/lib/games/constants";
import { oracleId, printingId } from "@/lib/games/ids";
import type { OnePieceCard } from "@/lib/onepiece/client";
import { parsePriceToCents } from "@/lib/prices/project";

/**
 * Maps a One Piece card onto the shared `sets` / `oracle_cards` /
 * `printings` rows. The reasoning is the same as lib/pokemon/project.ts: fill
 * the seven columns every screen reads, and put what is left in `game_data`.
 */

const GAME = "onepiece" as const;

/**
 * The rarity letters spelled out.
 *
 * Stored expanded rather than as the printed letter because the rarity shows
 * up in a filter dropdown and a table column beside Magic's "mythic" and
 * "uncommon", where a bare "SEC" is unreadable to anyone who does not
 * already play the game. An unrecognised code is passed through unchanged —
 * the catalog inventing a new one should surface it, not swallow it.
 */
const RARITY_NAMES: Record<string, string> = {
  C: "Common",
  UC: "Uncommon",
  R: "Rare",
  SR: "Super Rare",
  SEC: "Secret Rare",
  L: "Leader",
  TR: "Treasure Rare",
  P: "Promo",
  SP: "Special",
  "SP CARD": "Special",
};

export function rarityName(rarity: string | null): string {
  const key = (rarity ?? "").trim().toUpperCase();
  if (key.length === 0) return "Unknown";
  return RARITY_NAMES[key] ?? key;
}

/**
 * Dollars to integer cents, for a source that publishes numbers.
 *
 * Every price in this app is an integer number of cents, and
 * lib/prices/project.ts is blunt about why the conversion must not be
 * `value * 100`: binary floating point cannot represent most two-decimal
 * values exactly, so 0.29 * 100 is 28.999999999999996, and a single
 * Math.round hides it only until the numbers are summed over a collection.
 *
 * Scryfall sends strings, so that module parses the digits. This source
 * sends JSON numbers, which are already doubles by the time they arrive —
 * so the nearest two-decimal spelling is recovered with toFixed(2) and
 * handed to the same parser. One definition of what a dollar is worth,
 * rather than a second one here that rounds differently.
 */
export function centsFromDollars(
  value: number | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0) return null;
  return parsePriceToCents(value.toFixed(2));
}

/**
 * The name with a variant marker stripped, which decides what counts as the
 * same card.
 *
 * Alternate arts arrive as a separate row named "Kujyaku (Alternate Art)",
 * and they are the same card as "Kujyaku" — the same text, the same number,
 * a different picture — so they belong on one card page.
 *
 * A trailing parenthetical of *digits* is kept, and that exception is load
 * bearing: leaders are named "Nami (041)" and "Nami (001)", where the number
 * is the only thing distinguishing two genuinely different cards. Folding
 * those together would merge every leader a character has ever had.
 */
export function baseCardName(name: string): string {
  const match = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(name.trim());
  if (!match) return name.trim();
  return /^\d+$/.test(match[2]) ? name.trim() : match[1].trim();
}

/**
 * The leading integer of a card number: `OP11-004` sorts as 4.
 *
 * The *last* run of digits, not the first, because every number starts with
 * the set's own — taking the first would sort all of OP-11 as 11 and leave
 * the set in arbitrary order.
 */
export function collectorNumberToInt(cardNumber: string): number | null {
  const matches = cardNumber.match(/\d+/g);
  if (!matches || matches.length === 0) return null;
  const parsed = Number.parseInt(matches[matches.length - 1], 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * "Character — Straw Hat Crew", "Leader — Straw Hat Crew".
 *
 * Same shape as Magic's type line and Pokémon's, for the same reason: they
 * share a column.
 */
export function typeLineFor(card: OnePieceCard): string | null {
  const left = card.card_type?.trim() ?? "";
  const right = card.sub_types?.trim() ?? "";

  if (left.length === 0 && right.length === 0) return null;
  if (right.length === 0) return left;
  if (left.length === 0) return right;
  return `${left} — ${right}`;
}

/**
 * The statistics line, prepended to the card text.
 *
 * Cost, power, counter and life are what a One Piece player reads first, and
 * they have no columns of their own — `cmc` and `mana_cost` are Magic's
 * shapes and filling them with a DON!! cost would make Magic's mana-symbol
 * renderer try to draw it. They are in `game_data` for the card page, and
 * summarised here so that a search result or a hover preview, which only
 * ever shows the text, is not missing the numbers.
 */
export function statLine(card: OnePieceCard): string | null {
  const parts: string[] = [];
  if (card.card_color) parts.push(card.card_color);
  if (card.card_cost) parts.push(`Cost ${card.card_cost}`);
  if (card.card_power) parts.push(`Power ${card.card_power}`);
  if (card.counter_amount) parts.push(`Counter ${card.counter_amount}`);
  if (card.life) parts.push(`Life ${card.life}`);
  if (card.attribute) parts.push(card.attribute);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Splits off the publisher's reprint note.
 *
 * The source appends it to the card text with no separator at all, so a
 * reprint reads "...place the rest at the bottom of your deck in any
 * order.Disclaimer: This card is a reprint...". Only this one marker is
 * split on, and only where something precedes it: a general "insert a break
 * after a full stop before a capital" rule would break "Monkey.D.Luffy",
 * which is how that card's name is actually printed.
 */
function splitDisclaimer(text: string): string {
  return text.replace(/(?<=\S)Disclaimer:/g, "\n\nDisclaimer:");
}

export function oracleTextFor(card: OnePieceCard): string | null {
  const stats = statLine(card);
  const raw = card.card_text?.trim();
  const text = raw && raw.length > 0 ? splitDisclaimer(raw) : null;
  const joined = [stats, text].filter(Boolean).join("\n\n");
  return joined.length > 0 ? joined : null;
}

export function projectSet(
  setId: string,
  setName: string,
  kind: "set" | "deck",
  cardCount: number,
): CatalogSet {
  return {
    code: setCodeFor(GAME, setId),
    game: GAME,
    name: setName,
    setType: kind === "deck" ? "starter deck" : "booster",
    /**
     * Null: the catalog publishes no release dates. Every set picker orders
     * by date with nulls last and then by name, so One Piece sets group
     * together and read in name order, which for `Starter Deck 1 … 36` and
     * the numbered boosters is nearly release order anyway.
     */
    releasedAt: null,
    cardCount,
    iconSvgUri: null,
  };
}

export function projectCard(card: OnePieceCard): {
  oracle: CatalogOracle;
  printing: CatalogPrinting;
} {
  const base = baseCardName(card.card_name);
  const oracle = oracleId(GAME, base);

  return {
    oracle: {
      oracleId: oracle,
      game: GAME,
      name: base,
      typeLine: typeLineFor(card),
      oracleText: oracleTextFor(card),
      gameData: {
        cardType: card.card_type,
        color: card.card_color,
        cost: card.card_cost,
        power: card.card_power,
        counter: card.counter_amount,
        life: card.life,
        attribute: card.attribute,
        subTypes: card.sub_types,
      },
    },
    printing: {
      /**
       * Keyed on `card_image_id`, not `card_set_id`. The printed number is
       * shared by a card and its alternate arts — 27 of OP-11's 127 numbers
       * appear twice — so keying on it would make each pair overwrite the
       * other and lose half the set. `card_image_id` carries the `_p1`
       * suffix that tells them apart.
       */
      id: printingId(GAME, card.card_image_id),
      game: GAME,
      externalId: card.card_image_id,
      oracleId: oracle,
      setCode: setCodeFor(GAME, card.set_id),
      /**
       * The printed number, shared by the alternate arts — which is correct.
       * It is what is on the card, and what somebody entering a binder by
       * number will type; the two rows that share it are two candidates,
       * which the entry screen already knows how to show.
       */
      collectorNumber: card.card_set_id,
      collectorNumberNum: collectorNumberToInt(card.card_set_id),
      /** The full printed name, alternate-art marker and all. */
      name: card.card_name,
      rarity: rarityName(card.rarity),
      /**
       * Deliberately permissive. The catalog says nothing about foiling, and
       * One Piece foils inconsistently — some rares are foil in a booster
       * and not in a starter deck. Since this array is what the finish
       * picker offers, listing both lets every card actually be recorded;
       * nonfoil is the default, so the common case stays one keystroke.
       */
      finishes: ["nonfoil", "foil"],
      imageUrl: card.card_image,
      /** No art crops published; list rows fall back to the full card. */
      artUrl: null,
      releasedAt: null,
      usdCents: centsFromDollars(card.market_price),
    },
  };
}
