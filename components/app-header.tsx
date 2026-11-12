import Link from "next/link";

import { signOut } from "@/auth";
import { HeaderNav, type NavKey } from "@/components/header-nav";
import { HeaderSearch } from "@/components/header-search";

/**
 * The app chrome.
 *
 * Still a server component with the same `current` prop every page already
 * passes, so none of them had to change — but the parts that need to react
 * to a click are client components underneath. The sign-out form stays here,
 * because `signOut` is a server action and this is the only file that can
 * call it; it is handed to the nav as children so it can appear inside the
 * menu on a phone and inside the More dropdown on a desktop.
 */
export function AppHeader({ current }: { current?: NavKey }) {
  const signOutForm = (
    <form
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
  );

  return (
    <header className="border-b border-border">
      {/* max-w-5xl matches the widest page container, so the brand lines up
          with the page heading underneath it rather than hanging left. */}
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
        <Link
          href="/"
          className="text-lg font-semibold tracking-tight whitespace-nowrap"
        >
          MagicTracker
        </Link>

        {/*
          Search sits between the brand and the nav, and takes the slack on
          a wide screen. On a phone it drops to its own full-width row,
          which is the right priority: looking a card up is the most common
          thing anyone does here.
        */}
        <div className="order-last w-full sm:order-none sm:ml-2 sm:w-auto sm:flex-1">
          <HeaderSearch />
        </div>

        {/*
          Not wrapped in a positioning div: the nav renders a fragment, so
          its pieces are direct children of this flex row. The phone menu
          panel is one of them and needs `w-full` to wrap onto a line of its
          own — inside a wrapper it would open as a narrow column beside the
          brand instead.
        */}
        <HeaderNav current={current}>{signOutForm}</HeaderNav>
      </div>
    </header>
  );
}
