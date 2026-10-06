/**
 * Guard + setup for tests/db/*. These tests TRUNCATE tables, so they refuse
 * to run against anything but a local database (the same rule as
 * scripts/verify-db.ts), and they create that database if it doesn't exist
 * yet, so `createdb` isn't a step anyone has to remember.
 *
 * Import this FIRST in a db test file: its top-level check runs before any
 * module that could open a connection.
 */
import postgres from "postgres";

export const DATABASE_URL = process.env.DATABASE_URL ?? "";

function localHost(url: string): string | null {
    try {
        const h = new URL(url).hostname;
        return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(h) ? h : null;
    } catch {
        return null;
    }
}

if (!localHost(DATABASE_URL)) {
    throw new Error(
        `Refusing to run the database tests: DATABASE_URL must point at a throwaway LOCAL Postgres (got "${DATABASE_URL ? new URL(DATABASE_URL).hostname : "nothing"}"). They truncate tables.\n` +
            "  e.g. DATABASE_URL=postgres://postgres:postgres@localhost:5432/seasonsmith_unit npm run test:db"
    );
}

/** Creates the database named in DATABASE_URL when it's missing. */
export async function ensureDatabase(): Promise<void> {
    const u = new URL(DATABASE_URL);
    const name = decodeURIComponent(u.pathname.slice(1));
    if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`Use a plain database name for the tests (got "${name}").`);
    u.pathname = "/postgres";
    const admin = postgres(u.toString(), { ssl: false, onnotice: () => {}, max: 1 });
    try {
        const found = await admin`SELECT 1 FROM pg_database WHERE datname = ${name}`;
        if (!found.length) await admin.unsafe(`CREATE DATABASE "${name}"`);
    } finally {
        await admin.end({ timeout: 1 });
    }
}
