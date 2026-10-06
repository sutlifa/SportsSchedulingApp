/**
 * lib/leagues.ts + lib/users.ts against a real, LOCAL Postgres.
 *
 *     DATABASE_URL=postgres://postgres:postgres@localhost:5432/seasonsmith_unit npm run test:db
 */
import { ensureDatabase } from "../support/db.ts";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "../../lib/db.ts";
import { ensureSchema } from "../../lib/db/ensure.ts";
import { SCHEMA_SQL } from "../../lib/db/schema.ts";
import { createLeague, deleteLeague, getLeague, listLeagues, saveLeague } from "../../lib/leagues.ts";
import { upsertUser } from "../../lib/users.ts";
import { sampleLeague } from "../../lib/engine/sample.ts";
import { emptyLeague, emptySchedule, sanitizeLeague } from "../../lib/engine/sanitize.ts";
import { audit } from "../../lib/engine/engine.ts";
import { readiness } from "../../lib/engine/readiness.ts";
import type { Schedule } from "../../lib/engine/types.ts";

let alice = 0;
let bob = 0;

before(async () => {
    await ensureDatabase();
    await ensureSchema();
});
beforeEach(async () => {
    await sql`TRUNCATE users RESTART IDENTITY CASCADE`;
    alice = await upsertUser({ googleId: "g-alice", email: "alice@example.com", name: "Alice" });
    bob = await upsertUser({ googleId: "g-bob", email: "bob@example.com", name: null });
});
after(async () => {
    await sql.end({ timeout: 1 });
});

const schedule = (placed: number, unplaced: number): Schedule => ({
    matches: [
        ...Array.from({ length: placed }, (_, i) => ({ id: `p${i}`, home: "t10a", away: "t10b", bracketId: "b10", pool: "", date: "2027-03-06", time: "09:00", locationId: "loc-center", slotId: "s-sat-0", locked: false })),
        ...Array.from({ length: unplaced }, (_, i) => ({ id: `u${i}`, home: "t10a", away: "t10c", bracketId: "b10", pool: "", date: null, time: null, locationId: null, slotId: null, locked: false })),
    ],
    generatedAt: null,
    warnings: [],
});

describe("schema", () => {
    test("self-applies, and re-applying it is harmless", async () => {
        await ensureSchema();
        await sql.unsafe(SCHEMA_SQL);
        await sql.unsafe(SCHEMA_SQL);
        const tables = await sql<{ table_name: string }[]>`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`;
        assert.deepEqual(tables.map((t) => t.table_name).filter((n) => n === "users" || n === "leagues"), ["leagues", "users"]);
    });
});

describe("upsertUser", () => {
    test("idempotent on the Google id; refreshes email and name", async () => {
        const again = await upsertUser({ googleId: "g-alice", email: "alice2@example.com", name: "Alice A" });
        assert.equal(again, alice);
        const [row] = await sql<{ email: string; name: string }[]>`SELECT email, name FROM users WHERE id = ${alice}`;
        assert.deepEqual({ ...row }, { email: "alice2@example.com", name: "Alice A" });
        assert.notEqual(alice, bob);
        const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM users`;
        assert.equal(n, 2);
    });
});

describe("createLeague / getLeague", () => {
    test("a new league starts at version 1 and reads back as written", async () => {
        const rec = await createLeague(alice, "Spring 2027", sampleLeague("hockey"), schedule(2, 1));
        assert.equal(rec.version, 1);
        assert.match(rec.id, /^[0-9a-f-]{36}$/);
        assert.equal(rec.name, "Spring 2027");
        assert.equal(rec.updatedBy, null);
        assert.ok(!Number.isNaN(Date.parse(rec.updatedAt)));
        assert.deepEqual(rec.data, sampleLeague("hockey"));
        assert.deepEqual(await getLeague(alice, rec.id), rec);
    });

    test("ownership is in the SQL: another user's league reads as not found", async () => {
        const rec = await createLeague(alice, "Mine", sampleLeague(), emptySchedule());
        assert.equal(await getLeague(bob, rec.id), null);
        assert.equal(await getLeague(alice, "no-such-id"), null);
    });
});

describe("listLeagues", () => {
    test("counts teams, matches and unplaced matches from the stored JSON", async () => {
        await createLeague(alice, "A", sampleLeague(), schedule(3, 2));
        const [s] = await listLeagues(alice);
        assert.deepEqual([s.name, s.teamCount, s.matchCount, s.unplacedCount], ["A", 24, 5, 2]);
        assert.ok(!Number.isNaN(Date.parse(s.updatedAt)));
    });

    test("stored JSON missing teams or matches counts as 0", async () => {
        const rec = await createLeague(alice, "Bare", emptyLeague(), emptySchedule());
        await sql`UPDATE leagues SET data = '{}'::jsonb, schedule = '{}'::jsonb WHERE id = ${rec.id}`;
        const [s] = await listLeagues(alice);
        assert.deepEqual([s.teamCount, s.matchCount, s.unplacedCount], [0, 0, 0]);
    });

    test("only the user's own, live leagues, most recently updated first", async () => {
        const a = await createLeague(alice, "First", emptyLeague(), emptySchedule());
        const b = await createLeague(alice, "Second", emptyLeague(), emptySchedule());
        await createLeague(bob, "Bob's", emptyLeague(), emptySchedule());
        await saveLeague(alice, a.id, 1, "First, edited", emptyLeague(), emptySchedule());
        assert.deepEqual((await listLeagues(alice)).map((s) => s.name), ["First, edited", "Second"]);
        await deleteLeague(alice, b.id);
        assert.deepEqual((await listLeagues(alice)).map((s) => s.id), [a.id]);
        assert.deepEqual((await listLeagues(bob)).map((s) => s.name), ["Bob's"]);
    });

    test("returns at most 200", async () => {
        await sql`
            INSERT INTO leagues (id, user_id, name, data, schedule)
            SELECT 'bulk-' || g, ${alice}, 'L' || g, '{"teams":[]}'::jsonb, '{"matches":[]}'::jsonb FROM generate_series(1, 205) g
        `;
        assert.equal((await listLeagues(alice)).length, 200);
    });
});

describe("saveLeague: versioned saves", () => {
    test("the right version saves and bumps it; updatedAt moves forward", async () => {
        const rec = await createLeague(alice, "L", emptyLeague(), emptySchedule());
        const out = await saveLeague(alice, rec.id, 1, "L2", sampleLeague(), schedule(1, 0));
        assert.ok(out.ok);
        assert.equal(out.version, 2);
        assert.ok(out.updatedAt >= rec.updatedAt);
        const back = (await getLeague(alice, rec.id))!;
        assert.deepEqual([back.name, back.version, back.data.teams.length, back.schedule.matches.length], ["L2", 2, 24, 1]);
    });

    test("a stale version is refused with the CURRENT copy, and nothing is overwritten", async () => {
        const rec = await createLeague(alice, "L", emptyLeague(), emptySchedule());
        await saveLeague(alice, rec.id, 1, "Newer", sampleLeague(), emptySchedule());
        const stale = await saveLeague(alice, rec.id, 1, "Stale tab", emptyLeague(), emptySchedule());
        assert.equal(stale.ok, false);
        if (stale.ok || stale.reason !== "conflict") throw new Error("expected a conflict");
        assert.deepEqual([stale.current.name, stale.current.version, stale.current.data.teams.length], ["Newer", 2, 24]);
        assert.equal((await getLeague(alice, rec.id))!.name, "Newer");
        const future = await saveLeague(alice, rec.id, 9, "From the future", emptyLeague(), emptySchedule());
        assert.ok(!future.ok && future.reason === "conflict");
    });

    test("two saves racing from the same version: exactly one wins", async () => {
        const rec = await createLeague(alice, "L", emptyLeague(), emptySchedule());
        const outs = await Promise.all(["Tab A", "Tab B", "Tab C"].map((n) => saveLeague(alice, rec.id, 1, n, emptyLeague(), emptySchedule())));
        assert.equal(outs.filter((o) => o.ok).length, 1);
        assert.equal(outs.filter((o) => !o.ok && o.reason === "conflict").length, 2);
        assert.equal((await getLeague(alice, rec.id))!.version, 2);
    });

    test("another user's league, or one that doesn't exist, is 'missing' (never 'conflict', which would leak it)", async () => {
        const rec = await createLeague(alice, "Mine", sampleLeague(), emptySchedule());
        const hijack = await saveLeague(bob, rec.id, 1, "hijack", emptyLeague(), emptySchedule());
        assert.deepEqual(hijack, { ok: false, reason: "missing" });
        assert.equal((await getLeague(alice, rec.id))!.name, "Mine");
        assert.deepEqual(await saveLeague(alice, "nope", 1, "x", emptyLeague(), emptySchedule()), { ok: false, reason: "missing" });
    });
});

describe("deleteLeague: soft delete", () => {
    test("the owner deletes; it can't be read, listed or resurrected by an autosave; the row is kept", async () => {
        const rec = await createLeague(alice, "L", sampleLeague(), emptySchedule());
        assert.equal(await deleteLeague(alice, rec.id), true);
        assert.equal(await deleteLeague(alice, rec.id), false, "already deleted");
        assert.equal(await getLeague(alice, rec.id), null);
        assert.deepEqual(await listLeagues(alice), []);
        assert.deepEqual(await saveLeague(alice, rec.id, 1, "zombie", emptyLeague(), emptySchedule()), { ok: false, reason: "missing" });
        const [row] = await sql<{ deleted_at: Date | null; name: string }[]>`SELECT deleted_at, name FROM leagues WHERE id = ${rec.id}`;
        assert.ok(row.deleted_at instanceof Date, "soft: the row stays, marked deleted");
        assert.equal(row.name, "L", "the zombie save changed nothing");
    });

    test("nobody can delete someone else's league", async () => {
        const rec = await createLeague(alice, "L", emptyLeague(), emptySchedule());
        assert.equal(await deleteLeague(bob, rec.id), false);
        assert.ok(await getLeague(alice, rec.id));
    });

    test("deleting a user removes their leagues (ON DELETE CASCADE)", async () => {
        await createLeague(alice, "L", emptyLeague(), emptySchedule());
        await sql`DELETE FROM users WHERE id = ${alice}`;
        const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM leagues`;
        assert.equal(n, 0);
    });
});

describe("old shapes are sanitized on the way out", () => {
    test("a league saved before sports and named units loads in a shape the editor can use", async () => {
        const old = structuredClone(sampleLeague("tennis")) as unknown as { settings: Record<string, unknown>; locations: Record<string, unknown>[]; slots: Record<string, unknown>[] };
        delete old.settings.sport;
        for (const x of old.locations) delete x.units;
        for (const x of old.slots) delete x.unitIds;
        delete (old as Record<string, unknown>).availability;
        const oldSchedule = { matches: [{ id: "m1", home: "t10a", away: "t10b", date: "2027-03-06", time: "09:00", locationId: "loc-center", slotId: "s-sat-0" }] };
        const rec = await createLeague(alice, "Old", emptyLeague(), emptySchedule());
        await sql`UPDATE leagues SET data = ${sql.json(old as never)}, schedule = ${sql.json(oldSchedule as never)} WHERE id = ${rec.id}`;
        const back = (await getLeague(alice, rec.id))!;
        assert.equal(back.data.settings.sport, "tennis");
        assert.ok(back.data.locations.every((l) => Array.isArray(l.units)));
        assert.ok(back.data.slots.every((s) => Array.isArray(s.unitIds)));
        assert.deepEqual(back.data.availability, []);
        assert.equal(back.schedule.matches[0].locked, false);
        assert.deepEqual(back.data, sanitizeLeague(old));
        assert.doesNotThrow(() => audit(back.data, back.schedule.matches));
        assert.doesNotThrow(() => readiness(back.data, back.name));
    });

    test("non-object JSON in the row reads as an empty league, not a crash", async () => {
        const rec = await createLeague(alice, "Weird", emptyLeague(), emptySchedule());
        await sql`UPDATE leagues SET data = '"just a string"'::jsonb, schedule = '[1,2]'::jsonb WHERE id = ${rec.id}`;
        const back = (await getLeague(alice, rec.id))!;
        assert.deepEqual(back.data, emptyLeague());
        assert.deepEqual(back.schedule, emptySchedule());
        assert.deepEqual((await listLeagues(alice)).map((s) => [s.teamCount, s.matchCount]), [[0, 0]]);
    });

    test("a save's conflict copy is sanitized too", async () => {
        const rec = await createLeague(alice, "L", emptyLeague(), emptySchedule());
        await sql`UPDATE leagues SET data = '{"settings":{"sport":"curling"}}'::jsonb, version = 2 WHERE id = ${rec.id}`;
        const out = await saveLeague(alice, rec.id, 1, "stale", emptyLeague(), emptySchedule());
        assert.ok(!out.ok && out.reason === "conflict");
        assert.equal(out.current.data.settings.sport, "tennis");
        assert.deepEqual(out.current.data.teams, []);
    });
});
