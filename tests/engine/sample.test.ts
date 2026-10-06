import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { audit } from "../../lib/engine/engine.ts";
import { sampleLeague } from "../../lib/engine/sample.ts";
import { sanitizeRule } from "../../lib/engine/sanitize.ts";
import { SPORT_IDS, SPORTS } from "../../lib/engine/sports.ts";
import { toMinutes, isoToDay, weekendKey } from "../../lib/engine/dates.ts";
import { gamesOf, run, unplaced } from "../support/fixtures.ts";

describe("sampleLeague", () => {
    test("defaults to tennis", () => {
        assert.equal(sampleLeague().settings.sport, "tennis");
        assert.deepEqual(sampleLeague(), sampleLeague("tennis"));
    });

    test("ids and numbers are identical in every sport; only words differ", () => {
        const strip = (sport: (typeof SPORT_IDS)[number]) => {
            const l = sampleLeague(sport);
            return { ...l, settings: { ...l.settings, sport: "x" }, locations: l.locations.map((x) => ({ ...x, name: "", units: x.units.map((u) => u.id) })) };
        };
        for (const sport of SPORT_IDS) assert.deepEqual(strip(sport), strip("tennis"), sport);
    });

    test("names are clearly made up and in the sport's words", () => {
        for (const sport of SPORT_IDS) {
            const l = sampleLeague(sport);
            const t = SPORTS[sport];
            assert.ok(l.teams.every((x) => x.name.startsWith("Example ")));
            assert.ok(l.locations.every((x) => x.name.startsWith("Example ")));
            assert.equal(l.locations[0].name, `Example ${t.facility[0].split(" ").slice(1).join(" ")}`);
            assert.deepEqual(l.locations[0].units.map((u) => u.name), [0, 1, 2].map(t.unitLabel));
            assert.deepEqual(l.locations[1].units.map((u) => u.name), [0, 1].map(t.unitLabel));
        }
    });

    test("is a fresh object each call (editing one example can't edit the next)", () => {
        const a = sampleLeague();
        a.teams.pop();
        assert.equal(sampleLeague().teams.length, 24);
    });

    test("its rules are all valid rules", () => {
        const rules = [...sampleLeague().brackets.flatMap((b) => b.rules), ...sampleLeague().teams.flatMap((x) => x.rules)];
        for (const r of rules) assert.deepEqual(sanitizeRule(r), r);
    });

    for (const sport of SPORT_IDS) {
        test(`schedules fully, keeps its promises and audits clean (${sport})`, () => {
            const l = sampleLeague(sport);
            const r = run(l, [], { maxAttempts: 5 });
            assert.equal(unplaced(r.matches).length, 0, unplaced(r.matches).map((m) => m.note).join(" | "));
            assert.deepEqual(r.warnings, []);
            assert.equal(r.placed, 60, "24 teams x 5 / 2");
            const a = audit(l, r.matches);
            assert.deepEqual([...a.issues.entries()], [], "no hard or soft issues");
            for (const s of a.teams.values()) assert.equal(s.placed, 5);
            // A few of its promises, checked directly.
            for (const m of r.matches) {
                assert.equal(m.unitIds?.length, 1, "every game has its unit");
                if (m.bracketId === "b10") assert.ok(toMinutes(m.time!) >= toMinutes("09:00") && toMinutes(m.time!) <= toMinutes("17:30"));
                assert.ok(m.date !== "2027-03-27" && m.date !== "2027-03-28", "blackout weekend");
            }
            const hawks = gamesOf(r.matches, "t10a").map((m) => weekendKey(isoToDay(m.date!))).filter((w) => w !== null);
            assert.equal(new Set(hawks).size, hawks.length, "Hawks 10U: one per weekend");
            assert.ok(gamesOf(r.matches, "t14d").every((m) => m.locationId === "loc-center"));
        });
    }
});
