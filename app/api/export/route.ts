import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/dal";
import { buildExport, exportFilename } from "@/lib/export/build";

/**
 * Your data, as a file you keep.
 *
 * The whole point of this route is that it works without me: a plain JSON
 * file, readable in any editor, with card names next to the ids, so a backup
 * is useful even to a tool that has never heard of this app.
 *
 * /api is excluded from proxy.ts, so this does its own authorization.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const data = await buildExport();

    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exportFilename()}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("export failed", error);
    return NextResponse.json(
      { error: "could not build the export" },
      { status: 500 },
    );
  }
}
