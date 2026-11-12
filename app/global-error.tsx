"use client";

/**
 * The last resort: an error thrown by the root layout itself, where
 * `app/error.tsx` cannot help because the layout that would wrap it is the
 * thing that failed.
 *
 * It replaces the root layout, so it has to bring its own <html> and <body> —
 * and it cannot rely on the stylesheet or the font variables that layout
 * sets up. Hence the literal values rather than the design tokens: this file
 * has to render correctly when nothing else does.
 *
 * The tokens are declared in a <style> tag rather than written straight into
 * the inline styles so this page still follows the colour scheme. The app is
 * dark-first, and a white flash on a crash is the one place it would be most
 * jarring — the failure should look like the app, not like a raw browser
 * default.
 */

const TOKENS = `
  :root {
    --bg: #fafafa;
    --fg: #18181b;
    --muted: #71717a;
    --accent: #7d6210;
    --accent-contrast: #ffffff;
    --bad: #b03a30;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0a0a0b;
      --fg: #ededee;
      --muted: #8a8a92;
      --accent: #e6c45f;
      --accent-contrast: #0a0a0b;
      --bad: #e05a4e;
    }
  }
`;

export default function GlobalError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const message =
    error instanceof Error ? error.message : "Something went wrong.";

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          background: "var(--bg)",
          color: "var(--fg)",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <style dangerouslySetInnerHTML={{ __html: TOKENS }} />
        <div style={{ maxWidth: "32rem" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>
            MagicTracker couldn&rsquo;t start
          </h1>
          <p
            style={{
              marginTop: "0.75rem",
              fontSize: "0.875rem",
              color: "var(--muted)",
            }}
          >
            Something failed before the app could render. Your collection
            isn&rsquo;t affected — this is the page, not the data.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              marginTop: "1.5rem",
              cursor: "pointer",
              borderRadius: "0.5rem",
              border: "none",
              background: "var(--accent)",
              color: "var(--accent-contrast)",
              padding: "0.625rem 1rem",
              fontSize: "0.875rem",
              fontWeight: 500,
            }}
          >
            Try again
          </button>
          <p
            style={{
              marginTop: "2rem",
              fontFamily: "ui-monospace, monospace",
              fontSize: "0.75rem",
              color: "var(--bad)",
              wordBreak: "break-word",
            }}
          >
            {message}
          </p>
        </div>
      </body>
    </html>
  );
}
