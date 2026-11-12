"use client";

/**
 * The last resort: an error thrown by the root layout itself, where
 * `app/error.tsx` cannot help because the layout that would wrap it is the
 * thing that failed.
 *
 * It replaces the root layout, so it has to bring its own <html> and <body> —
 * and it cannot rely on the stylesheet or the font variables that layout
 * sets up. Hence the inline styles and the literal hex values rather than the
 * design tokens: this file has to render correctly when nothing else does.
 */
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
          background: "#fbfaf8",
          color: "#1c1a17",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <div style={{ maxWidth: "32rem" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>
            MagicTracker couldn&rsquo;t start
          </h1>
          <p style={{ marginTop: "0.75rem", fontSize: "0.875rem", color: "#6b655c" }}>
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
              background: "#8a5a2b",
              color: "#ffffff",
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
              color: "#9b2c2c",
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
