import { redirect } from "next/navigation";

import { signIn } from "@/auth";
import { getCurrentUser } from "@/lib/auth/dal";

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied:
    "That Google account isn't on the allowlist. Add it to ALLOWED_EMAILS and try again.",
  Configuration:
    "Auth isn't configured. Check AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET and AUTH_SECRET.",
  Verification: "That sign-in link expired. Try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  // searchParams is a Promise in Next 16.
  const { next, error } = await searchParams;

  // Already signed in? Don't make them click the button again.
  const user = await getCurrentUser();
  if (user) {
    redirect(next && next.startsWith("/") ? next : "/");
  }

  const message = error
    ? (ERROR_MESSAGES[error] ?? "Sign-in failed. Try again.")
    : null;

  return (
    <main className="flex-1 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">MagicTracker</h1>
        <p className="mt-2 text-sm text-muted">
          Personal collection, set completion, and Commander decks.
        </p>

        {message ? (
          <p
            role="alert"
            className="mt-6 rounded-md border border-border bg-surface-muted px-3 py-2 text-sm text-bad"
          >
            {message}
          </p>
        ) : null}

        <form
          className="mt-6"
          action={async () => {
            "use server";
            // Only allow relative redirect targets — an absolute URL here
            // would turn the login page into an open redirect.
            const target = next && next.startsWith("/") ? next : "/";
            await signIn("google", { redirectTo: target });
          }}
        >
          <button
            type="submit"
            className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-accent-contrast hover:opacity-90 cursor-pointer"
          >
            Continue with Google
          </button>
        </form>

        <p className="mt-6 text-xs text-muted">
          Sign-in is restricted to a fixed email allowlist. This is a private
          app for one person.
        </p>
      </div>
    </main>
  );
}
