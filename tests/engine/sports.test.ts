import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { cap, countOf, isSportId, SPORT_IDS, SPORTS, sportText, termsFor } from "../../lib/engine/sports.ts";

describe("termsFor", () => {
    test("every sport id maps to its own terms", () => {
        for (const id of SPORT_IDS) {
            const t = termsFor(id);
            assert.equal(t.id, id);
            assert.equal(t, SPORTS[id]);
        }
    });

    test("missing, unknown and legacy values fall back to tennis (pre-sport leagues were tennis)", () => {
        for (const v of [undefined, null, "", "Tennis", "TENNIS", "cricket", 42, {}, ["hockey"]]) assert.equal(termsFor(v).id, "tennis", String(v));
    });

    test("each sport's words", () => {
        const pick = (id: (typeof SPORT_IDS)[number]) => {
            const t = SPORTS[id];
            return [t.unit, t.units, t.time, t.match, t.matches, t.captain, t.captains];
        };
        assert.deepEqual(pick("tennis"), ["court", "courts", "court time", "match", "matches", "captain", "captains"]);
        assert.deepEqual(pick("pickleball"), ["court", "courts", "court time", "match", "matches", "captain", "captains"]);
        assert.deepEqual(pick("hockey"), ["sheet", "sheets", "ice time", "game", "games", "coach", "coaches"]);
        assert.deepEqual(pick("soccer"), ["field", "fields", "field time", "game", "games", "coach", "coaches"]);
        assert.deepEqual(pick("basketball"), ["court", "courts", "gym time", "game", "games", "coach", "coaches"]);
        assert.deepEqual(pick("volleyball"), ["court", "courts", "court time", "match", "matches", "coach", "coaches"]);
        for (const id of ["baseball", "softball", "lacrosse", "football"] as const) assert.deepEqual(pick(id), ["field", "fields", "field time", "game", "games", "coach", "coaches"]);
        assert.deepEqual(pick("other"), ["space", "spaces", "facility time", "game", "games", "coach", "coaches"]);
    });

    test("every sport has a name, a heading, two facilities and a sensible game length", () => {
        for (const id of SPORT_IDS) {
            const t = SPORTS[id];
            assert.ok(t.name.length > 0);
            assert.equal(t.unitHeading.toLowerCase(), t.unit);
            assert.equal(t.facility.length, 2);
            assert.ok(t.facility.every((f) => f.startsWith("Riverside ") || f.startsWith("Lakeview ")));
            assert.ok(t.minutes >= 45 && t.minutes <= 180, `${id}: ${t.minutes}`);
        }
        assert.equal(SPORTS.tennis.minutes, 90);
        assert.equal(SPORTS.hockey.minutes, 75);
    });

    test("isSportId", () => {
        for (const id of SPORT_IDS) assert.equal(isSportId(id), true);
        for (const v of ["", "Hockey", "cricket", null, undefined, 1]) assert.equal(isSportId(v), false);
    });
});

describe("unitLabel", () => {
    test("hockey letters its sheets: A, B, C … wrapping after Z", () => {
        const t = SPORTS.hockey;
        assert.deepEqual([0, 1, 2].map(t.unitLabel), ["Sheet A", "Sheet B", "Sheet C"]);
        assert.equal(t.unitLabel(25), "Sheet Z");
        assert.equal(t.unitLabel(26), "Sheet A");
    });

    test("everyone else numbers from 1", () => {
        assert.deepEqual([0, 1, 9].map(SPORTS.tennis.unitLabel), ["Court 1", "Court 2", "Court 10"]);
        assert.equal(SPORTS.soccer.unitLabel(2), "Field 3");
        assert.equal(SPORTS.other.unitLabel(0), "Space 1");
        for (const id of SPORT_IDS) if (id !== "hockey") assert.match(SPORTS[id].unitLabel(4), / 5$/);
    });

    test("labels start with the sport's unit heading", () => {
        for (const id of SPORT_IDS) assert.ok(SPORTS[id].unitLabel(0).startsWith(SPORTS[id].unitHeading + " "));
    });
});

describe("cap / countOf", () => {
    test("cap upper-cases the first letter only", () => {
        assert.equal(cap("court"), "Court");
        assert.equal(cap("ice time"), "Ice time");
        assert.equal(cap(""), "");
        assert.equal(cap("Already"), "Already");
    });

    test("countOf: singular for exactly 1, plural otherwise (0 included)", () => {
        assert.equal(countOf(1, SPORTS.tennis), "1 match");
        assert.equal(countOf(2, SPORTS.tennis), "2 matches");
        assert.equal(countOf(0, SPORTS.tennis), "0 matches");
        assert.equal(countOf(1, SPORTS.hockey), "1 game");
        assert.equal(countOf(5, SPORTS.hockey), "5 games");
    });
});

describe("sportText", () => {
    const h = SPORTS.hockey;

    test("lower case stays lower case, capitalised stays capitalised", () => {
        assert.equal(sportText("match", h), "game");
        assert.equal(sportText("Match day", h), "Game day");
        assert.equal(sportText("matches", h), "games");
        assert.equal(sportText("Matches at once", h), "Games at once");
        assert.equal(sportText("Max matches in one weekend", h), "Max games in one weekend");
        assert.equal(sportText("Copy for the captain: 3 matches", SPORTS.soccer), "Copy for the coach: 3 games");
        assert.equal(sportText("Captains", h), "Coaches");
    });

    test("ALL-CAPS keeps its leading capital (the function promises the first letter; no copy is all-caps)", () => {
        // Only the initial capital is carried over: "MATCHES" -> "Games". No
        // static copy passed to sportText is all-caps (CSS does the shouting),
        // so this is the documented behaviour, not a bug.
        assert.equal(sportText("MATCHES", h), "Games");
        assert.equal(sportText("CAPTAIN", h), "Coach");
    });

    test("possessives: captain’s, captain's and captains’", () => {
        assert.equal(sportText("The captain’s note", h), "The coach’s note");
        assert.equal(sportText("the captain's phone", h), "the coach's phone");
        assert.equal(sportText("captains’ list", h), "coaches’ list");
    });

    test("only whole words change", () => {
        assert.equal(sportText("rematch matchup mismatches", h), "rematch matchup mismatches");
        assert.equal(sportText("captaincy", h), "captaincy");
    });

    test("tennis text in tennis is unchanged", () => {
        const s = "Match day: 3 matches, ask the captain. Captains decide.";
        assert.equal(sportText(s, SPORTS.tennis), s);
    });

    test("volleyball keeps match but swaps captain for coach", () => {
        assert.equal(sportText("2 matches for each captain", SPORTS.volleyball), "2 matches for each coach");
    });
});
