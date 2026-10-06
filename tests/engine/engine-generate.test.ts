import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { audit, generate, poolKey } from "../../lib/engine/engine.ts";
import { dowOf, isoToDay, isWeekend, toMinutes, weekendKey, weekKey } from "../../lib/engine/dates.ts";
import type { League, Match, Rule } from "../../lib/engine/types.ts";
import { bracket, everyDay, gamesOf, league, location, placed, rule, run, slot, team, unplaced } from "../support/fixtures.ts";

const day = (m: Match) => isoToDay(m.date!);
const mins = (m: Match) => toMinutes(m.time!);
const reasons = (ms: Match[]) => ms.flatMap((m) => (m.blockers ?? []).map((b) => b.reason));

/** A two-team pool (A v Z) playing `n` games, with `rules` on A. */
function duel(n: number, slots: League["slots"], rules: Rule[] = [], over: Partial<League> = {}): League {
    return league({ brackets: [bracket("b", { matches: n })], teams: [team("a", { rules }), team("z")], slots, ...over });
}

/** No placed game may break a must-rule; checked independently of the engine's own check(). */
function noHardIssues(l: League, ms: Match[]) {
    const a = audit(l, ms);
    for (const m of placed(ms)) assert.deepEqual(a.issues.get(m.id)?.hard ?? [], [], `${m.home} v ${m.away} ${m.date} ${m.time}`);
    a.usage.forEach((u, i) => assert.ok(u <= a.ctx.instances[i].capacity, "over capacity"));
}

describe("generate: guarantees", () => {
    test("every team gets exactly its guaranteed games against its own bracket + pool when there is room", () => {
        const l = league({
            brackets: [bracket("b", { matches: 4 }), bracket("c", { matches: 2 })],
            slots: everyDay("10:00", 4),
            teams: [team("a1"), team("a2"), team("a3"), team("a4", { matches: 2 }), team("p1", { pool: "P" }), team("p2", { pool: " p " }), team("c1", { bracketId: "c" }), team("c2", { bracketId: "c" })],
        });
        const r = run(l);
        const teams = new Map(l.teams.map((t) => [t.id, t]));
        assert.equal(unplaced(r.matches).length, 0);
        assert.equal(r.placed, r.needed);
        for (const m of r.matches) {
            const h = teams.get(m.home)!;
            const w = teams.get(m.away)!;
            assert.equal(poolKey(h.bracketId, h.pool), poolKey(w.bracketId, w.pool), "same bracket and pool (pool names compare trimmed, case-insensitive)");
            assert.equal(m.bracketId, h.bracketId);
            assert.notEqual(m.home, m.away);
        }
        const count = (id: string) => gamesOf(r.matches, id).length;
        assert.deepEqual(["a1", "a2", "a3", "a4", "p1", "p2", "c1", "c2"].map(count), [4, 4, 4, 2, 4, 4, 2, 2]);
        noHardIssues(l, r.matches);
        assert.deepEqual(r.warnings, []);
    });

    test("home and away are balanced (each team hosts about half)", () => {
        const l = league({ brackets: [bracket("b", { matches: 6 })], slots: everyDay("10:00", 4), teams: ["a", "c", "d", "e"].map((id) => team(id)) });
        const a = audit(l, run(l).matches);
        for (const s of a.teams.values()) assert.ok(s.homeMatches >= 2 && s.homeMatches <= 4, `${s.teamId}: ${s.homeMatches}/6 at home`);
    });

    test("ids are unique, results are sorted, and placed matches carry a real slot", () => {
        const l = league({ slots: everyDay("10:00", 2), teams: ["a", "c", "d", "e"].map((id) => team(id)) });
        const r = run(l);
        assert.equal(new Set(r.matches.map((m) => m.id)).size, r.matches.length);
        const sorted = [...r.matches].sort((x, y) => (x.date! + x.time).localeCompare(y.date! + y.time) || x.id.localeCompare(y.id));
        assert.deepEqual(r.matches.map((m) => m.id), sorted.map((m) => m.id));
        for (const m of r.matches) assert.ok(m.slotId && m.locationId === "l" && m.locked === false);
    });

    test("teams don't have to play every week", () => {
        // 8-week season, 2 games each: most weeks are empty for each team, and that's fine.
        const l = league({ brackets: [bracket("b", { matches: 2 })], settings: { seasonStart: "2027-03-01", seasonEnd: "2027-04-25" }, slots: [slot("s", 6, "10:00", { capacity: 2 })], teams: ["a", "c", "d", "e"].map((id) => team(id)) });
        const r = run(l);
        assert.equal(unplaced(r.matches).length, 0);
        assert.deepEqual(r.warnings, []);
        for (const t of l.teams) assert.ok(new Set(gamesOf(r.matches, t.id).map((m) => weekKey(day(m)))).size <= 2);
    });

    test("games are spread across the season rather than bunched", () => {
        const l = league({ brackets: [bracket("b", { matches: 4 })], settings: { seasonStart: "2027-03-01", seasonEnd: "2027-05-30" }, slots: everyDay("10:00", 2), teams: ["a", "c", "d", "e"].map((id) => team(id)) });
        for (const t of l.teams) {
            const days = gamesOf(run(l).matches, t.id).map(day).sort((x, y) => x - y);
            assert.ok(days[days.length - 1] - days[0] >= 30, `${t.id}: ${days.length} games within ${days[days.length - 1] - days[0]} days`);
        }
    });
});

describe("generate: must rules are never broken (one minimal league per rule type)", () => {
    /**
     * Each case: a league where WITHOUT the rule every game fits (the control),
     * and WITH the must-rule some games can only fit by breaking it -- so the
     * generator must leave them unplaced, with the rule's sentence as the reason.
     */
    const cases: { name: string; n: number; slots: League["slots"]; rule: Rule; locations?: League["locations"]; ok: (m: Match, mine: Match[]) => boolean; maxPlaced: number; reason: string }[] = [
        {
            name: "max_per_weekend",
            n: 6,
            slots: [slot("sat", 6, "10:00"), slot("sun", 0, "10:00")],
            rule: rule("max_per_weekend", { n: 1 }),
            ok: (m, mine) => mine.filter((x) => weekendKey(day(x)) === weekendKey(day(m))).length <= 1,
            maxPlaced: 4,
            reason: "A: At most 1 match per weekend",
        },
        {
            name: "max_weekend_total",
            n: 4,
            slots: [slot("sat", 6, "10:00"), slot("sun", 0, "10:00")],
            rule: rule("max_weekend_total", { n: 2 }),
            ok: (_m, mine) => mine.filter((x) => isWeekend(day(x))).length <= 2,
            maxPlaced: 2,
            reason: "A: At most 2 matches on Sat/Sun all season",
        },
        {
            name: "max_per_week",
            n: 7,
            slots: everyDay("10:00"),
            rule: rule("max_per_week", { n: 1 }),
            ok: (m, mine) => mine.filter((x) => weekKey(day(x)) === weekKey(day(m))).length <= 1,
            maxPlaced: 5,
            reason: "A: At most 1 match per week",
        },
        {
            name: "max_on_day",
            n: 3,
            slots: [slot("sat", 6, "10:00")],
            rule: rule("max_on_day", { day: 6, n: 1 }),
            ok: (_m, mine) => mine.filter((x) => dowOf(day(x)) === 6).length <= 1,
            maxPlaced: 1,
            reason: "A: At most 1 match on Saturdays all season",
        },
        {
            name: "no_days",
            n: 6,
            slots: [slot("sat", 6, "10:00"), slot("tue", 2, "10:00")],
            rule: rule("no_days", { days: [6] }),
            ok: (m) => dowOf(day(m)) !== 6,
            maxPlaced: 5,
            reason: "A: Not on Saturdays",
        },
        {
            name: "only_days",
            n: 6,
            slots: [slot("sat", 6, "10:00"), slot("tue", 2, "10:00")],
            rule: rule("only_days", { days: [6] }),
            ok: (m) => dowOf(day(m)) === 6,
            maxPlaced: 4,
            reason: "A: Only on Saturdays",
        },
        {
            name: "not_dates",
            n: 5,
            slots: everyDay("10:00"),
            rule: rule("not_dates", { ranges: [{ from: "2027-03-01", to: "2027-03-28" }] }),
            ok: (m) => m.date! > "2027-03-28",
            maxPlaced: 3,
            reason: "A: Unavailable Mon, Mar 1 – Sun, Mar 28",
        },
        {
            name: "no_start_after",
            n: 6,
            slots: [slot("sat", 6, "10:00"), slot("tue", 2, "14:00")],
            rule: rule("no_start_after", { time: "12:00" }),
            ok: (m) => mins(m) <= 12 * 60,
            maxPlaced: 4,
            reason: "A: Start no later than 12:00 PM",
        },
        {
            name: "no_start_before",
            n: 6,
            slots: [slot("sat", 6, "10:00"), slot("tue", 2, "14:00")],
            rule: rule("no_start_before", { time: "12:00" }),
            ok: (m) => mins(m) >= 12 * 60,
            maxPlaced: 5,
            reason: "A: Start no earlier than 12:00 PM",
        },
        {
            name: "only_locations",
            n: 6,
            slots: [slot("sat", 6, "10:00"), slot("tue", 2, "10:00", { locationId: "m" })],
            locations: [location("l"), location("m", { name: "Park" })],
            rule: rule("only_locations", { locationIds: ["m"] }),
            ok: (m) => m.locationId === "m",
            maxPlaced: 5,
            reason: "A: Only at Park",
        },
        {
            name: "avoid_locations",
            n: 6,
            slots: [slot("sat", 6, "10:00"), slot("tue", 2, "10:00", { locationId: "m" })],
            locations: [location("l", { name: "Hall" }), location("m")],
            rule: rule("avoid_locations", { locationIds: ["l"] }),
            ok: (m) => m.locationId !== "l",
            maxPlaced: 5,
            reason: "A: Not at Hall",
        },
        {
            name: "min_days_between",
            n: 6,
            slots: everyDay("10:00"),
            rule: rule("min_days_between", { n: 7 }),
            ok: (m, mine) => mine.every((x) => x === m || Math.abs(day(x) - day(m)) >= 7),
            maxPlaced: 5,
            reason: "A: At least 7 days between matches",
        },
    ];

    for (const c of cases) {
        test(c.name, () => {
            const over = c.locations ? { locations: c.locations } : {};
            const control = run(duel(c.n, c.slots, [], over));
            assert.equal(unplaced(control.matches).length, 0, "control: without the rule everything fits");
            assert.ok(placed(control.matches).some((m) => !c.ok(m, placed(control.matches))), "control: the easy schedule would break the rule");

            const l = duel(c.n, c.slots, [c.rule], over);
            const r = run(l);
            const mine = placed(r.matches);
            for (const m of mine) assert.ok(c.ok(m, mine), `${m.date} ${m.time} @${m.locationId} breaks ${c.name}`);
            assert.equal(mine.length, c.maxPlaced, "as many as the rule allows are placed");
            assert.ok(reasons(unplaced(r.matches)).includes(c.reason), `reason given: ${reasons(unplaced(r.matches)).join(" | ")}`);
            noHardIssues(l, r.matches);

            // The same rule on the bracket binds every team in it.
            const viaBracket = duel(c.n, c.slots, [], { ...over, brackets: [bracket("b", { matches: c.n, rules: [c.rule] })] });
            const rb = placed(run(viaBracket).matches);
            for (const m of rb) assert.ok(c.ok(m, rb), `bracket-level ${c.name} broken`);
        });
    }

    /** Two pools, P (A v Z) and Q (C v D), so A and C never meet but compete for times. */
    const twoPools = (rules: Rule[], slots: League["slots"], onC = false) =>
        league({
            brackets: [bracket("b", { matches: 4 })],
            slots,
            teams: [team("a", { pool: "P", rules: onC ? [] : rules }), team("z", { pool: "P" }), team("c", { pool: "Q", rules: onC ? rules : [] }), team("d", { pool: "Q" })],
        });

    test("not_same_time (written on either team)", () => {
        const slots = [slot("sat", 6, "10:00", { capacity: 2 }), slot("sat2", 6, "11:00", { capacity: 2 })];
        const control = run(twoPools([], slots));
        assert.equal(unplaced(control.matches).length, 0);
        for (const onC of [false, true]) {
            const r = run(twoPools([rule("not_same_time", { teamIds: [onC ? "a" : "c"] })], slots, onC));
            for (const x of gamesOf(placed(r.matches), "a"))
                for (const y of gamesOf(placed(r.matches), "c")) assert.ok(!(x.date === y.date && Math.abs(mins(x) - mins(y)) < 90), `A and C overlap on ${x.date}`);
            assert.equal(placed(r.matches).length, 4, "only one pool fits each Saturday (10:00 and 11:00 overlap)");
            assert.ok(reasons(unplaced(r.matches)).some((s) => /^[AC]: not at the same time as [AC]$/.test(s)), reasons(r.matches).join(" | "));
        }
    });

    test("not_same_day (written on either team)", () => {
        const slots = [slot("sat", 6, "09:00"), slot("sat2", 6, "15:00")];
        for (const onC of [false, true]) {
            const r = run(twoPools([rule("not_same_day", { teamIds: [onC ? "a" : "c"] })], slots, onC));
            const aDays = new Set(gamesOf(placed(r.matches), "a").map((m) => m.date));
            assert.ok(gamesOf(placed(r.matches), "c").every((m) => !aDays.has(m.date)));
            assert.equal(placed(r.matches).length, 4);
            assert.ok(reasons(unplaced(r.matches)).some((s) => /: not on the same day as /.test(s)));
        }
    });

    test(
        "not_same_day holds when the two teams also play EACH OTHER that day (generate agrees with audit)",
        {
            todo: "BUG: check() skips a not_same_day partner who is in the game being placed (lib/engine/engine.ts:537), so placing A v C after A v D on the same day passes, yet audit() of the result flags A v D as a hard break: generate's output breaks a must-rule by its own audit. Repro: this test (3 teams, maxPerDay 2, one Saturday, A must not play the same day as C).",
        },
        () => {
            const l = league({
                settings: { seasonStart: "2027-03-06", seasonEnd: "2027-03-06", maxPerDay: 2 },
                brackets: [bracket("b", { matches: 2 })],
                slots: [slot("s9", 6, "09:00"), slot("s11", 6, "11:00"), slot("s13", 6, "13:00")],
                teams: [team("a", { rules: [rule("not_same_day", { teamIds: ["c"] })] }), team("c"), team("d")],
            });
            for (const seed of [1, 2, 3]) noHardIssues(l, run(l, [], { seed }).matches);
        }
    );

    test("bracket window and days, and slots' 'Open to'", () => {
        const l = league({
            brackets: [bracket("b", { matches: 4, earliest: "10:00", latest: "16:00", days: [6] }), bracket("y", { matches: 4 })],
            slots: [slot("early", 6, "08:00", { capacity: 2 }), slot("ok", 6, "12:00", { capacity: 2 }), slot("late", 6, "18:00", { capacity: 2 }), slot("sun", 0, "12:00", { capacity: 2 }), slot("yOnly", 2, "12:00", { capacity: 2, bracketIds: ["y"] })],
            teams: [team("a"), team("z"), team("y1", { bracketId: "y" }), team("y2", { bracketId: "y" })],
        });
        const r = run(l);
        for (const m of placed(r.matches)) if (m.bracketId === "b") assert.equal(m.slotId, "ok");
        assert.equal(gamesOf(placed(r.matches), "a").length, 4);
        noHardIssues(l, r.matches);
    });

    test("a must 'note' rule is never enforced", () => {
        const r = run(duel(4, [slot("sat", 6, "10:00")], [rule("note", { text: "No Saturdays please" })]));
        assert.equal(placed(r.matches).length, 4);
    });
});

describe("generate: prefer rules", () => {
    test("honoured when possible", () => {
        const l = duel(4, [slot("sat", 6, "10:00"), slot("tue", 2, "10:00")], [rule("no_days", { days: [6] }, "prefer")]);
        const r = run(l);
        assert.equal(unplaced(r.matches).length, 0);
        assert.ok(r.matches.every((m) => dowOf(day(m)) === 2), "all on Tuesdays");
        assert.equal(audit(l, r.matches).issues.size, 0);
    });

    test("broken only when that's the only way to place a game, and flagged softly", () => {
        const l = duel(6, [slot("sat", 6, "10:00"), slot("tue", 2, "10:00")], [rule("no_days", { days: [6] }, "prefer")]);
        const r = run(l);
        assert.equal(unplaced(r.matches).length, 0, "a prefer rule never leaves a game unplaced");
        const sats = r.matches.filter((m) => dowOf(day(m)) === 6);
        assert.equal(sats.length, 1, "exactly one game had to go on a Saturday");
        const a = audit(l, r.matches);
        assert.deepEqual(a.issues.get(sats[0].id), { hard: [], soft: ["A: Not on Saturdays"] });
    });

    test("prefer dynamic rules (max per weekend) also give way only when needed", () => {
        const l = duel(5, [slot("sat", 6, "10:00"), slot("sun", 0, "10:00")], [rule("max_per_weekend", { n: 1 }, "prefer")]);
        const r = run(l);
        assert.equal(unplaced(r.matches).length, 0);
        const weekends = new Map<number, number>();
        for (const m of r.matches) weekends.set(weekendKey(day(m))!, (weekends.get(weekendKey(day(m))!) ?? 0) + 1);
        assert.deepEqual([...weekends.values()].sort(), [1, 1, 1, 2], "one weekend doubles up, the rest have one");
    });
});

describe("generate: per-day limit, club limit, overlaps", () => {
    const oneDay = (maxPerDay: number) =>
        league({
            brackets: [bracket("b", { matches: 2 })],
            settings: { seasonStart: "2027-03-06", seasonEnd: "2027-03-06", maxPerDay },
            slots: ["09:00", "10:00", "11:00", "13:00"].map((t, i) => slot(`s${i}`, 6, t, { capacity: 2 })),
            teams: [team("a"), team("c"), team("d")],
        });

    test("maxPerDay 1: a team plays once a day at most", () => {
        const r = run(oneDay(1));
        assert.equal(placed(r.matches).length, 1);
        assert.ok(reasons(unplaced(r.matches)).some((s) => / already plays that day$/.test(s)));
    });

    test("maxPerDay 2: twice a day, but never two games overlapping (matchMinutes)", () => {
        const l = oneDay(2);
        const r = run(l);
        assert.equal(placed(r.matches).length, 3);
        for (const t of l.teams) {
            const ts = gamesOf(r.matches, t.id).map(mins).sort((x, y) => x - y);
            assert.equal(ts.length, 2);
            assert.ok(ts[1] - ts[0] >= 90, `${t.id}: ${ts}`);
        }
    });

    const clubs = (mode: "must" | "prefer", limit = 1) =>
        league({
            brackets: [bracket("b", { matches: 1 })],
            settings: { seasonStart: "2027-03-06", seasonEnd: "2027-03-06", clubLimit: limit, clubLimitMode: mode },
            slots: ["09:00", "09:30", "10:00"].map((t, i) => slot(`s${i}`, 6, t, { capacity: 4 })),
            teams: [team("r1", { club: "Riverside", pool: "1" }), team("x1", { pool: "1" }), team("r2", { club: " riverside ", pool: "2" }), team("x2", { pool: "2" }), team("r3", { club: "Riverside", pool: "3" }), team("x3", { pool: "3" })],
        });

    test("club limit (must): counts overlapping starts, not just equal ones; club names compare case-insensitively", () => {
        const l = clubs("must");
        const r = run(l);
        // 09:00, 09:30 and 10:00 all overlap with 90-minute games: only one Riverside game fits.
        assert.equal(placed(r.matches).length, 1);
        assert.ok(reasons(unplaced(r.matches)).includes("More than 1 Riverside match at the same time"), reasons(r.matches).join(" | "));
        noHardIssues(l, r.matches);
    });

    test("club limit: non-overlapping starts are fine", () => {
        const l = clubs("must");
        l.slots = ["09:00", "10:30", "12:00"].map((t, i) => slot(`s${i}`, 6, t, { capacity: 4 }));
        assert.equal(placed(run(l).matches).length, 3);
    });

    test("club limit 2 lets two overlap; the message is plural", () => {
        const r = run(clubs("must", 2));
        assert.equal(placed(r.matches).length, 2);
        assert.ok(reasons(unplaced(r.matches)).includes("More than 2 Riverside matches at the same time"));
    });

    test("club limit (prefer): everything is placed and the overlap is a soft flag", () => {
        const l = clubs("prefer");
        const r = run(l);
        assert.equal(placed(r.matches).length, 3);
        const soft = [...audit(l, r.matches).issues.values()].flatMap((v) => v.soft);
        assert.ok(soft.includes("More than 1 Riverside match at the same time"));
        noHardIssues(l, r.matches);
    });

    test("teams without a club are never limited", () => {
        const l = clubs("must");
        for (const t of l.teams) t.club = "";
        assert.equal(placed(run(l).matches).length, 3);
    });

    test("capacity: never more games at a time than it holds", () => {
        const l = league({ brackets: [bracket("b", { matches: 1 })], settings: { seasonStart: "2027-03-06", seasonEnd: "2027-03-06" }, slots: [slot("s", 6, "10:00", { capacity: 2 })], teams: ["a", "c", "d", "e", "f", "g"].map((id) => team(id)) });
        const r = run(l);
        assert.equal(placed(r.matches).length, 2);
        assert.ok(reasons(unplaced(r.matches)).includes("Every court is already booked at that time"));
    });
});

describe("generate: locks, scope, determinism", () => {
    const base = () =>
        league({
            brackets: [bracket("b", { matches: 3 }), bracket("y", { matches: 3 })],
            slots: everyDay("10:00", 2),
            teams: [team("a"), team("c"), team("d"), team("e"), team("y1", { bracketId: "y" }), team("y2", { bracketId: "y" }), team("y3", { bracketId: "y" }), team("y4", { bracketId: "y" })],
        });

    test("same seed and clock, same schedule; the input previous list is not mutated", () => {
        const prev = run(base()).matches;
        const snapshot = structuredClone(prev);
        assert.deepEqual(run(base(), prev, { seed: 7 }), run(base(), prev, { seed: 7 }));
        assert.deepEqual(prev, snapshot);
    });

    test("locked matches survive a regenerate untouched and count toward the team's games", () => {
        const l = base();
        const first = run(l).matches;
        const locked = first.map((m, i) => (i < 3 ? { ...m, locked: true } : m));
        const r = run(l, locked, { seed: 99 });
        for (const m of locked.slice(0, 3)) assert.deepEqual(r.matches.find((x) => x.id === m.id), m);
        for (const t of l.teams) assert.equal(gamesOf(r.matches, t.id).length, 3, `${t.id} still gets exactly 3`);
        noHardIssues(l, r.matches);
    });

    test("unlocked matches in scope are replaced", () => {
        const l = base();
        const first = run(l).matches;
        const r = run(l, first, { seed: 99 });
        assert.ok(r.matches.every((m) => !first.some((f) => f.id === m.id)), "new ids: nothing unlocked was kept");
        assert.equal(r.matches.length, first.length);
    });

    test("scope = one bracket: the other bracket's matches (even unlocked) are kept as they were", () => {
        const l = base();
        const first = run(l).matches;
        const r = run(l, first, { scope: "y", seed: 5 });
        const keep = (ms: Match[]) => ms.filter((m) => m.bracketId === "b").sort((x, y) => x.id.localeCompare(y.id));
        assert.deepEqual(keep(r.matches), keep(first));
        assert.equal(r.matches.filter((m) => m.bracketId === "y").length, 6);
        assert.equal(r.needed, 6, "only the scoped bracket is paired");
        noHardIssues(l, r.matches);
    });

    test("a kept match whose team was deleted is dropped", () => {
        const l = base();
        const first = run(l).matches.map((m) => ({ ...m, locked: true }));
        l.teams = l.teams.filter((t) => t.id !== "a");
        const r = run(l, first);
        assert.ok(r.matches.every((m) => m.home !== "a" && m.away !== "a"));
    });

    test("the time budget: at least 3 attempts, then stops once over budget; maxAttempts caps", () => {
        let t = 0;
        const slow = generate(base(), [], { scope: "all", seed: 1, timeBudgetMs: 10, maxAttempts: 50, now: () => (t += 100) });
        assert.equal(slow.attempts, 3);
        assert.equal(run(base(), [], { maxAttempts: 7 }).attempts, 7);
    });
});

describe("generate: warnings and explanations", () => {
    test("a team alone in its pool", () => {
        const l = league({ slots: everyDay("10:00"), teams: [team("a"), team("c"), team("solo", { pool: "Z", name: "Solo" })] });
        assert.ok(run(l).warnings.includes("Solo is the only team in B · Pool Z, so it has nobody to play."));
    });

    test("a team wanting more than the rest of its pool plays names that cause", () => {
        const l = league({ brackets: [bracket("b", { matches: 1 })], slots: everyDay("10:00"), teams: [team("a", { matches: 3 }), team("c"), team("d")] });
        assert.deepEqual(run(l).warnings, ["A gets 2 of 3 matches: the rest of B has only 2 to give (add a team, or give it fewer)."]);
    });

    test("an odd total names that cause", () => {
        const l = league({ brackets: [bracket("b", { matches: 3 })], slots: everyDay("10:00", 2), teams: [team("a"), team("c"), team("d")] });
        const w = run(l).warnings;
        assert.equal(w.length, 1);
        assert.match(w[0], /^[ACD] gets 2 of 3 matches: B has an odd total, so one team must come up one short \(or add a team\)\.$/);
    });

    test(
        "shortfall warnings agree in number ('of 1 match', not 'of 1 matches')",
        { todo: "BUG: generate() writes \"A gets 0 of 1 matches\" -- the noun is always plural (lib/engine/engine.ts:824, `${tc.target} ${ctx.terms.matches}`)" },
        () => {
            const l = league({ brackets: [bracket("b", { matches: 1 })], slots: everyDay("10:00", 3), teams: [team("a"), team("c"), team("d")] });
            for (const w of run(l).warnings) assert.doesNotMatch(w, /\b1 matches\b/, w);
        }
    );

    test("no time in the season: a warning, and every game says why", () => {
        const r = run(league({ teams: [team("a"), team("c")] }));
        assert.ok(r.warnings.includes("There are no open time slots in the season. Check the season dates and add weekly time slots."));
        assert.equal(unplaced(r.matches).length, 5);
        assert.ok(r.matches.every((m) => m.note === "There are no time slots in the season to put it in." && !m.blockers));
    });

    test("an unplaced game lists its top blockers with counts ('1 time' / 'n times')", () => {
        const l = league({ brackets: [bracket("b", { matches: 3 })], settings: { seasonStart: "2027-03-06", seasonEnd: "2027-03-13" }, slots: [slot("s", 6, "10:00")], teams: [team("a"), team("c")] });
        const [m] = unplaced(run(l).matches);
        assert.ok(m.blockers!.length >= 1 && m.blockers!.length <= 3);
        assert.deepEqual(m.blockers, [{ reason: "Every court is already booked at that time", count: 2 }]);
        assert.equal(m.note, "No spot fits. Most common blockers: Every court is already booked at that time (2 times).");
        const one = league({ brackets: [bracket("b", { matches: 2 })], settings: { seasonStart: "2027-03-06", seasonEnd: "2027-03-06" }, slots: [slot("s", 6, "10:00")], teams: [team("a"), team("c")] });
        assert.match(unplaced(run(one).matches)[0].note!, /\(1 time\)\.$/);
    });

    test("sport words in engine messages (hockey)", () => {
        const l = league({ settings: { sport: "hockey", seasonStart: "2027-03-06", seasonEnd: "2027-03-06" }, brackets: [bracket("b", { matches: 1 })], slots: [slot("s", 6, "10:00")], teams: ["a", "c", "d", "e"].map((id) => team(id)) });
        assert.ok(reasons(run(l).matches).includes("Every sheet is already booked at that time"));
    });

    test("teams outside any bracket are reported and not scheduled", () => {
        const r = run(league({ slots: everyDay("10:00"), teams: [team("a"), team("c"), team("x", { bracketId: "", name: "Loose" })] }));
        assert.ok(r.warnings.includes("Loose isn’t in an age bracket, so it can’t be scheduled."));
        assert.equal(gamesOf(r.matches, "x").length, 0);
    });
});
