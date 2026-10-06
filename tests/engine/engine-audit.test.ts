import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { audit, type Verdict } from "../../lib/engine/engine.ts";
import type { League, Match, Rule } from "../../lib/engine/types.ts";
import { bracket, league, location, match, rule, slot, team } from "../support/fixtures.ts";

/**
 * Every message audit() can produce, each from the smallest hand-edited
 * schedule that triggers it, with its hard/soft class. A hand move may break
 * a must-rule, but it must SAY so (hard), and a preference miss must be soft.
 *
 * League: Saturday 2027-03-06 and Sunday 2027-03-07; "Hall" (l) with Court 1-3,
 * 10:00 (u1,u2 free), 10:30 and 14:00 unnamed (capacity 1); pools 1 (A v Z) and
 * 2 (C v D).
 */
function base(over: { rulesA?: Rule[]; rulesC?: Rule[]; settings?: Partial<League["settings"]>; bracket?: Partial<League["brackets"][number]> } = {}): League {
    return league({
        settings: { seasonStart: "2027-03-06", seasonEnd: "2027-03-07", ...over.settings },
        brackets: [bracket("b", { matches: 2, ...over.bracket })],
        locations: [location("l", { name: "Hall", units: [{ id: "u1", name: "Court 1" }, { id: "u2", name: "Court 2" }, { id: "u3", name: "Court 3" }] })],
        slots: [
            slot("s10", 6, "10:00", { unitIds: ["u1", "u2"] }),
            slot("s1030", 6, "10:30", { capacity: 1 }),
            slot("s14", 6, "14:00", { capacity: 1 }),
            slot("u10", 0, "10:00", { capacity: 2 }),
        ],
        teams: [team("a", { pool: "1", club: "North", rules: over.rulesA ?? [] }), team("z", { pool: "1" }), team("c", { pool: "2", club: "north", rules: over.rulesC ?? [] }), team("d", { pool: "2" })],
    });
}
const sat = (time: string, slotId: string, over: Partial<Match> = {}) => ({ date: "2027-03-06", time, slotId, locationId: "l", ...over });
const sun = (over: Partial<Match> = {}) => ({ date: "2027-03-07", time: "10:00", slotId: "u10", locationId: "l", ...over });
const issue = (l: League, ms: Match[], id: string): Verdict => audit(l, ms).issues.get(id) ?? { hard: [], soft: [] };

describe("audit: a clean schedule", () => {
    test("has no issues at all", () => {
        const l = base();
        const ms = [match("m1", "a", "z", sat("10:00", "s10", { unitIds: ["u1"] })), match("m2", "c", "d", sat("10:00", "s10", { unitIds: ["u2"] })), match("m3", "z", "a", sun())];
        assert.equal(audit(l, ms).issues.size, 0);
    });

    test("does not mutate the matches it is given", () => {
        const ms = [match("m1", "a", "z", sat("10:30", "s1030")), match("m2", "c", "d", sat("10:30", "s1030"))];
        const copy = structuredClone(ms);
        audit(base(), ms);
        assert.deepEqual(ms, copy);
    });

    test("unplaced matches are not issues (they carry their own note)", () => {
        assert.equal(audit(base(), [match("m1", "a", "z")]).issues.size, 0);
    });
});

describe("audit: hard (must) problems", () => {
    test("capacity: both games at a full time are flagged", () => {
        const l = base();
        const ms = [match("m1", "a", "z", sat("10:30", "s1030")), match("m2", "c", "d", sat("10:30", "s1030"))];
        for (const id of ["m1", "m2"]) assert.deepEqual(issue(l, ms, id).hard, ["Every court is already booked at that time"]);
    });

    test("bracket limits: window, days and 'Open to'", () => {
        assert.deepEqual(issue(base({ bracket: { earliest: "11:00" } }), [match("m", "a", "z", sat("10:30", "s1030"))], "m").hard, ["B can’t start before 11:00 AM"]);
        assert.deepEqual(issue(base({ bracket: { latest: "12:00" } }), [match("m", "a", "z", sat("14:00", "s14"))], "m").hard, ["B can’t start after 12:00 PM"]);
        assert.deepEqual(issue(base({ bracket: { days: [0] } }), [match("m", "a", "z", sat("14:00", "s14"))], "m").hard, ["B doesn’t play on Saturdays"]);
        const l = base();
        l.slots = l.slots.map((s) => (s.id === "s14" ? { ...s, bracketIds: ["other"] } : s));
        assert.deepEqual(issue(l, [match("m", "a", "z", sat("14:00", "s14"))], "m").hard, ["This time slot isn’t open to B"]);
    });

    test("a team's static must-rule (as hard), and the same rule as prefer (as soft)", () => {
        const ms = [match("m", "a", "z", sat("14:00", "s14"))];
        assert.deepEqual(issue(base({ rulesA: [rule("no_days", { days: [6] })] }), ms, "m"), { hard: ["A: Not on Saturdays"], soft: [] });
        assert.deepEqual(issue(base({ rulesA: [rule("no_days", { days: [6] }, "prefer")] }), ms, "m"), { hard: [], soft: ["A: Not on Saturdays"] });
    });

    test("two games for one team in a day (maxPerDay 1)", () => {
        const ms = [match("m1", "a", "z", sat("10:30", "s1030")), match("m2", "z", "a", sat("14:00", "s14"))];
        const v = issue(base(), ms, "m1");
        assert.deepEqual(v.hard, ["A already plays that day", "Z already plays that day"]);
    });

    test("overlapping games for one team (maxPerDay 2)", () => {
        const l = base({ settings: { maxPerDay: 2 } });
        const ms = [match("m1", "a", "z", sat("10:00", "s10", { unitIds: ["u1"] })), match("m2", "a", "z", sat("10:30", "s1030"))];
        assert.deepEqual(issue(l, ms, "m2").hard, ["A is already playing at that time", "Z is already playing at that time"]);
        const apart = [match("m1", "a", "z", sat("10:00", "s10", { unitIds: ["u1"] })), match("m2", "a", "z", sat("14:00", "s14"))];
        assert.equal(audit(l, apart).issues.size, 0, "90+ minutes apart is fine with maxPerDay 2");
    });

    test("a dynamic must-rule (max per weekend) flags every game over the limit", () => {
        const l = base({ rulesA: [rule("max_per_weekend", { n: 1 })] });
        const ms = [match("m1", "a", "z", sat("14:00", "s14")), match("m2", "z", "a", sun())];
        for (const id of ["m1", "m2"]) assert.deepEqual(issue(l, ms, id).hard, ["A: At most 1 match per weekend"]);
    });

    test("not at the same time / not on the same day, flagged from both teams' side", () => {
        const sameTime = base({ rulesA: [rule("not_same_time", { teamIds: ["c"] })], settings: { clubLimit: null } });
        const ms = [match("m1", "a", "z", sat("10:00", "s10", { unitIds: ["u1"] })), match("m2", "c", "d", sat("10:30", "s1030"))];
        assert.deepEqual(issue(sameTime, ms, "m1").hard, ["A: not at the same time as C"]);
        assert.deepEqual(issue(sameTime, ms, "m2").hard, ["C: not at the same time as A"]);
        const sameDay = base({ rulesC: [rule("not_same_day", { teamIds: ["a"] }, "prefer")] });
        const ms2 = [match("m1", "a", "z", sat("10:00", "s10", { unitIds: ["u1"] })), match("m2", "c", "d", sat("14:00", "s14"))];
        assert.deepEqual(issue(sameDay, ms2, "m1"), { hard: [], soft: ["A: not on the same day as C"] });
        assert.deepEqual(issue(sameDay, ms2, "m2"), { hard: [], soft: ["C: not on the same day as A"] });
    });

    test("club limit: must = hard, prefer = soft, named as the club is written on the team", () => {
        const ms = [match("m1", "a", "z", sat("10:00", "s10", { unitIds: ["u1"] })), match("m2", "c", "d", sat("10:00", "s10", { unitIds: ["u2"] }))];
        assert.deepEqual(issue(base({ settings: { clubLimit: 1, clubLimitMode: "must" } }), ms, "m1").hard, ["More than 1 North match at the same time"]);
        assert.deepEqual(issue(base({ settings: { clubLimit: 1, clubLimitMode: "must" } }), ms, "m2").hard, ["More than 1 north match at the same time"]);
        assert.deepEqual(issue(base({ settings: { clubLimit: 1, clubLimitMode: "prefer" } }), ms, "m1"), { hard: [], soft: ["More than 1 North match at the same time"] });
        assert.equal(audit(base({ settings: { clubLimit: 2, clubLimitMode: "must" } }), ms).issues.size, 0);
    });

    test("a deleted team", () => {
        assert.deepEqual(issue(base(), [match("m", "a", "ghost", sat("14:00", "s14"))], "m"), { hard: ["One of these teams has been deleted"], soft: [] });
    });

    test("a deleted location", () => {
        const v = issue(base(), [match("m", "a", "z", { date: "2027-03-06", time: "14:00", slotId: "s-x", locationId: "gone" })], "m");
        assert.deepEqual(v.hard, ["Its location was deleted"]);
    });

    test("a date the facility's sheet covers, at an hour it doesn't list (or closes)", () => {
        const l = base({ settings: { sport: "hockey" } });
        l.availability = [{ id: "a1", date: "2027-03-06", time: "09:00", locationId: "l", courts: 2, unitIds: [], bracketIds: [] }];
        assert.deepEqual(issue(l, [match("m", "a", "z", sat("14:00", "s14"))], "m").hard, ["The facility’s spreadsheet has no ice time then"]);
    });

    test("double-booked unit (named; and unnamed when the unit is unknown)", () => {
        const l = base();
        const ms = [match("m1", "a", "z", sat("10:00", "s10", { unitIds: ["u1"] })), match("m2", "c", "d", sat("10:00", "s10", { unitIds: ["u1"] }))];
        for (const id of ["m1", "m2"]) assert.deepEqual(issue(l, ms, id).hard, ["Court 1 has two matches at once"]);
        const ghost = [match("m1", "a", "z", sat("10:00", "s10", { unitIds: ["zz"] })), match("m2", "c", "d", sat("10:00", "s10", { unitIds: ["zz"] }))];
        assert.deepEqual(issue(l, ghost, "m1"), { hard: ["A court has two matches at once"], soft: ["That court isn’t listed as free at that time"] });
    });
});

describe("audit: soft problems", () => {
    test("a time no longer in the weekly slots (and not covered by a sheet)", () => {
        const v = issue(base(), [match("m", "a", "z", { date: "2027-03-06", time: "18:00", slotId: "gone", locationId: "l" })], "m");
        assert.deepEqual(v, { hard: [], soft: ["This time is no longer in the weekly slots or the facility’s availability"] });
    });

    test("a unit that isn't free at that time", () => {
        const v = issue(base(), [match("m", "a", "z", sat("10:00", "s10", { unitIds: ["u3"] }))], "m");
        assert.deepEqual(v, { hard: [], soft: ["Court 3 isn’t listed as free at that time"] });
    });

    test("no unit assigned, with or without a free one", () => {
        const l = base();
        assert.deepEqual(issue(l, [match("m", "a", "z", sat("10:00", "s10"))], "m"), { hard: [], soft: ["No court assigned"] });
        const full = [match("m1", "a", "z", sat("10:00", "s10")), match("m2", "c", "d", sat("10:00", "s10", { unitIds: ["u1"] })), match("m3", "a", "z", sat("10:00", "s10", { unitIds: ["u2"], date: "2027-03-06" }))];
        // m1 has no unit and both of the time's units are held by others.
        assert.ok(issue(l, full, "m1").soft.includes("No court assigned: every court is booked at that time"));
    });

    test("short of units when a game uses several (courtsPerMatch 2)", () => {
        const l = base({ settings: { courtsPerMatch: 2 } });
        l.slots = l.slots.map((s) => (s.id === "s10" ? { ...s, unitIds: ["u1", "u2", "u3"] } : s));
        assert.deepEqual(issue(l, [match("m", "a", "z", sat("10:00", "s10", { unitIds: ["u1"] }))], "m").soft, ["Only 1 of 2 courts assigned"]);
        const busy = [match("m", "a", "z", sat("10:00", "s10", { unitIds: ["u1"] })), match("n", "c", "d", sat("10:00", "s10", { unitIds: ["u2", "u3"] }))];
        assert.ok(issue(l, busy, "m").soft.includes("Only 1 of 2 courts assigned: every court is booked at that time"));
    });

    test("a game already flagged for a unit that isn't free isn't also told it's short", () => {
        const v = issue(base(), [match("m", "a", "z", sat("10:00", "s10", { unitIds: ["u3"] }))], "m");
        assert.ok(!v.soft.some((s) => s.includes("assigned")));
    });

    test("no unit messages at a time without named units", () => {
        assert.equal(audit(base(), [match("m", "a", "z", sat("14:00", "s14"))]).issues.size, 0);
    });
});

describe("audit: words follow the sport", () => {
    test("hockey says sheet / games", () => {
        const l = base({ settings: { sport: "hockey" } });
        l.locations[0].units = [{ id: "u1", name: "Sheet A" }, { id: "u2", name: "Sheet B" }, { id: "u3", name: "Sheet C" }];
        const ms = [match("m1", "a", "z", sat("10:00", "s10", { unitIds: ["u1"] })), match("m2", "c", "d", sat("10:00", "s10", { unitIds: ["u1"] }))];
        assert.deepEqual(issue(l, ms, "m1").hard, ["Sheet A has two games at once"]);
        assert.deepEqual(issue(l, [match("m", "a", "z", sat("10:00", "s10"))], "m").soft, ["No sheet assigned"]);
        const cap = [match("m1", "a", "z", sat("14:00", "s14")), match("m2", "c", "d", sat("14:00", "s14"))];
        assert.deepEqual(issue(l, cap, "m1").hard, ["Every sheet is already booked at that time"]);
    });
});
