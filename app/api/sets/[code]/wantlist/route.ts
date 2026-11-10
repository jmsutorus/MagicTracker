import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/dal";
import {
  getSetCompletion,
  listMissingPrintings,
} from "@/lib/completion/queries";
import { formatWantList, wantListFilename } from "@/lib/completion/scope";

/**
 * The missing cards for one set, as a want list file.
 *
 * Plain text in the format Moxfield, Archidekt and Deckbox all import, so the
 * list is useful at a shop or in a trade without this app being open.
 *
 * /api is excluded from proxy.ts, so this does its own authorization.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { code } = await params;
  if (!/^[a-z0-9]{1,16}$/i.test(code)) {
    return NextResponse.json({ error: "invalid set code" }, { status: 400 });
  }

  try {
    const completion = await getSetCompletion(code);
    if (!completion) {
      return NextResponse.json({ error: "unknown set" }, { status: 404 });
    }

    const missing = await listMissingPrintings(code);
    const body = formatWantList(completion.code, missing);

    // A comment header so the file still says what it is weeks later. Every
    // importer that reads this format ignores lines starting with //.
    const header = [
      `// ${completion.name} (${completion.code.toUpperCase()}) want list`,
      `// ${completion.owned} of ${completion.target} owned — ${missing.length} missing`,
      `// generated ${new Date().toISOString().slice(0, 10)}`,
      "",
    ].join("\n");

    return new NextResponse(header + body + (body.length > 0 ? "\n" : ""), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${wantListFilename(completion.code)}"`,
        // Depends on the collection, so it must never be cached anywhere.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("want list failed", error);
    return NextResponse.json(
      { error: "could not build the want list" },
      { status: 500 },
    );
  }
}
