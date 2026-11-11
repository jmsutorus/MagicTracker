import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/dal";
import { buyListFilename, formatBuyList, getDeck } from "@/lib/decks/queries";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What this deck still needs, as a shopping list.
 *
 * "Cards I don't own" is the question Phase 5 ends on, and the answer is
 * useful away from the app — at a shop, or pasted into a seller's bulk
 * search. Card names and counts only, no set codes: a deck needs the card
 * and any printing will do.
 *
 * /api is excluded from proxy.ts, so this does its own authorization.
 */
export async function GET(
  _request: Request,
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

  try {
    const deck = await getDeck(id);
    if (!deck) {
      return NextResponse.json({ error: "unknown deck" }, { status: 404 });
    }

    const body = formatBuyList(deck.missing);
    const copies = deck.missing.reduce((n, m) => n + m.need, 0);

    const header = [
      `// ${deck.name} — buy list`,
      `// ${deck.missing.length} card${deck.missing.length === 1 ? "" : "s"}, ${copies} cop${copies === 1 ? "y" : "ies"} needed`,
      `// generated ${new Date().toISOString().slice(0, 10)}`,
      "",
    ].join("\n");

    return new NextResponse(header + body + (body.length > 0 ? "\n" : ""), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${buyListFilename(deck.name)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("buy list failed", error);
    return NextResponse.json(
      { error: "could not build the buy list" },
      { status: 500 },
    );
  }
}
