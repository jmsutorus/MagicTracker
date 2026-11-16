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
    // Card images are hotlinked from the catalogs' own CDNs rather than
    // re-hosted, which Scryfall's API terms require and the others are
    // served for. See PLAN.md §4.
    //
    // The non-Scryfall hosts arrived with multi-game support: Pokémon images
    // are served from scrydex (recent sets) and pokemontcg.io (older ones),
    // and One Piece images from the OPTCG API's own media path. Listed even
    // though every <Image> here passes `unoptimized`, so that a future
    // optimised one does not fail at runtime on a host nobody remembered.
    remotePatterns: [
      { protocol: "https", hostname: "cards.scryfall.io" },
      { protocol: "https", hostname: "svgs.scryfall.io" },
      { protocol: "https", hostname: "images.pokemontcg.io" },
      { protocol: "https", hostname: "images.scrydex.com" },
      { protocol: "https", hostname: "optcgapi.com" },
    ],
  },
};

export default nextConfig;
