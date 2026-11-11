"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  createShareLinkAction,
  revokeShareLinkAction,
} from "@/app/decks/actions";

/**
 * The share-link control.
 *
 * `origin` comes from the request's own Host header, passed in by the page,
 * rather than from a configured base URL or from `window.location` in an
 * effect: this app answers at localhost and at a hosted.app domain, a link
 * carrying the wrong one would be discovered by the person you sent it to,
 * and reading it on the server means the full URL is in the first render
 * instead of appearing a frame later.
 */
export function DeckShare({
  deckId,
  token,
  createdAt,
  origin,
}: {
  deckId: string;
  token: string | null;
  createdAt: string | null;
  origin: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const path = token ? `/share/${token}` : null;
  const url = path ? `${origin}${path}` : null;

  async function create() {
    setBusy(true);
    setError(null);
    const result = await createShareLinkAction(deckId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCopied(false);
    startTransition(() => router.refresh());
  }

  async function revoke() {
    setBusy(true);
    setError(null);
    const result = await revokeShareLinkAction(deckId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCopied(false);
    startTransition(() => router.refresh());
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard access is refused on an insecure origin and in some
      // browsers without a user gesture. The input below is selectable, so
      // say so rather than pretending it worked.
      setError("Could not copy. Select the link and copy it yourself.");
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted">
          {token
            ? "Anyone with this link can read the decklist. Not your collection, not what it is worth."
            : "Share a read-only copy of this list with someone who is not signed in."}
        </span>
      </div>

      {token ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            readOnly
            value={url ?? ""}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full max-w-md rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() => void copy()}
            className="cursor-pointer rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:text-foreground"
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <a
            href={path ?? "#"}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-muted underline underline-offset-4 hover:text-foreground"
          >
            Open
          </a>
          <button
            type="button"
            disabled={busy}
            onClick={() => void revoke()}
            className="cursor-pointer text-sm text-muted underline underline-offset-4 hover:text-foreground disabled:opacity-40"
          >
            Turn the link off
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void create()}
            className="cursor-pointer text-sm text-muted underline underline-offset-4 hover:text-foreground disabled:opacity-40"
          >
            Replace it
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => void create()}
          className="mt-2 cursor-pointer rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:text-foreground disabled:opacity-40"
        >
          Create a share link
        </button>
      )}

      {token && createdAt ? (
        <p className="mt-2 text-xs text-muted">
          Link made {createdAt.slice(0, 10)}. Turning it off breaks it
          immediately; replacing it breaks the old one and gives you a new URL.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-sm text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}
