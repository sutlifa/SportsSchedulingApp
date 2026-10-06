// scripts/verify-db.ts
//
// Proves the persistence promises against a real (throwaway, LOCAL) Postgres:
//
//     DATABASE_URL=postgres://postgres:postgres@localhost:5432/courtside_verify \
//       node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/verify-db.ts
//
// - the schema self-applies, twice, without error (fresh Neon must just work)
// - a user only ever sees their own leagues
// - a stale save is refused with the current copy (no silent overwrite)
// - a deleted league can't be read, listed, or resurrected by an autosave
//
// It TRUNCATES tables, so it refuses any non-localhost DATABASE_URL.
import { sql } from "../lib/db.ts";
import { ensureSchema } from "../lib/db/ensure.ts";
import { createLeague, deleteLeague, getLeague, listLeagues, saveLeague } from "../lib/leagues.ts";
import { upsertUser } from "../lib/users.ts";
import { sampleLeague } from "../lib/engine/sample.ts";
import { emptySchedule } from "../lib/engine/sanitize.ts";
import { audit } from "../lib/engine/engine.ts";
import { readiness } from "../lib/engine/readiness.ts";

const url = process.env.DATABASE_URL ?? "";
const host = (() => {
    try {
        return new URL(url).hostname;
    } catch {
        return "";
    }
})();
if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    console.error(`Refusing to run: DATABASE_URL must point at a throwaway LOCAL database (got "${host || "nothing"}"). This script truncates tables.`);
    process.exit(1);
}

let checks = 0;
function assert(cond: unknown, msg: string): asserts cond {
    checks++;
    if (!cond) {
        console.error(`FAIL: ${msg}`);
        process.exit(1);
    }
}

await ensureSchema();
await sql.unsafe("SELECT 1"); // second ensure in a fresh process path below
await sql`TRUNCATE users RESTART IDENTITY CASCADE`;

const alice = await upsertUser({ googleId: "g-alice", email: "alice@example.com", name: "Alice" });
const again = await upsertUser({ googleId: "g-alice", email: "alice2@example.com", name: "Alice A" });
assert(again === alice, "upsertUser is idempotent on google_id");
const bob = await upsertUser({ googleId: "g-bob", email: "bob@example.com", name: "Bob" });

const rec = await createLeague(alice, "Spring 2027", sampleLeague(), emptySchedule());
assert(rec.version === 1, "new league starts at version 1");
assert((await listLeagues(alice)).length === 1, "alice sees her league");
const summary = (await listLeagues(alice))[0];
assert(summary.teamCount === 24 && summary.matchCount === 0, `list counts come from jsonb (${summary.teamCount} teams)`);
assert((await listLeagues(bob)).length === 0, "bob does not see alice's league");
assert((await getLeague(bob, rec.id)) === null, "bob can't read alice's league by id");
const bobSave = await saveLeague(bob, rec.id, 1, "hijack", rec.data, rec.schedule);
assert(!bobSave.ok && bobSave.reason === "missing", "bob can't save over alice's league");
assert(!(await deleteLeague(bob, rec.id)), "bob can't delete alice's league");

const s1 = await saveLeague(alice, rec.id, 1, "Spring 2027 v2", rec.data, rec.schedule);
assert(s1.ok && s1.version === 2, "save at the right version succeeds and bumps it");
const stale = await saveLeague(alice, rec.id, 1, "stale tab", rec.data, rec.schedule);
assert(!stale.ok && stale.reason === "conflict" && stale.current.name === "Spring 2027 v2", "stale save is refused with the current copy");
assert((await getLeague(alice, rec.id))!.name === "Spring 2027 v2", "stale save did not overwrite");

assert(await deleteLeague(alice, rec.id), "alice deletes her league");
assert((await getLeague(alice, rec.id)) === null, "deleted league can't be read");
assert((await listLeagues(alice)).length === 0, "deleted league isn't listed");
const zombie = await saveLeague(alice, rec.id, 2, "resurrect", rec.data, rec.schedule);
assert(!zombie.ok && zombie.reason === "missing", "an autosave can't resurrect a deleted league");

// A league stored by an older version of the app (before sports and named
// units) must load in a shape the editor can use. Reading it raw crashed the
// editor with "Cannot read properties of undefined (reading 'length')".
{
    const old: Record<string, unknown> = structuredClone(sampleLeague("tennis")) as never;
    const o = old as { settings: Record<string, unknown>; locations: Record<string, unknown>[]; slots: Record<string, unknown>[]; availability: Record<string, unknown>[] };
    delete o.settings.sport;
    for (const x of o.locations) delete x.units;
    for (const x of o.slots) delete x.unitIds;
    for (const x of o.availability) delete x.unitIds;
    const oldSchedule = { matches: [{ id: "m1", home: "t1", away: "t2", bracketId: "b10", pool: "", date: "2027-03-06", time: "09:00", locationId: "loc-center", slotId: "s1", locked: false }], generatedAt: null, warnings: [] };
    const made = await createLeague(alice, "Old tennis league", sampleLeague("tennis"), emptySchedule());
    await sql`UPDATE leagues SET data = ${sql.json(old as never)}, schedule = ${sql.json(oldSchedule as never)} WHERE id = ${made.id}`;
    const back = (await getLeague(alice, made.id))!;
    assert(back.data.settings.sport === "tennis", "old league reads as tennis");
    assert(back.data.locations.every((l) => Array.isArray(l.units)), "old facilities get a units list");
    assert(back.data.slots.every((x) => Array.isArray(x.unitIds)), "old slots get a unitIds list");
    let crashed = "";
    try {
        audit(back.data, back.schedule.matches);
        readiness(back.data, back.name);
    } catch (e) {
        crashed = (e as Error).message;
    }
    assert(!crashed, `old league loads without crashing the editor (${crashed})`);
}

// Re-applying the schema on an existing database is harmless.
const { SCHEMA_SQL } = await import("../lib/db/schema.ts");
await sql.unsafe(SCHEMA_SQL);
assert(true, "schema re-applies cleanly");

await sql.end();
console.log(`verify-db: all ${checks} checks passed.`);
