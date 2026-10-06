import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { assignUnits, audit, moveOptions, reassignUnitsAfterEdit } from "../../lib/engine/engine.ts";
import type { League, Match } from "../../lib/engine/types.ts";
import { bracket, league, location, match, rule, slot, team } from "../support/fixtures.ts";

const COURTS = ["u1", "u2", "u3", "u4"].map((id, i) => ({ id, name: `Court ${i + 1}` }));

/** One Saturday (2027-03-06) at "Hall": 10:00 with u1-u3 free, 13:00 with u1-u4, 15:00 an unnamed slot. */
function hall(over: Partial<League> = {}): League {
    return league({
        settings: { seasonStart: "2027-03-06", seasonEnd: "2027-03-06" },
        locations: [location("l", { name: "Hall", units: COURTS })],
        slots: [slot("s10", 6, "10:00", { unitIds: ["u1", "u2", "u3"] }), slot("s13", 6, "13:00", { unitIds: ["u1", "u2", "u3", "u4"] }), slot("s15", 6, "15:00", { capacity: 2 })],
        brackets: [bracket("b", { matches: 1 })],
        teams: ["a", "c", "d", "e", "f", "g", "h", "i"].map((id) => team(id, { pool: id < "e" ? "1" : "2" })),
        ...over,
    });
}
const at = (time: "10:00" | "13:00" | "15:00", over: Partial<Match> = {}): Partial<Match> => ({ date: "2027-03-06", time, slotId: `s${time.slice(0, 2)}`, locationId: "l", ...over });
const units = (ms: Match[]) => Object.fromEntries(ms.map((m) => [m.id, m.unitIds ?? null]));

describe("assignUnits", () => {
    test("each placed game gets a unit, in the facility's order", () => {
        const ms = [match("m1", "a", "c", at("10:00")), match("m2", "d", "e", at("10:00")), match("m3", "f", "g", at("10:00"))];
        assert.deepEqual(units(assignUnits(hall(), ms)), { m1: ["u1"], m2: ["u2"], m3: ["u3"] });
    });

    test("stable: a game that already holds a valid, free unit keeps it", () => {
        const ms = [match("m1", "a", "c", at("10:00", { unitIds: ["u3"] })), match("m2", "d", "e", at("10:00")), match("m3", "f", "g", at("10:00"))];
        const out = assignUnits(hall(), ms);
        assert.deepEqual(units(out), { m1: ["u3"], m2: ["u1"], m3: ["u2"] });
        assert.equal(out[0], ms[0], "an unchanged game is the same object");
    });

    test("locked games keep their unit first; an unlocked game on the same unit moves", () => {
        const ms = [match("m1", "a", "c", at("10:00", { unitIds: ["u1"] })), match("m2", "d", "e", at("10:00", { unitIds: ["u1"], locked: true }))];
        assert.deepEqual(units(assignUnits(hall(), ms)), { m1: ["u2"], m2: ["u1"] });
    });

    test("never double-books, and a unit not free at that time is replaced", () => {
        const ms = [match("m1", "a", "c", at("10:00", { unitIds: ["u4"] })), match("m2", "d", "e", at("10:00", { unitIds: ["u2"] })), match("m3", "f", "g", at("10:00", { unitIds: ["u2"] }))];
        const out = assignUnits(hall(), ms);
        const all = out.flatMap((m) => m.unitIds ?? []);
        assert.equal(new Set(all).size, all.length);
        assert.ok(all.every((u) => ["u1", "u2", "u3"].includes(u)));
        assert.deepEqual(out[1].unitIds, ["u2"], "the first valid claim (by id) keeps it");
    });

    test("over capacity: the extra game ends up with no unit (the audit flags it)", () => {
        const ms = ["m1", "m2", "m3", "m4"].map((id, i) => match(id, ["a", "d", "f", "h"][i], ["c", "e", "g", "i"][i], at("10:00", id === "m4" ? { unitIds: ["u1"] } : {})));
        const out = assignUnits(hall(), ms);
        assert.equal(out.filter((m) => m.unitIds?.length === 1).length, 3);
        assert.equal(out.filter((m) => !m.unitIds).length, 1);
    });

    test("several units per game (courtsPerMatch 2): each game holds 2; a half assignment is redone", () => {
        const l = hall({ settings: { ...hall().settings, courtsPerMatch: 2 } });
        const ms = [match("m1", "a", "c", at("13:00", { unitIds: ["u4"] })), match("m2", "d", "e", at("13:00"))];
        const out = assignUnits(l, ms);
        assert.deepEqual(units(out), { m1: ["u1", "u2"], m2: ["u3", "u4"] });
    });

    test("a time with no named units clears the field; an unplaced game drops its units", () => {
        const ms = [match("m1", "a", "c", at("15:00", { unitIds: ["u1"] })), match("m2", "d", "e", { unitIds: ["u1"] })];
        const out = assignUnits(hall(), ms);
        assert.ok(!("unitIds" in out[0]) && !("unitIds" in out[1]));
    });

    test("games whose teams are gone, or whose time no longer exists, are passed through untouched", () => {
        const ghost = match("m1", "ghost", "c", at("10:00", { unitIds: ["u9"] }));
        const lost = match("m2", "a", "c", { date: "2027-03-06", time: "18:00", slotId: "nope", locationId: "l", unitIds: ["u1"] });
        const out = assignUnits(hall(), [ghost, lost]);
        assert.equal(out[0], ghost);
        assert.equal(out[1], lost);
    });

    test("order of the input is preserved and the input is not mutated", () => {
        const ms = [match("z", "a", "c", at("10:00")), match("a", "d", "e", at("10:00"))];
        const copy = structuredClone(ms);
        const out = assignUnits(hall(), ms);
        assert.deepEqual(out.map((m) => m.id), ["z", "a"]);
        assert.deepEqual(ms, copy);
    });
});

describe("reassignUnitsAfterEdit", () => {
    const placedMs = () => assignUnits(hall(), [match("m1", "a", "c", at("10:00")), match("m2", "d", "e", at("10:00"))]);

    test("an edit that can't affect units returns the SAME array (no churn)", () => {
        const l = hall();
        const ms = placedMs();
        assert.equal(reassignUnitsAfterEdit(l, { ...l, teams: [...l.teams] }, ms), ms);
        assert.equal(reassignUnitsAfterEdit(l, { ...l, brackets: [...l.brackets] }, ms), ms);
    });

    test("a unit-relevant edit where nothing moves also returns the same array", () => {
        const l = hall();
        const ms = placedMs();
        assert.equal(reassignUnitsAfterEdit(l, { ...l, slots: [...l.slots] }, ms), ms);
    });

    test("a removed unit: its game moves to a free one at once; others keep theirs", () => {
        const l = hall();
        const ms = placedMs();
        assert.deepEqual(units(ms), { m1: ["u1"], m2: ["u2"] });
        const edited: League = { ...l, slots: l.slots.map((s) => (s.id === "s10" ? { ...s, unitIds: ["u2", "u3"] } : s)) };
        const out = reassignUnitsAfterEdit(l, edited, ms);
        assert.notEqual(out, ms);
        assert.deepEqual(units(out), { m1: ["u3"], m2: ["u2"] });
        assert.equal(out[1], ms[1]);
    });
});

describe("moveOptions", () => {
    test("an unknown match id gives no options", () => {
        assert.deepEqual(moveOptions(hall(), [], "nope"), []);
    });

    test("one option per time in the season, judged with every other game in place", () => {
        const l = hall();
        const ms = assignUnits(l, [match("m1", "a", "c", at("10:00")), match("m2", "d", "e", at("10:00")), match("m3", "f", "g", at("10:00")), match("x", "h", "i", at("13:00"))]);
        const opts = moveOptions(l, ms, "x");
        assert.equal(opts.length, 3);
        const [o10, o13, o15] = opts;
        assert.equal(o10.used, 3);
        assert.deepEqual(o10.verdict.hard, ["Every court is already booked at that time"]);
        assert.deepEqual(o10.freeUnits, []);
        assert.equal(o13.used, 0, "the game being moved doesn't count against its own time");
        assert.deepEqual(o13.freeUnits, ["u1", "u2", "u3", "u4"], "its own units count as free");
        assert.deepEqual(o13.verdict, { hard: [], soft: [] });
        assert.deepEqual(o15.freeUnits, [], "an unnamed time has no units to offer");
        assert.deepEqual(o15.verdict, { hard: [], soft: [] });
    });

    test("rule breaks are listed in full (hard and soft), for hand moves", () => {
        const l = hall();
        l.teams = l.teams.map((t) => (t.id === "h" ? { ...t, rules: [rule("no_start_before", { time: "12:00" }), rule("no_start_after", { time: "14:00" }, "prefer")] } : t));
        const ms = [match("x", "h", "i", at("13:00"))];
        const [o10, o13, o15] = moveOptions(l, ms, "x");
        assert.deepEqual(o10.verdict.hard, ["H: Start no earlier than 12:00 PM"]);
        assert.deepEqual(o13.verdict, { hard: [], soft: [] });
        assert.deepEqual(o15.verdict, { hard: [], soft: ["H: Start no later than 2:00 PM"] });
    });

    test("another game of the same team that day shows up as a hard reason", () => {
        const l = hall({ brackets: [bracket("b", { matches: 2 })] });
        const ms = [match("x", "a", "c", at("10:00")), match("y", "a", "d", at("15:00"))];
        const o = moveOptions(l, ms, "x").find((x) => x.inst.time === "13:00")!;
        assert.deepEqual(o.verdict.hard, ["A already plays that day"]);
    });
});

describe("audit summary", () => {
    test("usage per time and per-team counts (target, placed, unplaced, weekend, home)", () => {
        const l = hall({ brackets: [bracket("b", { matches: 2 })] });
        const ms = assignUnits(l, [match("m1", "a", "c", at("10:00")), match("m2", "d", "a", at("13:00")), match("m3", "c", "d")]);
        const a = audit(l, ms);
        assert.deepEqual(a.usage, [1, 1, 0]);
        assert.deepEqual(a.teams.get("a"), { teamId: "a", target: 2, placed: 2, unplaced: 0, weekendMatches: 2, homeMatches: 1 });
        assert.deepEqual(a.teams.get("d"), { teamId: "d", target: 2, placed: 1, unplaced: 1, weekendMatches: 1, homeMatches: 1 });
        assert.deepEqual(a.teams.get("c"), { teamId: "c", target: 2, placed: 1, unplaced: 1, weekendMatches: 1, homeMatches: 1 });
    });
});
