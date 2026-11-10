/**
 * Email allowlist, as a pure function so it can be tested without touching
 * process.env or re-importing modules.
 *
 * Fails closed: an empty, missing, or whitespace-only allowlist permits
 * nobody. A misconfigured deploy is therefore useless to a stranger rather
 * than wide open, which is the correct direction for the mistake to fall.
 */
export function parseAllowlist(raw: string | undefined | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function matchesAllowlist(
  email: string | undefined | null,
  raw: string | undefined | null,
): boolean {
  if (!email) return false;

  const allowed = parseAllowlist(raw);
  if (allowed.length === 0) return false;

  // Exact match only. Substring or suffix matching here would let
  // "you@gmail.com.attacker.test" satisfy an allowlist of "you@gmail.com".
  return allowed.includes(email.trim().toLowerCase());
}
