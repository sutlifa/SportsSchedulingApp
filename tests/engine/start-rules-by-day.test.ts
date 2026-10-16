// "Can't start later than 8 PM on Saturdays, 7 PM on Sundays": start-time
// rules limited to some days of the week (an organiser couldn't express a
// different latest start per day). One rule per day; no days = every day.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { audit, compileStatic, generate, type Instance } from "../../lib/engine/engine.ts";
import { dowOf, isoToDay, toMinutes } from "../../lib/engine/dates.ts";
import { describeRule } from "../../lib/engine/rules.ts";
import { sampleLeague } from "../../lib/engine/sample.ts";
import { sanitizeRule } from "../../lib/engine/sanitize.ts";
import type { DayOfWeek, Rule } from "../../lib/engine/types.ts";

const lookup = { team: () => undefined, location: () => undefined };
const inst = (iso: string, time: string) => ({ day: isoToDay(iso), minutes: toMinutes(time) }) as Instance;
// 2027-03-06 is a Saturday, 03-07 a Sunday, 03-05 a Friday.
const SAT = "2027-03-06";
const SUN = "2027-03-07";
const FRI = "2027-03-05";

describe("start-time rules limited to days", () => {
    test("wording names the days; no days reads as before", () => {
        assert.equal(describeRule({ id: "a", mode: "must", type: "no_start_after", time: "20:00", days: [6] }, lookup), "Start no later than 8:00 PM on Saturdays");
        assert.equal(describeRule({ id: "a", mode: "must", type: "no_start_before", time: "10:00", days: [0, 6] }, lookup), "Start no earlier than 10:00 AM on Saturdays and Sundays");
        assert.equal(describeRule({ id: "a", mode: "must", type: "no_start_after", time: "18:00" }, lookup), "Start no later than 6:00 PM");
        assert.equal(describeRule({ id: "a", mode: "must", type: "no_start_after", time: "18:00", days: [] }, lookup), "Start no later than 6:00 PM");
    });

    test("sanitize keeps valid days, drops bad ones, and leaves old rules byte-identical", () => {
        assert.deepEqual(sanitizeRule({ id: "a", mode: "must", type: "no_start_after", time: "20:00", days: [6, 6, 9, "x"] }), { id: "a", mode: "must", type: "no_start_after", time: "20:00", days: [6] });
        assert.deepEqual(sanitizeRule({ id: "a", mode: "must", type: "no_start_after", time: "20:00" }), { id: "a", mode: "must", type: "no_start_after", time: "20:00" });
        assert.deepEqual(sanitizeRule({ id: "a", mode: "must", type: "no_start_after", time: "20:00", days: [] }), { id: "a", mode: "must", type: "no_start_after", time: "20:00" });
    });

    test("the generator's own test: only the chosen days are limited", () => {
        const sat = compileStatic({ id: "a", mode: "must", type: "no_start_after", time: "20:00", days: [6] }, new Set())!;
        const sun = compileStatic({ id: "b", mode: "must", type: "no_start_after", time: "19:00", days: [0] }, new Set())!;
        assert.equal(sat(inst(SAT, "20:00")), true);
        assert.equal(sat(inst(SAT, "20:30")), false);
        assert.equal(sat(inst(FRI, "21:00")), true, "Friday isn't limited by a Saturday rule");
        assert.equal(sun(inst(SUN, "19:00")), true);
        assert.equal(sun(inst(SUN, "19:30")), false);
        assert.equal(sun(inst(SAT, "20:00")), true, "Saturday isn't limited by a Sunday rule");
        const before = compileStatic({ id: "c", mode: "must", type: "no_start_before", time: "12:00", days: [0] }, new Set())!;
        assert.equal(before(inst(SUN, "11:00")), false);
        assert.equal(before(inst(SAT, "09:00")), true);
    });

    test("generate honours a different latest start on Saturday and Sunday", () => {
        const league = structuredClone(sampleLeague("tennis"));
        // Late weekend times so the limits actually bite.
        league.slots.push(
            { id: "late-sat", day: 6 as DayOfWeek, time: "20:30", locationId: league.locations[0].id, capacity: 3, unitIds: league.locations[0].units.map((u) => u.id), bracketIds: [] },
            { id: "late-sun", day: 0 as DayOfWeek, time: "19:30", locationId: league.locations[0].id, capacity: 3, unitIds: league.locations[0].units.map((u) => u.id), bracketIds: [] },
        );
        const rules: Rule[] = [
            { id: "sat", mode: "must", type: "no_start_after", time: "20:00", days: [6] },
            { id: "sun", mode: "must", type: "no_start_after", time: "19:00", days: [0] },
        ];
        for (const t of league.teams) t.rules = [...t.rules, ...rules];
        const r = generate(league, [], { scope: "all", seed: 3, maxAttempts: 5, timeBudgetMs: 1e9, now: () => 0 });
        for (const m of r.matches.filter((x) => x.date && x.time)) {
            const dow = dowOf(isoToDay(m.date!));
            if (dow === 6) assert.ok(toMinutes(m.time!) <= toMinutes("20:00"), `Saturday ${m.time}`);
            if (dow === 0) assert.ok(toMinutes(m.time!) <= toMinutes("19:00"), `Sunday ${m.time}`);
        }
        const a = audit(league, r.matches);
        assert.ok([...a.issues.values()].every((v) => v.hard.length === 0), "no must-rule broken");
    });
});
