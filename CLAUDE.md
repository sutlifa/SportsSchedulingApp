@AGENTS.md

# Seasonsmith (repo: SportsSchedulingApp) — agent context

Read this before touching anything. Kept short on purpose; same house rules as SongRank.

- **Repo:** `sutlifa/SportsSchedulingApp` (branch `main`). **Push to `main` = Vercel deploy.**
- Team loop: **Builder → Tester → Deployer**. The Tester never edits source; the Builder
  never declares itself done; the Deployer never ships with open bugs.

## What it is

A league/tournament scheduler for ANY sport (named Seasonsmith; it was "Courtside" and
tennis-only at first). A league (one season or tournament) has a sport, brackets (10U, 12U…)
with pools, facilities with named units (Sheet A / Field 3 / Court 2), weekly time slots
(which units are free, or a number of games at once), uploaded facility availability, and
teams with rules. "Generate" pairs every team with its guaranteed number of games (default 5)
against its own bracket+pool, places each pairing into a dated slot without breaking any
"must" rule, then assigns each game its unit(s). Teams do NOT have to play every week.

**Words come from the sport** (`lib/engine/sports.ts` `termsFor(settings.sport)`): court/sheet/
field, court/ice/field time, match/game, captain/coach. Never hard-code tennis words in UI or
engine messages: use `t.unit`, `t.time`, `t.matches`…, or `sportText()` for static copy.
Leagues saved before `sport` existed are tennis. The product name lives only in `lib/brand.ts`.

## Stack (pinned — don't bump casually)

Next.js **16.3.5** App Router · React **19.3.0** · TypeScript strict · Tailwind **v4**
(`@theme` in `app/globals.css`, no `tailwind.config.ts`) · `next-auth@5.0.0-beta.32`
(Google only, JWT, no adapter) · `postgres` (postgres.js) against Neon · `@vercel/analytics`.

Next 16: `params`/`searchParams`/`cookies()` are Promises; `next lint` is gone (ESLint CLI,
native flat exports — never `FlatCompat`); Turbopack is default. Docs: `node_modules/next/dist/docs/`.

## Architecture

```
lib/brand.ts      APP_NAME / tagline — the only place the product name is written
lib/engine/       PURE, shared by client, API and scripts. Imports use .ts extensions.
  types.ts        the whole data model (League = settings+brackets+locations(+units)+slots
                  +availability+teams; Match.unitIds = the game's assigned units)
  sports.ts       each sport's words + unit naming + default game length; sportText()
  dates.ts        day-number arithmetic (no Date/DST bugs), parsing/formatting
  rules.ts        rule catalogue + describeRule() — ONE sentence used in editor, chips AND
                  "why couldn't this be placed"; keep them identical
  engine.ts       prepare → pairPool → greedy placement, best of N randomized attempts;
                  assignUnits() gives each game its unit(s) — STABLE: valid existing
                  assignments are kept (locked first) so a coach told "Sheet B" isn't moved;
                  audit() re-checks a saved schedule (incl. double-booked units);
                  moveOptions() for hand moves (with each time's free units)
  sanitize.ts     coerce untrusted JSON (API bodies, backups) into a League/Schedule
  sample.ts       the "example league" AND the main verify fixture
  advice.ts       problem message → plain fix + the tab to make it on (matches engine
                  wording exactly; verify-engine asserts every engine message has advice)
  readiness.ts    "can this league be scheduled?" per setup step: block / warn / info.
                  ONE source for the setup wizard (blocks disable Next) and the Schedule
                  tab's "Before you schedule". Checks real usable time per bracket (start
                  window, days, "Open to"), spots vs games, dates vs games per team, must-
                  rules/requests leaving too few dates (or too little room for "days
                  between"), units per game vs free units, pools of one, a team wanting
                  more than the rest of its pool plays. Every block must be a PROOF that
                  Generate can't place everything (a false block traps people mid-setup).
                  scripts/verify-readiness.ts: a league with no blocks must schedule
lib/import/       facility availability sheets → dated court availability (pure)
  xlsx.ts         dependency-free .xlsx reader (zip via DecompressionStream; merged
                  cells filled; date-formatted numbers returned as {serial})
  sheet.ts        CSV/paste parsing, lenient date/time/courts readers, guessMapping()
                  (rows | dates-down | times-down) — the UI shows the guess and lets the
                  person correct it, because every facility's format differs
lib/db.ts         postgres client, `prepare: false` REQUIRED (Neon pooled). DATABASE_URL||POSTGRES_URL
lib/db/schema.ts  the whole DDL as a string; lib/db/ensure.ts runs it once per cold start
lib/leagues.ts    every leagues query; user_id + deleted_at filtered IN the SQL
lib/client/store.ts  cloud (API) and browser (localStorage) stores behind one interface
components/workspace/  the league editor (tabs). SetupWizard.tsx (/league/<id>?setup=1, where
                  /new sends a "Guided setup" league) reuses the tabs for its steps
                  (CourtsTab `only`, SeasonTab `setup`, TeamsTab `requests`) so the
                  wizard can't drift from the editor. Don't fork tab UI into the wizard.
components/SiteHeader + HeaderNav  every page in the bar (desktop) or the Menu (phones)
components/guide/ GuideContent (/guide) and TutorialContent (/tutorial) -- separate pages on
                  purpose (the header links to both), sharing parts.tsx (sport picker + its
                  stored choice, step styles); app/guide and app/tutorial are their server
                  wrappers. scripts/e2e/tutorial.mjs drives the tutorial word for word in every
                  sport; public/tutorial/<sport>-april-2027.* come from scripts/make-tutorial-sheets.py
app/about, app/privacy  linked from SiteFooter. Privacy states what the code does — keep it true
scripts/verify-engine.ts  headless invariants — run it, don't eyeball
```

**Units decide capacity when named**: a slot/upload that names units has
floor(units / settings.courtsPerMatch) games at once; otherwise its number. Sheets that list
units one per row ("Sheet A") attach to the facility's units by name, creating missing ones.

**Facility uploads (`League.availability`) REPLACE the weekly slots for every (location,
date) they mention**, including 0-court rows (= closed); other dates keep the weekly
pattern; blackouts still win. Courts → matches at once via `settings.courtsPerMatch`.
An import only replaces the (location, date) pairs in that file, so monthly sheets stack.

**Cloud leagues are mirrored to localStorage on every change** (`writeMirror`), listed on
the home page with Download backup / Restore. Never auto-upload a mirror: it could
overwrite newer cloud work.

**State is `{ name, data: League, schedule: Schedule }` and nothing else.** Who's short a
match, which rule a match breaks, court usage — all DERIVED by `audit()`. Don't store them.

## Non-negotiables

- **Unconfigured degrades honestly.** Zero env vars = browser-only mode with a banner naming
  the missing settings. Cloud mode needs DATABASE_URL + AUTH_SECRET + AUTH_GOOGLE_ID +
  AUTH_GOOGLE_SECRET together (`lib/authConfig.ts`). Never a dead button or a 500.
- **No allowlist, by owner decision.** Any Google account may sign in and sees only its own
  leagues. Who can sign in while testing is managed on Google's consent screen (test users).
- **Saves are versioned.** PUT carries the version it loaded; mismatch = 409 with the current
  copy, and the client stops autosaving until the person picks a version. Never silently
  overwrite a newer copy (SongRank lost ~300 votes that way).
- **"must" rules are never broken by the generator** — an unplaced match with a reason beats
  a placed match that breaks a rule. Hand moves may break one, but say so and stay flagged.
- **Moving a match locks it.** Regenerate replaces only unlocked matches in scope.
- **API routes:** guard → try/catch → human message; 500s go through `serverError()` in
  lib/guard.ts, which logs under an UPPERCASE label with a reference code and returns
  "… (Reference ABC123)" so a user's screenshot finds the log line.
- **The tutorial is tested.** Changing a UI label or behaviour that /tutorial mentions
  means updating the tutorial AND scripts/e2e/tutorial.mjs, and re-running it (all sports:
  SPORTS=hockey,tennis,pickleball,soccer,basketball,volleyball,baseball,softball,lacrosse,football,other).
- **Never rename storage keys or the backup tag** to match the brand: `tennis-scheduler.leagues.v1`,
  `courtside.mirror.*` and the accepted `courtside-league` backup tag hold real users' data.
- Never read localStorage in render or a useState initializer (hydration mismatch).
- `react-hooks` v7: no components defined inside components (use render functions), no refs
  read during render.
- Comments explain *why*, wherever a reader would otherwise "fix" a deliberate choice.

## Commands

```bash
npm run lint && npm run typecheck && npm run build   # build must pass with NO env vars
npm run verify                                       # engine + import invariants (~8s), incl. fuzz, all sports
npm run sheets                                       # regenerate public/tutorial sample sheets
npm run verify:db                                    # needs a LOCAL throwaway DATABASE_URL
npm run db:migrate                                   # optional; app self-migrates
```

Dev port **3004**. Playwright: install it in a scratch dir, never in this package.json;
browsers at `/opt/pw-browsers`. Browser mode is how to smoke-test the full flow offline.
