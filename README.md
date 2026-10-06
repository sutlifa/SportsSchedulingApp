# Seasonsmith: league and tournament scheduling for any sport

Put in your brackets, facilities (and their sheets, fields or courts), booked times, teams and
every coach's or captain's request, and Seasonsmith plans the whole season, or a tournament's
pool play. It guarantees each team its games against its own pool, never breaks a "must"
rule, puts every game on a named sheet, field or court, and explains in plain words anything
it couldn't fit and how to fix it.

It works for hockey, soccer, tennis, pickleball, basketball, volleyball, baseball, softball,
lacrosse, football and any other sport. Each league uses its own sport's words: *ice time* and
*Sheet A* for hockey, *field time* and *Field 3* for soccer, *court time* and *matches* for tennis.

**Using the app? Open the in-app guide at `/guide`** ([source](components/guide/GuideContent.tsx)).
It's linked from the header and footer, and its tutorial follows whichever sport you pick. The
tutorial builds a complete league in about 20 minutes, with a sample facility spreadsheet in that
sport. The guide also explains every error message.

---

## What it does

- **Sports and their words.** Each league picks a sport, which sets the words used everywhere:
  the booked time (ice / field / court / gym time), the playing areas (sheets, fields, courts),
  games or matches, and coaches or captains. It also sets a sensible default game length.
- **Brackets and pools.** Age groups (10U, 12U…) on one schedule. Each has its own number of
  guaranteed games, its own start-time window ("10U never after 5:30 PM") and its own allowed
  days. Pools split a bracket, and teams only play within their pool.
- **Facilities with named units.** A facility (say, an ice arena) contains named or numbered
  playing areas (Sheet A, Sheet B). Number them in one click ("Field 1" × 6), and every
  scheduled game is assigned its own unit.
- **Weekly time slots.** Each slot has a day, a start time, a facility, and which units are free.
  Slots can be limited to some brackets.
- **Facility spreadsheets.** Import .xlsx, .csv or pasted cells, in any layout: one row per
  slot, one row per sheet or field, or a grid. These set exact availability for specific dates.
  The importer guesses the layout and shows its guess for you to correct before anything is
  saved.
- **Coach and captain requests as rules.** Each rule is *Must* or *Prefer*:
  - max games per weekend, week or weekday, and max weekend games all season
  - days they can or can't play, and unavailable dates
  - latest and earliest start
  - only at, or not at, certain facilities
  - days between games
  - not at the same time, or on the same day, as another team
  - free-text notes
- **Balancing.** Spreads each team's games across the season (teams don't play every week),
  limits how many of one club's games are on at once, and spreads load across slots.
- **Hand edits.**
  - Move any game to a time that fits; the list says which rules each time would break.
  - Pick or change its sheet, field or court, and swap home and away.
  - Lock games so regenerating keeps them, and regenerate one bracket at a time.
- **Explained problems.** Each game that couldn't be placed lists what ruled out the most
  times, what to change, and a button to the tab where you change it.
- **Exports.** CSV for Excel or Sheets (with a sheet/field/court column), per-team text for
  coaches and captains, and full backups (JSON).
- **Never loses work.**
  - Saves are versioned, so a stale tab can't overwrite newer work.
  - Every change to a cloud league is also kept in the browser.
  - Backups open in any copy of the app.

## Using it

The header has every page: **New league**, **Your leagues**, **Guide**, **Tutorial** and **About** on
wide screens, and a **Menu** button on phones that also lists Errors and fixes, Questions and Privacy.

| Where | What |
| --- | --- |
| `/` | Your leagues and tournaments: open one, restore backup copies kept in this browser. |
| `/new` | New league or tournament: pick the sport, then **Guided setup**, the example league, or a backup file. |
| `/league/<id>?setup=1` | The setup wizard: name & sport → season → brackets & pools → facilities → *ice/field/court* time → teams → requests → review & schedule. Each step lists what's still **Needed** (Next stays disabled until it's done), what to **Check**, and notes. **Exit setup** opens the full editor; **Setup guide** reopens the wizard at the first unfinished step. |
| `/league/<id>` | The league: **Schedule · Teams · Brackets & pools · Facilities & *ice/field/court* time · Season** tabs. |
| `/guide` | How it works, the tutorial in your sport (`/guide?sport=hockey`), spreadsheet rules, rule reference, every error and its fix. |
| `/about`, `/privacy` | What the app is; what it stores and where (linked in the footer). |
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

To work offline, or when the hosted site is unavailable, run it locally. Then open the
**New league** page (`/new`) and choose **A backup file** to open a backup downloaded from the hosted site.

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
- For local dev, also add `http://localhost:3004` and `http://localhost:3004/api/auth/callback/google`.
- While the consent screen is in **Testing**, add every person who needs to sign in under
  **Google Auth Platform → Audience → Test users**. The app has no allowlist: any account
  that can sign in gets its own private leagues.

## Troubleshooting

The in-app guide's **Errors and how to fix them** section (`/guide#errors`) covers every
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
JWT), postgres.js and Neon. Read [`CLAUDE.md`](CLAUDE.md) before changing anything. It explains
the architecture and the rules that keep it correct.

```bash
npm run lint && npm run typecheck && npm run build   # must pass with NO env vars
npm run verify          # scheduler + import invariants (~32k checks incl. fuzzing, every sport)
DATABASE_URL=postgres://postgres:postgres@localhost:5432/<throwaway> npm run verify:db
                        # persistence: ownership, versioned saves, soft delete (local DB only)
npm run sheets          # regenerate the guide's sample facility sheets (needs python3 + openpyxl)
```

The end-to-end tutorial check drives the `/guide` tutorial in a real browser, in each sport, and
verifies every expected result. Playwright is intentionally not a dependency, so install it
anywhere:

```bash
npm run build && npx next start -p 3004 &
(mkdir -p /tmp/pw && cd /tmp/pw && npm i playwright)
PLAYWRIGHT_MODULE=/tmp/pw/node_modules/playwright/index.mjs SPORTS=hockey,soccer,tennis \
  node --experimental-strip-types --no-warnings scripts/e2e/tutorial.mjs
```

If you change the guide's tutorial, any UI label it mentions, or the sample sheets, update and
re-run `scripts/e2e/tutorial.mjs`.

Layout:

```
app/                 routes: / (leagues), /new, /league/[id] (?setup=1 = wizard), /guide, /about, /privacy, /signin, /api/leagues
components/          LeagueList, NewLeague, SiteHeader + HeaderNav (phone menu), SiteFooter, guide/, workspace/ (the editor + SetupWizard)
lib/brand.ts         the product name, in one place
lib/engine/          pure scheduler: types, sports (each sport's words), dates, rules, engine, advice, readiness (setup checks), sanitize, sample
lib/import/          facility spreadsheets: xlsx reader, CSV/paste, layout guessing
lib/                 db, leagues (queries), guard (API auth + error refs), client/ (stores, backups)
public/tutorial/     the guide's sample facility sheets, one per sport (scripts/make-tutorial-sheets.py)
scripts/             verify-*.ts (headless invariants), e2e/tutorial.mjs, migrate.ts
```

Deploying: push to `main`, and Vercel builds and deploys it. The repository is still named
`SportsSchedulingApp`. The app was first called Courtside, so old backups and browser storage
keys keep that name on purpose (see `lib/client/backup.ts` and `lib/client/store.ts`).
