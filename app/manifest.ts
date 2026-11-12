import type { MetadataRoute } from "next";

/**
 * The web app manifest, so this installs to a phone home screen.
 *
 * This is the whole of "make it a PWA" here, and deliberately so: no service
 * worker, no offline cache, no install prompt. PLAN.md §10 keeps the offline
 * write outbox deferred, and a service worker that cached pages without one
 * would mean a phone showing yesterday's collection with no way to tell.
 * What this buys is the part that was actually missing — an icon on the home
 * screen that opens straight into the app without browser chrome.
 *
 * `display: standalone` rather than `fullscreen`: the status bar is worth
 * keeping when you are standing in a shop checking a list.
 *
 * Two 512s, because Android uses them differently. The `any` icon is drawn
 * as-is, so it keeps its own rounded corners; the `maskable` one is
 * full-bleed with the card shrunk into the safe zone, because the launcher
 * crops it to whatever shape the device likes and a rounded square inside a
 * circle mask loses its corners.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MagicTracker",
    short_name: "MagicTracker",
    description:
      "Personal Magic: The Gathering collection, set completion, deck and value tracker.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    // The light surface from globals.css, matching the `theme-color` meta in
    // app/layout.tsx — the splash screen and the task switcher should look
    // like the app, not like its accent.
    background_color: "#fafafa",
    theme_color: "#fafafa",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
