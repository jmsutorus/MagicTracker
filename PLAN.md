# MagicTracker — Build Plan

A self-hosted Magic: The Gathering collection tracker. No subscription, no vendor lock-in,
runs on free tiers indefinitely at personal scale.

**Status:** planning. Nothing built yet.
**Database:** Neon Postgres (decision recorded in §2).

---

## 1. Context

Established requirements:

- **Formats played:** Commander and sealed. This narrows Phase 5 considerably — Commander rules
  (singleton, color identity, 100 cards) instead of a general multi-format legality engine.
- **Existing collection:** none. Nothing to migrate, so bulk import is a convenience rather than
  a day-one blocker.
- **Collection size:** a few hundred cards. Scale is a non-issue; no pagination or
  virtualization needed anywhere, and no database sizing concerns for personal data.
- **Project:** new, from scratch.
- **Set definition:** cards sharing a set symbol. Bloomburrow and Bloomburrow Commander are
  different sets. Implemented as Scryfall set code — see §4.

Sealed play has a design consequence worth noting up front: cards arrive **a pack at a time, in
set order**, which makes collector-number entry the fastest path (§7, Phase 2).

## 2. Goals

1. **Add cards fast.** Keyboard-driven entry by name or collector number.
2. **Set completion.** Track what I own against the master list for a set; show what's missing.
3. **Add a whole sealed product in one action.** Buy a precon → all ~100 cards land at once.
4. **Build Commander decks from the collection,** flagging cards I don't own yet.
5. **Know where a card physically is.** Binder, box, or inside a built deck.
6. **Track collection value** over time.

Non-goals for now: camera/OCR scanning (deferred — §10), trading, multi-user, selling.

---

## 3. Stack

| Layer | Choice | Why |
|---|---|---|
| App | Next.js (App Router) + TypeScript | Server actions reach Postgres directly; no separate API layer |
| Database | **Neon Postgres, Free plan** | 1 GB storage/project, 100 CU-hours/mo, 5 GB egress, 100 projects, no credit card, permanent. Autosuspends after 5 min idle, resumes in a few hundred ms |
| ORM / migrations | Drizzle | Lightweight, serverless-friendly, migrations stay readable SQL |
| Hosting | **Firebase App Hosting** | GCP-native, git-push deploys, built on Cloud Run. Requires the Blaze plan — see below |
| Auth | Auth.js, Google provider, single-email allowlist | ~30 min of work, no passwords. This app is on the public internet |
| Ingest | Node script as a **Cloud Run Job**, triggered by **Cloud Scheduler** | Bulk card files exceed serverless request limits, and the job needs no machine left on. Kept inside GCP so the database credential never leaves the project that already holds every other secret |
| UI | Tailwind + shadcn/ui | Fast to build, looks intentional without a design phase |

### Hosting: Firebase App Hosting, and what it costs us

The app cannot be a static export — it server-renders, uses server actions, runs the Auth.js
route handler, and holds a `DATABASE_URL` that must never reach the browser. On Firebase that
means App Hosting, and **App Hosting requires the Blaze plan**, so a billing account gets
attached to the project. That is a real departure from the original "$0, no credit card"
property, accepted deliberately.

In practice it should still be free. The no-cost quotas are aggregated per billing account and
reset monthly: 10 GiB/month App Hosting bandwidth, Cloud Run's 2M requests / 180k vCPU-seconds
/ 360k GiB-seconds, 2,500 Cloud Build minutes. Firebase's own worked example puts 10K visits at
about $0.01, and with `minInstances: 0` an idle app bills nothing. Guardrails regardless: a
billing budget alert and a Cloud Run spend cap, both of which Firebase's docs recommend.

**Known risk: Next.js version.** App Hosting's published support matrix lists 15.2.x as the
only *Active* version, with 13.5/14.2/15.0/15.1 on LTS, and says newer versions "might work,
but aren't officially supported." We run 16.4.6. Firebase's own March 2026 post calls Next
**16.2** the new baseline for the stable Deployment Adapter API, so the matrix appears to trail
their own adapter work — but 16.4.6 is not officially supported, and that post explicitly warns
that "not every Next.js feature, such as Cache Components and **Proxy**, is available or
behaves the same across all providers yet."

Proxy is what our unauthenticated redirect uses, so that warning lands directly on us — and the
architecture already absorbs it. `proxy.ts` performs only the optimistic cookie check; all real
authorization is `requireUser()` in the Data Access Layer (§6). On a provider where Proxy
misbehaves we lose a cheap redirect, not the security boundary. Following Next's recommended
split bought provider portability for free.

**Fallback if the Next 16 build won't cooperate:** deploy the same app as a container to Cloud
Run directly. Same infrastructure underneath, same billing profile, and no framework version
matrix at all, because we control the runtime. Nothing in the codebase is App Hosting-specific
beyond `apphosting.yaml`.

### Decision: Neon over Firestore

Both are free at this scale, and with a few hundred cards neither would strain. The deciding
factor is shape, not size: **this app's two headline features are set-difference operations.**

"Which cards in Bloomburrow do I not own?" is an anti-join. "Which cards does this deck need
that aren't in my collection?" is an anti-join. "Which commanders could I build from what I
own?" is a join with an array-subset predicate. In SQL each is one query, and each scope toggle
(booster-only, variants, foil axis) is a `WHERE` clause. Firestore cannot join, so all of it
becomes fetch-both-sides-and-diff-in-JavaScript, with every toggle as more client code.

Four more concrete advantages:

1. **The card database fits in the database.** ~110k printings projected to the columns we
   actually render is roughly 150–200 MB with indexes, inside Neon's 1 GB. The Firestore plan
   couldn't do this — 110k docs against a 20K writes/day cap is a six-day ingest, and index
   overhead would have eaten most of the 1 GiB allowance before recording a single card of
   mine. So that plan pushed the card database out into a tree of versioned static JSON
   artifacts on a CDN, with a manifest, cache-busting, per-set partitioning and a daily transfer
   budget to respect. **That machinery was about 40% of the architecture and existed purely to
   work around Firestore.** Deleting it is the single largest simplification available here.
2. **Fuzzy card-name search is native** via `pg_trgm`. Firestore has no full-text search —
   Google's own guidance is to add Algolia or Typesense (another service, another bill), or hand
   roll a client-side index to ship and version.
3. **Commander color identity** is `color_identity <@ commander_identity` with Postgres array
   operators. Firestore's `array-contains` cannot express "is a subset of."
4. **Ad-hoc SQL against my own collection.** For a personal project, being able to just open a
   console and ask a new question is a recurring benefit that never shows up in a feature list.

Firebase familiarity was the original reason to pick it, and that reason is weaker now — the
Neon-backed Earthbound/Cairnholm app means both are familiar, with Neon tooling already in hand.

**What Firestore genuinely wins, and we're giving up:** offline write persistence. Entry in a
bad-signal shop basement would queue locally and sync later. At a few hundred cards, most entry
happens at home, and if it ever matters, a PWA with an IndexedDB outbox recovers most of it
(§10). That is the honest cost of this decision.

**Also rejected: Firebase SQL Connect** (formerly Data Connect). On paper ideal — managed
Postgres inside Firebase. In practice it's Cloud SQL with a wrapper and no free tier: the Spark
trial runs 90 days at ~8,000 ops/day, then the instance is archived and unreachable, deleted 90
days later. The Blaze trial is 3 months on a fixed config, and changing that config ends it.
After that, [Firebase documents Cloud SQL as starting ~$9.37/month](https://firebase.google.com/docs/sql-connect/pricing)
— the same order as the subscriptions this project exists to avoid, with a 90-day timer attached.

---

## 4. Card data: sets and completion

### Data sources

**Scryfall — the card database.** Bulk file `default_cards` (~500 MB JSON, ~110k printings),
refreshed daily, served from `*.scryfall.io` which is **not** rate-limited.

Compliance rules, honored from the first commit (this is how we keep access):
- Use bulk files; never crawl the API card-by-card.
- Send a descriptive `User-Agent` and an explicit `Accept` header — both are required, and
  omitting them returns 403. Use a generic client name; never put personal details in headers.
- Any live API calls stay under 10/sec with 50–100 ms courtesy delay; search endpoints 2/sec.
- Cache at least 24 h. Don't re-host card images — hotlink Scryfall's CDN.
- Don't repackage or redistribute the dataset. Keep the deployment private.

*Image optimization:* Scryfall image URLs are derivable from the card's UUID
(`cards.scryfall.io/{size}/front/{id[0]}/{id[1]}/{id}.jpg`), so we store the ID and build URLs
in code rather than storing several URL variants per printing.

**MTGJSON — sealed products and precon decklists.** Scryfall doesn't model "what's inside this
product"; MTGJSON does, and it's the only reason goal #3 is achievable.
- `AllPrintings.json` — per-set `sealedProduct[]`: `uuid`, `name`, `category`, `subtype`,
  `cardCount`, `contents` (typed sub-lists: `card`, `deck`, `pack`, `sealed`, `variable`).
- `DeckList.json` + `AllDeckFiles.zip` — per-deck `commander[]`, `mainBoard[]`, `sideBoard[]`,
  `tokens[]`, and `sealedProductUuids[]` cross-referencing containing products.
- `AllPricesToday.json` — current prices keyed by MTGJSON uuid.

**The join:** MTGJSON `CardDeck` objects expose `identifiers.scryfallId`. So Scryfall is the
card database and MTGJSON is the product overlay mapped onto Scryfall printings. Unresolved rows
get logged, never silently dropped — expect a few on brand-new products.

### Implementing "same set symbol"

Verified against the live API, using Bloomburrow:

| Set | Code | `set_type` | `parent_set_code` | Icon |
|---|---|---|---|---|
| Bloomburrow | `blb` | expansion | — | `sets/blb.svg` |
| Bloomburrow Commander | `blc` | commander | `blb` | `sets/blc.svg` |
| Bloomburrow Promos | `pblb` | promo | `blb` | `sets/blb.svg` |

**Set code is the grouping key, not the icon.** The rule "same symbol = same set" gives exactly
the BLB ≠ BLC split required — they have distinct codes *and* distinct icons. But promo sets
**reuse the parent's icon file**, so keying on the icon would silently fold 160 prerelease-
stamped and buy-a-box promos into "complete Bloomburrow." Keying on set code separates them
correctly, and excluding `set_type = 'promo'` by default matches intent.

**The second axis the rule can't settle.** Within `blb`, some cards share both code and icon yet
clearly aren't the same completion goal:

- 266 cards are booster-obtainable (`is:booster`)
- 75 are borderless or extended-art Collector Booster treatments
- `card_count` on the set object is 397, which includes extras Scryfall files under `blb`

So "complete Bloomburrow" is 281 or 397 depending on whether the treatments count. There is no
objectively right answer, which is why it's a stored per-set rule rather than a hardcoded
constant — with the default being **booster-only, any finish**, the most common meaning of
"I completed the set."

```sql
completion_targets (
  set_code     text PRIMARY KEY REFERENCES sets(code) ON DELETE CASCADE,
  booster_only      boolean NOT NULL DEFAULT true,
  include_promos    boolean NOT NULL DEFAULT false,
  include_extras    boolean NOT NULL DEFAULT false,
  finish            text    NOT NULL DEFAULT 'any'   -- any | nonfoil | foil | etched
)
```

Every completion view reads these flags. Change them per set from the UI and the progress bar
recalculates — because it's a query, not a precomputed number.

**Measured when Phase 3 was built**, which corrected three things above:

| | |
|---|---|
| `blb` printings (en) | 397 |
| of those, booster-obtainable | **281** (collector numbers 1–281) |
| non-booster treatments | 116 (borderless showcase, extended art, promos) |
| `is_variation` across blb/blc/pblb | **0** |

- The booster count is **281**, not the 266 estimated earlier.
- **`include_variants` is gone.** It was specified as `NOT is_variation`, and Scryfall sets
  `variation` on nothing in these sets — the toggle would have been inert. The treatments it was
  meant to control are exactly the non-booster cards, so `booster_only` already draws that line.
  `include_extras` (art series, tokens) replaces it and does something real.
- **An exclusion is ignored when it would empty the set.** Of ~971 non-digital sets with cards,
  most have *zero* booster-obtainable printings: all 46 commander sets, all 26 duel decks, 277 of
  278 promo sets. Applying `booster_only` unconditionally would report a completion target of
  zero cards for most sets anyone owns — including every Commander precon. So each flag applies
  only when the set has something for it to narrow to. Note this is per-flag, not all-or-nothing:
  `blc` ignores `booster_only` (no booster cards) but still honors the promo exclusion, giving a
  default target of 355 of its 356 printings.
- `finish` gained a fourth value, `etched`, rather than making `foil` mean two things.

---

## 5. Schema

### The three notions of "card"

Keeping these separate is the most important modeling decision, and where most trackers go wrong:

| Level | Example | Who cares |
|---|---|---|
| **Oracle card** | "Lightning Bolt", the game object | Decks, legality, singleton rules |
| **Printing** | Lightning Bolt, 2ED #162 | Set completion, prices, images |
| **Collection item** | 2 copies, foil, NM, in Binder A | What I physically own |

Collapsing printing into oracle card breaks set completion. Collapsing collection item into
printing breaks foils, conditions, and locations.

```sql
-- ======== Card database: machine-owned, rebuilt by ingest, never hand-edited ========
sets              (code PK, mtgjson_code, name, set_type, released_at, card_count,
                   parent_set_code, icon_svg_uri, digital)
oracle_cards      (oracle_id PK, name, mana_cost, cmc, type_line, oracle_text,
                   colors text[], color_identity text[], keywords text[],
                   legalities JSONB, reserved, edhrec_rank)
printings         (scryfall_id PK, oracle_id FK, set_code FK, collector_number, name,
                   rarity, lang, finishes text[], is_booster, is_promo, is_variation,
                   frame_effects text[], border_color, released_at,
                   mtgjson_uuid, tcgplayer_id,
                   UNIQUE (set_code, collector_number, lang))

sealed_products   (uuid PK, set_code FK, name, category, subtype, card_count, release_date)
precon_decks      (id PK, mtgjson_file_name UNIQUE, name, set_code FK, type, release_date)
precon_deck_cards (precon_deck_id FK, printing_id FK, board, quantity, is_foil)
product_contents  (sealed_product_uuid FK, kind, precon_deck_id FK NULL,
                   printing_id FK NULL, quantity)

-- ======== Mine: human-owned, backed up, ingest never writes here ========
locations         (id PK, name, kind)   -- binder | box | deck | tradeable | sold
collection_items  (id PK, printing_id FK, finish, condition,
                   location_id FK NOT NULL, quantity, acquired_at,
                   acquired_price_cents, notes,
                   UNIQUE (printing_id, finish, condition, location_id))
completion_targets(... see §4 ...)
decks             (id PK, name, format, commander_printing_id FK NULL, notes,
                   is_physical, location_id FK NULL)
deck_cards        (id PK, deck_id FK, oracle_id FK, printing_id FK NULL,
                   board, quantity, is_allocated)
price_snapshots   (printing_id FK, finish, source, snapshot_date, price_cents,
                   PRIMARY KEY (printing_id, finish, source, snapshot_date))
ingest_runs       (id PK, source, started_at, finished_at, status, row_count,
                   mtgjson_version, scryfall_bulk_updated_at, warnings JSONB)
```

**Indexes that matter:** `pg_trgm` GIN on `oracle_cards.name` and `printings.name` for fuzzy
search; btree on `(set_code, collector_number)` for pack entry; btree on
`collection_items.printing_id`.

**The hard line:** ingest may rebuild the machine-owned tables and must never write to the
human-owned ones. Those reference printings by `scryfall_id`, which is stable across rebuilds.
(Phase 1 tightened this: the ingest upserts and never truncates, because `collection_items`
references `printings.scryfall_id` with `ON DELETE RESTRICT`.)

**Two departures from the sketch above, settled while building Phase 2:**

- **No `language` column on `collection_items`.** Scryfall models each language as its own
  printing, so `printings.lang` already answers it. A second copy of the same fact could only
  ever disagree with the first. It is dropped from the unique key too.
- **`location_id` is NOT NULL**, defaulting to a seeded `Unsorted` row. Partly because "where
  is it" is a question this app exists to answer, and partly because the unique key cannot work
  without it: Postgres treats NULLs as distinct, so every unplaced copy of a card would get its
  own row instead of merging into one quantity.

**Don't double-count cards in built decks.** `deck_cards.is_allocated` separates a deck that
physically exists in a box (cards are spoken for) from a deck that's only a list (cards are
still in the binder, available to other decks). Completion and "available to build with" both
read it.

### The query that justifies the whole stack

Missing cards for a set, honoring the §4 scope rules:

```sql
SELECT p.collector_number, p.name, p.rarity
FROM printings p
JOIN completion_targets t ON t.set_code = p.set_code
LEFT JOIN collection_items c ON c.printing_id = p.scryfall_id
WHERE p.set_code = $1
  AND p.lang = 'en'
  AND (NOT t.booster_only     OR p.is_booster)
  AND (    t.include_variants OR NOT p.is_variation)
  AND (    t.include_promos   OR NOT p.is_promo)
  AND c.id IS NULL
ORDER BY p.collector_number;
```

---

## 6. Ingest pipeline

A Cloud Run Job on a Cloud Scheduler trigger, not a web request.

It deliberately runs outside the serving app. A 70-second ingest inside a
request would fight the single serving instance for memory and would hit the
request timeout, and the ingest needs the *unpooled* database endpoint, which
the web app should never hold.

It is also deliberately inside GCP rather than on a CI runner: an external
runner would need its own long-lived copy of a database credential that can
write every table, and that credential would then live somewhere with a
different blast radius from the rest of the project's secrets.

1. `GET /bulk-data` for the current `default_cards` download URI (daily timestamp).
2. Compare against the last `ingest_runs` row; exit early if unchanged.
3. **Stream-parse** the JSON (`stream-json` or similar) — never `JSON.parse` a 500 MB file.
4. Project to schema columns only. **Never store the raw JSON blob per card** — that's the
   difference between ~150 MB and multiple GB against a 1 GB limit.
5. `COPY` into staging tables, then upsert into live tables in one transaction.
6. Pull MTGJSON products and decks; resolve to printings via `identifiers.scryfallId`; record
   unresolved rows in `ingest_runs.warnings`.
7. Record the run.

**Cadence:** cards and products weekly, plus `workflow_dispatch` for set-release day. Card data
barely changes between releases.

**Prices must not be ingested wholesale.** 110k printings × daily snapshots would exhaust 1 GB
within months. Snapshot **only printings present in `collection_items`**, weekly — a few hundred
rows per run at this collection size, free forever, and still enough for a real value chart.

---

## 7. Phases

Each phase ends at something usable. Phase 2 is where it beats a spreadsheet; getting there
fast matters more than polish before it.

**Phase 0 — Foundation**
`git init`, Next.js + TS + Tailwind, Neon project, Drizzle wired up, Auth.js with a one-email
allowlist, deploy.
→ *Done when:* the URL loads on your phone and nobody else can get in.

**Phase 1 — Card database + search**
Schema, ingest script, Actions cron, `pg_trgm` indexes. Type-ahead search (debounced,
keyboard-navigable) and card detail with printing picker.
→ *Done when:* you can find any printing of any card in under a second.

**Phase 2 — Collection entry**
`collection_items` + `locations`, and the entry screen this app lives or dies on:

- **Name mode:** type → arrow-key the printing → Enter → in, focus returns to the box.
- **Collector-number mode:** pin a set, then type bare numbers. A freshly opened pack is in set
  order with the number printed on each card, so `123` ⏎ `87` ⏎ `201` ⏎ enters a pack faster
  than any name-based flow — and it's unambiguous, no printing picker. This is the mode that
  matters most for sealed.
- Foil / condition / location stay sticky between entries.

Collection browse with filters and totals.
→ *Done when:* your actual cards are in the app, and entering a new pack takes under a minute.

**Phase 3 — Set completion**
`completion_targets` with per-set scope toggles, progress by rarity and color, missing-card
lists exportable as a want list.
→ *Done when:* "am I missing anything from Bloomburrow" is one click, and the BLB/BLC split
behaves the way you define it.

**Phase 4 — Sealed product add**
Ingest products and precons. Product picker → "Add to collection," optionally dropping cards
into a chosen location and auto-creating the matching deck, pre-allocated.
→ *Done when:* buying a Commander precon is two clicks, not an hour.

**Phase 5 — Commander decks**
Deck CRUD, inline owned-vs-needed while adding, Commander rules only: 100-card singleton, color
identity via `color_identity <@` the commander's, Commander banned list from
`oracle_cards.legalities`. "Cards I don't own" buy list. Physical allocation to a location.
→ *Done when:* you can build a deck and know exactly what's left to buy.

**Phase 6 — Bulk paste import**
Decklist text and CSV, with a review-and-resolve step for ambiguous names. Deliberately *after*
decks: with no existing collection to migrate, its real use is importing a decklist you found
online to check against what you own.

**Phase 7 — Value tracking**
Weekly owned-printings price job, value dashboard, value-over-time chart, biggest movers,
acquisition price vs market.

**Phase 8 — Polish**
PWA manifest for a phone app icon, scheduled database export to a file you keep, public
read-only deck share links.

---

## 8. Risks and constraints

| Risk | Mitigation |
|---|---|
| Neon Free is 1 GB/project | Projected columns only, no raw JSON blobs, image URLs derived from UUID, owned-only price snapshots. Projected ~150–200 MB steady state. Writes block (data is never deleted) if exceeded, so track it in `ingest_runs` |
| Neon Free autosuspends after 5 min | Cold start of a few hundred ms on first request. Documented here so it isn't mistaken for a bug |
| Neon Free is 100 CU-hours/mo, 5 GB egress | Far beyond single-user usage; worth a glance in the console after Phase 2 |
| **App Hosting requires Blaze** (billing account) | Free quotas (10 GiB/mo bandwidth, Cloud Run 2M req, 2,500 build-min) should keep it at ~$0; `minInstances: 0` means idle costs nothing. Set a budget alert and a Cloud Run spend cap |
| **Next 16.4.6 is outside App Hosting's Active support** (matrix tops at 15.2.x) and Firebase flags Proxy as provider-divergent | `proxy.ts` is only the optimistic check, so losing it costs a redirect, not security. If the build fails, fall back to deploying the container to Cloud Run directly |
| 500 MB bulk file vs serverless limits | Ingest never runs in a Vercel function; it's an Actions job |
| Scryfall access could be restricted if misused | §4 compliance rules from the first commit, not retrofitted. The required headers are already proven necessary — the API returns 403 without them |
| MTGJSON lags brand-new products by days | Manual ingest trigger plus unresolved-row logging, so gaps are visible rather than silent |
| No offline entry (the Firestore trade-off) | Accepted. Revisit via a PWA IndexedDB outbox only if it actually bites |
| Variant/promo scope is a judgment call | Stored per-set rules, not constants; revisit once real sets are on screen |

---

## 9. Open questions

None blocking. Phase 0 can start.

## 10. Deferred

- **Camera card scanning.** Biggest entry-speed win, by far the most work: image hashing or OCR,
  lighting and angle tolerance, a correction UI for misreads. Revisit only if Phase 2's
  collector-number entry proves too slow — which for pack-at-a-time sealed play, it may not.
- Offline-capable PWA with a write outbox.
- Sealed/draft pool tracking as a first-class concept (distinct from the permanent collection).
- Trade tracking and want-list matching.
- Price alerts.
