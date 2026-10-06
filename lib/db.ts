import postgres from "postgres";
import { cleanEnv } from "./authConfig";

// Falls back to an empty string instead of throwing at module load so that
// `next build`'s route analysis (which imports this module without ever
// running a query) doesn't fail just because DATABASE_URL isn't set in the
// current environment. postgres.js doesn't open a connection until the
// first query runs, so a real, clear connection error only surfaces then.
//
// `prepare: false` is required against Neon's pooled connection string (and
// any PgBouncer-style transaction pooler): prepared statements are tied to a
// single backend connection, which a transaction pooler doesn't guarantee
// across queries, and a schema change (e.g. an ALTER TABLE) can leave a
// stale cached plan behind that throws "cached plan must not change result
// type" on the next query.
// DATABASE_URL is what Vercel's Neon integration sets by default; POSTGRES_URL
// is the same pooled string under the name some integration setups use.
// Read through cleanEnv, like lib/authConfig.ts: a whitespace-only
// DATABASE_URL must fall through to POSTGRES_URL (or to "no database"), not be
// handed to postgres.js while the config check says it's missing.
export const databaseUrl = cleanEnv(process.env.DATABASE_URL) || cleanEnv(process.env.POSTGRES_URL) || "";

// SSL is required for Neon; a localhost database (scripts/verify-db.ts runs
// against a throwaway local Postgres) usually has no certificate at all.
const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(databaseUrl);

export const sql = postgres(databaseUrl, {
    ssl: isLocal ? false : "require",
    prepare: false,
    // The self-applying schema (lib/db/ensure.ts) uses CREATE ... IF NOT
    // EXISTS, which emits an "already exists, skipping" NOTICE per statement
    // on every cold start. postgres.js logs notices to the console by
    // default; they are not errors and would bury real ones in Vercel logs.
    onnotice: () => {},
});

/** True when a database is actually configured for this environment. */
export const hasDatabase = Boolean(databaseUrl);
