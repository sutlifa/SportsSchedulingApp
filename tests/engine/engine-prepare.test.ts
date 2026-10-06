import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    bracketHard,
    compileStatic,
    instanceKey,
    makeLookup,
    mulberry32,
    poolKey,
    prepare,
    sortMatches,
    spotForMatch,
    teamTarget,
    unitInputsChanged,
    unitShortText,
    type Instance,
} from "../../lib/engine/engine.ts";
import { dowOf, isoToDay } from "../../lib/engine/dates.ts";
import { SPORTS } from "../../lib/engine/sports.ts";
import { bracket, league, location, match, rule, slot, team } from "../support/fixtures.ts";

const at = (date: string, time: string, over: Partial<Instance> = {}): Instance => {
    const [h, m] = time.split(":").map(Number);
    return { idx: 0, day: isoToDay(date), date, time, minutes: h * 60 + m, slotId: "s", locationId: "l", capacity: 1, bracketIds: null, unitIds: [], ...over };
};

describe("prepare: instances", () => {
    test("one instance per weekly slot per matching weekday in the season, dense idx, sorted by time within a day", () => {
        // March 2027: Saturdays 6, 13, 20, 27; Tuesdays 2, 9, 16, 23, 30.
        const ctx = prepare(league({ slots: [slot("late", 6, "15:00"), slot("early", 6, "09:00"), slot("tue", 2, "18:00")] }));
        assert.equal(ctx.instances.length, 4 * 2 + 5);
        assert.ok(ctx.instances.every((i, k) => i.idx === k));
        const sat = ctx.instances.filter((i) => i.date === "2027-03-06");
        assert.deepEqual(sat.map((i) => i.time), ["09:00", "15:00"]);
        assert.ok(ctx.instances.every((i) => dowOf(i.day) === (i.slotId === "tue" ? 2 : 6)));
        for (let k = 1; k < ctx.instances.length; k++) assert.ok(ctx.instances[k - 1].day <= ctx.instances[k].day, "chronological");
        assert.equal(ctx.startDay, isoToDay("2027-03-01"));
        assert.equal(ctx.endDay, isoToDay("2027-03-31"));
        assert.equal(ctx.seasonDays, 31);
    });

    test("the season's first and last days are both included", () => {
        const ctx = prepare(league({ settings: { seasonStart: "2027-03-06", seasonEnd: "2027-03-13" }, slots: [slot("s", 6, "10:00")] }));
        assert.deepEqual(ctx.instances.map((i) => i.date), ["2027-03-06", "2027-03-13"]);
    });

    test("no season dates, or a reversed season, means no instances", () => {
        assert.equal(prepare(league({ settings: { seasonStart: "", seasonEnd: "" }, slots: [slot("s", 6, "10:00")] })).instances.length, 0);
        assert.equal(prepare(league({ settings: { seasonStart: "2027-03-31", seasonEnd: "2027-03-01" }, slots: [slot("s", 6, "10:00")] })).instances.length, 0);
    });

    test("a typo'd multi-year season is capped (~800 days) instead of hanging", () => {
        const ctx = prepare(league({ settings: { seasonStart: "2027-01-01", seasonEnd: "2099-12-31" }, slots: [slot("s", 6, "10:00")] }));
        assert.ok(ctx.instances.length > 100 && ctx.instances.length <= 115, String(ctx.instances.length));
    });

    test("blackout dates have no instances", () => {
        const ctx = prepare(league({ settings: { blackouts: [{ from: "2027-03-13" }, { from: "2027-03-20", to: "2027-03-21" }] }, slots: [slot("s", 6, "10:00"), slot("u", 0, "10:00")] }));
        assert.deepEqual([...new Set(ctx.instances.map((i) => i.date))], ["2027-03-06", "2027-03-07", "2027-03-14", "2027-03-27", "2027-03-28"]);
    });

    test("slots at deleted locations, with bad times, or with 0 capacity are ignored", () => {
        const ctx = prepare(league({ slots: [slot("gone", 6, "10:00", { locationId: "nowhere" }), slot("bad", 6, "9am"), slot("zero", 6, "11:00", { capacity: 0 })] }));
        assert.equal(ctx.instances.length, 0);
    });

    test("bracket 'Open to': a set when the slot lists brackets, null for everyone", () => {
        const ctx = prepare(league({ slots: [slot("open", 6, "10:00"), slot("only", 6, "12:00", { bracketIds: ["b"] })] }));
        const [open, only] = ctx.instances.filter((i) => i.date === "2027-03-06");
        assert.equal(open.bracketIds, null);
        assert.deepEqual([...only.bracketIds!], ["b"]);
    });
});

describe("prepare: capacity", () => {
    const units = [
        { id: "u1", name: "Court 1" },
        { id: "u2", name: "Court 2" },
        { id: "u3", name: "Court 3" },
    ];

    test("an unnamed slot's capacity is its number", () => {
        const ctx = prepare(league({ slots: [slot("s", 6, "10:00", { capacity: 4 })] }));
        assert.equal(ctx.instances[0].capacity, 4);
        assert.deepEqual(ctx.instances[0].unitIds, []);
    });

    test("named units decide capacity: floor(units / courtsPerMatch), in the facility's order", () => {
        const l = league({ locations: [location("l", { units })], slots: [slot("s", 6, "10:00", { capacity: 99, unitIds: ["u3", "u1"] })] });
        assert.equal(prepare(l).instances[0].capacity, 2);
        assert.deepEqual(prepare(l).instances[0].unitIds, ["u1", "u3"]);
        l.settings.courtsPerMatch = 2;
        assert.equal(prepare(l).instances[0].capacity, 1);
        assert.equal(prepare(l).unitsPerMatch, 2);
    });

    test("too few units for one game = no instance at all (zero capacity)", () => {
        const l = league({ settings: { courtsPerMatch: 2 }, locations: [location("l", { units })], slots: [slot("s", 6, "10:00", { unitIds: ["u1"] })] });
        assert.equal(prepare(l).instances.length, 0);
    });

    test("a deleted unit drops out of the slot instead of breaking it", () => {
        const l = league({ locations: [location("l", { units })], slots: [slot("s", 6, "10:00", { unitIds: ["u1", "gone"] })] });
        assert.deepEqual(prepare(l).instances[0].unitIds, ["u1"]);
        assert.equal(prepare(l).instances[0].capacity, 1);
    });

    test("an unnamed weekly slot's number is NOT divided by courtsPerMatch (it is already games at once)", () => {
        const l = league({ settings: { courtsPerMatch: 3 }, slots: [slot("s", 6, "10:00", { capacity: 2 })] });
        assert.equal(prepare(l).instances[0].capacity, 2);
    });
});

describe("prepare: facility uploads (availability)", () => {
    const base = () =>
        league({
            locations: [location("l", { units: [{ id: "u1", name: "Court 1" }, { id: "u2", name: "Court 2" }] }), location("m")],
            settings: { blackouts: [{ from: "2027-03-27" }] },
            slots: [slot("w9", 6, "09:00", { capacity: 2 }), slot("w11", 6, "11:00", { capacity: 2 }), slot("m9", 6, "09:00", { locationId: "m", capacity: 1 })],
        });

    test("REPLACES the weekly slots for each (location, date) it mentions; other dates keep the pattern", () => {
        const l = base();
        l.availability = [{ id: "a1", date: "2027-03-06", time: "10:00", locationId: "l", courts: 6, unitIds: [], bracketIds: [] }];
        const ctx = prepare(l);
        assert.deepEqual(ctx.instances.filter((i) => i.date === "2027-03-06" && i.locationId === "l").map((i) => [i.time, i.capacity, i.slotId]), [["10:00", 6, "a1"]]);
        assert.equal(ctx.instances.filter((i) => i.date === "2027-03-13" && i.locationId === "l").length, 2, "an unmentioned date keeps its weekly slots");
        assert.equal(ctx.instances.filter((i) => i.date === "2027-03-06" && i.locationId === "m").length, 1, "another facility the same day is untouched");
        assert.ok(ctx.covered.has("l|2027-03-06"));
        assert.ok(!ctx.covered.has("m|2027-03-06"));
    });

    test("a 0-court row closes the whole day at that facility", () => {
        const l = base();
        l.availability = [{ id: "a0", date: "2027-03-13", time: "09:00", locationId: "l", courts: 0, unitIds: [], bracketIds: [] }];
        assert.equal(prepare(l).instances.filter((i) => i.date === "2027-03-13" && i.locationId === "l").length, 0);
    });

    test("courts become games at once via courtsPerMatch; named units take precedence over the count", () => {
        const l = base();
        l.settings.courtsPerMatch = 2;
        l.availability = [
            { id: "a1", date: "2027-03-06", time: "09:00", locationId: "l", courts: 5, unitIds: [], bracketIds: [] },
            { id: "a2", date: "2027-03-13", time: "09:00", locationId: "l", courts: 9, unitIds: ["u1", "u2"], bracketIds: ["b"] },
        ];
        const ctx = prepare(l);
        const i1 = ctx.instances.find((i) => i.slotId === "a1")!;
        const i2 = ctx.instances.find((i) => i.slotId === "a2")!;
        assert.equal(i1.capacity, 2);
        assert.equal(i2.capacity, 1);
        assert.deepEqual(i2.unitIds, ["u1", "u2"]);
        assert.deepEqual([...i2.bracketIds!], ["b"]);
    });

    test("blackouts still win over an upload; uploads for deleted facilities are ignored", () => {
        const l = base();
        l.availability = [
            { id: "a1", date: "2027-03-27", time: "09:00", locationId: "l", courts: 4, unitIds: [], bracketIds: [] },
            { id: "a2", date: "2027-03-06", time: "09:00", locationId: "gone", courts: 4, unitIds: [], bracketIds: [] },
        ];
        const ctx = prepare(l);
        assert.equal(ctx.instances.filter((i) => i.date === "2027-03-27").length, 0);
        assert.equal(ctx.instances.filter((i) => i.slotId === "a2").length, 0);
        assert.ok(!ctx.covered.has("gone|2027-03-06"));
    });

    test("instByKey and instByTime find every instance", () => {
        const ctx = prepare(base());
        for (const i of ctx.instances) {
            assert.equal(ctx.instByKey.get(instanceKey(i.date, i.slotId)), i);
            assert.ok(ctx.instByTime.get(`${i.date}|${i.time}|${i.locationId}`));
        }
    });
});

describe("prepare: teams and settings", () => {
    test("a team whose bracket doesn't exist is left out with a plain warning", () => {
        const ctx = prepare(league({ teams: [team("a"), team("lost", { bracketId: "nope", name: "Lost Team" })] }));
        assert.ok(ctx.teams.has("a"));
        assert.ok(!ctx.teams.has("lost"));
        assert.deepEqual(ctx.warnings, ["Lost Team isn’t in an age bracket, so it can’t be scheduled."]);
    });

    test("not_same_time / not_same_day hold from both sides; the stricter mode wins; self and unknown ids ignored", () => {
        const ctx = prepare(
            league({
                teams: [
                    team("a", { rules: [rule("not_same_time", { teamIds: ["c", "a", "ghost"] }, "prefer"), rule("not_same_day", { teamIds: ["d"] })] }),
                    team("b"),
                    team("c", { rules: [rule("not_same_time", { teamIds: ["a"] }, "must")] }),
                    team("d"),
                ],
            })
        );
        const a = ctx.teams.get("a")!;
        assert.deepEqual([...a.sameTime], [["c", "must"]]);
        assert.deepEqual([...ctx.teams.get("c")!.sameTime], [["a", "must"]]);
        assert.deepEqual([...ctx.teams.get("d")!.sameDay], [["a", "must"]]);
        assert.equal(ctx.teams.get("b")!.sameTime.size, 0);
    });

    test("bracket rules apply to every team in it, before the team's own", () => {
        const ctx = prepare(league({ brackets: [bracket("b", { rules: [rule("max_per_week", { n: 1 })] })], teams: [team("a", { rules: [rule("min_days_between", { n: 3 })] })] }));
        assert.deepEqual(ctx.teams.get("a")!.dynamicRules.map((r) => r.text), ["A: At most 1 match per week", "A: At least 3 days between matches"]);
    });

    test("settings are normalised: clubLimit 0 = none, maxPerDay at least 1, sport words", () => {
        const ctx = prepare(league({ settings: { clubLimit: 0, maxPerDay: 0, sport: "hockey" } }));
        assert.equal(ctx.clubLimit, null);
        assert.equal(ctx.maxPerDay, 1);
        assert.equal(ctx.terms, SPORTS.hockey);
        assert.equal(prepare(league({ settings: { clubLimit: 2 } })).clubLimit, 2);
    });

    test("staticHard / staticSoft per instance: must rules block, prefer rules only score", () => {
        const ctx = prepare(
            league({
                slots: [slot("sat", 6, "10:00"), slot("tue", 2, "10:00")],
                teams: [team("a", { rules: [rule("no_days", { days: [6] }), rule("no_days", { days: [2] }, "prefer", "p")] })],
            })
        );
        const a = ctx.teams.get("a")!;
        for (const i of ctx.instances) {
            if (i.slotId === "sat") assert.equal(a.staticHard[i.idx], "A: Not on Saturdays");
            else {
                assert.equal(a.staticHard[i.idx], null);
                assert.deepEqual(a.staticSoft[i.idx], ["A: Not on Tuesdays"]);
            }
        }
    });
});

describe("bracketHard", () => {
    const b = bracket("b", { name: "10U", earliest: "09:00", latest: "17:30", days: [6, 0] });
    test("null when the time fits", () => {
        assert.equal(bracketHard(b, at("2027-03-06", "09:00")), null);
        assert.equal(bracketHard(b, at("2027-03-07", "17:30")), null, "the window is inclusive");
        assert.equal(bracketHard(bracket(), at("2027-03-09", "23:00")), null, "no window, any day");
    });
    test("each reason in its exact words", () => {
        assert.equal(bracketHard(b, at("2027-03-06", "10:00", { bracketIds: new Set(["other"]) })), "This time slot isn’t open to 10U");
        assert.equal(bracketHard(b, at("2027-03-06", "08:59")), "10U can’t start before 9:00 AM");
        assert.equal(bracketHard(b, at("2027-03-06", "17:31")), "10U can’t start after 5:30 PM");
        assert.equal(bracketHard(b, at("2027-03-09", "10:00")), "10U doesn’t play on Tuesdays");
    });
    test("'Open to' is checked first", () => {
        assert.equal(bracketHard(b, at("2027-03-09", "06:00", { bracketIds: new Set(["x"]) })), "This time slot isn’t open to 10U");
        assert.equal(bracketHard(b, at("2027-03-06", "10:00", { bracketIds: new Set(["b"]) })), null);
    });
});

describe("compileStatic", () => {
    const live = new Set(["l1", "l2"]);
    const sat10 = at("2027-03-06", "10:00", { locationId: "l1" });
    const tue18 = at("2027-03-09", "18:00", { locationId: "l2" });
    const ok = (r: Parameters<typeof compileStatic>[0], i: Instance) => compileStatic(r, live)!(i);

    test("dynamic rules (and notes) are not static", () => {
        for (const type of ["max_per_weekend", "max_weekend_total", "max_per_week", "max_on_day", "min_days_between", "not_same_time", "not_same_day", "note"] as const) {
            const r = { id: "x", mode: "must", type, n: 1, day: 0, teamIds: [], text: "" } as unknown as Parameters<typeof compileStatic>[0];
            assert.equal(compileStatic(r, live), null, type);
        }
    });

    test("no_days / only_days (empty only_days = anywhere)", () => {
        assert.equal(ok(rule("no_days", { days: [6] }), sat10), false);
        assert.equal(ok(rule("no_days", { days: [6] }), tue18), true);
        assert.equal(ok(rule("no_days", { days: [] }), sat10), true);
        assert.equal(ok(rule("only_days", { days: [2] }), sat10), false);
        assert.equal(ok(rule("only_days", { days: [2] }), tue18), true);
        assert.equal(ok(rule("only_days", { days: [] }), sat10), true);
    });

    test("not_dates covers whole ranges", () => {
        const r = rule("not_dates", { ranges: [{ from: "2027-03-05", to: "2027-03-06" }] });
        assert.equal(ok(r, sat10), false);
        assert.equal(ok(r, tue18), true);
    });

    test("start-time limits are inclusive; an invalid time is no rule", () => {
        assert.equal(ok(rule("no_start_after", { time: "18:00" }), tue18), true);
        assert.equal(ok(rule("no_start_after", { time: "17:59" }), tue18), false);
        assert.equal(ok(rule("no_start_before", { time: "10:00" }), sat10), true);
        assert.equal(ok(rule("no_start_before", { time: "10:01" }), sat10), false);
        assert.equal(compileStatic(rule("no_start_after", { time: "late" }), live), null);
    });

    test("locations: only/avoid; an 'only' list of deleted locations restricts nothing", () => {
        assert.equal(ok(rule("only_locations", { locationIds: ["l1"] }), sat10), true);
        assert.equal(ok(rule("only_locations", { locationIds: ["l1"] }), tue18), false);
        assert.equal(ok(rule("only_locations", { locationIds: ["deleted"] }), tue18), true);
        assert.equal(ok(rule("only_locations", { locationIds: ["deleted", "l1"] }), tue18), false);
        assert.equal(ok(rule("avoid_locations", { locationIds: ["l1"] }), sat10), false);
        assert.equal(ok(rule("avoid_locations", { locationIds: ["l1"] }), tue18), true);
    });
});

describe("small helpers", () => {
    test("teamTarget: team override, else bracket, floored and never negative", () => {
        assert.equal(teamTarget(team("a"), bracket("b", { matches: 5 })), 5);
        assert.equal(teamTarget(team("a", { matches: 3 }), bracket("b", { matches: 5 })), 3);
        assert.equal(teamTarget(team("a", { matches: 0 }), bracket("b", { matches: 5 })), 0, "0 is an override, not 'use the bracket'");
        assert.equal(teamTarget(team("a"), undefined), 0);
        assert.equal(teamTarget(team("a", { matches: -2 }), bracket()), 0);
        assert.equal(teamTarget(team("a", { matches: 2.9 }), bracket()), 2);
    });

    test("poolKey: bracket + trimmed, case-insensitive pool", () => {
        assert.equal(poolKey("b", " Pool A "), poolKey("b", "pool a"));
        assert.notEqual(poolKey("b", "A"), poolKey("c", "A"));
        assert.notEqual(poolKey("b", ""), poolKey("b", "A"));
    });

    test("makeLookup names teams, locations and units, and carries the sport", () => {
        const l = league({ settings: { sport: "soccer" }, locations: [location("l", { name: "Park", units: [{ id: "u1", name: "Field 1" }] })], teams: [team("a", { name: "Ants" })] });
        const lk = makeLookup(l);
        assert.deepEqual([lk.team("a"), lk.location("l"), lk.unit!("u1"), lk.team("zz")], ["Ants", "Park", "Field 1", undefined]);
        assert.equal(lk.terms, SPORTS.soccer);
    });

    test("mulberry32 is deterministic and in [0, 1)", () => {
        const a = mulberry32(42);
        const b = mulberry32(42);
        const xs = Array.from({ length: 1000 }, () => a());
        assert.deepEqual(xs, Array.from({ length: 1000 }, () => b()));
        assert.ok(xs.every((x) => x >= 0 && x < 1));
        assert.notDeepEqual(xs.slice(0, 5), Array.from({ length: 5 }, mulberry32(43)));
    });

    test("sortMatches: placed first by date, time, id; unplaced last; input untouched", () => {
        const ms = [
            match("z", "a", "b"),
            match("b", "a", "b", { date: "2027-03-06", time: "11:00" }),
            match("a", "a", "b", { date: "2027-03-06", time: "11:00" }),
            match("c", "a", "b", { date: "2027-03-01", time: "18:00" }),
            match("y", "a", "b"),
        ];
        assert.deepEqual(sortMatches(ms).map((m) => m.id), ["c", "a", "b", "y", "z"]);
        assert.equal(ms[0].id, "z");
    });

    test("unitShortText in each sport's words", () => {
        assert.equal(unitShortText(SPORTS.tennis, 0, 1, true), "No court assigned");
        assert.equal(unitShortText(SPORTS.hockey, 0, 1, false), "No sheet assigned: every sheet is booked at that time");
        assert.equal(unitShortText(SPORTS.soccer, 1, 2, true), "Only 1 of 2 fields assigned");
        assert.equal(unitShortText(SPORTS.soccer, 1, 3, false), "Only 1 of 3 fields assigned: every field is booked at that time");
    });

    test("unitInputsChanged compares the unit-relevant parts by reference", () => {
        const a = league();
        assert.equal(unitInputsChanged(a, { ...a, teams: [] }), false);
        assert.equal(unitInputsChanged(a, { ...a, brackets: [] }), false);
        for (const k of ["locations", "slots", "availability"] as const) assert.equal(unitInputsChanged(a, { ...a, [k]: [...a[k]] }), true, k);
        assert.equal(unitInputsChanged(a, { ...a, settings: { ...a.settings } }), true);
    });
});

describe("spotForMatch", () => {
    const l = league({ slots: [slot("s", 6, "10:00")] });
    const ctx = prepare(l);

    test("unplaced or malformed matches have no spot", () => {
        assert.equal(spotForMatch(ctx, match("m", "a", "b")), null);
        assert.equal(spotForMatch(ctx, match("m", "a", "b", { date: "2027-03-06", time: "10am" })), null);
    });

    test("found by slot id, or by date+time+location when the slot id changed (a re-import)", () => {
        const bySlot = spotForMatch(ctx, match("m", "a", "b", { date: "2027-03-06", time: "10:00", slotId: "s", locationId: "l" }))!;
        const byTime = spotForMatch(ctx, match("m", "a", "b", { date: "2027-03-06", time: "10:00", slotId: "old-id", locationId: "l" }))!;
        assert.ok(bySlot.idx >= 0);
        assert.equal(byTime.idx, bySlot.idx);
    });

    test("a time no longer in the season keeps its date and time with idx -1", () => {
        const s = spotForMatch(ctx, match("m", "a", "b", { date: "2027-03-09", time: "18:00", slotId: "gone", locationId: "l" }))!;
        assert.deepEqual([s.idx, s.date, s.time, s.day, s.minutes], [-1, "2027-03-09", "18:00", isoToDay("2027-03-09"), 1080]);
        const moved = spotForMatch(ctx, match("m", "a", "b", { date: "2027-03-06", time: "12:00", slotId: "s", locationId: "l" }))!;
        assert.equal(moved.idx, -1, "same slot id but a different time is not that slot");
    });
});
