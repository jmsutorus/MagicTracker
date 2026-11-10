import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/dal";
import { findPrintingsByCollectorNumber } from "@/lib/collection/queries";
import {
  describeParseFailure,
  parseCollectorNumberEntry,
} from "@/lib/collection/parse";

/**
 * Collector-number lookup for pack entry: given a pinned set and whatever was
 * typed, what card is that?
 *
 * The typed string is parsed here rather than on the client so that the
 * quantity rules have exactly one implementation, and so a caller that skips
 * the UI gets the same answer.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const setCode = (params.get("set") ?? "").trim();
  const raw = params.get("number") ?? "";

  if (setCode.length === 0 || setCode.length > 16) {
    return NextResponse.json({ error: "Pin a set first." }, { status: 400 });
  }
  if (raw.length > 32) {
    return NextResponse.json(
      { error: "That is too long to be a collector number." },
      { status: 400 },
    );
  }

  const parsed = parseCollectorNumberEntry(raw);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: describeParseFailure(parsed.reason) },
      { status: 400 },
    );
  }

  try {
    const candidates = await findPrintingsByCollectorNumber(
      setCode,
      parsed.collectorNumber,
    );

    return NextResponse.json({
      quantity: parsed.quantity,
      collectorNumber: parsed.collectorNumber,
      candidates,
    });
  } catch (error) {
    console.error("collector number lookup failed", error);
    return NextResponse.json({ error: "lookup failed" }, { status: 500 });
  }
}
