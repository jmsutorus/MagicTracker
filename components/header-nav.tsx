"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export type NavKey =
  | "dashboard"
  | "cards"
  | "collection"
  | "locations"
  | "sets"
  | "products"
  | "decks"
  | "wishlist"
  | "value"
  | "import";

/**
 * The links that earn a permanent slot, and the ones that do not.
 *
 * Nine flat links did not fit across a phone and wrapped onto a second and
 * third row, which pushed the page itself below the fold. They were also
 * undifferentiated: "Import" is something you do twice a year and sat beside
 * "Collection", which is the point of the app.
 *
 * So: six primary destinations, and the occasional ones folded into a menu.
 * "Cards" is gone entirely — the header now carries a search box, which is
 * what that link was for.
 */
const PRIMARY: { key: NavKey; href: string; label: string }[] = [
  { key: "dashboard", href: "/", label: "Dashboard" },
  { key: "collection", href: "/collection", label: "Collection" },
  { key: "decks", href: "/decks", label: "Decks" },
  { key: "sets", href: "/sets", label: "Sets" },
  { key: "products", href: "/products", label: "Products" },
  { key: "wishlist", href: "/wishlist", label: "Wishlist" },
];

const SECONDARY: { key: NavKey; href: string; label: string }[] = [
  { key: "value", href: "/value", label: "Value over time" },
  { key: "import", href: "/import", label: "Import a list" },
  { key: "locations", href: "/collection/locations", label: "Locations" },
  { key: "cards", href: "/cards", label: "Card search" },
];

export function HeaderNav({
  current,
  children,
}: {
  current?: NavKey;
  /** The sign-out form, rendered by the server component that owns it. */
  children: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  /* Click away, or press Escape, to dismiss the More menu. */
  useEffect(() => {
    if (!moreOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMoreOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  const linkClass = (key: NavKey) =>
    `text-sm whitespace-nowrap ${
      current === key ? "text-foreground" : "text-muted hover:text-foreground"
    }`;

  return (
    <>
      {/* ---- phone: one button, and a panel under the header ------------ */}
      <button
        type="button"
        onClick={() => setMenuOpen((o) => !o)}
        aria-expanded={menuOpen}
        aria-controls="header-menu"
        className="ml-auto cursor-pointer rounded-lg border border-border px-2.5 py-1.5 text-sm text-muted hover:text-foreground lg:hidden"
      >
        <span aria-hidden>{menuOpen ? "✕" : "☰"}</span>
        <span className="sr-only">Menu</span>
      </button>

      {/* ---- desktop: the primary six, then More ------------------------ */}
      <nav className="ml-auto hidden items-center gap-x-4 lg:flex">
        {PRIMARY.map((item) => (
          <Link key={item.href} href={item.href} className={linkClass(item.key)}>
            {item.label}
          </Link>
        ))}

        <div ref={moreRef} className="relative">
          <button
            type="button"
            onClick={() => setMoreOpen((o) => !o)}
            aria-expanded={moreOpen}
            className="cursor-pointer text-sm text-muted hover:text-foreground"
          >
            More <span aria-hidden>▾</span>
          </button>

          {moreOpen ? (
            <div className="absolute right-0 top-full z-50 mt-2 w-48 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-xl">
              {SECONDARY.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className="block px-3 py-2 text-sm text-muted hover:bg-surface-muted hover:text-foreground"
                >
                  {item.label}
                </Link>
              ))}
              <a
                href="/api/export"
                className="block border-t border-border px-3 py-2 text-sm text-muted hover:bg-surface-muted hover:text-foreground"
              >
                Download a backup
              </a>
              <div className="border-t border-border px-3 py-2">{children}</div>
            </div>
          ) : null}
        </div>
      </nav>

      {menuOpen ? (
        <div
          id="header-menu"
          /* `order-last` keeps it under the search box, which is itself
             ordered last on a phone — otherwise the menu opens between the
             brand and the search field. */
          className="order-last w-full border-t border-border pt-3 lg:hidden"
        >
          <nav className="flex flex-col gap-1">
            {[...PRIMARY, ...SECONDARY].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className={`rounded-md px-2 py-2 ${linkClass(item.key)}`}
              >
                {item.label}
              </Link>
            ))}
            <a
              href="/api/export"
              className="rounded-md px-2 py-2 text-sm text-muted hover:text-foreground"
            >
              Download a backup
            </a>
            <div className="border-t border-border px-2 pt-2">{children}</div>
          </nav>
        </div>
      ) : null}
    </>
  );
}
