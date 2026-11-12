import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MagicTracker",
  description:
    "Personal Magic: The Gathering collection, set completion, and deck tracker.",
  /*
   * Noindex, and it covers the shared decklists too. A share link is
   * unlisted rather than public: you hand it to someone, and it does not
   * turn up in a search for the deck's name.
   */
  robots: { index: false, follow: false },
  applicationName: "MagicTracker",
  appleWebApp: {
    capable: true,
    title: "MagicTracker",
    // The iOS status bar sits *over* the page, so "default" keeps dark text
    // on the light background rather than guessing at a translucent one.
    statusBarStyle: "default",
  },
};

/**
 * Installed, the browser paints the status bar and the area around the
 * safe-area insets in theme_color, so it gets a value per scheme rather than
 * one that is wrong half the time. The colours are the two surfaces from
 * globals.css, not the accent: this is the paper behind the app, and a
 * saturated bar above a quiet page reads as a different app.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0b" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
