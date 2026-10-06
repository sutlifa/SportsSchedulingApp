/**
 * lib/users.ts without a database. (With one: tests/db/leagues.test.ts.)
 * Sign-in is hidden when no database is configured, so upsertUser being
 * reached anyway must fail with a log line that names the real cause rather
 * than an opaque connection error deep inside an Auth.js callback.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
const { upsertUser } = await import("../../lib/users.ts");
const { hasDatabase, databaseUrl } = await import("../../lib/db.ts");

test("no DATABASE_URL: lib/db still imports (so `next build` works) and says there is no database", () => {
    assert.equal(hasDatabase, false);
    assert.equal(databaseUrl, "");
});

test("upsertUser without a database fails with an explanation, before any query", async () => {
    await assert.rejects(upsertUser({ googleId: "g", email: "a@b.c", name: null }), /no DATABASE_URL set -- sign-in should be disabled \(see lib\/authConfig\.ts\)/);
});
