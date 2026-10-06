# Courtside — SportsSchedulingApp

Put in teams, locations, schedule rules and have the app plan out your schedule for you.

Built for tennis leagues: age brackets with pools, multiple facilities (with Google Maps pins),
weekly time slots with a court capacity, and per-team rules and captain requests
("no more than once a weekend", "max 3 weekend matches", "not at the same time as our 14U team",
unavailable dates, latest start times…). Every team gets its guaranteed number of matches
against its own pool, spread across the season.

## Run it

```bash
npm install
npm run dev            # http://localhost:3004 — works with zero env vars (browser-only mode)
npm run verify         # scheduler invariants
npm run lint && npm run typecheck && npm run build
```

See `.env.example` for cloud mode. Deploys to Vercel on push to `main`.
