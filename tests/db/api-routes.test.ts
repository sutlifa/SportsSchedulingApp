/**
 * The /api/leagues routes end to end: real handlers, real lib/leagues.ts, a
 * real (local) Postgres. Only "@/auth" is a stand-in (tests/support/fake-auth.ts),
 * so "who is signed in" is set per test.
 */
import { ensureDatabase } from "../support/db.ts";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { setSession } from "../support/fake-auth.ts";
import { sampleLeague } from "../../lib/engine/sample.ts";
import { emptyLeague, emptySchedule } from "../../lib/engine/sanitize.ts";
import type { LeagueRecord, LeagueSummary } from "../../lib/leagues.ts";

Object.assign(process.env, { AUTH_SECRET: "s", AUTH_GOOGLE_ID: "id", AUTH_GOOGLE_SECRET: "sec" });
const list = await import("../../app/api/leagues/route.ts");
const one = await import("../../app/api/leagues/[id]/route.ts");
const { sql } = await import("../../lib/db.ts");
const { ensureSchema } = await import("../../lib/db/ensure.ts");
const { upsertUser } = await import("../../lib/users.ts");

let alice = 0;
let bob = 0;
before(async () => {
    await ensureDatabase();
    await ensureSchema();
});
beforeEach(async () => {
    await sql`TRUNCATE users RESTART IDENTITY CASCADE`;
    alice = await upsertUser({ googleId: "g-alice", email: "alice@example.com", name: "Alice" });
    bob = await upsertUser({ googleId: "g-bob", email: "bob@example.com", name: "Bob" });
    as(alice);
});
after(async () => {
    await sql.end({ timeout: 1 });
});

const as = (userId: number | null) => setSession(userId === null ? null : { user: { id: userId } });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: unknown) => new Request("http://x/api/leagues", { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const create = async (name = "Spring", data: unknown = sampleLeague(), schedule: unknown = emptySchedule()) => {
    const res = await list.POST(req("POST", { name, data, schedule }));
    assert.equal(res.status, 201);
    return ((await res.json()) as { league: LeagueRecord }).league;
};
const get = (id: string) => one.GET(req("GET"), ctx(id));
const put = (id: string, body: unknown) => one.PUT(req("PUT", body), ctx(id));
const del = (id: string) => one.DELETE(req("DELETE"), ctx(id));

describe("POST /api/leagues", () => {
    test("201 with the new league at version 1", async () => {
        const rec = await create("Spring 2027", sampleLeague("soccer"));
        assert.equal(rec.version, 1);
        assert.equal(rec.name, "Spring 2027");
        assert.deepEqual(rec.data, sampleLeague("soccer"));
    });

    test("no data or schedule: an empty league", async () => {
        const res = await list.POST(req("POST", { name: "  Blank  " }));
        const rec = ((await res.json()) as { league: LeagueRecord }).league;
        assert.equal(rec.name, "Blank");
        assert.deepEqual(rec.data, emptyLeague());
        assert.deepEqual(rec.schedule, emptySchedule());
    });

    test("untrusted data is sanitized before it's stored", async () => {
        const data = sampleLeague();
        data.locations[0].mapUrl = "javascript:alert(1)";
        const rec = await create("x", { ...data, extra: "dropped", teams: [...data.teams, "junk"] });
        assert.equal(rec.data.locations[0].mapUrl, "");
        assert.equal(rec.data.teams.length, 25, "junk coerced to an unnamed team, never passed through raw");
        const [row] = await sql<{ data: Record<string, unknown> }[]>`SELECT data FROM leagues WHERE id = ${rec.id}`;
        assert.equal("extra" in row.data, false);
    });
});

describe("GET /api/leagues", () => {
    test("200 with only the caller's leagues, as summaries", async () => {
        await create("A");
        as(bob);
        await create("B");
        as(alice);
        const res = await list.GET();
        assert.equal(res.status, 200);
        const j = (await res.json()) as { leagues: LeagueSummary[] };
        assert.deepEqual(j.leagues.map((s) => [s.name, s.teamCount, s.matchCount, s.unplacedCount]), [["A", 24, 0, 0]]);
        assert.equal("data" in j.leagues[0], false, "the list never ships whole leagues");
    });
});

describe("GET /api/leagues/[id]", () => {
    test("200 for the owner", async () => {
        const rec = await create();
        const res = await get(rec.id);
        assert.equal(res.status, 200);
        assert.deepEqual(((await res.json()) as { league: LeagueRecord }).league, rec);
    });

    test("404 for someone else's id (never 403, which would confirm it exists), and for unknown ids", async () => {
        const rec = await create();
        as(bob);
        for (const id of [rec.id, "no-such-id"]) {
            const res = await get(id);
            assert.equal(res.status, 404);
            assert.deepEqual(await res.json(), { error: "That league doesn’t exist or was deleted." });
        }
    });
});

describe("PUT /api/leagues/[id]", () => {
    test("200 with the new version", async () => {
        const rec = await create();
        const res = await put(rec.id, { name: "Renamed", version: 1, data: rec.data, schedule: rec.schedule });
        assert.equal(res.status, 200);
        const j = (await res.json()) as { version: number; updatedAt: string };
        assert.equal(j.version, 2);
        assert.ok(!Number.isNaN(Date.parse(j.updatedAt)));
        assert.equal((((await (await get(rec.id)).json()) as { league: LeagueRecord }).league).name, "Renamed");
    });

    test("409 on a stale version, carrying the current copy; nothing overwritten", async () => {
        const rec = await create();
        await put(rec.id, { name: "Newer", version: 1, data: rec.data, schedule: rec.schedule });
        const res = await put(rec.id, { name: "Stale", version: 1, data: emptyLeague(), schedule: emptySchedule() });
        assert.equal(res.status, 409);
        const j = (await res.json()) as { error: string; current: LeagueRecord };
        assert.equal(j.error, "This league was changed somewhere else since you opened it.");
        assert.deepEqual([j.current.name, j.current.version, j.current.data.teams.length], ["Newer", 2, 24]);
    });

    test("404 for someone else's league -- and their save changes nothing", async () => {
        const rec = await create();
        as(bob);
        const res = await put(rec.id, { name: "hijack", version: 1, data: emptyLeague(), schedule: emptySchedule() });
        assert.equal(res.status, 404);
        assert.deepEqual(await res.json(), { error: "This league was deleted." });
        as(alice);
        assert.equal((((await (await get(rec.id)).json()) as { league: LeagueRecord }).league).name, "Spring");
    });

    test("the saved body is sanitized", async () => {
        const rec = await create();
        const data = structuredClone(rec.data);
        data.brackets[0].color = "red";
        await put(rec.id, { name: "x", version: 1, data, schedule: { matches: [{ id: "m", home: "a", away: "b", date: "soon", time: "09:00" }] } });
        const back = ((await (await get(rec.id)).json()) as { league: LeagueRecord }).league;
        assert.equal(back.data.brackets[0].color, "#2f7fb8");
        assert.equal(back.schedule.matches[0].date, null);
    });
});

describe("DELETE /api/leagues/[id]", () => {
    test("200, then 404; a deleted league can't be read or resurrected by an autosave", async () => {
        const rec = await create();
        const res = await del(rec.id);
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { ok: true });
        const again = await del(rec.id);
        assert.equal(again.status, 404);
        assert.deepEqual(await again.json(), { error: "That league doesn’t exist or was already deleted." });
        assert.equal((await get(rec.id)).status, 404);
        assert.equal((await put(rec.id, { name: "zombie", version: 1, data: rec.data, schedule: rec.schedule })).status, 404);
        assert.deepEqual(((await (await list.GET()).json()) as { leagues: unknown[] }).leagues, []);
    });

    test("404 for someone else's league, which survives", async () => {
        const rec = await create();
        as(bob);
        assert.equal((await del(rec.id)).status, 404);
        as(alice);
        assert.equal((await get(rec.id)).status, 200);
    });
});

describe("guards still apply with a database", () => {
    test("signed out: 401 everywhere", async () => {
        const rec = await create();
        as(null);
        for (const res of [await list.GET(), await list.POST(req("POST", { name: "x" })), await get(rec.id), await put(rec.id, { name: "x", version: 1, data: {}, schedule: {} }), await del(rec.id)]) assert.equal(res.status, 401);
        as(alice);
        assert.equal((await get(rec.id)).status, 200, "nothing changed");
    });
});
