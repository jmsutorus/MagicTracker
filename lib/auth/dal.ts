import { redirect } from "next/navigation";

import { auth, isAllowedEmail } from "@/auth";

export type CurrentUser = {
  email: string;
  name: string | null;
  image: string | null;
};

/**
 * The secure authorization check — the Data Access Layer from Next's own
 * authentication guidance.
 *
 * `proxy.ts` only does the cheap optimistic check (is a session cookie
 * present?) so unauthenticated visitors get redirected without a round trip to
 * the session. It is explicitly NOT authorization. Every page, server action
 * and route handler that touches real data calls this instead.
 *
 * It re-verifies the allowlist rather than trusting the JWT alone, because a
 * JWT issued before an email was removed from ALLOWED_EMAILS would otherwise
 * keep working until it expired.
 */
export async function requireUser(): Promise<CurrentUser> {
  const session = await auth();
  const email = session?.user?.email;

  if (!isAllowedEmail(email)) {
    redirect("/login");
  }

  return {
    email: email!.toLowerCase(),
    name: session?.user?.name ?? null,
    image: session?.user?.image ?? null,
  };
}

/** Non-redirecting variant, for places that need to render either way. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  const email = session?.user?.email;

  if (!isAllowedEmail(email)) return null;

  return {
    email: email!.toLowerCase(),
    name: session?.user?.name ?? null,
    image: session?.user?.image ?? null,
  };
}
