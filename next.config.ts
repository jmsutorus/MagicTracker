import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Cache Components is off for now.
   *
   * The scaffold enables it by default, and it is genuinely valuable for pages
   * that are mostly static with dynamic islands. This app is the opposite
   * shape right now: every page reads the signed-in session and that user's
   * own collection, so nothing is cacheable and the only effect would be
   * Suspense boundaries everywhere for no user-visible gain.
   *
   * Worth revisiting in Phase 1: card and set pages render global, immutable
   * card data, which is exactly what `"use cache"` is for.
   */
  cacheComponents: false,
  // `partialPrefetching` requires `cacheComponents`, so it comes back with it.

  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  images: {
    // Card images are hotlinked from Scryfall's CDN rather than re-hosted,
    // which their API terms require. See PLAN.md §4.
    remotePatterns: [
      { protocol: "https", hostname: "cards.scryfall.io" },
      { protocol: "https", hostname: "svgs.scryfall.io" },
    ],
  },
};

export default nextConfig;
