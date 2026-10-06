import { beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { browserLeagues, browserStore, clearAllMirrors, cloudStore, readMirrors, removeMirror, storeFor, writeMirror, type LeagueRecord } from "../../lib/client/store.ts";
import { emptyLeague, emptySchedule } from "../../lib/engine/sanitize.ts";
import { sampleLeague } from "../../lib/engine/sample.ts";
import { installWindow, json, scriptFetch, text, type MemoryStorage } from "../support/browser.ts";

// These literal keys hold real users' data. Renaming either (e.g. to match the
// brand) would make every browser-saved league and mirror vanish on upgrade.
const LEAGUES_KEY = "tennis-scheduler.leagues.v1";
const MIRROR_PREFIX = "courtside.mirror.";
const SIGNED_OUT = "You’ve been signed out. Sign in again in another tab; your changes stay on this page.";

let storage: MemoryStorage;
beforeEach(() => {
    storage = installWindow();
});

const rec = (over: Partial<LeagueRecord> = {}): LeagueRecord => ({ id: "x", name: "N", data: emptyLeague(), schedule: emptySchedule(), version: 1, updatedAt: "2027-01-01T00:00:00.000Z", updatedBy: null, ...over });

describe("browserStore", () => {
    test("stores leagues under the original key, 'tennis-scheduler.leagues.v1'", async () => {
        const r = await browserStore.create("Spring");
        assert.deepEqual(storage.keys(), [LEAGUES_KEY]);
        assert.ok(JSON.parse(storage.raw(LEAGUES_KEY)!)[r.id]);
    });

    test("create: version 1, a fresh uuid, an empty league unless one is given", async () => {
        const a = await browserStore.create("A");
        const b = await browserStore.create("B", sampleLeague("hockey"));
        assert.equal(a.version, 1);
        assert.match(a.id, /^[0-9a-f-]{36}$/);
        assert.notEqual(a.id, b.id);
        assert.deepEqual(a.data, emptyLeague());
        assert.deepEqual(a.schedule, emptySchedule());
        assert.equal(b.data.settings.sport, "hockey");
        assert.equal(a.updatedBy, null);
    });

    test("load: the saved record, or null", async () => {
        const a = await browserStore.create("A", sampleLeague());
        const back = await browserStore.load(a.id);
        assert.deepEqual(back, a);
        assert.equal(await browserStore.load("nope"), null);
    });

    test("list: summaries with counts, most recently updated first", async (t) => {
        t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2027-01-01T00:00:00Z") });
        const a = await browserStore.create("Older", sampleLeague());
        t.mock.timers.tick(1000);
        const b = await browserStore.create("Newer", emptyLeague(), {
            matches: [
                { id: "m1", home: "a", away: "b", bracketId: "x", pool: "", date: "2027-03-06", time: "09:00", locationId: "l", slotId: "s", locked: false },
                { id: "m2", home: "a", away: "b", bracketId: "x", pool: "", date: null, time: null, locationId: null, slotId: null, locked: false },
            ],
            generatedAt: null,
            warnings: [],
        });
        const list = await browserStore.list();
        assert.deepEqual(
            list.map((s) => [s.id, s.name, s.teamCount, s.matchCount, s.unplacedCount]),
            [
                [b.id, "Newer", 0, 2, 1],
                [a.id, "Older", 24, 0, 0],
            ]
        );
    });

    test("save: right version saves and bumps it", async () => {
        const a = await browserStore.create("A");
        const out = await browserStore.save({ id: a.id, name: "A2", data: sampleLeague(), schedule: emptySchedule(), version: 1 });
        assert.equal(out.ok, true);
        assert.equal(out.ok && out.version, 2);
        const back = (await browserStore.load(a.id))!;
        assert.equal(back.name, "A2");
        assert.equal(back.version, 2);
        assert.equal(back.data.teams.length, 24);
    });

    test("save: a stale version is a conflict carrying the current copy (never an overwrite)", async () => {
        const a = await browserStore.create("A");
        await browserStore.save({ ...a, name: "From tab 1", version: 1 });
        const stale = await browserStore.save({ ...a, name: "From tab 2", version: 1 });
        assert.equal(stale.ok, false);
        if (stale.ok || stale.kind !== "conflict") throw new Error("expected a conflict");
        assert.equal(stale.current.name, "From tab 1");
        assert.equal(stale.current.version, 2);
        assert.equal(stale.message, "This league was changed in another tab since you opened it.");
        assert.equal((await browserStore.load(a.id))!.name, "From tab 1");
    });

    test("save: a league deleted in another tab is an error that doesn't retry", async () => {
        const out = await browserStore.save({ id: "gone", name: "x", data: emptyLeague(), schedule: emptySchedule(), version: 1 });
        assert.deepEqual(out, { ok: false, kind: "error", message: "This league was deleted in another tab.", retry: false });
    });

    test("remove", async () => {
        const a = await browserStore.create("A");
        const b = await browserStore.create("B");
        await browserStore.remove(a.id);
        assert.deepEqual((await browserStore.list()).map((s) => s.id), [b.id]);
        await browserStore.remove("never-existed");
    });

    test("old or damaged stored data is sanitized on read, never crashes", async () => {
        storage.setItem(
            LEAGUES_KEY,
            JSON.stringify({
                old: { name: 5, data: { settings: {}, locations: [{ id: "l", name: "Old" }], slots: [{ id: "s", day: 6, time: "09:00", locationId: "l" }] }, schedule: null },
                junk: "not a record",
                nul: null,
            })
        );
        const list = await browserStore.list();
        assert.deepEqual(list.map((s) => s.id), ["old"]);
        const old = (await browserStore.load("old"))!;
        assert.equal(old.name, "Untitled league");
        assert.equal(old.version, 1);
        assert.equal(old.updatedAt, new Date(0).toISOString());
        assert.equal(old.data.settings.sport, "tennis");
        assert.deepEqual(old.data.locations[0].units, []);
        assert.deepEqual(old.data.slots[0].unitIds, []);
        assert.deepEqual(old.schedule, emptySchedule());
    });

    test("unparseable stored JSON reads as no leagues", async () => {
        storage.setItem(LEAGUES_KEY, "{not json");
        assert.deepEqual(await browserStore.list(), []);
        assert.equal(await browserStore.load("x"), null);
    });

    test("full storage: create throws a readable error; save says so and doesn't retry", async () => {
        const a = await browserStore.create("A");
        storage.mode = "full";
        await assert.rejects(browserStore.create("B"), /storage may be full or blocked\). Export a backup/);
        const out = await browserStore.save({ ...a, version: 1 });
        assert.equal(out.ok, false);
        assert.ok(!out.ok && out.kind === "error" && out.retry === false && /wouldn’t store the league/.test(out.message));
        await browserStore.remove(a.id); // must not throw either
    });

    test("blocked storage (site data off): reads are empty, nothing throws on list/load/remove", async () => {
        storage.mode = "blocked";
        assert.deepEqual(await browserStore.list(), []);
        assert.equal(await browserStore.load("x"), null);
        await browserStore.remove("x");
        assert.deepEqual(await browserLeagues(), []);
    });

    test("browserLeagues returns every record; storeFor picks the store", async () => {
        await browserStore.create("A");
        await browserStore.create("B");
        assert.deepEqual((await browserLeagues()).map((r) => r.name).sort(), ["A", "B"]);
        assert.equal(storeFor("browser"), browserStore);
        assert.equal(storeFor("cloud"), cloudStore);
    });
});

describe("mirrors", () => {
    const m = (id: string, name = id) => ({ id, name, data: sampleLeague(), schedule: emptySchedule() });

    test("written under 'courtside.mirror.v2.<user>' -- the original prefix, per account", () => {
        writeMirror("alice", m("l1"));
        assert.deepEqual(storage.keys(), [`${MIRROR_PREFIX}v2.alice`]);
    });

    test("read back sanitized, newest first", (t) => {
        t.mock.timers.enable({ apis: ["Date"], now: 1_000 });
        writeMirror("alice", m("l1", "First"));
        t.mock.timers.tick(10);
        writeMirror("alice", m("l2", "Second"));
        const out = readMirrors("alice");
        assert.deepEqual(out.map((x) => x.name), ["Second", "First"]);
        assert.equal(out[0].savedAt, new Date(1_010).toISOString());
        assert.deepEqual(out[0].data, sampleLeague());
    });

    test("one account never sees another's mirrors (shared computers)", () => {
        writeMirror("alice", m("l1"));
        writeMirror("bob", m("l2"));
        assert.deepEqual(readMirrors("alice").map((x) => x.id), ["l1"]);
        assert.deepEqual(readMirrors("bob").map((x) => x.id), ["l2"]);
        assert.deepEqual(readMirrors("carol"), []);
    });

    test("no user key: nothing written, nothing read", () => {
        writeMirror("", m("l1"));
        assert.deepEqual(storage.keys(), []);
        assert.deepEqual(readMirrors(""), []);
    });

    test("re-writing a league replaces its mirror; at most 15 are kept, the most recent", (t) => {
        t.mock.timers.enable({ apis: ["Date"], now: 1_000 });
        for (let i = 0; i < 20; i++) {
            writeMirror("alice", m(`l${i}`));
            t.mock.timers.tick(1);
        }
        writeMirror("alice", m("l0", "Edited again"));
        const ids = readMirrors("alice").map((x) => x.id);
        assert.equal(ids.length, 15);
        assert.equal(ids[0], "l0");
        assert.ok(!ids.includes("l5") && ids.includes("l6") && ids.includes("l19"));
    });

    test("removeMirror removes one", () => {
        writeMirror("alice", m("l1"));
        writeMirror("alice", m("l2"));
        removeMirror("alice", "l1");
        assert.deepEqual(readMirrors("alice").map((x) => x.id), ["l2"]);
    });

    test("clearAllMirrors removes every account's mirrors and nothing else", async () => {
        await browserStore.create("Browser league");
        storage.setItem("unrelated", "keep");
        writeMirror("alice", m("l1"));
        writeMirror("bob", m("l2"));
        storage.setItem(`${MIRROR_PREFIX}v1-legacy`, "{}");
        clearAllMirrors();
        assert.deepEqual(storage.keys().sort(), [LEAGUES_KEY, "unrelated"].sort());
    });

    test("damaged mirror data is skipped or sanitized", () => {
        storage.setItem(`${MIRROR_PREFIX}v2.alice`, JSON.stringify({ a: { id: "a", data: { teams: "x" }, savedAt: "2027-01-01" }, b: { name: "no id" }, c: null }));
        const out = readMirrors("alice");
        assert.deepEqual(out.map((x) => [x.id, x.name, x.data.teams.length]), [["a", "Untitled league", 0]]);
        storage.setItem(`${MIRROR_PREFIX}v2.bob`, "{oops");
        assert.deepEqual(readMirrors("bob"), []);
    });

    test("full or blocked storage never throws from any mirror function", () => {
        writeMirror("alice", m("l1"));
        storage.mode = "full";
        writeMirror("alice", m("l2"));
        removeMirror("alice", "l1");
        assert.deepEqual(readMirrors("alice").map((x) => x.id), ["l1"], "the failed writes changed nothing");
        storage.mode = "blocked";
        writeMirror("alice", m("l3"));
        assert.deepEqual(readMirrors("alice"), []);
        removeMirror("alice", "l1");
        clearAllMirrors();
    });
});

describe("cloudStore (mocked fetch)", () => {
    const league = { id: "abc", name: "L", data: emptyLeague(), schedule: emptySchedule(), version: 3 };

    test("list: GET /api/leagues, uncached", async () => {
        const calls = scriptFetch(json(200, { leagues: [{ id: "a" }] }));
        assert.deepEqual(await cloudStore.list(), [{ id: "a" }]);
        assert.equal(calls[0].url, "/api/leagues");
        assert.equal(calls[0].init?.cache, "no-store");
    });

    test("create: POSTs name, data and schedule as JSON", async () => {
        const calls = scriptFetch(json(201, { league: rec({ id: "new" }) }));
        const out = await cloudStore.create("Spring", sampleLeague(), emptySchedule());
        assert.equal(out.id, "new");
        assert.equal(calls[0].init?.method, "POST");
        assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { name: "Spring", data: sampleLeague(), schedule: emptySchedule() });
        assert.equal((calls[0].init?.headers as Record<string, string>)["content-type"], "application/json");
    });

    test("load: 404 is null; the id is URL-encoded", async () => {
        const calls = scriptFetch(json(404, { error: "x" }), json(200, { league: rec() }));
        assert.equal(await cloudStore.load("a/b c"), null);
        assert.equal(calls[0].url, "/api/leagues/a%2Fb%20c");
        assert.equal((await cloudStore.load("x"))!.id, "x");
    });

    test("errors carry the server's own message when it sent one", async () => {
        scriptFetch(json(500, { error: "Couldn’t load your leagues. Try again in a moment. (Reference ABC123)" }));
        await assert.rejects(cloudStore.list(), { message: "Couldn’t load your leagues. Try again in a moment. (Reference ABC123)" });
    });

    test("errors from outside our code (no JSON) get a readable message per status", async () => {
        const cases: [number, string][] = [
            [401, SIGNED_OUT],
            [413, "This league is too large to save."],
            [404, "This league wasn’t found. It may have been deleted."],
            [502, "The server is busy or restarting (error 502). We’ll keep trying."],
            [503, "The server is busy or restarting (error 503). We’ll keep trying."],
            [504, "The server is busy or restarting (error 504). We’ll keep trying."],
            [500, "Something went wrong (error 500). Try again in a moment."],
            [418, "Something went wrong (error 418). Try again in a moment."],
        ];
        for (const [status, message] of cases) {
            scriptFetch(text(status, "<html>gateway</html>"));
            await assert.rejects(cloudStore.list(), { message }, String(status));
        }
        scriptFetch(json(500, { notError: true }));
        await assert.rejects(cloudStore.create("x"), { message: "Something went wrong (error 500). Try again in a moment." });
    });

    test("save: PUT with the version; ok returns the new version", async () => {
        const calls = scriptFetch(json(200, { version: 4, updatedAt: "2027-01-01T00:00:00.000Z" }));
        assert.deepEqual(await cloudStore.save(league), { ok: true, version: 4, updatedAt: "2027-01-01T00:00:00.000Z" });
        assert.equal(calls[0].url, "/api/leagues/abc");
        assert.equal(calls[0].init?.method, "PUT");
        assert.equal(JSON.parse(String(calls[0].init?.body)).version, 3);
    });

    test("save: 409 is a conflict with the server's current copy and message", async () => {
        const current = rec({ id: "abc", name: "Newer", version: 5 });
        scriptFetch(json(409, { error: "This league was changed somewhere else since you opened it.", current }));
        assert.deepEqual(await cloudStore.save(league), { ok: false, kind: "conflict", current, message: "This league was changed somewhere else since you opened it." });
    });

    test("save: 401 is OUR signed-out sentence (whatever the server said) and retries", async () => {
        for (const reply of [json(401, { error: "Please sign in again." }), text(401)]) {
            scriptFetch(reply);
            assert.deepEqual(await cloudStore.save(league), { ok: false, kind: "error", message: SIGNED_OUT, retry: true });
        }
    });

    test("save: retry only for 429 and 5xx; other 4xx would fail the same way again", async () => {
        const cases: [Response, boolean, string][] = [
            [json(429, { error: "Slow down" }), true, "Slow down"],
            [json(500, { error: "Couldn’t save. (Reference X)" }), true, "Couldn’t save. (Reference X)"],
            [text(503), true, "The server is busy or restarting (error 503). We’ll keep trying."],
            [json(413, { error: "This league is too large to save." }), false, "This league is too large to save."],
            [text(413), false, "This league is too large to save."],
            [json(400, { error: "That save was missing information. Reload the page and try again." }), false, "That save was missing information. Reload the page and try again."],
            [json(404, { error: "This league was deleted." }), false, "This league was deleted."],
        ];
        for (const [res, retry, message] of cases) {
            scriptFetch(res);
            assert.deepEqual(await cloudStore.save(league), { ok: false, kind: "error", message, retry }, `${res.status}`);
        }
    });

    test("save: a network failure says 'offline' and retries", async () => {
        scriptFetch(new TypeError("fetch failed"));
        assert.deepEqual(await cloudStore.save(league), { ok: false, kind: "error", message: "You seem to be offline. Your changes are still on screen; we’ll keep trying.", retry: true });
    });

    test("remove: DELETE; a 404 (already gone) is fine; anything else throws", async () => {
        const calls = scriptFetch(json(200, { ok: true }), json(404, { error: "gone" }), json(500, { error: "Couldn’t delete the league." }));
        await cloudStore.remove("abc");
        assert.equal(calls[0].init?.method, "DELETE");
        await cloudStore.remove("abc");
        await assert.rejects(cloudStore.remove("abc"), { message: "Couldn’t delete the league." });
    });

    test("the guide's 'Saving' table quotes the signed-out sentence", () => {
        const guide = readFileSync(new URL("../../components/guide/GuideContent.tsx", import.meta.url), "utf8");
        const quoted = /Not saved yet: (You’ve been signed out)…/.exec(guide)?.[1];
        assert.ok(quoted && SIGNED_OUT.startsWith(quoted));
    });

    test("cloud calls never touch localStorage", async () => {
        scriptFetch(json(200, { leagues: [] }));
        const spy = mock.method(storage, "getItem");
        await cloudStore.list();
        assert.equal(spy.mock.callCount(), 0);
    });
});
