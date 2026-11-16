import type {
  CatalogOracle,
  CatalogPrinting,
  CatalogSet,
} from "@/lib/games/catalog";
import { setCodeFor } from "@/lib/games/constants";
import { oracleId, printingId } from "@/lib/games/ids";
import type { PokemonCard, PokemonSet } from "@/lib/pokemon/client";

/**
 * Maps a Pokémon card onto the same `sets` / `oracle_cards` / `printings`
 * rows a Magic card lands in.
 *
 * The point of this file is that the rest of the app never learns what a
 * Pokémon card is. A collection row, a search result, a wishlist entry and a
 * card page all read `name`, `type_line`, `oracle_text`, `rarity`,
 * `set_code`, `collector_number` and an image URL — so if those seven are
 * filled honestly, every screen already works. What genuinely has no column
 * (HP, attacks, retreat cost, weaknesses) goes to `game_data`, which only
 * the card page reads.
 *
 * Kept pure and separate from the client so the fiddly parts — the finish
 * rules, the date reformatting, promo numbering — are unit-testable without a
 * network.
 */

const GAME = "pokemon" as const;

/**
 * `2026/11/06` is not a date Postgres accepts. Slashes to hyphens, and
 * anything that is not the expected shape becomes null rather than a guess:
 * a wrong release date silently reorders every set picker in the app.
 */
export function toIsoDate(value: string | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4})[/-](\d{2})[/-](\d{2})/.exec(value.trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/**
 * Rarities that mean the card is holographic and has no plain version.
 *
 * The data gives a rarity and nothing about finishes, so this is inference,
 * and it is written to fail in the forgiving direction. The three ordinary
 * rarities are listed and everything else — "Rare Holo", "Illustration
 * Rare", "Special Illustration Rare", "Hyper Rare", "ACE SPEC Rare", every
 * rarity a future set invents — is treated as inherently foil. New rarities
 * in Pokémon are nearly always chase cards, so an unknown string guessing
 * "foil" is right far more often than it is wrong.
 */
const ORDINARY_RARITIES = new Set(["common", "uncommon", "rare"]);

/**
 * Reverse holos began with Legendary Collection, May 2002. Before that a
 * common had exactly one finish, so offering the option would be an invitation
 * to record a card that does not exist.
 */
const REVERSE_HOLO_FROM = "2002-05-01";

/**
 * Which finishes a copy of this card can be recorded in.
 *
 * This array is what the entry screen's finish picker is built from — a
 * finish not listed here cannot be chosen — so the cost of being too narrow
 * is someone holding a card they are not allowed to write down, while the
 * cost of being too wide is an option nobody picks. Given that asymmetry,
 * an ordinary-rarity card in the reverse-holo era offers all three: plenty of
 * sets print a holo of a card whose rarity line still reads "Rare".
 */
export function finishesFor(
  rarity: string | undefined,
  releasedAt: string | null,
): string[] {
  const key = (rarity ?? "").trim().toLowerCase();

  if (key.length > 0 && !ORDINARY_RARITIES.has(key)) return ["foil"];

  if (releasedAt !== null && releasedAt < REVERSE_HOLO_FROM) return ["nonfoil"];

  return ["nonfoil", "reverse", "foil"];
}

/**
 * The leading integer of a collector number, for ordering.
 *
 * Pokémon numbers more often than Magic's are not numbers at all: promos run
 * `SWSH001`, secret rares run `TG12`, and the Scarlet & Violet sets use
 * `GG01`. The digits are taken from wherever they start, so `TG12` sorts as
 * 12 among its own kind rather than collapsing every letter-prefixed card to
 * the top of the set.
 */
export function collectorNumberToInt(number: string): number | null {
  const match = /(\d+)/.exec(number);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * The type line a list row shows: "Basic Pokémon — Grass", "Trainer —
 * Supporter", "Energy — Special".
 *
 * Same em-dash shape as Magic's, because it lands in the same column of the
 * same table and reading one row as a Magic type line and the next as
 * something else would make the column noise.
 */
export function typeLineFor(card: PokemonCard): string | null {
  const left = [...(card.subtypes ?? []), card.supertype ?? ""]
    .filter(Boolean)
    .join(" ");

  const right = (card.types ?? []).join(" ");

  if (left.length === 0 && right.length === 0) return null;
  if (right.length === 0) return left;
  if (left.length === 0) return right;
  return `${left} — ${right}`;
}

/**
 * The card's text, assembled from the several fields it is split across.
 *
 * A Pokémon card's rules are an ability, then its attacks with their costs
 * and damage, then any rule box text. Joined into one block so the card page
 * and every search snippet have a single string to show, in the order the
 * card itself reads.
 */
export function oracleTextFor(card: PokemonCard): string | null {
  const parts: string[] = [];

  for (const ability of card.abilities ?? []) {
    const label = [ability.type, ability.name].filter(Boolean).join(": ");
    parts.push([label, ability.text].filter(Boolean).join(" — "));
  }

  for (const attack of card.attacks ?? []) {
    /*
     * The cost is a list of energy type names — ["Fire", "Fire"] — and on
     * the card it is a row of symbols, which this column cannot show. Joined
     * bare it read "FireFire Burning Darkness": two words fused into one and
     * then fused onto the attack's name. Bracketed and comma-separated, it
     * reads as the cost it is and stays clear of the name.
     */
    const cost = (attack.cost ?? []).filter((c) => c.length > 0);
    const head = [
      cost.length > 0 ? `{${cost.join(", ")}}` : "",
      attack.name,
      attack.damage,
    ]
      .filter((v) => v && v.length > 0)
      .join(" ");
    parts.push([head, attack.text].filter(Boolean).join(" — "));
  }

  for (const rule of card.rules ?? []) parts.push(rule);

  const text = parts.filter((p) => p.trim().length > 0).join("\n\n");
  return text.length > 0 ? text : null;
}

export function projectSet(set: PokemonSet): CatalogSet {
  return {
    code: setCodeFor(GAME, set.id),
    game: GAME,
    name: set.name,
    /**
     * The series doubles as the set type, which is what `sets.set_type` is
     * for: a free-text classification this game uses. "Scarlet & Violet",
     * "Sword & Shield", "POP". It is never compared against Magic's values.
     */
    setType: set.series ?? "expansion",
    releasedAt: toIsoDate(set.releaseDate),
    cardCount: set.total ?? set.printedTotal ?? 0,
    /**
     * The set symbol, in the same column the Magic set icons live in. Those
     * are SVGs and these are PNGs, but every reader of the column puts it in
     * an `<img src>`, which does not care.
     */
    iconSvgUri: set.images?.symbol ?? null,
  };
}

export function projectCard(
  card: PokemonCard,
  set: PokemonSet,
): { oracle: CatalogOracle; printing: CatalogPrinting } {
  const releasedAt = toIsoDate(set.releaseDate);
  const oracle = oracleId(GAME, card.name);

  return {
    oracle: {
      oracleId: oracle,
      game: GAME,
      name: card.name,
      typeLine: typeLineFor(card),
      oracleText: oracleTextFor(card),
      gameData: {
        supertype: card.supertype ?? null,
        subtypes: card.subtypes ?? [],
        hp: card.hp ?? null,
        types: card.types ?? [],
        evolvesFrom: card.evolvesFrom ?? null,
        abilities: card.abilities ?? [],
        attacks: card.attacks ?? [],
        weaknesses: card.weaknesses ?? [],
        resistances: card.resistances ?? [],
        retreatCost: card.retreatCost ?? [],
        regulationMark: card.regulationMark ?? null,
        nationalPokedexNumbers: card.nationalPokedexNumbers ?? [],
      },
    },
    printing: {
      id: printingId(GAME, card.id),
      game: GAME,
      externalId: card.id,
      oracleId: oracle,
      setCode: setCodeFor(GAME, set.id),
      collectorNumber: card.number,
      collectorNumberNum: collectorNumberToInt(card.number),
      name: card.name,
      rarity: card.rarity ?? "Unknown",
      finishes: finishesFor(card.rarity, releasedAt),
      imageUrl: card.images?.large ?? card.images?.small ?? null,
      /**
       * Null, always: this catalog publishes whole cards and no art crop.
       * The list components fall back to the full image, which at 44px is a
       * small card rather than the illustration — not as legible as Magic's
       * crops, but it is the picture that exists.
       */
      artUrl: null,
      releasedAt,
      /** The bulk data carries no prices. See lib/pokemon/client.ts. */
      usdCents: null,
    },
  };
}
