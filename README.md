# MagicTracker

Personal Magic: The Gathering collection tracker — collection, set completion,
sealed product adds, and Commander decks. Built to run on free tiers
indefinitely, with no subscription.

See [PLAN.md](./PLAN.md) for the architecture, data model, and phase plan,
including why the stack is what it is.

**Current state: Phase 0 (foundation) complete.** The card database and all
collection features arrive in Phases 1–2.

---

## Stack

- **Next.js 16** (App Router, Turbopack) + TypeScript + Tailwind 4
- **Neon Postgres** (Free plan) via **Drizzle ORM** / `node-postgres`
- **Auth.js v5** — Google sign-in, single-email allowlist, JWT sessions
- Card data from [Scryfall](https://scryfall.com/docs/api) bulk files;
  sealed product and precon contents from [MTGJSON](https://mtgjson.com)

## Setup

```bash
npm install
cp .env.example .env.local   # then fill it in, see below
npm run db:migrate
npm run db:check             # should print "✓ reachable"
npm run dev
```

### Environment

| Variable | What it's for |
|---|---|
| `DATABASE_URL` | Neon **pooled** connection (the `-pooler` host). Used by the app. |
| `DATABASE_URL_UNPOOLED` | Neon **direct** connection. Used by migrations and the Phase 1 bulk ingest — DDL and `COPY` both misbehave through PgBouncer. |
| `AUTH_SECRET` | Signs the session cookie. `openssl rand -base64 32` |
| `AUTH_URL` | `http://localhost:3000` locally; the deployed origin in production. |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | From the Google OAuth client below. |
| `ALLOWED_EMAILS` | Comma-separated allowlist. **Empty means nobody can sign in** — it fails closed on purpose. |

Keep `sslmode=verify-full` in the connection strings. `pg` currently treats
`require` as `verify-full` anyway, but that changes in pg v9, so being explicit
now avoids a silent downgrade later.

### Google sign-in setup

One-time, in the [Google Cloud Console](https://console.cloud.google.com/):

1. **APIs & Services → OAuth consent screen.** Choose *External*, fill in the
   app name, and add your own Google account under *Test users*. The app stays
   unpublished — it only ever needs to work for you.
2. **APIs & Services → Credentials → Create credentials → OAuth client ID.**
   Application type: *Web application*.
3. **Authorized JavaScript origins:** `http://localhost:3000`
4. **Authorized redirect URIs:** `http://localhost:3000/api/auth/callback/google`
5. Copy the client ID and secret into `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`
   in `.env.local`.

When you deploy, add the production origin and
`https://<your-domain>/api/auth/callback/google` to the same client, and set
`AUTH_URL` to the deployed origin.

## Deployment

Firebase App Hosting, project `magictracker-514320`, backend `magictracker`.

**Live:** https://magictracker--magictracker-514320.us-east5.hosted.app

Region is **us-east5 (Columbus, Ohio)**, chosen to sit in the same metro as the
Neon database (`aws-us-east-2`), since every page load makes a database round
trip.

```bash
firebase deploy --only apphosting
```

Config lives in `apphosting.yaml` (runtime sizing + env) and `firebase.json`
(which files get uploaded). `minInstances: 0` means an idle app costs nothing;
`maxInstances: 1` because there is one user.

### Secrets

All five live in Secret Manager and are bound **RUNTIME-only** — the build is
verified to succeed with no credentials present at all, so none are exposed to
the build step:

`DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`,
`ALLOWED_EMAILS`

`ALLOWED_EMAILS` is a secret rather than a plain `value:` in `apphosting.yaml`
because that file is committed and it holds a personal email address.

To change one:

```bash
printf '%s' 'new-value' | firebase apphosting:secrets:set NAME --data-file - --force
firebase apphosting:secrets:grantaccess NAME --backend magictracker
firebase deploy --only apphosting     # rollout picks up the new version
```

Don't pipe with `echo` — a trailing newline becomes part of the secret, which
silently breaks a connection string.

### Push-to-deploy

Not connected. The backend was created non-interactively, so it has no GitHub
link; deploys are from local source. Connecting the repo requires authorizing
the Firebase GitHub App in the console (App Hosting → backend → settings), after
which pushes to `main` build automatically.

### Card data ingest

The weekly refresh is a **Cloud Run Job** started by **Cloud Scheduler** —
not a GitHub Action, and not a route in the app. It runs two jobs in
sequence, as separate child processes (`scripts/ingest.ts`):

1. `ingest-cards.ts` — Scryfall bulk cards. ~90 seconds, peaks ~240 MB heap.
2. `ingest-products.ts` — the MTGJSON sealed-product catalog. ~3 seconds.

Neither depends on the other, so a failure in one does not skip the other and
the exit code is non-zero if either failed.

| | |
|---|---|
| Job | `ingest-cards`, region `us-east5` (named for the first of its two jobs) |
| Schedule | `ingest-cards-weekly`, region `us-east4`, Mondays 09:17 UTC |
| Image | `us-east5-docker.pkg.dev/magictracker-514320/magictracker/ingest-cards` |
| Built from | `Dockerfile.ingest` via `cloudbuild.ingest.yaml` |
| Runs as | `mtg-ingest@` — holds `secretAccessor` on one secret and nothing else |
| Started by | `mtg-ingest-scheduler@` — holds `run.invoker` on this one job and nothing else |

Cloud Scheduler is not offered in `us-east5`, which is why the trigger sits in
`us-east4` and calls across. It sends one API request a week, so its latency
does not matter; the *job* is in `us-east5` because the Neon database is in
AWS `us-east-2` — same metro — and the ingest is round-trip heavy.

Create or update the whole thing:

```powershell
powershell -File scripts/deploy-ingest-job.ps1
```

It is idempotent: change the ingest, run it again, and it rebuilds the image
and rolls the job forward. It needs `gcloud auth login` once.

```bash
# run it now, and watch
gcloud run jobs execute ingest-cards --region us-east5 --wait
# re-ingest a bulk file the script would otherwise skip as unchanged
gcloud run jobs execute ingest-cards --region us-east5 --args=--force --wait
gcloud beta run jobs logs tail ingest-cards --region us-east5
```

**Why not GitHub Actions.** A CI runner would need its own long-lived copy of
a database credential that can write every table, kept somewhere with a
different blast radius from every other secret this project has. Keeping the
job in GCP means the credential never leaves the project that already holds
`DATABASE_URL`, and the job has no public endpoint at all — it can only be
started through the Cloud Run Admin API by one service account.

**Why not a route in the app.** The ingest takes over a minute, which exceeds
the request timeout, and it would fight the single serving instance for
memory. It also needs the *unpooled* endpoint, which the web app should not
hold.

The job never truncates. From Phase 2 `collection_items` references
`printings.scryfall_id`, so a truncate would either trip the foreign key or
cascade away the record of cards physically owned. It upserts, and reports
stale rows instead of deleting them. The product ingest follows the same
rule, and additionally never overwrites a cached card list from the catalog
refresh — it refreshes those deliberately, per product, further down.

**What the product ingest deliberately does not download.** MTGJSON publishes
no file dedicated to sealed products; deck contents live inside
`AllPrintings.json.gz` (176 MB) or `AllDeckFiles.zip` (253 MB). The catalog
alone is `DeckList.json` at 0.65 MB, and one deck is ~0.5 MB at
`/api/v5/decks/<fileName>.json`. So the weekly job loads only the catalog
(3,144 decks), and a product's contents are fetched the first time you open
it and cached in `precon_cards` from then on. See "Sealed products" below.

**On database size.** A full ingest rewrites every row, so each one leaves
roughly its own size again in dead tuples. That is not a leak: autovacuum
marks the space reusable and the next ingest reuses it rather than extending
the files. Measured over three consecutive forced ingests the database went
99 MB -> 176 MB -> 178 MB, i.e. it settles at about twice the live data, or
17% of Neon's 1 GB free limit. A normal weekly run only touches rows that
actually changed, so the churn is far smaller than that test.

### Google OAuth redirect URIs

The OAuth client needs **both** origins registered, or sign-in fails with
`redirect_uri_mismatch`:

- `http://localhost:3000/api/auth/callback/google`
- `https://magictracker--magictracker-514320.us-east5.hosted.app/api/auth/callback/google`

If the backend URL ever changes, update the OAuth client *and* `AUTH_URL` in
`apphosting.yaml`.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:generate` | Generate a migration from `lib/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Drizzle Studio (browse the database) |
| `npm run db:check` | Connectivity + migration + extension check |
| `npm run ingest` | Both ingests, in order — what the scheduled job runs |
| `npm run ingest:cards` | Load Scryfall bulk data into the card tables. `-- --force` re-ingests an unchanged file |
| `npm run ingest:products` | Load the MTGJSON sealed-product catalog. `-- --force` re-ingests an unchanged version |
| `scripts/search-smoke.ts` | Eyeball search ranking against the real database (`npx tsx`) |
| `npm run collection:smoke` | End-to-end check of the collection layer against the real database |
| `npm run completion:smoke` | End-to-end check of set completion against the real database |
| `npm run products:smoke` | End-to-end check of sealed-product add against the real database |
| `scripts/deploy-ingest-job.ps1` | Create/update the scheduled ingest in GCP (idempotent) |

## The collection

Two tables, and they are the only data here that cannot be regenerated: the
card database rebuilds from Scryfall in 35 seconds, but the record of which
cards are in which binder exists nowhere else.

```
locations        (id, name, kind, sort_order)
collection_items (id, printing_id, finish, condition, location_id, quantity,
                  acquired_at, acquired_price_cents, notes,
                  UNIQUE (printing_id, finish, condition, location_id))
```

Decisions worth knowing before changing any of it:

- **Copies are aggregated.** A playset is `quantity: 4`, not four rows. That
  unique key is what makes `add` an upsert that adds to the quantity, and it
  is why entering the same card twice cannot produce two rows that later
  disagree about where it is.
- **`printing_id` is `ON DELETE RESTRICT`, not `CASCADE`.** If anything ever
  tries to delete a printing somebody owns, it must fail loudly rather than
  quietly taking the collection row with it. This is transitive: `printings`
  cascades from `oracle_cards` and `sets`, so deleting an owned card's oracle
  row now aborts too.
- **`location_id` is NOT NULL**, defaulting to a seeded `Unsorted` row.
  Postgres treats NULLs as distinct, so a nullable location would give every
  unplaced copy its own row instead of merging.
- **There is no `language` column.** Scryfall models each language as its own
  printing, so `printings.lang` already answers it.
- **A stored `quantity` of 0 is forbidden** by a CHECK constraint, so an
  adjustment that reaches zero deletes the row. The adjust is a single
  statement, not read-then-write, so two concurrent decrements cannot both
  read 1 and both write 0.
- **`acquired_price_cents` is set on insert and never overwritten by a merge.**
  Once two purchases at different prices are one quantity, no single price is
  true, and Phase 7 compares this against market value — where a confidently
  wrong number is worse than a null.

### Entering cards

`/collection/add` has two modes because the two ways cards arrive are
genuinely different:

- **Collector number** — pin a set once, then type bare numbers: `123` ⏎
  `87` ⏎. A freshly opened pack is in set order with the number printed on
  every card, so this beats any name-based flow for sealed, and there is no
  printing to disambiguate. `4x 123` enters a playset.
- **Card name** — type, arrow to the card, Enter. A card with one printing is
  added immediately; otherwise Enter opens the printing list and a second
  Enter commits.

Finish, condition and location stay put between entries, focus returns to the
input after every add, and every add is logged with an undo.

`4x123` and `123x4` are **rejected as ambiguous** rather than guessed. They
are mirror images, so any rule that reads a quantity out of one reads the
other backwards — `123x4` would enter 123 copies of card #4. Asking for a
space is better than silently entering a hundred wrong cards.

Server actions do the writing, and every one of them calls `requireUser()`
first: an action is a public HTTP endpoint with a generated name, not a
private function call, and `proxy.ts` never sees its POST body.

## Set completion

`/sets` lists every set you own a card from with a progress bar; `/sets/<code>`
is the detail — overall, by rarity, by color, the scope rules, and the missing
list with a want-list download.

"Complete" is a stored per-set rule, because there is no objectively right
answer. Bloomburrow has 397 English printings, of which **281** are
booster-obtainable (collector numbers 1–281) and 116 are Collector Booster
treatments and promos sharing the same code and set symbol. So "complete
Bloomburrow" is 281 or 397 depending on what you meant.

```
completion_targets (set_code PK, booster_only, include_promos,
                    include_extras, finish)
```

Default: **booster-only, any finish**. No row means "use the default", so
resetting deletes rather than writing the defaults back — one representation
of the default instead of two that can drift.

**An exclusion is ignored when it would empty the set.** This is the rule
worth knowing. Of ~971 non-digital sets with cards, most have *zero*
booster-obtainable printings — all 46 commander sets, all 26 duel decks, 277
of 278 promo sets — so applying `booster_only` literally would report a
completion target of zero cards for most sets anyone owns, every Commander
precon included. Each flag therefore applies only when the set has something
for it to narrow to.

It is per-flag, not all-or-nothing, and Bloomburrow Commander shows why:
`blc` has no booster cards so `booster_only` is inert, but it does have
non-promo cards, so the promo exclusion still bites and the default target is
**355 of 356**. A flag that cannot bite is shown disabled in the UI and
described as ignored, because "booster-obtainable cards only" is actively
misleading on a Commander deck.

The `finish` rule is literal: an etched foil does not satisfy a `foil` target,
because etched is a separate treatment that usually exists alongside the
regular foil, and counting one for the other would call a set complete while
the regular foils are still missing.

The missing list is the anti-join this whole stack was chosen for — a LEFT
JOIN with an IS NULL test, which a document store cannot express without
reading the entire set and the entire collection into application memory
first. It exports as `1 Lightning Bolt (2ED) 162`, the format Moxfield,
Archidekt and Deckbox all import.

## Sealed products

`/products` lists preconstructed decks; opening one and pressing a button puts
its whole contents into the collection. Buying a Commander precon is two
clicks rather than an hour of typing, which is the point of the phase.

**Only precons, not every sealed product.** A booster box has no deterministic
contents — "add a booster box" cannot name a single card — so there is nothing
to add. A precon's card list is fixed, which is exactly what makes a one-step
add possible. The catalog holds 3,144 decks, 206 of them Commander precons.

**Two tables, filled at different times.**

| | |
|---|---|
| `precon_products` | The catalog. 3,144 rows from `DeckList.json`, refreshed weekly |
| `precon_cards` | One product's card list. Written on first open, then cached |

**Three joins, all deliberate.**

- `precon_products` → `sets` on `mtgjson_code`, LEFT. 3,122 of 3,144 products
  link to a Scryfall set; MTGJSON's `Q01`–`Q08` Challenger-deck codes match
  nothing, so a foreign key here would reject 22 real products and an inner
  join would hide them.
- `precon_cards` → `printings` on `scryfall_id`, LEFT, **with no foreign
  key**. A card MTGJSON lists before Scryfall has it shows as unresolved
  today and starts working by itself after the next card ingest, with no
  product re-fetch. A real foreign key would instead make a brand-new product
  fail to insert at all.
- The card name, set code and collector number are stored alongside the id, so
  an unresolved line still reads as a card rather than a bare UUID.

**The add is one SQL statement.** A precon is ~100 lines against the one table
in this database that cannot be regenerated. One statement is atomic by
definition, so an add either happens completely or not at all — a hundred
round trips could leave the collection holding half a deck with no record of
which half.

**The finish is clamped.** MTGJSON marks a precon commander `isFoil`; if
Scryfall holds that printing as nonfoil-only, then storing `foil` is a copy
that does not exist, and the same check that protects manual entry would
reject it. So the finish falls back: as shipped → nonfoil → whatever the
printing has. The clamp is one SQL expression (`finishExpr`) shared by every
read and write, so the "owned" column, the preview and the add cannot
disagree about which row a copy lands in.

**Adding twice adds twice.** Two boxes is two copies of each card, not an
error. The undo subtracts what the product contributed and never more, so a
Sol Ring that was in the box before the add is still there afterwards.

## How auth is structured

Two layers, deliberately:

- **`proxy.ts`** (Next 16's rename of `middleware.ts`) does an *optimistic*
  check — is a session cookie present? — so anonymous visitors are redirected
  to `/login` cheaply. It verifies nothing. Proxy code runs detached from the
  render path and can be deployed to a CDN edge, so it must not be what stands
  between a stranger and the data.
- **`lib/auth/dal.ts`** (`requireUser()`) is the *secure* check, and every page
  or action that touches data calls it. It re-verifies the email allowlist
  rather than trusting the JWT, so removing an address from `ALLOWED_EMAILS`
  takes effect immediately instead of whenever the token happens to expire.

This is the split Next's own authentication guide recommends.

## Working with the card data

`scripts/ingest-cards.ts` honors these, and anything new that touches Scryfall
has to as well — see PLAN.md §4:

- Use Scryfall's **bulk files**, never card-by-card API crawling.
- Always send a descriptive `User-Agent` and an explicit `Accept` header.
  Scryfall returns **403** without them.
- Hotlink card images from Scryfall's CDN; never re-host them.
- Cache for at least 24 h, and don't redistribute the dataset.
