import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/dal";
import { searchDeckCards } from "@/lib/decks/queries";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Card search for the deck editor, answering "do I own one" in the same
 * response.
 *
 * Deck-scoped rather than a general card search, because the two facts that
 * make the result useful — how many copies are free to build with, and
 * whether the card fits the commander's colour identity — are both relative
 * to this deck. Calling the generic search and then asking twice more per
 * row is what makes other trackers feel slow.
 *
 * /api is excluded from proxy.ts, so this does its own authorization.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "unknown deck" }, { status: 400 });
  }

  const query = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 80);

  try {
    const results = await searchDeckCards(id, query, 12);
    return NextResponse.json(
      { results },
      // Depends on the collection, so it must never be cached anywhere.
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("deck card search failed", error);
    return NextResponse.json({ error: "search failed" }, { status: 500 });
  }
}
