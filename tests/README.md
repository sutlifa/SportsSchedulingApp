# Unit tests

Node's built-in runner (`node:test` + `node:assert/strict`), run straight from TypeScript with
`--experimental-strip-types`. No test dependencies.

```bash
npm test                                   # everything except tests/db (~10s, no database, no network)
DATABASE_URL=postgres://postgres:postgres@localhost:5432/seasonsmith_unit npm run test:db
                                           # tests/db against a LOCAL throwaway Postgres
```

## Layout

The folders mirror the source:

```
tests/engine/   lib/engine/*: dates, sports, rules, sanitize, engine (prepare / pairing /
                generate / units / audit), advice, readiness, sample, and fuzz.test.ts
                (seeded random leagues checked against the promises independently of the
                engine's own check())
tests/import/   lib/import/*: CSV/paste parsing, cell readers, layout guessing, the .xlsx
                reader (workbooks built in-test by support/xlsx-builder.ts), and the
                tutorial's sample sheets in public/tutorial for every sport
tests/client/   lib/client/*: backups, and the browser/cloud stores and mirrors against an
                in-memory localStorage and a scripted fetch (support/browser.ts)
tests/lib/      lib/guard.ts, lib/authConfig.ts, lib/users.ts without a database
tests/api/      the /api/leagues route handlers: 503 / 401 / 400 / 413, and 500 against a
                database that refuses connections (no database needed)
tests/db/       lib/leagues.ts, lib/users.ts and the routes' 200 / 201 / 404 / 409 paths
                against real Postgres
tests/support/  fixtures (small league builders), the resolver hook, fakes
```

`tests/support/register.mjs` registers a resolver hook (`resolve.mjs`) so plain node can load
code written for Next's bundler: the `@/` alias, `./db`-style imports without `.ts`, and
`next/server`. It also maps `@/auth` to `support/fake-auth.ts`, so a test can set who is signed
in. That is the only module the tests replace. The guard, the routes, sanitize and
`lib/leagues.ts` all run for real.

## Known bugs

A test that exposes a real bug in the app is marked `{ todo: "BUG: … (file:line)" }` instead of
being skipped or loosened. It still runs, shows as `# TODO` in the output and doesn't fail
the run. When the bug is fixed, the todo starts passing and the marker should be removed.
`fuzz.test.ts` tolerates one known engine bug (`not_same_day`) only in its exact shape, and
counts how often it happens in its own todo test.

## Database tests

`tests/db/*` truncate tables, so `support/db.ts` refuses any `DATABASE_URL` whose host isn't
`localhost`, `127.0.0.1` or `::1`. It creates the named database if it doesn't exist yet, and
the schema self-applies. The files run one at a time (`--test-concurrency=1`) because they
share that database. Start Postgres with `service postgresql start` if it isn't running.

## Writing tests

- Test what a function promises (its doc comment, CLAUDE.md), not what it happens to print.
- Build the smallest league that shows the behaviour (`support/fixtures.ts`). Use
  `sampleLeague()` only when the example league is the subject.
- Keep the suite deterministic. Call `generate` through `run()`, which uses a fixed seed and
  clock, and mock `Date` with `t.mock.timers` when order depends on timestamps.
