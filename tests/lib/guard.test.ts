import { afterEach, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { cleanName, errorRef, isGuardFailure, MAX_BODY_BYTES, readJson, requireUser, serverError } from "../../lib/guard.ts";
import { setSession } from "../support/fake-auth.ts";

const CLOUD_ENV = ["DATABASE_URL", "POSTGRES_URL", "AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"] as const;
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
    saved = Object.fromEntries(CLOUD_ENV.map((k) => [k, process.env[k]]));
    for (const k of CLOUD_ENV) delete process.env[k];
    setSession(null);
});
afterEach(() => {
    for (const k of CLOUD_ENV) if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
});
const configure = () => Object.assign(process.env, { DATABASE_URL: "postgres://u:p@127.0.0.1:9/x", AUTH_SECRET: "s", AUTH_GOOGLE_ID: "id", AUTH_GOOGLE_SECRET: "sec" });
const req = (body: string) => new Request("http://localhost/api/leagues", { method: "POST", body });

describe("requireUser", () => {
    test("unconfigured site: 503 with a plain message, never a sign-in wall", async () => {
        const g = await requireUser();
        assert.ok(isGuardFailure(g));
        assert.equal(g.response.status, 503);
        assert.deepEqual(await g.response.json(), { error: "Saving to the cloud isn’t set up on this site yet." });
    });

    test("configured, no session (or a session without our user id): 401", async () => {
        configure();
        for (const s of [null, {}, { user: {} }, { user: { email: "a@b.c" } }]) {
            setSession(s);
            const g = await requireUser();
            assert.ok(isGuardFailure(g));
            assert.equal(g.response.status, 401);
            assert.deepEqual(await g.response.json(), { error: "Please sign in again." });
        }
    });

    test("configured and signed in: the user's id", async () => {
        configure();
        setSession({ user: { id: 42 } });
        const g = await requireUser();
        assert.equal(isGuardFailure(g), false);
        assert.deepEqual(g, { userId: 42 });
    });
});

describe("readJson", () => {
    test("valid JSON bodies, including null and arrays", async () => {
        assert.deepEqual(await readJson(req('{"name":"x"}')), { body: { name: "x" } });
        assert.deepEqual(await readJson(req("null")), { body: null });
        assert.deepEqual(await readJson(req("[1]")), { body: [1] });
    });

    test("bad JSON (or none): 400 with a human message", async () => {
        for (const body of ["", "{", "name=x", "{'a':1}"]) {
            const r = await readJson(req(body));
            assert.ok("response" in r, body);
            assert.equal(r.response.status, 400);
            assert.deepEqual(await r.response.json(), { error: "That request wasn’t valid." });
        }
    });

    test("over the size cap: 413; at the cap: read", async () => {
        const pad = (n: number) => JSON.stringify({ x: "a".repeat(n - 8) });
        assert.equal(pad(MAX_BODY_BYTES).length, MAX_BODY_BYTES);
        const atCap = await readJson(req(pad(MAX_BODY_BYTES)));
        assert.ok("body" in atCap);
        const over = await readJson(req(pad(MAX_BODY_BYTES + 1)));
        assert.ok("response" in over);
        assert.equal(over.response.status, 413);
        assert.deepEqual(await over.response.json(), { error: "This league is too large to save." });
    });

    test("the cap is ~3 MB, far above a real league (1000 teams, 10k matches)", () => {
        assert.equal(MAX_BODY_BYTES, 3_000_000);
    });

    test("the cap counts UTF-8 BYTES, as its name says (multi-byte text can't slip past it)", async () => {
        const over = JSON.stringify({ x: "é".repeat(1_600_000) });
        assert.ok(over.length < MAX_BODY_BYTES && Buffer.byteLength(over) > MAX_BODY_BYTES);
        const r = await readJson(req(over));
        assert.ok("response" in r && r.response.status === 413);
        // Exactly at the cap in bytes (2-byte "é" padding) is still read, and decoded right.
        const base = JSON.stringify({ x: "" }).length;
        const at = JSON.stringify({ x: "é".repeat((MAX_BODY_BYTES - base) / 2) });
        assert.equal(Buffer.byteLength(at), MAX_BODY_BYTES);
        const ok = await readJson(req(at));
        assert.ok("body" in ok && (ok.body as { x: string }).x.startsWith("éé"));
    });
});

describe("cleanName", () => {
    test("trims and cuts to 120 characters", () => {
        assert.equal(cleanName("  Spring 2027  "), "Spring 2027");
        assert.equal(cleanName("x".repeat(300))!.length, 120);
    });
    test("null for blanks and non-strings", () => {
        for (const v of ["", "   ", "\n\t", null, undefined, 5, {}, ["x"]]) assert.equal(cleanName(v), null, JSON.stringify(v));
    });
});

describe("errorRef / serverError", () => {
    test("errorRef is 6 upper-case letters/digits, and varies", () => {
        const refs = new Set<string>();
        for (let i = 0; i < 2000; i++) {
            const r = errorRef();
            assert.match(r, /^[A-Z0-9]{6}$/);
            refs.add(r);
        }
        assert.ok(refs.size > 1990, "practically unique");
    });

    test("errorRef stays 6 characters even for short random draws", (t) => {
        for (const v of [0, 0.5, 0.25, 1 / 36]) {
            t.mock.method(Math, "random", () => v);
            assert.match(errorRef(), /^[A-Z0-9]{6}$/, String(v));
            t.mock.restoreAll();
        }
    });

    test("serverError: 500, '<message> (Reference XXXXXX)', the ref in the body, and never the error text", async () => {
        const logged: unknown[][] = [];
        const spy = mock.method(console, "error", (...args: unknown[]) => void logged.push(args));
        try {
            const secret = new Error('relation "leagues" does not exist at character 42 -- password=hunter2');
            const res = serverError("SAVE LEAGUE ERROR", secret, "Couldn’t save. Your changes are still on screen; we’ll keep trying.");
            assert.equal(res.status, 500);
            const body = (await res.json()) as { error: string; ref: string };
            assert.match(body.error, /^Couldn’t save\. Your changes are still on screen; we’ll keep trying\. \(Reference [A-Z0-9]{6}\)$/);
            assert.equal(body.error.endsWith(`(Reference ${body.ref})`), true);
            assert.deepEqual(Object.keys(body).sort(), ["error", "ref"]);
            assert.doesNotMatch(JSON.stringify(body), /relation|leagues|hunter2|character|Error/);
            // The log line carries the label, the same ref, and the real error.
            assert.equal(spy.mock.callCount(), 1);
            assert.equal(logged[0][0], `SAVE LEAGUE ERROR [ref ${body.ref}]:`);
            assert.equal(logged[0][1], secret);
        } finally {
            spy.mock.restore();
        }
    });
});
