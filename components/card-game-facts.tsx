import type { GameSlug } from "@/lib/games/constants";

/**
 * The stat block on a card page, for the games that are not Magic.
 *
 * Magic's block is written out in the page itself — colour identity,
 * Commander legality, mana value, EDHREC rank, reserved list — because every
 * one of those is a real column with its own meaning. The other games have no
 * columns at all; their facts live in `oracle_cards.game_data` as whatever
 * their catalog published. See lib/pokemon/project.ts and
 * lib/onepiece/project.ts for what goes in.
 *
 * This reads that JSON defensively rather than trusting its shape. It is
 * upstream data stored verbatim, it can change under us between ingests, and
 * a card page is not worth a crash: anything missing or of an unexpected type
 * is simply left out, and a card with nothing recognisable renders nothing.
 */

function str(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function list(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const parts = value.map(str).filter((v): v is string => v !== null);
  return parts.length > 0 ? parts.join(", ") : null;
}

type Fact = { label: string; value: string };

function pokemonFacts(data: Record<string, unknown>): Fact[] {
  const facts: Fact[] = [];

  const hp = str(data.hp);
  if (hp) facts.push({ label: "HP", value: hp });

  const types = list(data.types);
  if (types) facts.push({ label: "Type", value: types });

  const evolves = str(data.evolvesFrom);
  if (evolves) facts.push({ label: "Evolves from", value: evolves });

  // Length, not contents: the cost is an array of energy names, and what a
  // reader wants from it is the number of energy, which is how the card
  // itself states a retreat cost.
  if (Array.isArray(data.retreatCost) && data.retreatCost.length > 0) {
    facts.push({ label: "Retreat", value: String(data.retreatCost.length) });
  }

  const weaknesses = weaknessText(data.weaknesses);
  if (weaknesses) facts.push({ label: "Weakness", value: weaknesses });

  const resistances = weaknessText(data.resistances);
  if (resistances) facts.push({ label: "Resistance", value: resistances });

  const mark = str(data.regulationMark);
  if (mark) facts.push({ label: "Regulation mark", value: mark });

  return facts;
}

/** `[{ type: "Fire", value: "×2" }]` → "Fire ×2". */
function weaknessText(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const parts = value
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) return null;
      const row = entry as Record<string, unknown>;
      return [str(row.type), str(row.value)].filter(Boolean).join(" ") || null;
    })
    .filter((v): v is string => v !== null);
  return parts.length > 0 ? parts.join(", ") : null;
}

function onePieceFacts(data: Record<string, unknown>): Fact[] {
  const facts: Fact[] = [];

  const pairs: [string, unknown][] = [
    ["Card type", data.cardType],
    ["Colour", data.color],
    ["Cost", data.cost],
    ["Power", data.power],
    ["Counter", data.counter],
    ["Life", data.life],
    ["Attribute", data.attribute],
    ["Types", data.subTypes],
  ];

  for (const [label, raw] of pairs) {
    const value = str(raw);
    if (value) facts.push({ label, value });
  }

  return facts;
}

export function CardGameFacts({
  game,
  gameData,
}: {
  game: GameSlug;
  gameData: Record<string, unknown> | null;
}) {
  if (game === "mtg" || !gameData) return null;

  const facts =
    game === "pokemon" ? pokemonFacts(gameData) : onePieceFacts(gameData);

  if (facts.length === 0) return null;

  return (
    <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
      {facts.map((fact) => (
        <div key={fact.label}>
          <dt className="text-xs uppercase tracking-wide text-muted">
            {fact.label}
          </dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
