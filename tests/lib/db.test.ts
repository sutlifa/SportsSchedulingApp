/**
 * lib/db.ts picks its URL once, at import, through cleanEnv -- the same reading
 * lib/authConfig.ts uses to decide cloud vs browser mode. No query is run.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL = "   ";
process.env.POSTGRES_URL = ' "postgres://u:p@localhost:5432/x" ';
const { databaseUrl, hasDatabase } = await import("../../lib/db.ts");

test("a whitespace-only DATABASE_URL falls through to POSTGRES_URL, cleaned", () => {
    assert.equal(databaseUrl, "postgres://u:p@localhost:5432/x");
    assert.equal(hasDatabase, true);
});
