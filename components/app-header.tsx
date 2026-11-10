import Link from "next/link";

import { signOut } from "@/auth";

export function AppHeader({
  current,
}: {
  current?: "dashboard" | "cards" | "collection";
}) {
  const navClass = (key: string) =>
    `text-sm ${
      current === key
        ? "text-foreground"
        : "text-muted hover:text-foreground"
    }`;

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex w-full max-w-4xl items-center gap-5 px-4 py-4">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          MagicTracker
        </Link>

        <nav className="flex items-center gap-4">
          <Link href="/" className={navClass("dashboard")}>
            Dashboard
          </Link>
          <Link href="/collection" className={navClass("collection")}>
            Collection
          </Link>
          <Link href="/cards" className={navClass("cards")}>
            Cards
          </Link>
        </nav>

        <form
          className="ml-auto"
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button
            type="submit"
            className="cursor-pointer text-sm text-muted underline underline-offset-4 hover:text-foreground"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
