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

The weekly Scryfall refresh is a **Cloud Run Job** started by **Cloud
Scheduler** — not a GitHub Action, and not a route in the app.

| | |
|---|---|
| Job | `ingest-cards`, region `us-east5` |
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
stale rows instead of deleting them.

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
| `npm run ingest:cards` | Load Scryfall bulk data into the card tables. `-- --force` re-ingests an unchanged file |
| `scripts/search-smoke.ts` | Eyeball search ranking against the real database (`npx tsx`) |
| `scripts/deploy-ingest-job.ps1` | Create/update the scheduled ingest in GCP (idempotent) |

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
