// scripts/verify-engine.ts
//
// Headless proof that the scheduler keeps its promises:
//
//     node --experimental-strip-types scripts/verify-engine.ts
//
// Scheduling bugs don't throw. They put a 10U team on court at 8pm or give
// one team four matches and another six, and nobody notices until a parent
// emails. So every promise is asserted here, on fixed scenarios AND on a few
// hundred randomly generated leagues. Exits non-zero on the first failure.
import { assignUnits, audit, gamesInSlots, generate, moveOptions, pairPool, mulberry32, poolKey, prepare, reassignUnitsAfterEdit, rebindAfterEdit, rebindSlotIds } from "../lib/engine/engine.ts";
import { describeRule } from "../lib/engine/rules.ts";
import { makeLookup } from "../lib/engine/engine.ts";
import { SPORT_IDS, sportText, SPORTS } from "../lib/engine/sports.ts";
import { dowOf, isoToDay, isWeekend, parseTimes, toMinutes, weekendKey, formatTime } from "../lib/engine/dates.ts";
import { sampleLeague } from "../lib/engine/sample.ts";
import { adviceFor } from "../lib/engine/advice.ts";
import type { DayOfWeek, League, Match, Rule, Team } from "../lib/engine/types.ts";

let checks = 0;
function assert(cond: unknown, msg: string): asserts cond {
    checks++;
    if (!cond) {
        console.error(`FAIL: ${msg}`);
        process.exit(1);
    }
}

// Deterministic clock so attempt counts don't depend on machine speed.
const fixedRun = (league: League, prev: Match[] = [], scope = "all", seed = 1, maxAttempts = 25) =>
    generate(league, prev, { scope, seed, maxAttempts, timeBudgetMs: 1e9, now: () => 0 });

/** Universal invariants for any generated schedule. */
function checkInvariants(league: League, matches: Match[], label: string) {
    const teams = new Map(league.teams.map((t) => [t.id, t]));
    const a = audit(league, matches);
    for (const m of matches) {
        assert(m.home !== m.away, `${label}: a team plays itself (${m.id})`);
        const h = teams.get(m.home)!;
        const w = teams.get(m.away)!;
        assert(poolKey(h.bracketId, h.pool) === poolKey(w.bracketId, w.pool), `${label}: cross-pool match ${h.name} v ${w.name}`);
        if (m.date) {
            const v = a.issues.get(m.id);
            assert(!v || v.hard.length === 0, `${label}: placed match breaks a must-rule: ${h.name} v ${w.name} ${m.date} ${m.time}: ${v?.hard.join(" / ")}`);
        }
    }
    a.usage.forEach((u, i) => assert(u <= a.ctx.instances[i].capacity, `${label}: slot over capacity at ${a.ctx.instances[i].date} ${a.ctx.instances[i].time}`));
    for (const s of a.teams.values()) {
        assert(s.placed + s.unplaced <= s.target, `${label}: ${teams.get(s.teamId)!.name} has more matches (${s.placed + s.unplaced}) than its target ${s.target}`);
    }
}

// --- dates -----------------------------------------------------------------
assert(dowOf(isoToDay("2027-03-06")) === 6, "2027-03-06 is a Saturday");
assert(dowOf(isoToDay("2027-03-14")) === 0, "2027-03-14 (DST start) is a Sunday");
assert(weekendKey(isoToDay("2027-03-07")) === isoToDay("2027-03-06"), "Sunday belongs to the previous Saturday's weekend");
assert(weekendKey(isoToDay("2027-03-08")) === null, "Monday is not a weekend");
assert(JSON.stringify(parseTimes("9, 10:30, 1pm, 17:45, 6")) === JSON.stringify(["09:00", "10:30", "13:00", "17:45", "18:00"]), "parseTimes");
assert(JSON.stringify(parseTimes("9.30, 0930, 1330, 10:15am")) === JSON.stringify(["09:30", "13:30", "10:15"]), "parseTimes: dot, military, am");
assert(formatTime("18:30") === "6:30 PM" && formatTime("00:05") === "12:05 AM" && formatTime("12:00") === "12:00 PM", "formatTime");

// --- the example league schedules completely -------------------------------
{
    const league = sampleLeague();
    const r = fixedRun(league);
    checkInvariants(league, r.matches, "sample");
    const unplaced = r.matches.filter((m) => !m.date);
    assert(unplaced.length === 0, `sample: ${unplaced.length} matches unplaced: ${unplaced.map((m) => m.note).join(" | ")}`);
    const a = audit(league, r.matches);
    for (const s of a.teams.values()) assert(s.placed === s.target, `sample: team ${s.teamId} got ${s.placed}/${s.target}`);
    assert(r.warnings.length === 0, `sample: unexpected warnings: ${r.warnings.join(" | ")}`);

    // Curfew: no 10U after 5:30pm, no 12U after 6:30pm.
    for (const m of r.matches) {
        if (m.bracketId === "b10") assert(toMinutes(m.time!) <= toMinutes("17:30") && toMinutes(m.time!) >= toMinutes("09:00"), "10U start-time window");
        if (m.bracketId === "b12") assert(toMinutes(m.time!) <= toMinutes("18:30"), "12U latest start");
    }
    // Blackout weekend is empty.
    assert(!r.matches.some((m) => m.date === "2027-03-27" || m.date === "2027-03-28"), "blackout dates unused");
    // Max one match per weekend for Aces 10U.
    const aces = r.matches.filter((m) => m.home === "t10a" || m.away === "t10a");
    const weekends = aces.map((m) => weekendKey(isoToDay(m.date!))).filter((w) => w !== null);
    assert(new Set(weekends).size === weekends.length, "Aces 10U plays at most once per weekend");
    // Season-total weekend cap.
    const a12 = r.matches.filter((m) => m.home === "t12a" || m.away === "t12a");
    assert(a12.filter((m) => isWeekend(isoToDay(m.date!))).length <= 3, "Aces 12U: max 3 weekend matches");
    // Location restriction.
    assert(r.matches.filter((m) => m.home === "t14d" || m.away === "t14d").every((m) => m.locationId === "loc-center"), "Ad In 14U only at the center");
    // Shared coach: Topspin 12U and 14U never overlap.
    const g = (id: string) => r.matches.filter((m) => m.home === id || m.away === id);
    for (const x of g("t12g")) for (const y of g("t14c"))
        assert(!(x.date === y.date && Math.abs(toMinutes(x.time!) - toMinutes(y.time!)) < 90), "Topspin 12U / 14U overlap");
    // Min days between.
    const let18 = g("t18e").map((m) => isoToDay(m.date!)).sort((p, q) => p - q);
    for (let i = 1; i < let18.length; i++) assert(let18[i] - let18[i - 1] >= 6, "Let 18U: 6 days apart");
    // Determinism.
    const again = fixedRun(sampleLeague());
    assert(JSON.stringify(again.matches) === JSON.stringify(r.matches), "same seed -> same schedule");

    // Teams don't play every week -- but matches shouldn't all bunch up either:
    // nobody plays all 5 inside three weeks of an ~10-week season.
    for (const t of league.teams) {
        const days = g(t.id).map((m) => isoToDay(m.date!)).sort((p, q) => p - q);
        assert(days[days.length - 1] - days[0] >= 21, `${t.name} matches are bunched into ${days[days.length - 1] - days[0]} days`);
    }

    // --- locks and scope ---------------------------------------------------
    const locked = r.matches.map((m, i) => (i === 3 ? { ...m, locked: true } : m));
    const r2 = fixedRun(league, locked, "all", 99);
    const lockedAfter = r2.matches.find((m) => m.id === locked[3].id);
    assert(lockedAfter && JSON.stringify(lockedAfter) === JSON.stringify(locked[3]), "locked match survives regenerate unchanged");
    checkInvariants(league, r2.matches, "locked regenerate");
    const a2 = audit(league, r2.matches);
    for (const s of a2.teams.values()) assert(s.placed === s.target, `locked regenerate: team ${s.teamId} got ${s.placed}/${s.target}`);

    const r3 = fixedRun(league, r.matches, "b14", 7);
    const other = (ms: Match[]) => JSON.stringify(ms.filter((m) => m.bracketId !== "b14").sort((p, q) => p.id.localeCompare(q.id)));
    assert(other(r3.matches) === other(r.matches), "regenerating 14U leaves other brackets untouched");
    checkInvariants(league, r3.matches, "scoped regenerate");
    assert(r3.matches.filter((m) => m.bracketId === "b14").length === 15, "14U regenerated: 6 teams x 5 / 2 = 15 matches");

    // --- the audit is not vacuous: hand-made violations get flagged ---------
    // Without these, checkInvariants above would pass against an audit that
    // never reports anything.
    const at = (m: Match, date: string, time: string, slotId: string) => ({ ...m, date, time, slotId, locationId: "loc-park" });
    const m10 = r.matches.find((m) => m.bracketId === "b10")!;
    const late = r.matches.map((m) => (m.id === m10.id ? at(m, "2027-03-09", "19:00", "s-2-1") : m));
    assert(audit(league, late).issues.get(m10.id)?.hard.some((h) => h.includes("10U can’t start after")), "audit flags a 10U match at 7pm");
    const acesGames = r.matches.filter((m) => m.home === "t10a" || m.away === "t10a");
    const sat = acesGames.find((m) => dowOf(isoToDay(m.date!)) === 6);
    if (sat) {
        const sun = isoToDay(sat.date!) + 1;
        const other = acesGames.find((m) => m.id !== sat.id)!;
        const sunIso = new Date(sun * 86400000).toISOString().slice(0, 10);
        const twice = r.matches.map((m) => (m.id === other.id ? { ...m, date: sunIso, time: "12:00", slotId: "s-sun-0", locationId: "loc-center" } : m));
        const v = audit(league, twice).issues.get(other.id);
        assert(v?.hard.some((h) => h.includes("per weekend")), "audit flags Aces 10U playing twice in one weekend");
    }
    const crowd = r.matches.map((m) => ({ ...m, date: "2027-03-06", time: "09:00", slotId: "s-sat-0", locationId: "loc-center" }));
    assert(audit(league, crowd).usage[0] > 3 && [...audit(league, crowd).issues.values()].some((v) => v.hard.some((h) => h.includes("already booked"))), "audit flags an over-capacity slot");

    // --- move options agree with audit --------------------------------------
    const target = r.matches[0];
    const opts = moveOptions(league, r.matches, target.id);
    const ok = opts.filter((o) => o.verdict.hard.length === 0);
    assert(ok.length > 0, "move: a placed match has at least one legal spot (its own)");
    for (const o of ok.slice(0, 20)) {
        // As the Move dialog does: the moved game takes a free unit at its new time.
        const moved = r.matches.map((m) => (m.id === target.id ? { ...m, date: o.inst.date, time: o.inst.time, slotId: o.inst.slotId, locationId: o.inst.locationId, unitIds: o.freeUnits.slice(0, 1) } : m));
        const v = audit(league, moved).issues.get(target.id);
        assert(!v || v.hard.length === 0, "move: a spot offered as legal audits as legal");
    }
}

// --- pairing evenness -----------------------------------------------------
{
    const ids = ["a", "b", "c", "d"];
    for (let seed = 1; seed < 60; seed++) {
        const pairs = pairPool(ids, new Map(ids.map((i) => [i, 5])), new Map(), mulberry32(seed));
        const count = new Map<string, number>();
        const meets = new Map<string, number>();
        for (const [x, y] of pairs) {
            count.set(x, (count.get(x) ?? 0) + 1);
            count.set(y, (count.get(y) ?? 0) + 1);
            const k = [x, y].sort().join();
            meets.set(k, (meets.get(k) ?? 0) + 1);
        }
        for (const id of ids) assert(count.get(id) === 5, `pairing: ${id} gets 5 in a 4-team pool (seed ${seed})`);
        const v = [...meets.values()];
        assert(meets.size === 6 && Math.max(...v) <= 2, `pairing: repeats spread evenly in a 4-team pool (seed ${seed}): ${JSON.stringify([...meets])}`);
    }
    // Odd total: 5 teams x 5 = 25 -> exactly one team one short.
    for (let seed = 1; seed < 30; seed++) {
        const five = ["a", "b", "c", "d", "e"];
        const pairs = pairPool(five, new Map(five.map((i) => [i, 5])), new Map(), mulberry32(seed));
        assert(pairs.length === 12, `pairing: 5x5 pool makes 12 matches (seed ${seed}), got ${pairs.length}`);
    }
    // Pool of 6 with 5 matches = full round robin, no repeats.
    for (let seed = 1; seed < 30; seed++) {
        const six = ["a", "b", "c", "d", "e", "f"];
        const pairs = pairPool(six, new Map(six.map((i) => [i, 5])), new Map(), mulberry32(seed));
        const keys = new Set(pairs.map(([x, y]) => [x, y].sort().join()));
        assert(pairs.length === 15 && keys.size === 15, `pairing: 6-team pool is a clean round robin (seed ${seed})`);
    }
}

// --- an odd pool is reported, not hidden ------------------------------------
{
    const league = sampleLeague();
    league.teams.push({ ...league.teams.find((t) => t.id === "t10b")!, id: "t10e", name: "Example Fifth 10U", rules: [] });
    const r = fixedRun(league);
    assert(r.warnings.some((w) => w.includes("odd total")), "odd pool total produces a warning");
    checkInvariants(league, r.matches, "odd pool");
}
// One team wanting more than the rest of its pool plays is named as that,
// not as an "odd total" (the total here, 8 + 3 × 2 = 14, is even).
{
    const league = sampleLeague();
    for (const t of league.teams) if (t.bracketId === "b10") t.matches = t.id === "t10b" ? 8 : 2;
    const r = fixedRun(league);
    assert(
        r.warnings.some((w) => /^Example Lightning 10U gets \d+ of 8 matches: the rest of 10U has only 6 to give/.test(w)),
        `over-asking team names the real cause: ${r.warnings.join(" | ")}`
    );
    assert(!r.warnings.some((w) => w.includes("odd total")), "…and no odd-total warning for an even total");
    checkInvariants(league, r.matches, "over-asking team");
}

// --- infeasible: too little court time ---------------------------------------
{
    const league = sampleLeague();
    league.slots = league.slots.filter((s) => s.id === "s-sat-0").map((s) => ({ ...s, capacity: 1 }));
    const r = fixedRun(league);
    checkInvariants(league, r.matches, "tight");
    const un = r.matches.filter((m) => !m.date);
    assert(un.length > 0, "tight: some matches can't be placed");
    assert(un.every((m) => m.note && m.note.length > 10), "tight: every unplaced match explains why");
}

// --- exactly feasible: 1 per weekend, weekend-only, 5 matches, 5 weekends ----
{
    const t = (id: string): Team => ({ id, name: id, bracketId: "b", pool: "", club: "", captain: "", contact: "", matches: null, rules: [], notes: "" });
    const league: League = {
        settings: { sport: "tennis", seasonStart: "2027-03-06", seasonEnd: "2027-04-04", blackouts: [], maxPerDay: 1, matchMinutes: 90, clubLimit: null, clubLimitMode: "must", courtsPerMatch: 1 },
        brackets: [{ id: "b", name: "B", matches: 5, earliest: "", latest: "", days: [], color: "#000", rules: [{ id: "r", mode: "must", type: "max_per_weekend", n: 1 }] }],
        locations: [{ id: "l", name: "L", address: "", mapUrl: "", notes: "", units: [] }],
        slots: [{ id: "s", day: 6, time: "10:00", locationId: "l", capacity: 3, unitIds: [], bracketIds: [] }],
        availability: [],
        teams: ["a", "b", "c", "d", "e", "f"].map(t),
    };
    const r = generate(league, [], { scope: "all", seed: 3, timeBudgetMs: 1e9, maxAttempts: 200, now: () => 0 });
    checkInvariants(league, r.matches, "exact");
    assert(r.matches.every((m) => m.date), `exact: all 15 matches fit into 5 Saturdays x 3 courts (${r.matches.filter((m) => !m.date).length} unplaced)`);
}

// --- fuzz: random leagues never break a must-rule ----------------------------
{
    const rng = mulberry32(2024);
    const pick = <T,>(xs: T[]) => xs[Math.floor(rng() * xs.length)];
    const ruleTypes = ["max_per_weekend", "max_weekend_total", "max_per_week", "no_days", "not_dates", "no_start_after", "min_days_between", "not_same_time", "not_same_day", "max_on_day"] as const;
    for (let trial = 0; trial < 150; trial++) {
        const nTeams = 4 + Math.floor(rng() * 14);
        const teams: Team[] = [];
        for (let i = 0; i < nTeams; i++) {
            const rules: Rule[] = [];
            const nRules = Math.floor(rng() * 3);
            for (let k = 0; k < nRules; k++) {
                const type = pick([...ruleTypes]);
                const mode = rng() < 0.7 ? "must" : "prefer";
                const id = `r${i}${k}`;
                const other = `t${Math.floor(rng() * nTeams)}`;
                const day = Math.floor(rng() * 7) as DayOfWeek;
                const rule: Rule =
                    type === "no_days" ? { id, mode, type, days: [day] }
                    : type === "not_dates" ? { id, mode, type, ranges: [{ from: "2027-03-13", to: "2027-03-21" }] }
                    : type === "no_start_after" ? { id, mode, type, time: pick(["12:00", "16:00", "18:00"]) }
                    : type === "not_same_time" || type === "not_same_day" ? { id, mode, type, teamIds: [other] }
                    : type === "max_on_day" ? { id, mode, type, day, n: 1 + Math.floor(rng() * 2) }
                    : type === "min_days_between" ? { id, mode, type, n: 2 + Math.floor(rng() * 6) }
                    : { id, mode, type, n: 1 + Math.floor(rng() * 3) };
                rules.push(rule);
            }
            teams.push({ id: `t${i}`, name: `T${i}`, bracketId: pick(["x", "y"]), pool: pick(["", "", "A"]), club: pick(["", "C1", "C2"]), captain: "", contact: "", matches: rng() < 0.2 ? 3 : null, rules, notes: "" });
        }
        const slots = [];
        const nSlots = 2 + Math.floor(rng() * 8);
        for (let s = 0; s < nSlots; s++)
            slots.push({ id: `s${s}`, day: Math.floor(rng() * 7) as DayOfWeek, time: pick(["09:00", "10:30", "13:00", "17:00", "19:00"]), locationId: pick(["l1", "l2"]), capacity: 1 + Math.floor(rng() * 3), unitIds: [], bracketIds: rng() < 0.2 ? ["x"] : [] });
        const league: League = {
            settings: { sport: "tennis", seasonStart: "2027-03-01", seasonEnd: "2027-05-30", blackouts: [{ from: "2027-04-03" }], maxPerDay: pick([1, 1, 2]), matchMinutes: 90, clubLimit: pick([null, 1, 2]), clubLimitMode: pick(["must", "prefer"]), courtsPerMatch: 1 },
            brackets: [
                { id: "x", name: "X", matches: 5, earliest: "", latest: pick(["", "18:00"]), days: [], color: "#000", rules: [] },
                { id: "y", name: "Y", matches: 4, earliest: pick(["", "10:00"]), latest: "", days: rng() < 0.2 ? [6, 0] : [], color: "#000", rules: [] },
            ],
            locations: [
                { id: "l1", name: "L1", address: "", mapUrl: "", notes: "", units: [] },
                { id: "l2", name: "L2", address: "", mapUrl: "", notes: "", units: [] },
            ],
            slots,
            availability: [],
            teams,
        };
        const r = generate(league, [], { scope: "all", seed: trial, maxAttempts: 4, timeBudgetMs: 1e9, now: () => 0 });
        checkInvariants(league, r.matches, `fuzz #${trial}`);
        for (const m of r.matches.filter((x) => !x.date)) assert(m.note, `fuzz #${trial}: unplaced match without a reason`);
        // Every problem the engine can report must come with specific advice
        // (a fix and the tab to make it on), not the generic fallback.
        const reasons = [...r.matches.flatMap((m) => (m.blockers ?? []).map((b) => b.reason)), ...[...audit(league, r.matches).issues.values()].flatMap((v) => [...v.hard, ...v.soft])];
        for (const reason of reasons) assert(adviceFor(reason, league).tab !== null, `fuzz #${trial}: no specific advice for “${reason}”`);
    }
}

// --- regressions from the first Tester pass ------------------------------------
{
    // Club limit counts OVERLAPPING matches, not just identical start times.
    const t = (id: string, club: string, pool: string): Team => ({ id, name: id, bracketId: "b", pool, club, captain: "", contact: "", matches: 1, rules: [], notes: "" });
    const league: League = {
        settings: { sport: "tennis", seasonStart: "2027-03-06", seasonEnd: "2027-03-06", blackouts: [], maxPerDay: 1, matchMinutes: 90, clubLimit: 1, clubLimitMode: "must", courtsPerMatch: 1 },
        brackets: [{ id: "b", name: "B", matches: 1, earliest: "", latest: "", days: [], color: "#000", rules: [] }],
        locations: [{ id: "l", name: "L", address: "", mapUrl: "", notes: "", units: [] }],
        slots: ["09:00", "09:30", "10:00", "11:00"].map((time, i) => ({ id: `s${i}`, day: 6 as DayOfWeek, time, locationId: "l", capacity: 4, unitIds: [], bracketIds: [] })),
        availability: [],
        teams: [t("r1", "Riverside", "1"), t("x1", "", "1"), t("r2", "Riverside", "2"), t("x2", "", "2"), t("r3", "Riverside", "3"), t("x3", "", "3")],
    };
    const r = generate(league, [], { scope: "all", seed: 1, maxAttempts: 30, timeBudgetMs: 1e9, now: () => 0 });
    checkInvariants(league, r.matches, "club overlap");
    const starts = r.matches.filter((m) => m.date).map((m) => toMinutes(m.time!)).sort((a, b) => a - b);
    for (let i = 1; i < starts.length; i++) assert(starts[i] - starts[i - 1] >= 90, `club limit 1: Riverside matches overlap (${starts.join(",")})`);
    assert(r.matches.filter((m) => !m.date).length === 1, "club overlap: only 2 non-overlapping starts exist (9:00/9:30/10:00 overlap; 11:00 is clear of 9:00 and 9:30 only), so one match waits");

    // An only_locations rule whose location was deleted is no restriction (it used to block every slot).
    const sl = sampleLeague();
    sl.teams[0].rules = [{ id: "z", mode: "must", type: "only_locations", locationIds: ["deleted-location"] }];
    const rs = fixedRun(sl);
    assert(rs.matches.filter((m) => m.home === "t10a" || m.away === "t10a").every((m) => m.date), "stale only_locations doesn't strand the team");

    // A match left at a deleted location is a must-level problem, not a preference miss.
    const placed = rs.matches.find((m) => m.date)!;
    const gone = rs.matches.map((m) => (m.id === placed.id ? { ...m, locationId: "deleted-location", slotId: "nope" } : m));
    assert(audit(sl, gone).issues.get(placed.id)?.hard.includes("Its location was deleted"), "deleted location is a hard issue");
}

// --- named units (sheets / fields / courts) ------------------------------------------
{
    for (const sport of SPORT_IDS) {
        const league = sampleLeague(sport);
        const r = fixedRun(league);
        checkInvariants(league, r.matches, `units ${sport}`);
        const seen = new Set<string>();
        for (const m of r.matches) {
            assert(m.unitIds?.length === 1, `${sport}: every placed game gets one unit (${m.id})`);
            const loc = league.locations.find((l) => l.id === m.locationId)!;
            assert(loc.units.some((u) => u.id === m.unitIds![0]), `${sport}: the unit belongs to the game's facility`);
            const key = `${m.date}|${m.time}|${m.unitIds![0]}`;
            assert(!seen.has(key), `${sport}: no unit holds two games at once`);
            seen.add(key);
        }
        assert(league.locations[0].units[0].name === SPORTS[sport].unitLabel(0), `${sport}: sample units use the sport's naming`);
    }
    // Stable: re-assigning keeps every existing (valid) unit.
    const league = sampleLeague("hockey");
    const r = fixedRun(league);
    assert(JSON.stringify(assignUnits(league, r.matches)) === JSON.stringify(r.matches), "assignUnits is stable");
    // A hand-made double booking is a must-level problem, named by unit.
    const [a1, a2] = r.matches.filter((m) => m.locationId === "loc-center");
    const clash = r.matches.map((m) => (m.id === a2.id ? { ...m, date: a1.date, time: a1.time, slotId: a1.slotId, unitIds: a1.unitIds } : m));
    assert(audit(league, clash).issues.get(a2.id)?.hard.some((h) => h === "Sheet A has two games at once" || /^Sheet [A-C] has two games at once$/.test(h)), "double-booked sheet is flagged in hockey words");
    // Two units per game: 3 sheets -> 1 game at once, each holding 2 sheets.
    const two = sampleLeague("hockey");
    two.settings.courtsPerMatch = 2;
    const r2 = fixedRun(two);
    checkInvariants(two, r2.matches, "two units per game");
    assert(r2.matches.filter((m) => m.date).every((m) => m.unitIds?.length === 2), "two units per game assigned");
    // Each sport speaks its own words, and every message still gets advice.
    const tight = sampleLeague("hockey");
    tight.slots = tight.slots.filter((x) => x.id === "s-sat-0").map((x) => ({ ...x, unitIds: [x.unitIds[0]] }));
    const rt = fixedRun(tight);
    const reasons = rt.matches.flatMap((m) => (m.blockers ?? []).map((b) => b.reason));
    assert(reasons.includes("Every sheet is already booked at that time"), `hockey capacity message: ${[...new Set(reasons)].join(" | ")}`);
    for (const reason of reasons) assert(adviceFor(reason, tight).tab !== null, `advice for “${reason}”`);
    assert(describeRule({ id: "x", mode: "must", type: "max_per_weekend", n: 1 }, makeLookup(tight)) === "At most 1 game per weekend", "hockey rule sentence");
    assert(describeRule({ id: "x", mode: "must", type: "max_per_weekend", n: 2 }, makeLookup(sampleLeague("tennis"))) === "At most 2 matches per weekend", "tennis rule sentence");
    assert(sportText("Copy for the captain: 3 matches", SPORTS.soccer) === "Copy for the coach: 3 games", "sportText");
    assert(adviceFor("Sheet B has two games at once", tight).tab === "courts" && adviceFor("More than 2 Northside games at the same time", tight).tab === "season", "new messages have advice");
}

// --- units invalidated by an edit (Tester round 4) ------------------------------------
// A facility's unit removed, or "units used by one game" raised, used to leave
// booked games on no unit with no flag. Now the editor re-runs assignUnits on
// such edits (reassignUnitsAfterEdit) and the audit flags whatever is left.
{
    const allReasons = (league: League, ms: Match[]) => [...audit(league, ms).issues.values()].flatMap((v) => [...v.hard, ...v.soft]);
    const adviceOk = (league: League, ms: Match[], label: string) => {
        for (const reason of allReasons(league, ms)) assert(adviceFor(reason, league).tab !== null, `${label}: no specific advice for “${reason}”`);
    };
    /** Every placed game at a time with named units holds enough of them, or says it doesn't. */
    const noSilentGaps = (league: League, ms: Match[], label: string) => {
        const a = audit(league, ms);
        for (const m of ms) {
            if (!m.date) continue;
            const inst = a.ctx.instances.find((i) => i.date === m.date && i.slotId === m.slotId);
            if (!inst?.unitIds.length) continue;
            const short = (m.unitIds?.length ?? 0) < a.ctx.unitsPerMatch;
            const flagged = a.issues.get(m.id)?.soft.some((s) => / assigned(: |$)/.test(s));
            assert(!short || flagged, `${label}: ${m.id} is short of its units with no flag`);
        }
    };

    // (1) Field 1 removed from a soccer facility after generating.
    const league = sampleLeague("soccer");
    const r = fixedRun(league);
    const goneId = "center-u1";
    const edited: League = {
        ...league,
        locations: league.locations.map((l) => (l.id === "loc-center" ? { ...l, units: l.units.filter((u) => u.id !== goneId) } : l)),
        slots: league.slots.map((s) => ({ ...s, unitIds: s.unitIds.filter((u) => u !== goneId) })),
    };
    // As CourtsTab's saveLocation does: the removed unit leaves every game.
    const stripped = r.matches.map((m) => {
        if (!m.unitIds?.includes(goneId)) return m;
        const rest = { ...m };
        delete rest.unitIds;
        return rest;
    });
    const lost = stripped.filter((m, i) => m !== r.matches[i]);
    assert(lost.length > 0, "unit removed: some games were on Field 1");
    const before = audit(edited, stripped);
    for (const m of lost) assert(before.issues.get(m.id)?.soft.some((s) => s === "No field assigned" || s === "No field assigned: every field is booked at that time"), `unit removed: ${m.id} is flagged before reassigning`);
    adviceOk(edited, stripped, "unit removed, before");
    const fixed = reassignUnitsAfterEdit(league, edited, stripped);
    noSilentGaps(edited, fixed, "unit removed");
    adviceOk(edited, fixed, "unit removed, after");
    let moved = 0;
    let stuck = 0;
    for (const m of fixed) {
        const was = r.matches.find((x) => x.id === m.id)!;
        if (was.unitIds && !was.unitIds.includes(goneId)) assert(JSON.stringify(m.unitIds) === JSON.stringify(was.unitIds), `unit removed: ${m.id} kept its unit (stable)`);
        if (!was.unitIds?.includes(goneId)) continue;
        if (m.unitIds?.length) {
            assert(m.unitIds[0] !== goneId && edited.locations[0].units.some((u) => u.id === m.unitIds![0]), "unit removed: moved to a live field");
            moved++;
        } else {
            assert(audit(edited, fixed).issues.get(m.id)?.soft.includes("No field assigned: every field is booked at that time"), "unit removed: a game with no free field says so");
            stuck++;
        }
    }
    assert(moved > 0, `unit removed: games move to a free field where there is one (moved ${moved}, stuck ${stuck})`);
    const seen = new Set<string>();
    for (const m of fixed) for (const u of m.unitIds ?? []) {
        const k = `${m.date}|${m.time}|${u}`;
        assert(!seen.has(k), "unit removed: no field double-booked after reassigning");
        seen.add(k);
    }
    // Unrelated edits don't touch the schedule (same array back).
    const renamed = { ...league, teams: league.teams.map((x, i) => (i === 0 ? { ...x, name: "Renamed" } : x)) };
    assert(reassignUnitsAfterEdit(league, renamed, r.matches) === r.matches, "a team rename doesn't reassign units");
    assert(reassignUnitsAfterEdit(league, { ...league, slots: [...league.slots] }, r.matches) === r.matches, "a no-op slot edit returns the same schedule");
    // A game simply missing its unit while one is free: the bare message, and reassigning fixes it.
    const bare = r.matches.map((m, i) => (i === 0 ? { ...m, unitIds: undefined } : m));
    assert(audit(league, bare).issues.get(r.matches[0].id)?.soft.includes("No field assigned"), "a game with a free field but none assigned is flagged");
    assert(adviceFor("No field assigned", league).tab === "courts" && adviceFor("No sheet assigned: every sheet is booked at that time", sampleLeague("hockey")).tab === "courts", "advice for missing units");
    assert(JSON.stringify(assignUnits(league, bare)) === JSON.stringify(r.matches), "reassigning gives the game its field back");

    // (2) Hockey: "sheets used by one game" raised from 1 to 2.
    const hockey = sampleLeague("hockey");
    const rh = fixedRun(hockey);
    const two: League = { ...hockey, settings: { ...hockey.settings, courtsPerMatch: 2 } };
    const raw = audit(two, rh.matches);
    for (const m of rh.matches) assert(raw.issues.get(m.id)?.soft.some((s) => s.startsWith("Only 1 of 2 sheets assigned")), `units raised: ${m.id} holding 1 of 2 sheets is flagged`);
    adviceOk(two, rh.matches, "units raised, before");
    const rh2 = reassignUnitsAfterEdit(hockey, two, rh.matches);
    noSilentGaps(two, rh2, "units raised");
    adviceOk(two, rh2, "units raised, after");
    const withTwo = rh2.filter((m) => m.unitIds?.length === 2);
    assert(withTwo.length > 0, "units raised: games get 2 sheets where 2 are free");
    assert(rh2.every((m) => !m.unitIds || m.unitIds.length === 2), "units raised: no game keeps a half assignment");
    const seen2 = new Set<string>();
    for (const m of withTwo) for (const u of m.unitIds!) {
        const k = `${m.date}|${m.time}|${u}`;
        assert(!seen2.has(k), "units raised: no sheet double-booked");
        seen2.add(k);
    }
    for (const m of rh2.filter((x) => !x.unitIds)) assert(audit(two, rh2).issues.get(m.id)?.soft.includes("No sheet assigned: every sheet is booked at that time"), "units raised: the rest say every sheet is booked");
}

// --- advice speaks the league's sport ------------------------------------------------
{
    const hockey = sampleLeague("hockey");
    const a = adviceFor("Example Aces 10U already plays that day", hockey);
    assert(a.tip.includes("Max games per team per day") && !/\bmatch(es)?\b/.test(a.tip), `hockey advice uses game words: ${a.tip}`);
    assert(adviceFor("Every sheet is already booked at that time", hockey).tabLabel === "Facilities & ice time", "hockey tab label is the real tab name");
    assert(adviceFor("Every sheet is already booked at that time", hockey).tip.includes("add more sheets"), "hockey advice says sheets");
    assert(adviceFor("Every court is already booked at that time", sampleLeague("tennis")).tabLabel === "Facilities & court time", "tennis tab label");
    for (const sport of SPORT_IDS) {
        const l = sampleLeague(sport);
        const t = SPORTS[sport];
        for (const reason of [`Every ${t.unit} is already booked at that time`, `The facility’s spreadsheet has no ${t.time} then`, `${t.unitLabel(0)} isn’t listed as free at that time`, `No ${t.unit} assigned`])
            assert(!/\bunits?\b/.test(adviceFor(reason, l).tip), `${sport}: advice never says “unit”: ${adviceFor(reason, l).tip}`);
    }
}

// --- slot ids follow the engine's binding -----------------------------------------
// The day planner's "Clear" + "Add times" and "Copy to… / Replace" give a
// time a NEW slot id. The engine still binds the booked games (date, time,
// facility fallback); the editor re-points their slotId so the next delete
// of the new slot counts and warns about them.
{
    const league = sampleLeague();
    const r = fixedRun(league);
    const ctx = prepare(league);
    assert(rebindSlotIds(league, r.matches, ctx) === r.matches, "a fresh schedule needs no re-binding");
    const busy = league.slots.find((s) => r.matches.some((m) => m.slotId === s.id))!;
    const before = gamesInSlots(ctx, r.matches, new Set([busy.id]));
    assert(before.length > 0 && before.length === r.matches.filter((m) => m.slotId === busy.id).length, "gamesInSlots counts a slot's booked games");
    const fresh = { ...busy, id: "replaced-slot" };
    const replaced = { ...league, slots: [...league.slots.filter((s) => s.id !== busy.id), fresh] };
    const ctx2 = prepare(replaced);
    assert(gamesInSlots(ctx2, r.matches, new Set([fresh.id])).length === before.length, "games on a replaced time count as booked in the new slot (time fallback)");
    const rebound = rebindAfterEdit(league, replaced, r.matches);
    assert(rebound !== r.matches && rebound.filter((m) => m.slotId === fresh.id).length === before.length, "re-binding points them at the new slot");
    assert(!rebound.some((m) => m.slotId === busy.id), "no game keeps the dead slot id");
    assert(rebound.every((m, i) => m.date === r.matches[i].date && m.time === r.matches[i].time && m.locationId === r.matches[i].locationId), "re-binding never moves a game");
    const a1 = audit(replaced, rebound);
    assert(![...a1.issues.values()].some((v) => v.soft.some((x) => /no longer in the weekly slots/.test(x))), "re-bound games aren't flagged as off the weekly slots");
    assert(rebindAfterEdit(replaced, { ...replaced, teams: [...replaced.teams] }, rebound) === rebound, "an edit that doesn't touch time skips re-binding");
    // A cleared time with nothing to re-bind to: the game keeps its id and is flagged.
    const cleared = { ...league, slots: league.slots.filter((s) => s.id !== busy.id) };
    const kept = rebindAfterEdit(league, cleared, r.matches);
    assert(kept.filter((m) => m.slotId === busy.id).length === before.length, "a game whose time is gone keeps its slot id");
    assert(gamesInSlots(prepare(cleared), kept, new Set([busy.id])).length === 0, "and no longer counts as booked anywhere");
}

// --- performance: a big league stays interactive ----------------------------------
{
    const league = sampleLeague();
    const extra: Team[] = [];
    for (let i = 0; i < 60; i++) extra.push({ ...league.teams[(i % 6) + 12], id: `big${i}`, name: `Big ${i}`, pool: `P${i % 6}`, rules: [] });
    league.teams.push(...extra);
    league.slots.push(...league.slots.map((s) => ({ ...s, id: s.id + "-b", capacity: s.capacity + 2 })));
    const t0 = performance.now();
    const r = generate(league, [], { scope: "all", seed: 5, timeBudgetMs: 1500 });
    const ms = performance.now() - t0;
    checkInvariants(league, r.matches, "big");
    assert(ms < 4000, `big league took ${Math.round(ms)}ms`);
    console.log(`big league: ${league.teams.length} teams, ${r.placed}/${r.needed} placed, ${r.attempts} attempts in ${Math.round(ms)}ms`);
}

console.log(`verify-engine: all ${checks} checks passed.`);
