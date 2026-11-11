import { NextResponse } from "next/server";

import { formatCardList } from "@/lib/import/parse";
import { getSharedDeck, sharedListFilename } from "@/lib/decks/share";

/**
 * A shared decklist as plain text.
 *
 * Public, like the page it sits under — the token is the authorization, and
 * `getSharedDeck` returns null for a token that was never issued or has been
 * revoked. Nothing here reads the session at all.
 *
 * The format is `formatCardList` from the import parser, which makes this the
 * parser's own inverse: the file this hands out is one the paste box accepts.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  try {
    const deck = await getSharedDeck(token);
    if (!deck) {
      return NextResponse.json({ error: "unknown link" }, { status: 404 });
    }

    const sections = deck.boards.map(({ board, cards }) => {
      const heading =
        board === "commander"
          ? "// Commander"
          : board === "maybe"
            ? "// Maybeboard"
            : "// Deck";
      return `${heading}\n${formatCardList(cards)}`;
    });

    const body = [
      `// ${deck.name}`,
      `// ${deck.legality.cardCount} cards, shared from MagicTracker`,
      "",
      sections.join("\n\n"),
      "",
    ].join("\n");

    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${sharedListFilename(deck.name)}"`,
        // The link's owner can revoke it; a cached copy at a CDN would
        // outlive the revoke.
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("shared decklist failed", error);
    return NextResponse.json(
      { error: "could not build the list" },
      { status: 500 },
    );
  }
}
