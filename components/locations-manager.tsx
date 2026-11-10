"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  createLocationAction,
  deleteLocationAction,
  renameLocationAction,
} from "@/app/collection/actions";
import { LOCATION_KINDS } from "@/lib/collection/constants";
import type { LocationRow } from "@/lib/collection/queries";

/**
 * Create, rename and delete the places cards live.
 *
 * Deleting is only offered for an empty location. The foreign key is ON
 * DELETE RESTRICT so the database would refuse anyway, but hiding the button
 * is better than offering an action that cannot work: the alternative designs
 * are losing the collection rows or silently moving cards somewhere the user
 * did not choose, and neither is a fair reading of "delete this binder".
 */
export function LocationsManager({ locations }: { locations: LocationRow[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<string>("box");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function create() {
    setError(null);
    const result = await createLocationAction(newName, newKind);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNewName("");
    refresh();
  }

  async function rename(id: string) {
    setError(null);
    const result = await renameLocationAction(id, editingName);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEditingId(null);
    refresh();
  }

  async function remove(id: string) {
    setError(null);
    const result = await deleteLocationAction(id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    refresh();
  }

  const inputClass =
    "rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent";

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-surface-muted p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          New location
        </h2>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Name</span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void create();
                }
              }}
              placeholder="Binder A"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Kind</span>
            <select
              value={newKind}
              onChange={(e) => setNewKind(e.target.value)}
              className={inputClass}
            >
              {LOCATION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void create()}
            className="cursor-pointer rounded-lg bg-accent px-3 py-2 text-sm text-accent-contrast"
          >
            Create
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Kind</th>
              <th className="px-4 py-2 text-right font-medium">Cards</th>
              <th className="px-4 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {locations.map((l) => (
              <tr key={l.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2">
                  {editingId === l.id ? (
                    <input
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void rename(l.id);
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setEditingId(null);
                        }
                      }}
                      autoFocus
                      className={inputClass}
                    />
                  ) : (
                    l.name
                  )}
                </td>
                <td className="px-4 py-2 text-muted">{l.kind}</td>
                <td className="px-4 py-2 text-right font-mono">
                  {l.cardCount.toLocaleString()}
                </td>
                <td className="px-4 py-2 text-right">
                  <div className="flex items-center justify-end gap-3 text-xs">
                    {editingId === l.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void rename(l.id)}
                          className="cursor-pointer underline underline-offset-4"
                        >
                          save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="cursor-pointer text-muted underline underline-offset-4"
                        >
                          cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(l.id);
                          setEditingName(l.name);
                        }}
                        className="cursor-pointer text-muted underline underline-offset-4 hover:text-foreground"
                      >
                        rename
                      </button>
                    )}

                    {l.cardCount === 0 && locations.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => void remove(l.id)}
                        className="cursor-pointer text-muted underline underline-offset-4 hover:text-bad"
                      >
                        delete
                      </button>
                    ) : (
                      <span className="text-muted" title="Only empty locations can be deleted">
                        —
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
