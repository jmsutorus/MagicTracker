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

Not wired up yet (Phase 1), but the rules are fixed and the ingest must honor
them — see PLAN.md §4:

- Use Scryfall's **bulk files**, never card-by-card API crawling.
- Always send a descriptive `User-Agent` and an explicit `Accept` header.
  Scryfall returns **403** without them.
- Hotlink card images from Scryfall's CDN; never re-host them.
- Cache for at least 24 h, and don't redistribute the dataset.
