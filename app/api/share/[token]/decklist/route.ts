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

    // The headings are the ones the paste box reads back (see
    // lib/import/constants.ts), so a downloaded list imports as the sections
    // it left as — a cube's own labels would not round-trip.
    const sections = deck.boards.map(({ board, cards }) => {
      const heading =
        board === "commander"
          ? "// Commander"
          : board === "side"
            ? "// Sideboard"
            : board === "maybe"
              ? "// Maybeboard"
              : "// Deck";
      return `${heading}\n${formatCardList(cards)}`;
    });

    /*
     * Every copy in the file, not the verdict's count: a Standard deck's
     * `cardCount` is its sixty and the sideboard is printed below it, so the
     * verdict's number would be a line that disagrees with the list under it.
     */
    const copies = deck.boards.reduce(
      (total, { cards }) => total + cards.reduce((n, c) => n + c.quantity, 0),
      0,
    );

    const body = [
      `// ${deck.name}`,
      `// ${copies} cards, shared from MagicTracker`,
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
