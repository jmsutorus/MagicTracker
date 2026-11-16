import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/dal";
import { ensureSimilarityThreshold, searchCards } from "@/lib/cards/search";
import { parseGame } from "@/lib/games/constants";

/**
 * Card name search for the type-ahead.
 *
 * /api is excluded from proxy.ts, so this handler does its own authorization
 * and returns a JSON 401 rather than a redirect an API caller can't use.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();

  if (query.length === 0) {
    return NextResponse.json({ results: [] });
  }
  if (query.length > 100) {
    return NextResponse.json({ error: "query too long" }, { status: 400 });
  }

  const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Number.isSafeInteger(limitParam)
    ? Math.min(Math.max(limitParam, 1), 50)
    : 20;

  /*
   * Optional, and null means every game rather than Magic.
   *
   * The header search box and the collection entry screen both want the
   * whole catalog — somebody typing "Charizard" has already said which game
   * they meant — while a caller that is about to do something Magic-only can
   * narrow with `?game=mtg`. An unrecognised value falls back to searching
   * everything, which is a worse-targeted answer rather than an error.
   */
  const game = parseGame(url.searchParams.get("game")) ?? undefined;

  try {
    await ensureSimilarityThreshold();
    const results = await searchCards(query, limit, game);
    return NextResponse.json(
      { results },
      // Card data changes only when a set releases, so a short private cache
      // costs nothing and makes backspacing through a query feel instant.
      { headers: { "Cache-Control": "private, max-age=60" } },
    );
  } catch (error) {
    console.error("card search failed", error);
    return NextResponse.json({ error: "search failed" }, { status: 500 });
  }
}
