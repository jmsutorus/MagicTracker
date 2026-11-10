import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Next 16 renamed the `middleware` convention to `proxy`.
 *
 * This is an OPTIMISTIC check only: it asks whether a session cookie exists,
 * so anonymous visitors are bounced to /login cheaply. It does not verify the
 * cookie's signature, its expiry, or the email allowlist. Proxy code runs
 * detached from the render path (it can even be deployed to a CDN edge), so it
 * must not be the thing standing between a stranger and the data.
 *
 * Real authorization is `requireUser()` in lib/auth/dal.ts, called by every
 * page and action that reads or writes anything.
 */
const SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
];

export function proxy(request: NextRequest) {
  const hasSessionCookie = SESSION_COOKIE_NAMES.some((name) =>
    request.cookies.has(name),
  );

  if (hasSessionCookie) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  const { pathname, search } = request.nextUrl;

  if (pathname !== "/") {
    loginUrl.searchParams.set("next", `${pathname}${search}`);
  }

  return NextResponse.redirect(loginUrl);
}

export const config = {
  /**
   * Page routes only — the login page, all of /api, and static assets are
   * excluded.
   *
   * /api is excluded on purpose. Redirecting an API call to /login would hand
   * a `fetch()` a 307 and a page of HTML, which is useless to the caller.
   * Route handlers authenticate themselves via lib/auth/dal.ts and return a
   * JSON 401 instead. Since real authorization was never in the proxy, nothing
   * is weakened by this.
   */
  matcher: [
    "/((?!login|api/|_next/static|_next/image|favicon.ico|robots.txt|manifest.webmanifest).*)",
  ],
};
