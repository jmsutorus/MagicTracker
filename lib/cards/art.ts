import { sql, type SQL } from "drizzle-orm";

/**
 * A printing to draw a card's art from, given only its oracle id.
 *
 * Several places want to show a picture of a card they only know by identity:
 * a deck knows its commander's `oracle_id` and may or may not name a
 * printing, and a wishlist row that means "any Sol Ring" has no printing at
 * all. Art, though, belongs to a printing — every Sol Ring is a different
 * picture — so something has to choose one.
 *
 * The rule: newest English, non-extra printing. English because a Japanese
 * alternate-art is a surprise when you asked for the card you know;
 * non-extra because art series cards, tokens and emblems are filed under the
 * same oracle id and are not the card; newest because a card someone is
 * looking at today is most likely the reprint they just opened. The id is
 * the final tiebreak so the choice is stable between page loads rather than
 * shifting with whatever the planner returned first.
 *
 * Callers that have a preferred printing should coalesce onto this rather
 * than replace it — `coalesce(dc.printing_id, <this>)` — so a chosen printing
 * always wins and this is only the fallback.
 */
export function representativePrinting(oracleIdExpr: SQL): SQL {
  return sql`(
    SELECT p.scryfall_id
      FROM printings p
     WHERE p.oracle_id = ${oracleIdExpr}
       AND p.lang = 'en'
       AND NOT p.is_extra
     ORDER BY p.released_at DESC NULLS LAST, p.scryfall_id
     LIMIT 1
  )`;
}
