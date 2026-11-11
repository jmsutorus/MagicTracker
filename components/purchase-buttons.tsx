"use client";

import { useState } from "react";

import {
  formatBuyListText,
  massEntryUrl,
  STORE_LABELS,
  type BuyListEntry,
  type Store,
} from "@/lib/purchase/links";

const STORES: Store[] = ["tcgplayer", "manapool"];

/**
 * "Buy these on TCGplayer / Mana Pool."
 *
 * Neither store accepts a pre-filled list in a URL, so the handoff is: copy
 * the list, open the store's bulk page, paste. Both happen on one click.
 *
 * The button is an anchor rather than a `<button>` that calls `window.open`
 * on purpose. `window.open` after an `await` has lost the user gesture and
 * gets caught by popup blockers; a real link click never does. So the link
 * opens the tab and the handler fires the clipboard copy alongside it.
 */
export function PurchaseButtons({
  entries,
  label,
}: {
  entries: BuyListEntry[];
  /** What the list is, for the sentence above the buttons. */
  label?: string;
}) {
  const [copied, setCopied] = useState<Store | null>(null);
  const [failed, setFailed] = useState(false);

  if (entries.length === 0) return null;

  const text = formatBuyListText(entries);
  const copies = entries.reduce((n, e) => n + e.quantity, 0);

  async function copy(store: Store) {
    try {
      await navigator.clipboard.writeText(text);
      setFailed(false);
      setCopied(store);
      window.setTimeout(() => setCopied(null), 4000);
    } catch {
      // No clipboard permission, or an insecure context. The download link
      // next to these buttons is the fallback, so say so rather than
      // pretending the copy worked.
      setCopied(null);
      setFailed(true);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {STORES.map((store) => (
          <a
            key={store}
            href={massEntryUrl(store)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => void copy(store)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted"
          >
            <CartIcon />
            Buy on {STORE_LABELS[store]}
          </a>
        ))}
      </div>
      <p className="text-xs text-muted" role="status" aria-live="polite">
        {copied
          ? `${copies} ${copies === 1 ? "card" : "cards"} copied — paste into ${STORE_LABELS[copied]}'s box and it prices the lot.`
          : failed
            ? "Couldn't reach the clipboard. Use the download link instead, or copy the list from the file."
            : `Copies ${label ?? "the list"} to your clipboard and opens the store's bulk-entry page.`}
      </p>
    </div>
  );
}

/** A shopping cart — says "external store" without shipping a trademark. */
function CartIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4 shrink-0"
      aria-hidden="true"
    >
      <path d="M1.5 2h2l2 8h7l1.5-6H5.5" />
      <circle cx="6.5" cy="13" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="13" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
