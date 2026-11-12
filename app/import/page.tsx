import { AppFooter } from "@/components/app-footer";
import { AppHeader } from "@/components/app-header";
import { ImportPaste } from "@/components/import-paste";
import { requireUser } from "@/lib/auth/dal";
import { listLocations } from "@/lib/collection/queries";
import { DEFAULT_LOCATION_NAME } from "@/lib/collection/constants";
import { listDecks } from "@/lib/decks/queries";

export const metadata = { title: "Import · MagicTracker" };

export default async function ImportPage() {
  await requireUser();

  const [locations, decks] = await Promise.all([listLocations(), listDecks()]);

  // The seeded default, so the common case needs no choosing. Falls back to
  // the first location rather than to nothing, because an install that
  // renamed "Unsorted" should still land somewhere sensible.
  const defaultLocation =
    locations.find((l) => l.name === DEFAULT_LOCATION_NAME) ?? locations[0];

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader current="import" />

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Import a list</h1>
        {/* Kept, unlike the other page subtitles: this one faces an empty
            textarea and answers "what am I supposed to paste here", which
            the page cannot answer by showing its contents. */}
        <p className="mt-2 text-sm text-muted">
          Paste a decklist or a CSV export. Nothing is stored until you say so.
        </p>

        <div className="mt-6">
          <ImportPaste
            locations={locations.map((l) => ({ id: l.id, name: l.name }))}
            decks={decks.map((d) => ({
              id: d.id,
              name: d.name,
              format: d.format,
            }))}
            defaultLocationId={defaultLocation?.id ?? null}
          />
        </div>

        <section className="mt-10 rounded-lg border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            What it understands
          </h2>
          <ul className="mt-3 space-y-1 text-sm text-muted">
            <li>
              <span className="text-foreground">Decklists</span> — Arena,
              Moxfield, Archidekt, Deckstats, TappedOut and MTGGoldfish exports,
              and plain{" "}
              <span className="font-mono text-xs">4 Lightning Bolt</span> lines.
            </li>
            <li>
              <span className="text-foreground">CSV and TSV</span> — Deckbox and
              ManaBox exports, or anything with a card-name column. A Scryfall
              id column is used when there is one.
            </li>
            <li>
              <span className="text-foreground">Set codes</span> —{" "}
              <span className="font-mono text-xs">(LTC) 284</span>,{" "}
              <span className="font-mono text-xs">[LTC]</span>, or a set&rsquo;s
              full name. Treated as a hint: an unrecognised one is reported and
              the card is matched by name anyway.
            </li>
            <li>
              <span className="text-foreground">Foil markers</span> —{" "}
              <span className="font-mono text-xs">*F*</span>,{" "}
              <span className="font-mono text-xs">*E*</span> for etched, and a
              CSV foil or condition column.
            </li>
            <li>
              <span className="text-foreground">Sections</span> — Commander,
              Deck and Sideboard headings, including{" "}
              <span className="font-mono text-xs">{"//Main"}</span> and{" "}
              <span className="font-mono text-xs">SB:</span>. A sideboard lands
              on the maybeboard, since Commander has none.
            </li>
          </ul>
        </section>
      </main>

      <AppFooter />
    </div>
  );
}
