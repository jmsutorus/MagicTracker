import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/dal";
import { ensureSimilarityThreshold, searchCards } from "@/lib/cards/search";

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

  try {
    await ensureSimilarityThreshold();
    const results = await searchCards(query, limit);
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
