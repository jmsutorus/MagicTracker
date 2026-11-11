import Link from "next/link";

import { signOut } from "@/auth";

export function AppHeader({
  current,
}: {
  current?:
    | "dashboard"
    | "cards"
    | "collection"
    | "sets"
    | "products"
    | "decks"
    | "wishlist"
    | "value"
    | "import";
}) {
  const navClass = (key: string) =>
    `text-sm ${
      current === key ? "text-foreground" : "text-muted hover:text-foreground"
    }`;

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-4">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          MagicTracker
        </Link>

        {/* Wraps rather than overflowing: nine links do not fit across a
            phone, and a nav that scrolls sideways hides its own last item. */}
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link href="/" className={navClass("dashboard")}>
            Dashboard
          </Link>
          <Link href="/collection" className={navClass("collection")}>
            Collection
          </Link>
          <Link href="/decks" className={navClass("decks")}>
            Decks
          </Link>
          <Link href="/sets" className={navClass("sets")}>
            Sets
          </Link>
          <Link href="/products" className={navClass("products")}>
            Products
          </Link>
          <Link href="/cards" className={navClass("cards")}>
            Cards
          </Link>
          <Link href="/wishlist" className={navClass("wishlist")}>
            Wishlist
          </Link>
          <Link href="/value" className={navClass("value")}>
            Value
          </Link>
          <Link href="/import" className={navClass("import")}>
            Import
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
