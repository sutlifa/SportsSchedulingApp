/**
 * The /api/leagues route handlers, imported for real, with only "@/auth"
 * swapped for tests/support/fake-auth.ts (see tests/support/resolve.mjs).
 *
 * This file needs NO database: it covers every response the routes give
 * BEFORE they reach one (503 unconfigured, 401, 400, 413), and the 500 path
 * against a database that refuses connections. The 200/201/404/409 paths
 * need real rows and live in tests/db/api-routes.test.ts.
 */
import { after, afterEach, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { sampleLeague } from "../../lib/engine/sample.ts";
import { emptySchedule } from "../../lib/engine/sanitize.ts";
import { setSession } from "../support/fake-auth.ts";

// lib/db.ts reads the URL once, at import: point it at a port nothing listens
// on BEFORE importing the routes, so any query fails fast and harmlessly.
const DEAD_DB = "postgres://u:p@127.0.0.1:9/nothing";
const CONFIG = { DATABASE_URL: DEAD_DB, AUTH_SECRET: "s", AUTH_GOOGLE_ID: "id", AUTH_GOOGLE_SECRET: "sec" };
const ENV_KEYS = [...Object.keys(CONFIG), "POSTGRES_URL"];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
delete process.env.POSTGRES_URL;
Object.assign(process.env, CONFIG);

const list = await import("../../app/api/leagues/route.ts");
const one = await import("../../app/api/leagues/[id]/route.ts");
const { sql } = await import("../../lib/db.ts");

after(async () => {
    await sql.end({ timeout: 1 });
    for (const k of ENV_KEYS) if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
});
beforeEach(() => {
    Object.assign(process.env, CONFIG);
    setSession({ user: { id: 1 } });
});

const ctx = (id = "abc") => ({ params: Promise.resolve({ id }) });
const body = (b: unknown) => (typeof b === "string" ? b : JSON.stringify(b));
const post = (b: unknown) => list.POST(new Request("http://x/api/leagues", { method: "POST", body: body(b) }));
const put = (b: unknown, id = "abc") => one.PUT(new Request(`http://x/api/leagues/${id}`, { method: "PUT", body: body(b) }), ctx(id));
const goodSave = { name: "L", version: 1, data: sampleLeague(), schedule: emptySchedule() };

/** Every handler, each with a body that would otherwise be valid. */
const everyHandler = (): [string, () => Promise<Response>][] => [
    ["GET /api/leagues", () => list.GET()],
    ["POST /api/leagues", () => post({ name: "L" })],
    ["GET /api/leagues/[id]", () => one.GET(new Request("http://x"), ctx())],
    ["PUT /api/leagues/[id]", () => put(goodSave)],
    ["DELETE /api/leagues/[id]", () => one.DELETE(new Request("http://x", { method: "DELETE" }), ctx())],
];

async function expectError(res: Response, status: number, error: string | RegExp) {
    assert.equal(res.status, status);
    const j = (await res.json()) as { error: string };
    if (typeof error === "string") assert.equal(j.error, error);
    else assert.match(j.error, error);
}

describe("unconfigured site (browser mode)", () => {
    for (const k of ["DATABASE_URL", "AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"]) {
        test(`without ${k}, every route answers 503 with a plain message`, async () => {
            delete process.env[k];
            for (const [name, call] of everyHandler()) await expectError(await call(), 503, "Saving to the cloud isn’t set up on this site yet.").catch((e) => assert.fail(`${name}: ${e.message}`));
        });
    }
});

describe("signed out", () => {
    test("every route answers 401", async () => {
        setSession(null);
        for (const [name, call] of everyHandler()) await expectError(await call(), 401, "Please sign in again.").catch((e) => assert.fail(`${name}: ${e.message}`));
    });
});

describe("bad input", () => {
    test("POST: unreadable JSON is 400", async () => {
        await expectError(await post("{nope"), 400, "That request wasn’t valid.");
        await expectError(await post(""), 400, "That request wasn’t valid.");
    });

    test("POST: no usable name is 400", async () => {
        for (const b of [{}, { name: "   " }, { name: 5 }, null, []]) await expectError(await post(b), 400, "Give the league a name.");
    });

    test("PUT: unreadable JSON is 400", async () => {
        await expectError(await put("{nope"), 400, "That request wasn’t valid.");
    });

    test("PUT: missing name, version, data or schedule -- or a non-integer version -- is 400", async () => {
        const msg = "That save was missing information. Reload the page and try again.";
        for (const k of ["name", "version", "data", "schedule"] as const) {
            const b: Record<string, unknown> = { ...goodSave };
            delete b[k];
            await expectError(await put(b), 400, msg);
        }
        for (const version of [1.5, "1", null, NaN]) await expectError(await put({ ...goodSave, version }), 400, msg);
        await expectError(await put({ ...goodSave, name: "  " }), 400, msg);
        await expectError(await put(null), 400, msg);
    });

    test("oversize bodies are 413 on POST and PUT", async () => {
        const huge = { ...goodSave, notes: "x".repeat(3_000_001) };
        await expectError(await post(huge), 413, "This league is too large to save.");
        await expectError(await put(huge), 413, "This league is too large to save.");
    });
});

describe("database failure", () => {
    let logged: string[] = [];
    let spy: ReturnType<typeof mock.method>;
    beforeEach(() => {
        logged = [];
        spy = mock.method(console, "error", (label: unknown) => void logged.push(String(label)));
    });
    afterEach(() => spy.mock.restore());

    const cases: [string, () => Promise<Response>, string, RegExp][] = [
        ["GET /api/leagues", () => list.GET(), "LIST LEAGUES ERROR", /^Couldn’t load your leagues\. Try again in a moment\. \(Reference [A-Z0-9]{6}\)$/],
        ["POST /api/leagues", () => post({ name: "L" }), "CREATE LEAGUE ERROR", /^Couldn’t create the league\. Try again in a moment\. \(Reference [A-Z0-9]{6}\)$/],
        ["GET /api/leagues/[id]", () => one.GET(new Request("http://x"), ctx()), "GET LEAGUE ERROR", /^Couldn’t load the league\. Try again in a moment\. \(Reference [A-Z0-9]{6}\)$/],
        ["PUT /api/leagues/[id]", () => put(goodSave), "SAVE LEAGUE ERROR", /^Couldn’t save\. Your changes are still on screen; we’ll keep trying\. \(Reference [A-Z0-9]{6}\)$/],
        ["DELETE /api/leagues/[id]", () => one.DELETE(new Request("http://x", { method: "DELETE" }), ctx()), "DELETE LEAGUE ERROR", /^Couldn’t delete the league\. Try again in a moment\. \(Reference [A-Z0-9]{6}\)$/],
    ];
    for (const [name, call, label, message] of cases) {
        test(`${name}: 500 with a reference, logged under ${label}, no internals leaked`, async () => {
            const res = await call();
            assert.equal(res.status, 500);
            const j = (await res.json()) as { error: string; ref: string };
            assert.match(j.error, message);
            assert.ok(j.error.endsWith(`(Reference ${j.ref})`));
            assert.doesNotMatch(JSON.stringify(j), /ECONNREFUSED|127\.0\.0\.1|postgres|connect|Error:/i);
            assert.deepEqual(logged, [`${label} [ref ${j.ref}]:`]);
        });
    }
});
