import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { adviceFor, type AdviceTab } from "../../lib/engine/advice.ts";
import { audit, unitShortText } from "../../lib/engine/engine.ts";
import { describeRule, newRule, RULE_ORDER } from "../../lib/engine/rules.ts";
import { sampleLeague } from "../../lib/engine/sample.ts";
import { SPORT_IDS, SPORTS } from "../../lib/engine/sports.ts";
import type { Rule } from "../../lib/engine/types.ts";
import { run } from "../support/fixtures.ts";

const TABS: AdviceTab[] = ["courts", "brackets", "teams", "season"];

/**
 * Every message the engine (check / audit / generate) and describeRule can
 * produce, written with the sport's words exactly as engine.ts builds them,
 * paired with the tab its fix lives on. Team-rule messages use the sample
 * league's first team, as the engine prefixes them.
 */
function catalogue(sport: (typeof SPORT_IDS)[number]): [string, AdviceTab][] {
    const t = SPORTS[sport];
    const l = sampleLeague(sport);
    const team = l.teams[0].name;
    const other = l.teams[1].name;
    const lookup = { team: (id: string) => l.teams.find((x) => x.id === id)?.name, location: (id: string) => l.locations.find((x) => x.id === id)?.name, terms: t };
    const ruleMsgs: [string, AdviceTab][] = RULE_ORDER.filter((type) => type !== "not_same_time" && type !== "not_same_day").map((type) => {
        const rule = { ...newRule(type, "x"), ...(type.includes("location") ? { locationIds: ["loc-center"] } : {}), ...(type.endsWith("days") ? { days: [6] } : {}) } as Rule;
        return [`${team}: ${describeRule(rule, lookup)}`, "teams"];
    });
    return [
        [`Every ${t.unit} is already booked at that time`, "courts"],
        [unitShortText(t, 0, 1, true), "courts"],
        [unitShortText(t, 0, 1, false), "courts"],
        [unitShortText(t, 1, 2, true), "courts"],
        [unitShortText(t, 1, 3, false), "courts"],
        [`${t.unitLabel(0)} has two ${t.matches} at once`, "courts"],
        [`A ${t.unit} has two ${t.matches} at once`, "courts"],
        [`${t.unitLabel(1)} isn’t listed as free at that time`, "courts"],
        [`That ${t.unit} isn’t listed as free at that time`, "courts"],
        ["This time slot isn’t open to 10U", "courts"],
        ["10U can’t start before 9:00 AM", "brackets"],
        ["12U can’t start after 6:30 PM", "brackets"],
        ["14U doesn’t play on Saturdays", "brackets"],
        [`${team} already plays that day`, "season"],
        [`${team} is already playing at that time`, "season"],
        [`More than 1 Northside ${t.match} at the same time`, "season"],
        [`More than 2 Northside ${t.matches} at the same time`, "season"],
        ["Its location was deleted", "courts"],
        [`The facility’s spreadsheet has no ${t.time} then`, "courts"],
        ["This time is no longer in the weekly slots or the facility’s availability", "courts"],
        ["There are no time slots in the season to put it in.", "courts"],
        ["One of these teams has been deleted", "teams"],
        [`${team}: not at the same time as ${other}`, "teams"],
        [`${team}: not on the same day as ${other}`, "teams"],
        ...ruleMsgs,
    ];
}

describe("adviceFor", () => {
    for (const sport of SPORT_IDS) {
        test(`every engine message has specific advice on the right tab (${sport})`, () => {
            const l = sampleLeague(sport);
            for (const [reason, tab] of catalogue(sport)) {
                const a = adviceFor(reason, l);
                assert.equal(a.tab, tab, reason);
                assert.ok(a.tip.length > 10, reason);
            }
        });

        test(`tips speak the sport and never say "unit" (${sport})`, () => {
            const l = sampleLeague(sport);
            const t = SPORTS[sport];
            for (const [reason] of catalogue(sport)) {
                const tip = adviceFor(reason, l).tip;
                assert.doesNotMatch(tip, /\bunits?\b/, tip);
                if (t.match === "game") assert.doesNotMatch(tip.replace(/“[^”]*”/g, ""), /\bmatch(es)?\b/, `${reason} -> ${tip}`);
            }
        });

        test(`tab labels name the real tabs (${sport})`, () => {
            const l = sampleLeague(sport);
            const labels: Record<AdviceTab, string> = { courts: `Facilities & ${SPORTS[sport].time}`, brackets: "Brackets & pools", teams: "Teams", season: "Season" };
            for (const [reason] of catalogue(sport)) {
                const a = adviceFor(reason, l);
                assert.ok(a.tab && TABS.includes(a.tab));
                assert.equal(a.tabLabel, labels[a.tab!]);
            }
        });
    }

    test("audit's 'One of these teams has been deleted' has specific advice, in the sport's words", () => {
        assert.deepEqual(adviceFor("One of these teams has been deleted", sampleLeague()), { tip: "A team in this match no longer exists. Regenerate to drop the match, or add the team back.", tab: "teams", tabLabel: "Teams" });
        assert.equal(adviceFor("One of these teams has been deleted", sampleLeague("hockey")).tip, "A team in this game no longer exists. Regenerate to drop the game, or add the team back.");
    });

    test("every message a real audit gives for a deleted team or location has advice", () => {
        const l = sampleLeague("soccer");
        const ms = run(l, [], { maxAttempts: 1 }).matches;
        const broken = [{ ...ms[0], home: "deleted-team" }, { ...ms[1], locationId: "gone", slotId: "gone" }, ...ms.slice(2)];
        for (const reason of [...audit(l, broken).issues.values()].flatMap((v) => [...v.hard, ...v.soft])) assert.ok(TABS.includes(adviceFor(reason, l).tab!), reason);
    });

    test("the 'booked' variants of a missing unit get a different fix from the plain one", () => {
        const l = sampleLeague("soccer");
        assert.notEqual(adviceFor("No field assigned", l).tip, adviceFor("No field assigned: every field is booked at that time", l).tip);
        assert.notEqual(adviceFor("No field assigned: every field is booked at that time", l).tip, adviceFor("Every field is already booked at that time", l).tip);
    });

    test("names from the message are carried into the tip", () => {
        const l = sampleLeague();
        assert.match(adviceFor("This time slot isn’t open to 12U", l).tip, /Add 12U to a slot’s “Open to”/);
        assert.match(adviceFor("10U doesn’t play on Sundays", l).tip, /Add Sundays under “Plays on”/);
        assert.match(adviceFor("Court 2 has two matches at once", l).tip, /^Court 2 is double-booked/);
        const name = l.teams[3].name;
        assert.equal(adviceFor(`${name}: At most 1 match per weekend`, l).tip, `This is ${name}’s rule “At most 1 match per weekend”. Loosen it, switch it to “Prefer”, or add time slots that fit it.`);
    });

    test("an unknown message (or a team that isn't in this league) falls back to a generic tip with no tab", () => {
        const l = sampleLeague("hockey");
        for (const reason of ["Something new went wrong", "Nobody FC: Not on Saturdays", ""]) {
            const a = adviceFor(reason, l);
            assert.equal(a.tab, null);
            assert.equal(a.tabLabel, "");
            assert.equal(a.tip, "Try moving the game by hand, or regenerate.");
        }
    });

    for (const sport of ["tennis", "hockey", "soccer"] as const) {
        test(`every reason a real generate + audit produces has advice (${sport}, tight league)`, () => {
            const l = sampleLeague(sport);
            l.slots = l.slots.filter((s) => s.id === "s-sat-0" || s.id === "s-2-0").map((s) => ({ ...s, unitIds: s.unitIds.slice(0, 1) }));
            l.settings.clubLimitMode = "must";
            l.settings.clubLimit = 1;
            const r = run(l, [], { maxAttempts: 3 });
            const moved = r.matches.map((m, i) => (i === 0 && m.date ? { ...m, unitIds: undefined } : m));
            const all = [...r.matches.flatMap((m) => (m.blockers ?? []).map((b) => b.reason)), ...[...audit(l, moved).issues.values()].flatMap((v) => [...v.hard, ...v.soft])];
            assert.ok(all.length > 0);
            for (const reason of new Set(all)) assert.ok(TABS.includes(adviceFor(reason, l).tab!), reason);
        });
    }
});
