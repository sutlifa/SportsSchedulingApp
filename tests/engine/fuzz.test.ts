/**
 * Seeded property tests: random leagues through the real pipeline, checked
 * against the promises INDEPENDENTLY of the engine's own check() (which
 * audit() reuses), so a bug shared by both can't hide.
 *
 * Deterministic: every league comes from mulberry32(seed), and generate runs
 * on a fixed clock, so a failure names its seed and reproduces exactly.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { audit, generate, mulberry32, poolKey, prepare } from "../../lib/engine/engine.ts";
import { dowOf, isoToDay, isTime, rangesToDays, toMinutes, weekendKey, weekKey } from "../../lib/engine/dates.ts";
import { readiness } from "../../lib/engine/readiness.ts";
import { adviceFor } from "../../lib/engine/advice.ts";
import { sanitizeLeague, sanitizeSchedule } from "../../lib/engine/sanitize.ts";
import { SPORT_IDS } from "../../lib/engine/sports.ts";
import { teamTarget } from "../../lib/engine/engine.ts";
import type { Availability, DayOfWeek, League, Match, Rule, Slot, Team } from "../../lib/engine/types.ts";

const ITERATIONS = 300;

function randomLeague(seed: number): League {
    const rng = mulberry32(seed * 2654435761);
    const int = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
    const chance = (p: number) => rng() < p;
    const day = () => int(0, 6) as DayOfWeek;
    const times = ["08:00", "09:00", "09:30", "10:30", "12:00", "13:00", "15:30", "17:00", "18:30", "20:00"];

    const nLoc = int(1, 3);
    const locations = Array.from({ length: nLoc }, (_, i) => ({
        id: `l${i}`,
        name: `Loc ${i}`,
        address: "",
        mapUrl: "",
        notes: "",
        units: chance(0.6) ? Array.from({ length: int(1, 4) }, (_, k) => ({ id: `l${i}u${k}`, name: `U${k}` })) : [],
    }));
    const brackets = ["x", "y", "z"].slice(0, int(1, 3)).map((id) => ({
        id,
        name: id.toUpperCase(),
        matches: int(1, 6),
        earliest: chance(0.3) ? pick(["09:00", "10:00", "12:00"]) : "",
        latest: chance(0.3) ? pick(["15:00", "18:00", "19:00"]) : "",
        days: chance(0.2) ? ([6, 0] as DayOfWeek[]) : [],
        color: "#000000",
        rules: [] as Rule[],
    }));
    const nTeams = int(2, 14);
    const teamIds = Array.from({ length: nTeams }, (_, i) => `t${i}`);
    const randomRule = (i: number, k: number): Rule => {
        const id = `r${i}_${k}`;
        const mode = chance(0.7) ? "must" : "prefer";
        switch (int(0, 13)) {
            case 0: return { id, mode, type: "max_per_weekend", n: int(1, 2) };
            case 1: return { id, mode, type: "max_weekend_total", n: int(1, 4) };
            case 2: return { id, mode, type: "max_per_week", n: int(1, 2) };
            case 3: return { id, mode, type: "max_on_day", day: day(), n: int(1, 2) };
            case 4: return { id, mode, type: "no_days", days: [day()] };
            case 5: return { id, mode, type: "only_days", days: [day(), day()] };
            case 6: return { id, mode, type: "not_dates", ranges: [{ from: "2027-03-13", to: pick(["2027-03-14", "2027-03-21"]) }] };
            case 7: return { id, mode, type: "no_start_after", time: pick(["12:00", "17:00"]) };
            case 8: return { id, mode, type: "no_start_before", time: pick(["09:30", "12:00"]) };
            case 9: return { id, mode, type: "only_locations", locationIds: [pick(locations).id] };
            case 10: return { id, mode, type: "avoid_locations", locationIds: [pick(locations).id] };
            case 11: return { id, mode, type: "min_days_between", n: int(2, 8) };
            case 12: return { id, mode, type: "not_same_time", teamIds: [pick(teamIds)] };
            default: return { id, mode, type: "not_same_day", teamIds: [pick(teamIds)] };
        }
    };
    for (const b of brackets) if (chance(0.2)) b.rules.push(randomRule(99, brackets.indexOf(b)));
    const teams: Team[] = teamIds.map((id, i) => ({
        id,
        name: `T${i}`,
        bracketId: pick(brackets).id,
        pool: pick(["", "", "A"]),
        club: pick(["", "", "North", "South"]),
        captain: "",
        contact: "",
        matches: chance(0.15) ? int(0, 4) : null,
        rules: Array.from({ length: int(0, 2) }, (_, k) => randomRule(i, k)),
        notes: "",
    }));
    const slots: Slot[] = Array.from({ length: int(1, 9) }, (_, s) => {
        const loc = pick(locations);
        const named = loc.units.length > 0 && chance(0.7);
        return {
            id: `s${s}`,
            day: day(),
            time: pick(times),
            locationId: loc.id,
            capacity: int(0, 3),
            unitIds: named ? loc.units.filter(() => chance(0.7)).map((u) => u.id) : [],
            bracketIds: chance(0.15) ? [pick(brackets).id] : [],
        };
    });
    const availability: Availability[] = chance(0.3)
        ? Array.from({ length: int(1, 6) }, (_, a) => {
              const loc = pick(locations);
              return { id: `a${a}`, date: `2027-03-${String(int(1, 28)).padStart(2, "0")}`, time: pick(times), locationId: loc.id, courts: int(0, 4), unitIds: loc.units.length && chance(0.5) ? [loc.units[0].id] : [], bracketIds: [] };
          })
        : [];
    return {
        settings: {
            sport: pick(SPORT_IDS),
            seasonStart: "2027-03-01",
            seasonEnd: pick(["2027-03-31", "2027-04-30", "2027-03-14"]),
            blackouts: chance(0.4) ? [{ from: "2027-03-20", to: "2027-03-21" }] : [],
            maxPerDay: pick([1, 1, 2]),
            matchMinutes: pick([60, 90, 120]),
            clubLimit: pick([null, null, 1, 2]),
            clubLimitMode: pick(["must", "prefer"] as const),
            courtsPerMatch: pick([1, 1, 1, 2]),
        },
        brackets,
        locations,
        slots,
        availability,
        teams,
    };
}

function gen(l: League, seed: number, prev: Match[] = []) {
    return generate(l, prev, { scope: "all", seed, maxAttempts: 3, timeBudgetMs: 1e9, now: () => 0 });
}

/**
 * The known not_same_day bug (see engine-generate.test.ts): "X: not on the same
 * day as Y" on a game of X's, where X and Y ALSO play each other that day.
 */
let knownBugHits = 0;
function isKnownSameDayBug(l: League, ms: Match[], m: Match, text: string): boolean {
    const hit = /^(.+): not on the same day as (.+)$/.exec(text);
    if (!hit) return false;
    const id = (name: string) => l.teams.find((t) => t.name === name)?.id;
    const [x, y] = [id(hit[1]), id(hit[2])];
    const together = ms.some((g) => g.date === m.date && ((g.home === x && g.away === y) || (g.home === y && g.away === x)));
    if (together) knownBugHits++;
    return together;
}

/** Every promise of a generated schedule, checked without the engine's check(). */
function checkPromises(l: League, ms: Match[], label: string) {
    const teams = new Map(l.teams.map((t) => [t.id, t]));
    const brackets = new Map(l.brackets.map((b) => [b.id, b]));
    const ctx = prepare(l);
    const a = audit(l, ms);
    const perInstance = new Map<number, number>();
    const unitAt = new Set<string>();
    const perTeamDay = new Map<string, Match[]>();
    for (const m of ms) {
        const h = teams.get(m.home)!;
        const w = teams.get(m.away)!;
        assert.notEqual(m.home, m.away, `${label}: plays itself`);
        assert.equal(poolKey(h.bracketId, h.pool), poolKey(w.bracketId, w.pool), `${label}: cross-pool`);
        if (!m.date) {
            assert.ok(m.note && m.note.length > 10, `${label}: unplaced without a reason`);
            continue;
        }
        // In a real instance, with capacity.
        const inst = ctx.instByKey.get(`${m.date}|${m.slotId}`);
        assert.ok(inst && inst.time === m.time && inst.locationId === m.locationId, `${label}: ${m.id} is not on an open time`);
        perInstance.set(inst.idx, (perInstance.get(inst.idx) ?? 0) + 1);
        // Inside its bracket's window, days and "Open to".
        const b = brackets.get(m.bracketId)!;
        const mins = toMinutes(m.time!);
        if (isTime(b.earliest)) assert.ok(mins >= toMinutes(b.earliest), `${label}: before ${b.name}'s window`);
        if (isTime(b.latest)) assert.ok(mins <= toMinutes(b.latest), `${label}: after ${b.name}'s window`);
        if (b.days.length) assert.ok(b.days.includes(dowOf(isoToDay(m.date))), `${label}: ${b.name} on a day it doesn't play`);
        if (inst.bracketIds) assert.ok(inst.bracketIds.has(b.id), `${label}: slot not open to ${b.name}`);
        assert.ok(!rangesToDays(l.settings.blackouts).has(isoToDay(m.date)), `${label}: on a blackout`);
        // Units: right number, free at that time, never two games on one.
        if (inst.unitIds.length) {
            assert.equal(m.unitIds?.length ?? 0, Math.max(1, l.settings.courtsPerMatch), `${label}: ${m.id} unit count`);
            for (const u of m.unitIds!) {
                assert.ok(inst.unitIds.includes(u), `${label}: unit not free`);
                const k = `${inst.idx}|${u}`;
                assert.ok(!unitAt.has(k), `${label}: unit double-booked`);
                unitAt.add(k);
            }
        } else assert.ok(!m.unitIds, `${label}: units at an unnamed time`);
        for (const id of [m.home, m.away]) {
            const k = `${id}|${m.date}`;
            perTeamDay.set(k, [...(perTeamDay.get(k) ?? []), m]);
        }
        // No must-rule broken (the engine's own audit agrees) -- apart from the
        // one known bug, tolerated ONLY in its exact shape so it can't mask
        // anything else; it is counted and asserted by its own todo test.
        const hard = (a.issues.get(m.id)?.hard ?? []).filter((h) => !isKnownSameDayBug(l, ms, m, h));
        assert.deepEqual(hard, [], `${label}: ${m.id} breaks a must-rule`);
    }
    for (const [idx, n] of perInstance) assert.ok(n <= ctx.instances[idx].capacity, `${label}: over capacity`);
    for (const [k, list] of perTeamDay) {
        assert.ok(list.length <= Math.max(1, l.settings.maxPerDay), `${label}: ${k} over maxPerDay`);
        const starts = list.map((m) => toMinutes(m.time!)).sort((x, y) => x - y);
        for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= l.settings.matchMinutes, `${label}: ${k} overlapping games`);
    }
    // Static must-rules, checked from scratch.
    for (const t of l.teams) {
        const b = brackets.get(t.bracketId);
        if (!b) continue;
        const mine = ms.filter((m) => m.date && (m.home === t.id || m.away === t.id));
        assert.ok(mine.length + ms.filter((m) => !m.date && (m.home === t.id || m.away === t.id)).length <= teamTarget(t, b), `${label}: ${t.id} over target`);
        for (const r of [...b.rules, ...t.rules]) {
            if (r.mode !== "must") continue;
            const days = mine.map((m) => isoToDay(m.date!));
            if (r.type === "no_days") assert.ok(days.every((d) => !r.days.includes(dowOf(d))), `${label}: ${t.id} no_days`);
            if (r.type === "only_days" && r.days.length) assert.ok(days.every((d) => r.days.includes(dowOf(d))), `${label}: ${t.id} only_days`);
            if (r.type === "not_dates") assert.ok(days.every((d) => !rangesToDays(r.ranges).has(d)), `${label}: ${t.id} not_dates`);
            if (r.type === "no_start_after") assert.ok(mine.every((m) => toMinutes(m.time!) <= toMinutes(r.time)), `${label}: ${t.id} no_start_after`);
            if (r.type === "no_start_before") assert.ok(mine.every((m) => toMinutes(m.time!) >= toMinutes(r.time)), `${label}: ${t.id} no_start_before`);
            if (r.type === "only_locations") assert.ok(mine.every((m) => r.locationIds.includes(m.locationId!)), `${label}: ${t.id} only_locations`);
            if (r.type === "avoid_locations") assert.ok(mine.every((m) => !r.locationIds.includes(m.locationId!)), `${label}: ${t.id} avoid_locations`);
            if (r.type === "min_days_between") for (const x of days) for (const y of days) assert.ok(x === y || Math.abs(x - y) >= r.n, `${label}: ${t.id} days between`);
            const count = (key: (d: number) => number | null) => {
                const m = new Map<number, number>();
                for (const d of days) {
                    const k = key(d);
                    if (k !== null) m.set(k, (m.get(k) ?? 0) + 1);
                }
                return Math.max(0, ...m.values());
            };
            if (r.type === "max_per_weekend") assert.ok(count(weekendKey) <= r.n, `${label}: ${t.id} per weekend`);
            if (r.type === "max_per_week") assert.ok(count(weekKey) <= r.n, `${label}: ${t.id} per week`);
            if (r.type === "max_weekend_total") assert.ok(days.filter((d) => weekendKey(d) !== null).length <= r.n, `${label}: ${t.id} weekend total`);
            if (r.type === "max_on_day") assert.ok(days.filter((d) => dowOf(d) === r.day).length <= r.n, `${label}: ${t.id} max on day`);
        }
    }
}

describe("fuzz: random leagues keep every promise", () => {
    test(`${ITERATIONS} seeded leagues: generate -> independent invariant checks`, () => {
        for (let seed = 1; seed <= ITERATIONS; seed++) {
            const l = randomLeague(seed);
            const r = gen(l, seed);
            checkPromises(l, r.matches, `seed ${seed}`);
            for (const reason of [...r.matches.flatMap((m) => (m.blockers ?? []).map((b) => b.reason)), ...[...audit(l, r.matches).issues.values()].flatMap((v) => [...v.hard, ...v.soft])])
                assert.notEqual(adviceFor(reason, l).tab, null, `seed ${seed}: no advice for “${reason}”`);
        }
    });

    test("regenerating with half the games locked keeps the locks and every promise", () => {
        for (let seed = 1; seed <= 100; seed++) {
            const l = randomLeague(seed);
            const first = gen(l, seed).matches;
            const locked = first.map((m, i) => (m.date && i % 2 === 0 ? { ...m, locked: true } : m));
            const r = gen(l, seed + 1000, locked);
            for (const m of locked.filter((x) => x.locked)) assert.deepEqual(r.matches.find((x) => x.id === m.id), m, `seed ${seed}: lock moved`);
            checkPromises(l, r.matches, `relock seed ${seed}`);
        }
    });

    // Reads the count the two tests above collected (tests in a file run in
    // order), rather than generating 300 leagues a second time.
    test(
        "no schedule hits the known not_same_day bug",
        { todo: "BUG: see engine-generate.test.ts 'not_same_day holds when the two teams also play EACH OTHER that day' (lib/engine/engine.ts:537)" },
        () => {
            assert.equal(knownBugHits, 0);
        }
    );

    test("same seed, same schedule", () => {
        for (let seed = 1; seed <= 25; seed++) assert.deepEqual(gen(randomLeague(seed), 7), gen(randomLeague(seed), 7));
    });
});

describe("fuzz: readiness blocks are proofs", () => {
    test("whenever a time/brackets/teams/requests check blocks, Generate really can't give every team its games", () => {
        let blocked = 0;
        for (let seed = 1; seed <= ITERATIONS; seed++) {
            const l = randomLeague(seed);
            if (l.teams.some((t) => !l.brackets.some((b) => b.id === t.bracketId))) continue;
            const blocks = readiness(l, "x").filter((c) => c.level === "block" && ["time", "brackets", "teams", "requests"].includes(c.step));
            if (!blocks.length) continue;
            blocked++;
            const r = generate(l, [], { scope: "all", seed, maxAttempts: 6, timeBudgetMs: 1e9, now: () => 0 });
            const a = audit(l, r.matches);
            const complete = [...a.teams.values()].every((s) => s.placed === s.target);
            assert.ok(!complete, `seed ${seed}: false block (everything scheduled): ${blocks.map((c) => c.text).join(" | ")}`);
        }
        assert.ok(blocked > 20, `the fuzz exercised blocks (${blocked})`);
    });
});

describe("fuzz: sanitize", () => {
    /** Random JSON-ish values, biased toward the league's own keys. */
    function junk(rng: () => number, depth = 0): unknown {
        const keys = ["settings", "brackets", "locations", "slots", "availability", "teams", "rules", "units", "type", "id", "name", "days", "time", "date", "n", "matches", "home", "away", "unitIds", "sport", "from", "to", "ranges", "courts", "capacity", "locked", "blockers"];
        const r = rng();
        if (depth > 4 || r < 0.25) return [null, 0, -1, 7, 1.5, "", "x", "09:00", "2027-03-06", "must", "prefer", "no_days", true, "#123456"][Math.floor(rng() * 14)];
        if (r < 0.55) return Array.from({ length: Math.floor(rng() * 4) }, () => junk(rng, depth + 1));
        const o: Record<string, unknown> = {};
        for (let i = 0; i < 1 + Math.floor(rng() * 5); i++) o[keys[Math.floor(rng() * keys.length)]] = junk(rng, depth + 1);
        return o;
    }

    test("never throws, always yields usable arrays, and is idempotent (500 random inputs)", () => {
        const rng = mulberry32(77);
        for (let i = 0; i < 500; i++) {
            const v = junk(rng);
            const l = sanitizeLeague(v);
            for (const k of ["brackets", "locations", "slots", "availability", "teams"] as const) assert.ok(Array.isArray(l[k]));
            assert.deepEqual(sanitizeLeague(l), l, `#${i}`);
            const s = sanitizeSchedule(v);
            assert.deepEqual(sanitizeSchedule(s), s, `#${i}`);
            assert.doesNotThrow(() => audit(l, s.matches), `#${i}`);
        }
    });
});
