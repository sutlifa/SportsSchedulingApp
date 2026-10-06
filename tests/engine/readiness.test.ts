import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { firstOpenStep, readiness, SETUP_STEPS, stepTitle, type Check, type Level, type StepId } from "../../lib/engine/readiness.ts";
import { sampleLeague } from "../../lib/engine/sample.ts";
import { emptyLeague } from "../../lib/engine/sanitize.ts";
import { SPORT_IDS } from "../../lib/engine/sports.ts";
import type { League } from "../../lib/engine/types.ts";
import { bracket, everyDay, league, location, rule, run, slot, team, unplaced, type LeagueOver } from "../support/fixtures.ts";

/**
 * A league with no blocks and no warnings: 4 teams x 5 games, a named
 * two-court facility with an address, a 10:00 slot every day of March 2027.
 */
function ready(over: LeagueOver = {}): League {
    return league({
        locations: [location("l", { name: "Hall", address: "1 Main St", units: [{ id: "u1", name: "Court 1" }, { id: "u2", name: "Court 2" }] })],
        slots: everyDay("10:00", 2, { unitIds: ["u1", "u2"] }),
        teams: ["a", "c", "d", "e"].map((id) => team(id)),
        ...over,
    });
}
const checks = (l: League, name = "League") => readiness(l, name);
const find = (l: League, level: Level, step: StepId, text: string, name = "League") => checks(l, name).some((c) => c.level === level && c.step === step && c.text === text);
const levels = (l: League, level: Level, name = "League") => checks(l, name).filter((c) => c.level === level);
/** Assert exactly this check is present, and it is absent from the ready league. */
function shows(l: League, level: Level, step: StepId, text: string, name = "League") {
    assert.ok(find(l, level, step, text, name), `expected ${level}/${step}: ${text}\n got: ${JSON.stringify(checks(l, name), null, 1)}`);
    assert.ok(!find(ready(), level, step, text), "and the ready league doesn't show it");
}
/** A league readiness passes must actually schedule completely. */
function schedulesFully(l: League) {
    assert.deepEqual(levels(l, "block").map((c) => c.text), [], "no blocks");
    const r = run(l, [], { maxAttempts: 8 });
    assert.equal(unplaced(r.matches).length, 0, `no false pass: ${unplaced(r.matches).map((m) => m.note).join(" | ")}`);
}

describe("the ready league", () => {
    test("has no blocks and no warnings, and schedules fully", () => {
        assert.deepEqual(levels(ready(), "warn"), []);
        schedulesFully(ready());
        assert.equal(firstOpenStep(checks(ready())), "review");
    });

    for (const sport of SPORT_IDS) {
        test(`the ${sport} example league has no blocks, opens on review, and schedules fully`, () => {
            const l = sampleLeague(sport);
            assert.deepEqual(levels(l, "block"), []);
            assert.equal(firstOpenStep(checks(l)), "review");
            schedulesFully(l);
        });
    }
});

describe("basics and season", () => {
    test("a name is required (blank or spaces)", () => {
        for (const name of ["", "   "]) shows(ready(), "block", "basics", "Give the league or tournament a name.", name);
    });

    test("season dates: missing, and reversed", () => {
        shows(ready({ settings: { seasonStart: "" } }), "block", "season", "Set the season’s first and last day.");
        shows(ready({ settings: { seasonEnd: "2027-02-01" } }), "block", "season", "The last day is before the first day.");
    });

    test("a season over 400 days warns; 400 days does not", () => {
        shows(ready({ settings: { seasonStart: "2027-01-01", seasonEnd: "2028-03-01" } }), "warn", "season", "The season is 61 weeks long. Check the dates.");
        const exactly = ready({ settings: { seasonStart: "2027-01-01", seasonEnd: "2028-02-04" } });
        assert.ok(!checks(exactly).some((c) => /weeks long/.test(c.text)));
    });

    test("a blackout outside the season warns; one overlapping the season's edge does not", () => {
        shows(ready({ settings: { blackouts: [{ from: "2027-01-01" }] } }), "warn", "season", "Blackout Fri, Jan 1 is outside the season, so it does nothing.");
        shows(ready({ settings: { blackouts: [{ from: "2027-04-01", to: "2027-04-03" }] } }), "warn", "season", "Blackout Thu, Apr 1 – Sat, Apr 3 is outside the season, so it does nothing.");
        assert.ok(!checks(ready({ settings: { blackouts: [{ from: "2027-02-25", to: "2027-03-02" }] } })).some((c) => /outside the season/.test(c.text)));
    });

    test("every day blacked out blocks -- counting only blackout days INSIDE the season", () => {
        shows(ready({ settings: { blackouts: [{ from: "2027-02-01", to: "2027-04-30" }] } }), "block", "season", "Every day of the season is a blackout date.");
        const allButOne = ready({ settings: { blackouts: [{ from: "2027-02-01", to: "2027-03-30" }] } });
        assert.ok(!find(allButOne, "block", "season", "Every day of the season is a blackout date."));
        // A long holiday that starts before the season doesn't add up to "every day".
        const before = ready({ settings: { blackouts: [{ from: "2026-12-01", to: "2027-01-31" }] } });
        assert.ok(!find(before, "block", "season", "Every day of the season is a blackout date."));
    });
});

describe("brackets and facilities", () => {
    test("no brackets", () => shows(ready({ brackets: [] }), "block", "brackets", "Add at least one bracket (an age group or division, e.g. 10U)."));

    test("a bracket giving 0 games warns", () => shows(ready({ brackets: [bracket("b", { matches: 0 })] }), "warn", "brackets", "B gives each team 0 matches."));

    test("earliest after latest blocks; equal does not", () => {
        shows(ready({ brackets: [bracket("b", { earliest: "18:00", latest: "09:00" })] }), "block", "brackets", "B: the earliest start is after the latest start.");
        assert.ok(!checks(ready({ brackets: [bracket("b", { earliest: "10:00", latest: "10:00" })] })).some((c) => /earliest start is after/.test(c.text)));
    });

    test("no facilities", () => shows(ready({ locations: [], slots: [] }), "block", "facilities", "Add at least one facility."));

    test("info: a facility with no named units, or no address (in the sport's words)", () => {
        const l = ready({ locations: [location("l", { name: "Hall" })], slots: everyDay("10:00", 2) });
        shows(l, "info", "facilities", "Hall has no named courts, so matches there won’t say which court.");
        shows(l, "info", "facilities", "Hall has no address. Exports and coach texts are clearer with one.");
        const ice = ready({ settings: { sport: "hockey" }, locations: [location("l", { name: "Rink", address: "x" })], slots: everyDay("10:00", 2) });
        assert.ok(find(ice, "info", "facilities", "Rink has no named sheets, so games there won’t say which sheet."));
    });
});

describe("time", () => {
    test("no weekly time and no upload", () => shows(ready({ slots: [] }), "block", "time", "Add weekly court time, or upload a facility’s spreadsheet."));

    test("an upload alone is enough time", () => {
        const l = ready({ slots: [], availability: Array.from({ length: 31 }, (_, i) => ({ id: `a${i}`, date: `2027-03-${String(i + 1).padStart(2, "0")}`, time: "10:00", locationId: "l", courts: 2, unitIds: [], bracketIds: [] })) });
        schedulesFully(l);
    });

    test("time that never falls in the season", () => {
        shows(ready({ settings: { seasonStart: "2027-03-01", seasonEnd: "2027-03-01" }, slots: [slot("s", 6, "10:00", { capacity: 2 })] }), "block", "time", "None of the court time falls inside the season. Check the slots’ days and the season dates.");
    });

    test("info: a facility with no time yet", () => {
        const l = ready();
        l.locations.push(location("m", { name: "Annex", address: "x", units: [{ id: "x", name: "Court 1" }] }));
        shows(l, "info", "time", "Annex has no court time yet.");
    });

    test("a bracket with no usable time (window, days, 'Open to')", () => {
        shows(ready({ brackets: [bracket("b", { earliest: "12:00" })] }), "block", "time", "B has no court time it can use: check its start window and days, and each slot’s “Open to”.");
        shows(ready({ slots: everyDay("10:00", 2, { bracketIds: ["other"] }) }), "block", "time", "B has no court time it can use: check its start window and days, and each slot’s “Open to”.");
    });

    test("too few dates for a team's games (singular and plural)", () => {
        shows(ready({ settings: { seasonEnd: "2027-03-03" } }), "block", "time", "B: a team needs 5 matches but only 3 dates fit it, at 1 a day at most.");
        shows(ready({ settings: { seasonEnd: "2027-03-01" } }), "block", "time", "B: a team needs 5 matches but only 1 date fits it, at 1 a day at most.");
        // maxPerDay 2 doubles what each date can hold: 3 dates x 2 >= 5.
        assert.ok(!checks(ready({ settings: { seasonEnd: "2027-03-03", maxPerDay: 2 } })).some((c) => /dates? fits? it/.test(c.text)));
    });

    test("fewer spots than games blocks; under 1.5x warns; plenty is quiet", () => {
        // 6 teams x 2 games = 6 games, on 4 Saturdays.
        const six = (cap: number) => ready({ brackets: [bracket("b", { matches: 2 })], slots: [slot("s", 6, "10:00", { capacity: cap })], teams: ["a", "c", "d", "e", "f", "g"].map((id) => team(id)), locations: [location("l", { name: "Hall", address: "x", units: [] })] });
        shows(six(1), "block", "time", "B needs 6 matches but only 4 match spots fit it.");
        shows(six(1), "block", "time", "6 matches are needed but the season has only 4 match spots.");
        shows(six(2), "warn", "time", "B is tight: 6 matches for 8 match spots that fit it. Some requests may not be met.");
        assert.deepEqual(levels(six(3), "block"), []);
        assert.ok(!checks(six(3)).some((c) => /tight/.test(c.text)));
        schedulesFully(six(2));
    });

    test("the season total can block when each bracket fits on its own", () => {
        // Two brackets of 4 teams x 2 games = 4 games each, 8 in all, sharing
        // one court on Saturdays and Sundays.
        const l = ready({
            brackets: [bracket("b", { matches: 2 }), bracket("y", { matches: 2 })],
            slots: [slot("s", 6, "10:00", { capacity: 1 }), slot("t", 0, "10:00", { capacity: 1 })],
            teams: [...["a", "c", "d", "e"].map((id) => team(id)), ...["p", "q", "r", "s"].map((id) => team(id, { bracketId: "y" }))],
            locations: [location("l", { name: "Hall", address: "x" })],
        });
        assert.deepEqual(levels(l, "block"), [], "8 spots for 8 games");
        // A blackout weekend leaves 6 spots: each bracket's 4 still fit, the total doesn't.
        l.settings.blackouts = [{ from: "2027-03-27", to: "2027-03-28" }];
        shows(l, "block", "time", "8 matches are needed but the season has only 6 match spots.");
        assert.ok(!checks(l).some((c) => /^[BY] needs/.test(c.text)));
    });

    test("units per game: no time holds one game (block, on the season step)", () => {
        shows(ready({ settings: { courtsPerMatch: 3 } }), "block", "season", "A match uses 3 courts, but no time has more than 2 free. Lower “Courts used by one match”, or free more courts.");
        const ice = ready({ settings: { sport: "hockey", courtsPerMatch: 3 } });
        assert.ok(find(ice, "block", "season", "A game uses 3 sheets, but no time has more than 2 free. Lower “Sheets used by one game”, or free more sheets."));
        assert.ok(!find(ice, "block", "time", "None of the ice time falls inside the season. Check the slots’ days and the season dates."), "not misreported as a dates problem");
    });

    test("units per game: some times too small warns per facility; unnamed weekly 'at once' counts are never divided", () => {
        const l = ready({ settings: { courtsPerMatch: 2 } });
        l.locations.push(location("m", { name: "Annex", address: "x", units: [{ id: "x1", name: "Court 1" }] }));
        l.slots.push(slot("m1", 6, "12:00", { locationId: "m", unitIds: ["x1"] }));
        shows(l, "warn", "time", "Annex has 1 court free at some times, but a match uses 2, so those times hold no matches.");
        assert.ok(!checks(l).some((c) => c.text.startsWith("Hall has")), "Hall's 2-court times hold a game");
        const unnamed = ready({ settings: { courtsPerMatch: 4 }, locations: [location("l", { name: "Hall", address: "x" })], slots: everyDay("10:00", 2) });
        assert.ok(!checks(unnamed).some((c) => / free at some times| but no time has more than/.test(c.text)));
    });
});

describe("bracket must-rules", () => {
    test("must-rules leaving too few dates", () => {
        const l = ready({ brackets: [bracket("b", { rules: [rule("only_days", { days: [6] })] })] });
        shows(l, "block", "brackets", "B: its must-rules leave 4 dates its teams can play, but a team needs 5 matches.");
    });

    test("a frequency rule leaving too little room, at the boundary and one over", () => {
        const l = ready({ brackets: [bracket("b", { matches: 6, rules: [rule("max_per_week", { n: 1 })] })] });
        shows(l, "block", "brackets", "B: “At most 1 match per week” leaves room for only 5 matches in the season, but a team needs 6.");
        const fits = ready({ brackets: [bracket("b", { matches: 5, rules: [rule("max_per_week", { n: 1 })] })] });
        assert.ok(!levels(fits, "block").length);
    });

    test("prefer rules never block", () => {
        const l = ready({ brackets: [bracket("b", { rules: [rule("only_days", { days: [6] }, "prefer"), rule("max_per_week", { n: 1 }, "prefer")], matches: 6 })] });
        assert.deepEqual(levels(l, "block"), []);
    });
});

describe("teams", () => {
    test("fewer than two teams", () => shows(ready({ teams: [team("a")] }), "block", "teams", "Add the teams (at least two)."));

    test("a team outside every bracket", () => {
        const l = ready();
        l.teams.push(team("x", { bracketId: "", name: "Loose" }));
        shows(l, "block", "teams", "Loose isn’t in a bracket.");
    });

    test("a team alone in its pool (with the pool's label)", () => {
        const l = ready();
        l.teams.push(team("x", { pool: "Z", name: "Solo" }));
        shows(l, "block", "teams", "Solo is the only team in B · Pool Z, so it has nobody to play.");
    });

    test("a team wanting more than the rest of its pool plays, and no 'odd total' note then", () => {
        const l = ready({ brackets: [bracket("b", { matches: 1 })], teams: [team("a", { matches: 4 }), team("c"), team("d")] });
        shows(l, "block", "teams", "A wants 4 matches but the rest of its pool has only 2 to give.");
        assert.ok(!checks(l).some((c) => /odd total/.test(c.text)));
    });

    test("an odd pool total warns", () => {
        shows(ready({ brackets: [bracket("b", { matches: 3 })], teams: [team("a"), team("c"), team("d")] }), "warn", "teams", "B has an odd total of matches, so one team will get one fewer.");
    });

    test("a bracket with no teams warns", () => {
        const l = ready();
        l.brackets.push(bracket("y"));
        shows(l, "warn", "teams", "Y has no teams yet.");
    });
});

describe("requests", () => {
    test("rules that do nothing yet warn", () => {
        const l = ready();
        l.teams[0].rules = [rule("no_days", { days: [] }), rule("note", { text: "" }), rule("only_locations", { locationIds: [] }), rule("not_same_day", { teamIds: [] })];
        for (const what of ["no days chosen yet", "empty note", "no locations chosen yet", "no teams chosen yet"]) shows(l, "warn", "requests", `A: a “${what}” rule does nothing yet.`);
    });

    test("a team's must-requests leaving too few dates", () => {
        const l = ready();
        l.teams[0].rules = [rule("only_days", { days: [6] })];
        shows(l, "block", "requests", "A: its must-requests leave 4 dates it can play, but it needs 5 matches.");
    });

    test("days-between leaving too little room; the boundary passes and schedules", () => {
        const l = ready();
        l.teams[0].rules = [rule("min_days_between", { n: 10 })];
        shows(l, "block", "requests", "A: “At least 10 days between matches” leaves room for only 4 matches in the season, but it needs 5.");
        const fits = ready();
        fits.teams[0].rules = [rule("min_days_between", { n: 7 })];
        schedulesFully(fits);
    });

    test("weekend caps measured on the days the team can actually play", () => {
        const l = ready();
        l.teams[0].rules = [rule("only_days", { days: [6, 0] }), rule("max_per_weekend", { n: 1 })];
        shows(l, "block", "requests", "A: “At most 1 match per weekend” leaves room for only 4 matches in the season, but it needs 5.");
        const total = ready();
        total.teams[0].rules = [rule("only_days", { days: [6, 0] }), rule("max_weekend_total", { n: 3 })];
        shows(total, "block", "requests", "A: “At most 3 matches on Sat/Sun all season” leaves room for only 3 matches in the season, but it needs 5.");
    });

    test("a bracket that already explains the shortfall isn't repeated per team", () => {
        const l = ready({ brackets: [bracket("b", { rules: [rule("only_days", { days: [6] })] })] });
        l.teams[0].rules = [rule("only_days", { days: [6] })];
        assert.ok(!checks(l).some((c) => c.step === "requests" && c.level === "block"));
    });

    test("prefer requests never block", () => {
        const l = ready();
        l.teams[0].rules = [rule("only_days", { days: [6] }, "prefer"), rule("min_days_between", { n: 20 }, "prefer")];
        assert.deepEqual(levels(l, "block"), []);
        schedulesFully(l);
    });

    test("info: how many teams have requests", () => {
        const l = ready();
        l.teams[0].rules = [rule("note", { text: "hi" })];
        shows(l, "info", "requests", "1 of 4 teams have requests. Add any you’ve been sent; you can always add more later.");
        assert.ok(!checks(ready({ teams: [] })).some((c) => c.step === "requests"), "no teams, no count");
    });
});

describe("no count/noun mismatches", () => {
    const BAD = /\b1 (matches|games|dates|spots|courts|sheets|fields|teams)\b|\b(0|[2-9]|\d\d+) (match|game|date|court|sheet|field|team)\b(?! spots?\b| time\b)/;
    const battery = (): League[] => {
        const out: League[] = [];
        for (const sport of SPORT_IDS) {
            const l = sampleLeague(sport);
            out.push(l);
            const tight = structuredClone(l);
            tight.settings.seasonEnd = "2027-03-07";
            out.push(tight);
            const one = structuredClone(l);
            one.brackets[0].matches = 1;
            one.settings.courtsPerMatch = 2;
            out.push(one);
            out.push(ready({ settings: { sport, seasonEnd: "2027-03-01" } }));
            out.push(ready({ settings: { sport }, brackets: [bracket("b", { matches: 1 })], teams: [team("a"), team("c"), team("d")] }));
        }
        return out;
    };

    test("across many leagues in every sport", () => {
        for (const l of battery()) for (const c of checks(l)) assert.doesNotMatch(c.text, BAD, c.text);
    });

    test("a one-team league says '0 of 1 team has requests'", () => {
        const texts = checks(ready({ teams: [team("a")] })).map((c) => c.text);
        for (const t of texts) assert.doesNotMatch(t, BAD, t);
        assert.ok(texts.includes("0 of 1 team has requests. Add any you’ve been sent; you can always add more later."));
    });
});

describe("firstOpenStep / stepTitle", () => {
    test("the first step with a block, in wizard order; review when none", () => {
        const c = (step: StepId, level: Level = "block"): Check => ({ step, level, text: "x" });
        assert.equal(firstOpenStep([]), "review");
        assert.equal(firstOpenStep([c("teams"), c("season")]), "season");
        assert.equal(firstOpenStep([c("basics", "warn"), c("time")]), "time", "warnings don't stop the wizard");
        assert.equal(firstOpenStep([c("requests", "info")]), "review");
        for (const s of SETUP_STEPS) assert.equal(firstOpenStep([c(s)]), s);
    });

    test("a blank league blocks on each input step and opens on basics, then season once named", () => {
        for (const sport of SPORT_IDS) {
            const e = emptyLeague(sport);
            const steps = new Set(levels(e, "block", "").map((x) => x.step));
            for (const s of ["basics", "season", "brackets", "facilities", "time", "teams"] as const) assert.ok(steps.has(s), `${sport}: ${s}`);
            assert.ok(!steps.has("requests") && !steps.has("review"));
            assert.equal(firstOpenStep(checks(e, "")), "basics");
            assert.equal(firstOpenStep(checks(e, "Named")), "season");
        }
    });

    test("step titles, with the time step in the sport's words", () => {
        const title = (sport: (typeof SPORT_IDS)[number], s: StepId) => stepTitle(s, emptyLeague(sport));
        assert.deepEqual(SETUP_STEPS.map((s) => title("tennis", s)), ["Name & sport", "Season", "Brackets & pools", "Facilities", "Court time", "Teams", "Requests", "Review & schedule"]);
        assert.equal(title("hockey", "time"), "Ice time");
        assert.equal(title("soccer", "time"), "Field time");
        assert.equal(title("basketball", "time"), "Gym time");
        assert.equal(title("other", "time"), "Facility time");
        for (const sport of SPORT_IDS) for (const s of SETUP_STEPS) assert.ok(title(sport, s).length > 0);
    });
});
