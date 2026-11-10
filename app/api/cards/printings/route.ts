import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/dal";
import { listPrintingsForOracle } from "@/lib/collection/queries";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every printing of one card, for the name-mode printing picker.
 *
 * /api is excluded from proxy.ts, so this does its own authorization and
 * answers with a JSON 401 rather than a redirect a fetch() cannot use.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const oracleId = new URL(request.url).searchParams.get("oracleId") ?? "";

  // Checked before it reaches a ::uuid cast, which would otherwise raise a
  // 22P02 and surface as a 500 for what is really a bad request.
  if (!UUID_RE.test(oracleId)) {
    return NextResponse.json({ error: "invalid oracleId" }, { status: 400 });
  }

  try {
    const printings = await listPrintingsForOracle(oracleId);
    return NextResponse.json({ printings });
  } catch (error) {
    console.error("printing lookup failed", error);
    return NextResponse.json({ error: "lookup failed" }, { status: 500 });
  }
}
