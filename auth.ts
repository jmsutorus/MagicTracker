import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

import { matchesAllowlist } from "@/lib/auth/allowlist";

/**
 * Single-user auth.
 *
 * This app is on the public internet, so "no auth" is not an option. But it
 * also has exactly one user, so there is no user table, no registration, and
 * no database adapter — just Google sign-in gated by an email allowlist, with
 * the session carried in a signed JWT cookie.
 *
 * The allowlist comparison itself lives in lib/auth/allowlist.ts as a pure
 * function, and is unit tested there.
 */
export function isAllowedEmail(email: string | null | undefined): boolean {
  return matchesAllowlist(email, process.env.ALLOWED_EMAILS);
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    signIn({ profile }) {
      // Require Google to have verified the address. Without this check, the
      // allowlist could be satisfied by an account that merely claims the
      // address rather than one that proved it.
      if (profile?.email_verified !== true) return false;
      return isAllowedEmail(profile.email);
    },
  },
});
