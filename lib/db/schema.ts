/**
 * The entire DDL surface, as a string so it ships inside the server bundle
 * (no runtime file read, no output-tracing config to forget). Idempotent:
 * lib/db/ensure.ts runs it once per cold start so a fresh Neon database works
 * with no manual migration; `npm run db:migrate` runs the same text on demand.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
    id          serial PRIMARY KEY,
    google_id   text NOT NULL UNIQUE,
    email       text NOT NULL,
    name        text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- One row per league season, owned by one user. The league itself
-- (brackets, locations, slots, teams, rules) and its saved schedule are
-- jsonb: always read and written whole, never queried by field, so a
-- normalised schema would just be a slower way to store the same document.
CREATE TABLE IF NOT EXISTS leagues (
    id          text PRIMARY KEY,
    user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        text NOT NULL,
    data        jsonb NOT NULL,
    schedule    jsonb NOT NULL,
    -- Optimistic concurrency: every save names the version it was based on.
    -- A stale tab or second device saving an older copy gets a 409 instead
    -- of silently overwriting newer work. See saveLeague().
    version     integer NOT NULL DEFAULT 1,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    -- Soft delete. EVERY read path filters deleted_at IS NULL.
    deleted_at  timestamptz
);

CREATE INDEX IF NOT EXISTS leagues_user_live_idx
    ON leagues (user_id, updated_at DESC)
    WHERE deleted_at IS NULL;
`;
