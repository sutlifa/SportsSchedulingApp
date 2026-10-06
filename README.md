# Courtside: tennis league scheduling

Put in your brackets, facilities, court times, teams and every captain's request, and
Courtside plans the whole season. It guarantees each team its matches against its own pool,
never breaks a "must" rule, and explains in plain words anything it couldn't fit and how
to fix it.

**Using the app? Open the in-app guide at [`/guide`](app/guide/page.tsx).** It is linked from
the header of the site and has a step-by-step tutorial (with a sample facility spreadsheet)
that builds a complete league in about 20 minutes, plus a reference for every error message.

---

## What it does

- **Brackets and pools.** Age groups (10U, 12U…) on one schedule, each with its own guaranteed
  number of matches, start-time window ("10U never after 5:30 PM") and allowed days. Pools
  split a bracket; teams only play their own pool.
- **Facilities.** One or many locations, each with an address and a Google Maps pin.
- **Court times.** Weekly time slots (day, start, location, *matches at once*, optionally only
  for some brackets), plus **facility spreadsheets** (.xlsx, .csv or pasted cells, in any
  layout) that set exact courts for specific dates.
- **Captain requests as rules,** each *Must* or *Prefer*: max matches per weekend / week /
  weekday, max weekend matches all season, days they can or can't play, unavailable dates,
  latest/earliest start, only/not at certain locations, days between matches, not at the
  same time / same day as another team, plus free-text notes.
- **Balancing.** Spreads each team's matches across the season (teams don't play every week),
  limits how many of one club's matches are on court at once, and spreads load across slots.
- **Hand edits.** Move any match to a time that fits (the list says which rules each time
  would break), swap home/away, lock matches so regenerating keeps them, regenerate one
  bracket at a time.
- **Explained problems.** Each match that couldn't be placed lists what ruled out the most
  times, what to change, and a button to the tab where you change it.
- **Exports.** CSV for Excel/Sheets, per-team text for captains, full backups (JSON).
- **Never loses work.** Saves are versioned (a stale tab can't overwrite newer work), every
  change to a cloud league is also kept in the browser, and backups open in any copy of the app.

## Using it

| Where | What |
| --- | --- |
| `/` | Your leagues: create (blank, example league, or from a backup), open, restore backup copies. |
| `/league/<id>` | The league: **Schedule · Teams · Brackets & pools · Courts & times · Season** tabs. |
| `/guide` | How it works, the tutorial, facility sheet rules, rule reference, every error and its fix. |
| `/signin` | Google sign-in (only when the site is connected to its database). |

## Two modes

| Mode | When | Where leagues live |
| --- | --- | --- |
| **Cloud** | All four settings below are present | Postgres (Neon), per Google account. Also mirrored in the browser as backup copies. |
| **Browser only** | Any setting missing (e.g. running locally with no setup) | This browser's storage. A yellow banner says so and names the missing settings. |

Everything works in both modes. Backups move leagues between them.

## Running it locally

```bash
npm install
npm run dev            # http://localhost:3004, browser-only mode with zero setup
```

To work offline or if the hosted site is unavailable: run it locally, then on the home page
choose **New league → A backup file** to open a backup downloaded from the hosted site.

## Configuration (cloud mode)

Copy `.env.example` to `.env.local` (locally) or set these in Vercel → Settings →
Environment Variables (Production), then redeploy.

| Variable | What |
| --- | --- |
| `DATABASE_URL` | Neon **pooled** connection string (host contains `-pooler`). `POSTGRES_URL` is also accepted. Tables are created automatically on first use. |
| `AUTH_SECRET` | Any long random string (`npx auth secret` or `openssl rand -base64 32`). |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | From one Google Cloud OAuth client (Web application). |

Google OAuth client settings:

- Authorized JavaScript origin: `https://<your-domain>`
- Authorized redirect URI: `https://<your-domain>/api/auth/callback/google`
- For local dev, also `http://localhost:3004` and `http://localhost:3004/api/auth/callback/google`.
- While the consent screen is in **Testing**, add every person who needs to sign in under
  **Google Auth Platform → Audience → Test users**. There is no allowlist in the app: any
  account that can sign in gets its own private leagues.

## Troubleshooting

The in-app guide's **[Errors and how to fix them](app/guide/page.tsx)** section covers every
message. The most common setup problems:

| Symptom | Cause | Fix |
| --- | --- | --- |
| Yellow "Saved in this browser only" banner on the live site | A cloud setting is missing | The banner names it; add it in Vercel and redeploy. |
| Google: `Error 401: invalid_client` | `AUTH_GOOGLE_ID` isn't the OAuth client's ID | Copy the Client ID (and that client's secret) again; redeploy. |
| Google: `Error 400: redirect_uri_mismatch` | Domain not registered with Google | Add `https://<domain>/api/auth/callback/google` to Authorized redirect URIs. |
| Google: access blocked / not verified | Account isn't a test user | Add it under Audience → Test users. |
| Sign-in page shows `Configuration` | Wrong secret/ID, or the database rejected the account | Check all four settings and the Vercel function logs. |
| "Couldn't reach the database… (Reference XYZ)" | Neon paused, down or over its usage limit | Check Neon; meanwhile use Backup copies → Download backup. |
| Any message with **(Reference ABC123)** | A server error | Search Vercel → Logs for `ref ABC123`: the full error is logged next to it. |

## Development

Stack: Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind v4, Auth.js v5 (Google,
JWT), postgres.js + Neon. Read [`CLAUDE.md`](CLAUDE.md) before changing anything. It explains
the architecture and the rules that keep it correct.

```bash
npm run lint && npm run typecheck && npm run build   # must pass with NO env vars
npm run verify          # scheduler + import invariants (~25k checks incl. fuzzing)
DATABASE_URL=postgres://postgres:postgres@localhost:5432/<throwaway> npm run verify:db
                        # persistence: ownership, versioned saves, soft delete (local DB only)
```

End-to-end tutorial check (drives the `/guide` tutorial in a real browser and verifies every
expected result). Playwright is intentionally not a dependency; install it anywhere:

```bash
npm run build && npx next start -p 3004 &
(cd /tmp/pw && npm i playwright)
PLAYWRIGHT_MODULE=/tmp/pw/node_modules/playwright/index.mjs \
  node --experimental-strip-types --no-warnings scripts/e2e/tutorial.mjs
```

If you change the guide's tutorial or any UI label it mentions, update and re-run
`scripts/e2e/tutorial.mjs`.

Layout:

```
app/                 routes: / (leagues), /league/[id], /guide, /signin, /api/leagues
components/          LeagueList, workspace/ (the league editor tabs, dialogs)
lib/engine/          pure scheduler: types, dates, rules, engine, advice, sanitize, sample
lib/import/          facility spreadsheets: xlsx reader, CSV/paste, layout guessing
lib/                 db, leagues (queries), guard (API auth + error refs), client/ (stores)
public/tutorial/     the tutorial's sample facility spreadsheet
scripts/             verify-*.ts (headless invariants), e2e/tutorial.mjs, migrate.ts
```

Deploying: push to `main`; Vercel builds and deploys it.
