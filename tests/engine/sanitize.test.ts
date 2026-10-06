import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { defaultSettings, emptyLeague, emptySchedule, mapSearchUrl, safeMapUrl, sanitizeLeague, sanitizeRule, sanitizeSchedule } from "../../lib/engine/sanitize.ts";
import { RULE_ORDER } from "../../lib/engine/rules.ts";
import { sampleLeague } from "../../lib/engine/sample.ts";
import { SPORT_IDS, SPORTS } from "../../lib/engine/sports.ts";
import { prepare } from "../../lib/engine/engine.ts";
import type { Rule } from "../../lib/engine/types.ts";

const ID = /^[A-Za-z0-9_-]+$/;

describe("sanitizeRule", () => {
    test("rejects non-objects and unknown types", () => {
        for (const v of [null, undefined, 1, "max_per_week", [], {}, { type: "nope" }, { type: 3 }, { type: "" }])
            assert.equal(sanitizeRule(v), null, JSON.stringify(v));
    });

    test(
        "rejects rule types that are Object.prototype keys (constructor, toString, __proto__)",
        { todo: "BUG: `type in RULE_DEFS` (lib/engine/sanitize.ts:52) is true for prototype keys, the switch has no case, and sanitizeRule returns undefined, which the `!== null` filter at :82 keeps" },
        () => {
            for (const type of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) assert.equal(sanitizeRule({ type }), null, type);
        }
    );

    test("mode: only 'prefer' is prefer; anything else is must", () => {
        assert.equal(sanitizeRule({ type: "max_per_week", mode: "prefer" })!.mode, "prefer");
        for (const mode of ["must", "PREFER", "", undefined, 1]) assert.equal(sanitizeRule({ type: "max_per_week", mode })!.mode, "must");
    });

    test("ids: kept when safe, replaced (uniquely) when not", () => {
        assert.equal(sanitizeRule({ type: "note", id: "abc_1-2" })!.id, "abc_1-2");
        const a = sanitizeRule({ type: "note", id: "<script>" })!.id;
        const b = sanitizeRule({ type: "note" })!.id;
        assert.match(a, ID);
        assert.match(b, ID);
        assert.notEqual(a, b);
        assert.notEqual(sanitizeRule({ type: "note", id: "x".repeat(65) })!.id, "x".repeat(65));
    });

    test("count rules clamp and default", () => {
        for (const type of ["max_per_weekend", "max_weekend_total", "max_per_week"] as const) {
            assert.equal((sanitizeRule({ type, n: 2 }) as { n: number }).n, 2);
            assert.equal((sanitizeRule({ type, n: "3" }) as { n: number }).n, 3, "numeric strings are read");
            assert.equal((sanitizeRule({ type, n: 2.6 }) as { n: number }).n, 3, "rounded");
            assert.equal((sanitizeRule({ type, n: -4 }) as { n: number }).n, 0);
            assert.equal((sanitizeRule({ type, n: 1000 }) as { n: number }).n, 99);
            assert.equal((sanitizeRule({ type }) as { n: number }).n, 1, "default 1");
            assert.equal((sanitizeRule({ type, n: "lots" }) as { n: number }).n, 1);
            assert.equal((sanitizeRule({ type, n: Infinity }) as { n: number }).n, 1);
        }
        assert.equal((sanitizeRule({ type: "min_days_between" }) as { n: number }).n, 3, "days-between default 3");
        assert.equal((sanitizeRule({ type: "min_days_between", n: 500 }) as { n: number }).n, 60);
    });

    test("max_on_day: day must be 0..6 integer, else Sunday", () => {
        assert.deepEqual(sanitizeRule({ type: "max_on_day", id: "x", day: 3, n: 2 }), { id: "x", mode: "must", type: "max_on_day", day: 3, n: 2 });
        for (const day of [7, -1, 2.5, "3", null]) assert.equal((sanitizeRule({ type: "max_on_day", day }) as { day: number }).day, 0, String(day));
    });

    test("day lists: valid, de-duplicated, at most 7 read", () => {
        assert.deepEqual((sanitizeRule({ type: "no_days", days: [1, 1, 7, -1, "2", 2.5, 6] }) as { days: number[] }).days, [1, 6]);
        assert.deepEqual((sanitizeRule({ type: "only_days", days: "0,6" }) as { days: number[] }).days, []);
        assert.deepEqual((sanitizeRule({ type: "only_days", days: [0, 1, 2, 3, 4, 5, 6, 0, 6] }) as { days: number[] }).days, [0, 1, 2, 3, 4, 5, 6]);
    });

    test("date ranges: invalid `from` dropped, invalid or equal `to` collapsed to one day", () => {
        const rule = sanitizeRule({
            type: "not_dates",
            ranges: [{ from: "2027-03-06", to: "2027-03-07" }, { from: "2027-03-08", to: "2027-03-08" }, { from: "2027-03-09", to: "soon" }, { from: "bad" }, "2027-03-10", null],
        }) as { ranges: unknown[] };
        assert.deepEqual(rule.ranges, [{ from: "2027-03-06", to: "2027-03-07" }, { from: "2027-03-08" }, { from: "2027-03-09" }]);
    });

    test("start-time rules: valid HH:MM kept, otherwise the rule's default", () => {
        assert.equal((sanitizeRule({ type: "no_start_after", time: "19:30" }) as { time: string }).time, "19:30");
        assert.equal((sanitizeRule({ type: "no_start_after", time: "7pm" }) as { time: string }).time, "18:00");
        assert.equal((sanitizeRule({ type: "no_start_before", time: "25:00" }) as { time: string }).time, "10:00");
        assert.equal((sanitizeRule({ type: "no_start_before" }) as { time: string }).time, "10:00");
    });

    test("location and team id lists: safe ids only, de-duplicated", () => {
        assert.deepEqual((sanitizeRule({ type: "only_locations", locationIds: ["l1", "l1", "bad id", "", 5, "l2"] }) as { locationIds: string[] }).locationIds, ["l1", "l2"]);
        assert.deepEqual((sanitizeRule({ type: "avoid_locations", locationIds: "l1" }) as { locationIds: string[] }).locationIds, []);
        assert.deepEqual((sanitizeRule({ type: "not_same_time", teamIds: ["t1", "t1", "t2"] }) as { teamIds: string[] }).teamIds, ["t1", "t2"]);
        assert.deepEqual((sanitizeRule({ type: "not_same_day", teamIds: [{}] }) as { teamIds: string[] }).teamIds, []);
    });

    test("notes: text kept up to 2000 characters, non-strings become empty", () => {
        assert.equal((sanitizeRule({ type: "note", text: "hi" }) as { text: string }).text, "hi");
        assert.equal((sanitizeRule({ type: "note", text: "x".repeat(5000) }) as { text: string }).text.length, 2000);
        assert.equal((sanitizeRule({ type: "note", text: 12 }) as { text: string }).text, "");
    });

    test("every type: a sanitized rule sanitizes to itself, and only known fields survive", () => {
        for (const type of RULE_ORDER) {
            const once = sanitizeRule({ type, id: "r1", mode: "prefer", extra: "drop me", __proto__x: 1 })!;
            assert.ok(once, type);
            assert.equal("extra" in once, false);
            assert.deepEqual(sanitizeRule(once), once, type);
        }
    });
});

describe("sanitizeLeague: garbage and missing fields", () => {
    test("anything that isn't an object gives an empty tennis league", () => {
        for (const v of [null, undefined, 0, "league", [], true]) {
            const l = sanitizeLeague(v);
            assert.deepEqual(l, emptyLeague("tennis"), String(v));
        }
    });

    test("arrays that aren't arrays become empty arrays", () => {
        const l = sanitizeLeague({ brackets: "x", locations: {}, slots: 3, availability: null, teams: "t", settings: { blackouts: "none" } });
        assert.deepEqual([l.brackets, l.locations, l.slots, l.availability, l.teams, l.settings.blackouts], [[], [], [], [], [], []]);
    });

    test("settings: defaults, clamps and the club-limit null", () => {
        const s = sanitizeLeague({ settings: {} }).settings;
        assert.deepEqual(s, defaultSettings("tennis"));
        const c = sanitizeLeague({ settings: { maxPerDay: 9, matchMinutes: 5, clubLimit: 500, courtsPerMatch: 0, clubLimitMode: "x", seasonStart: "2027-3-6", seasonEnd: "2027-05-16" } }).settings;
        assert.deepEqual([c.maxPerDay, c.matchMinutes, c.clubLimit, c.courtsPerMatch, c.clubLimitMode, c.seasonStart, c.seasonEnd], [5, 15, 50, 1, "must", "", "2027-05-16"]);
        assert.equal(sanitizeLeague({ settings: { clubLimit: "" } }).settings.clubLimit, null);
        assert.equal(sanitizeLeague({ settings: { clubLimit: null } }).settings.clubLimit, null);
        assert.equal(sanitizeLeague({ settings: { clubLimit: 0 } }).settings.clubLimit, 1);
        assert.equal(sanitizeLeague({ settings: { clubLimit: "abc" } }).settings.clubLimit, 2, "unreadable club limit falls back to 2");
        assert.equal(sanitizeLeague({ settings: { matchMinutes: 10_000 } }).settings.matchMinutes, 600);
        assert.equal(sanitizeLeague({ settings: { courtsPerMatch: 99 } }).settings.courtsPerMatch, 20);
        assert.equal(sanitizeLeague({ settings: { clubLimitMode: "prefer" } }).settings.clubLimitMode, "prefer");
    });

    test("blackouts are sanitized like rule ranges", () => {
        const s = sanitizeLeague({ settings: { blackouts: [{ from: "2027-03-27", to: "2027-03-28" }, { from: "x" }, { from: "2027-04-01", to: "2027-04-01" }] } }).settings;
        assert.deepEqual(s.blackouts, [{ from: "2027-03-27", to: "2027-03-28" }, { from: "2027-04-01" }]);
    });

    test("brackets: names, counts, windows, days, colours, rules", () => {
        const [b] = sanitizeLeague({
            brackets: [{ id: "b 1", name: "", matches: 200, earliest: "9:00", latest: "18:30", days: [6, 6, 9], color: "red", rules: [{ type: "max_per_week", n: 1 }, { type: "bogus" }, null] }],
        }).brackets;
        assert.match(b.id, ID);
        assert.notEqual(b.id, "b 1");
        assert.equal(b.name, "Unnamed bracket");
        assert.equal(b.matches, 99);
        assert.equal(b.earliest, "");
        assert.equal(b.latest, "18:30");
        assert.deepEqual(b.days, [6]);
        assert.equal(b.color, "#2f7fb8");
        assert.equal(b.rules.length, 1);
        assert.equal(sanitizeLeague({ brackets: [{ color: "#A1b2C3" }] }).brackets[0].color, "#A1b2C3");
        for (const bad of ["#abc", "#1234567", "a1b2c3", "#ggg000", 0x123456]) assert.equal(sanitizeLeague({ brackets: [{ color: bad }] }).brackets[0].color, "#2f7fb8", String(bad));
        assert.equal(sanitizeLeague({ brackets: [{}] }).brackets[0].matches, 5, "default 5 games");
        assert.equal(sanitizeLeague({ brackets: [{ name: "x".repeat(100) }] }).brackets[0].name.length, 60);
    });

    test("locations: name fallback, map URL filtered, units trimmed and de-duplicated by name (case-insensitive)", () => {
        const [l] = sanitizeLeague({
            locations: [
                {
                    id: "loc",
                    name: "",
                    mapUrl: "javascript:alert(1)",
                    units: [{ id: "u1", name: " Court 1 " }, { id: "u2", name: "court 1" }, { id: "u3", name: "" }, { id: "u4" }, "Court 9", { id: "bad id", name: "Court 2" }],
                },
            ],
        }).locations;
        assert.equal(l.name, "Unnamed location");
        assert.equal(l.mapUrl, "");
        assert.deepEqual(l.units.map((u) => u.name), ["Court 1", "Court 2"]);
        assert.equal(l.units[0].id, "u1");
        assert.match(l.units[1].id, ID);
        assert.notEqual(l.units[1].id, "bad id");
        assert.equal(l.address, "");
        assert.equal(l.notes, "");
    });

    test(
        "units: duplicate ids inside one facility are not kept (they would count as two units of capacity)",
        { todo: "BUG: sanitizeLeague keeps two units with the same id (lib/engine/sanitize.ts:132-136 de-dups by name only); prepare() then counts both, giving 2 games at once on 1 real unit, and the 2nd game gets no unit" },
        () => {
            const l = sanitizeLeague({ locations: [{ id: "l", units: [{ id: "u1", name: "Court A" }, { id: "u1", name: "Court B" }] }] });
            assert.equal(new Set(l.locations[0].units.map((u) => u.id)).size, l.locations[0].units.length);
        }
    );

    test("slots: bad times dropped, bad days default to Saturday, capacity clamped, id lists cleaned", () => {
        const l = sanitizeLeague({
            slots: [
                { id: "s1", day: 2, time: "17:00", locationId: "l", capacity: 500, unitIds: ["u1", "u1", "x y"], bracketIds: ["b1"] },
                { id: "s2", day: 9, time: "09:00", locationId: "l" },
                { id: "s3", day: 1, time: "9am", locationId: "l" },
                { id: "s4", day: 1, locationId: "l" },
            ],
        });
        assert.deepEqual(l.slots.map((s) => s.id), ["s1", "s2"]);
        assert.deepEqual([l.slots[0].capacity, l.slots[0].unitIds, l.slots[0].bracketIds], [100, ["u1"], ["b1"]]);
        assert.deepEqual([l.slots[1].day, l.slots[1].capacity, l.slots[1].unitIds, l.slots[1].bracketIds], [6, 1, [], []]);
    });

    test("availability: rows without a real date, time or location are dropped; courts clamped 0..200", () => {
        const l = sanitizeLeague({
            availability: [
                { id: "a1", date: "2027-03-06", time: "09:00", locationId: "l", courts: 4 },
                { id: "a2", date: "2027-03-06", time: "09:00", locationId: "l", courts: 900 },
                { id: "a3", date: "2027-03-06", time: "09:00", locationId: "l" },
                { date: "3/6/2027", time: "09:00", locationId: "l", courts: 4 },
                { date: "2027-03-06", time: "9:00", locationId: "l", courts: 4 },
                { date: "2027-03-06", time: "09:00", courts: 4 },
            ],
        });
        assert.deepEqual(l.availability.map((a) => [a.id, a.courts, a.unitIds, a.bracketIds]), [["a1", 4, [], []], ["a2", 200, [], []], ["a3", 0, [], []]]);
    });

    test("teams: names, pools, null match override, rules", () => {
        const l = sanitizeLeague({
            teams: [
                { id: "t1", name: "", bracketId: "b1", pool: "A", club: "C", captain: 5, matches: null, rules: [{ type: "note", text: "x" }] },
                { id: "t2", name: "Two", bracketId: "bad id", matches: "" },
                { id: "t3", name: "Three", matches: "4" },
                { id: "t4", name: "Four", matches: 150 },
                { id: "t5", name: "Five" },
            ],
        });
        const [t1, t2, t3, t4, t5] = l.teams;
        assert.deepEqual([t1.name, t1.bracketId, t1.pool, t1.club, t1.captain, t1.matches, t1.rules.length], ["Unnamed team", "b1", "A", "C", "", null, 1]);
        assert.deepEqual([t2.bracketId, t2.matches], ["", null]);
        assert.equal(t3.matches, 4);
        assert.equal(t4.matches, 99);
        assert.equal(t5.matches, null);
        assert.equal(t5.notes, "");
    });
});

describe("sanitizeLeague: limits", () => {
    test("list lengths are capped", () => {
        const many = (n: number, f: (i: number) => unknown) => Array.from({ length: n }, (_, i) => f(i));
        const l = sanitizeLeague({
            brackets: many(60, (i) => ({ id: `b${i}` })),
            locations: many(120, (i) => ({ id: `l${i}`, units: many(150, (k) => ({ id: `u${k}`, name: `U${k}` })) })),
            slots: many(600, (i) => ({ id: `s${i}`, time: "09:00", locationId: "l0" })),
            teams: many(1100, (i) => ({ id: `t${i}`, rules: many(80, () => ({ type: "note" })) })),
        });
        assert.equal(l.brackets.length, 50);
        assert.equal(l.locations.length, 100);
        assert.equal(l.locations[0].units.length, 100);
        assert.equal(l.slots.length, 500);
        assert.equal(l.teams.length, 1000);
        assert.equal(l.teams[0].rules.length, 60);
    });

    test("availability is capped at 15,000 rows and a schedule at 10,000 matches", () => {
        const l = sanitizeLeague({ availability: Array.from({ length: 15_100 }, (_, i) => ({ id: `a${i}`, date: "2027-03-06", time: "09:00", locationId: "l", courts: 1 })) });
        assert.equal(l.availability.length, 15_000);
        const s = sanitizeSchedule({ matches: Array.from({ length: 10_100 }, (_, i) => ({ id: `m${i}`, home: "a", away: "b" })) });
        assert.equal(s.matches.length, 10_000);
    });

    test("long text is cut, not rejected", () => {
        const l = sanitizeLeague({ locations: [{ name: "n".repeat(500), address: "a".repeat(500), notes: "z".repeat(5000) }], teams: [{ name: "t".repeat(500), pool: "p".repeat(100), club: "c".repeat(100), contact: "x".repeat(500), notes: "y".repeat(5000) }] });
        assert.deepEqual([l.locations[0].name.length, l.locations[0].address.length, l.locations[0].notes.length], [120, 300, 2000]);
        const t = l.teams[0];
        assert.deepEqual([t.name.length, t.pool.length, t.club.length, t.contact.length, t.notes.length], [120, 40, 80, 200, 2000]);
    });
});

describe("sanitizeLeague: old shapes", () => {
    /** A league as saved before sports and named units existed. */
    const preSport = () => {
        const l = structuredClone(sampleLeague("tennis")) as unknown as Record<string, Record<string, unknown> & Record<string, unknown>[]>;
        delete (l.settings as Record<string, unknown>).sport;
        delete (l.settings as Record<string, unknown>).courtsPerMatch;
        for (const x of l.locations as Record<string, unknown>[]) delete x.units;
        for (const x of l.slots as Record<string, unknown>[]) delete x.unitIds;
        delete (l as Record<string, unknown>).availability;
        return l;
    };

    test("a league without `sport` is tennis; missing units/unitIds/availability become empty lists", () => {
        const l = sanitizeLeague(preSport());
        assert.equal(l.settings.sport, "tennis");
        assert.equal(l.settings.courtsPerMatch, 1);
        assert.ok(l.locations.every((x) => Array.isArray(x.units) && x.units.length === 0));
        assert.ok(l.slots.every((x) => Array.isArray(x.unitIds) && x.unitIds.length === 0));
        assert.deepEqual(l.availability, []);
        assert.equal(l.teams.length, 24);
    });

    test("an old league prepares: slot capacity comes from its number when no units are named", () => {
        const ctx = prepare(sanitizeLeague(preSport()));
        assert.ok(ctx.instances.length > 0);
        assert.ok(ctx.instances.every((i) => i.unitIds.length === 0 && (i.capacity === 3 || i.capacity === 2)));
    });

    test(
        "a team rule whose type is a prototype key (e.g. from a hand-edited backup) can't crash the engine",
        { todo: "BUG: sanitizeLeague keeps `undefined` in team.rules for {type:'constructor'} (lib/engine/sanitize.ts:52,82); audit/readiness/generate then throw \"Cannot read properties of undefined (reading 'type')\"" },
        () => {
            const raw = JSON.parse(JSON.stringify(sampleLeague())) as { teams: { rules: unknown[] }[] };
            raw.teams[0].rules.push({ id: "evil", mode: "must", type: "constructor" });
            const l = sanitizeLeague(raw);
            assert.ok(l.teams[0].rules.every((r) => r && typeof r.type === "string"));
            assert.doesNotThrow(() => prepare(l));
        }
    );

    test("an unknown sport reads as tennis", () => {
        assert.equal(sanitizeLeague({ settings: { sport: "curling" } }).settings.sport, "tennis");
        for (const id of SPORT_IDS) assert.equal(sanitizeLeague({ settings: { sport: id } }).settings.sport, id);
    });
});

describe("sanitizeSchedule", () => {
    test("garbage gives an empty schedule", () => {
        for (const v of [null, undefined, "x", 4, []]) assert.deepEqual(sanitizeSchedule(v), emptySchedule());
    });

    test("a placed match needs BOTH a real date and a real time; otherwise it is unplaced", () => {
        const s = sanitizeSchedule({
            matches: [
                { id: "m1", home: "a", away: "b", date: "2027-03-06", time: "09:00", locationId: "l", slotId: "s", unitIds: ["u1"] },
                { id: "m2", home: "a", away: "b", date: "2027-03-06", time: "9am", locationId: "l", slotId: "s", unitIds: ["u1"] },
                { id: "m3", home: "a", away: "b", date: null, time: "09:00", locationId: "l" },
            ],
        });
        assert.deepEqual(
            s.matches.map((m) => [m.id, m.date, m.time, m.locationId, m.slotId, m.unitIds ?? null]),
            [
                ["m1", "2027-03-06", "09:00", "l", "s", ["u1"]],
                ["m2", null, null, null, null, null],
                ["m3", null, null, null, null, null],
            ]
        );
    });

    test("matches without both teams are dropped; bad ids get a positional id", () => {
        const s = sanitizeSchedule({ matches: [{ id: "bad id", home: "a", away: "b" }, { id: "x", home: "a" }, { id: "y", away: "b" }, null] });
        assert.deepEqual(s.matches.map((m) => m.id), ["m0"]);
    });

    test("locked is strictly true; note kept and cut; blockers cleaned and capped at 5", () => {
        const [m] = sanitizeSchedule({
            matches: [
                {
                    id: "m",
                    home: "a",
                    away: "b",
                    locked: "true",
                    note: "n".repeat(2000),
                    blockers: [{ reason: "A", count: 3 }, { reason: "", count: 1 }, { reason: 5 }, { reason: "B", count: -2 }, { reason: "C" }, { reason: "D" }, { reason: "E" }],
                },
            ],
        }).matches;
        assert.equal(m.locked, false);
        assert.equal(m.note!.length, 1000);
        // The cap of 5 applies to the raw list, then unreadable entries drop out.
        assert.deepEqual(m.blockers, [{ reason: "A", count: 3 }, { reason: "B", count: 0 }, { reason: "C", count: 0 }]);
        assert.equal(sanitizeSchedule({ matches: [{ id: "m", home: "a", away: "b", locked: true }] }).matches[0].locked, true);
    });

    test("optional fields are absent (not undefined) when empty, so JSON round-trips exactly", () => {
        const [m] = sanitizeSchedule({ matches: [{ id: "m", home: "a", away: "b", note: "", blockers: [], unitIds: [] }] }).matches;
        assert.deepEqual(Object.keys(m).sort(), ["away", "bracketId", "date", "home", "id", "locationId", "locked", "pool", "slotId", "time"]);
    });

    test("generatedAt and warnings", () => {
        const s = sanitizeSchedule({ generatedAt: "2027-01-01T00:00:00.000Z" + "x".repeat(100), warnings: ["ok", "", 5, "w".repeat(900)] });
        assert.equal(s.generatedAt!.length, 40);
        assert.deepEqual(s.warnings.map((w) => w.length), [2, 500]);
        assert.equal(sanitizeSchedule({ generatedAt: 5 }).generatedAt, null);
    });
});

describe("safeMapUrl / mapSearchUrl", () => {
    const allow = [
        "https://maps.app.goo.gl/AbC123",
        "https://goo.gl/maps/xyz",
        "https://www.google.com/maps/place/Riverside",
        "https://google.com/maps/@40,-74,15z",
        "https://maps.google.com/?q=x",
        "https://www.google.co.uk/maps/@51,0,15z",
        "https://www.google.de/maps/place/x",
        "https://www.google.com.au/maps/place/x",
        "  https://maps.google.com/?q=trimmed  ",
    ];
    const deny = [
        "javascript:alert(1)",
        "JaVaScRiPt:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "http://maps.google.com/",
        "https://google.evil.com/maps/place/x",
        "https://maps.google.attacker.io/",
        "https://google.com.evil.io/maps",
        "https://evilgoogle.com/maps",
        "https://goo.gl/abc",
        "https://goo.gl/",
        "https://www.google.com/search?q=x",
        "https://www.google.com/",
        "https://user@evil.com/maps",
        "ftp://maps.google.com/",
        "not a url",
        "",
    ];
    for (const url of allow) test(`allows ${url.trim()}`, () => assert.notEqual(safeMapUrl(url), ""));
    for (const url of deny) test(`denies ${JSON.stringify(url)}`, () => assert.equal(safeMapUrl(url), ""));

    test("an accepted URL comes back normalised, and normalising again changes nothing", () => {
        const once = safeMapUrl("  https://MAPS.google.com/?q=x  ");
        assert.equal(once, "https://maps.google.com/?q=x");
        assert.equal(safeMapUrl(once), once);
    });

    test("mapSearchUrl: a Google Maps search for name + address, encoded", () => {
        assert.equal(mapSearchUrl("Riverside Courts", "1 Main St, Town"), "https://www.google.com/maps/search/?api=1&query=Riverside%20Courts%2C%201%20Main%20St%2C%20Town");
        assert.equal(mapSearchUrl("  Only Name ", "   "), "https://www.google.com/maps/search/?api=1&query=Only%20Name");
        assert.equal(mapSearchUrl("", ""), "https://www.google.com/maps/search/?api=1&query=");
        assert.equal(mapSearchUrl("A&B", "#1"), "https://www.google.com/maps/search/?api=1&query=A%26B%2C%20%231");
        assert.notEqual(safeMapUrl(mapSearchUrl("X", "Y")), "", "its own search links pass the pin filter");
    });
});

describe("idempotence", () => {
    for (const sport of SPORT_IDS) {
        test(`sanitize(sanitize(x)) equals sanitize(x) for the ${sport} example league`, () => {
            const once = sanitizeLeague(sampleLeague(sport));
            assert.deepEqual(sanitizeLeague(once), once);
            assert.deepEqual(once, sampleLeague(sport), "the example league is already clean");
            assert.equal(once.locations[0].units[0].name, SPORTS[sport].unitLabel(0));
        });
    }

    test("idempotent on a messy input too (league and schedule)", () => {
        const messy = { settings: { sport: "hockey", maxPerDay: "3", blackouts: [{ from: "2027-01-01", to: "2027-01-01" }] }, brackets: [{ name: "  ", color: "#zzz" }], locations: [{ units: [{ name: "A" }, { name: "a" }] }], slots: [{ time: "09:00", day: 3 }], teams: [{ rules: [{ type: "no_days", days: [1, 1] }, { type: "x" }] }] };
        const once = sanitizeLeague(messy);
        assert.deepEqual(sanitizeLeague(once), once);
        const sched = { matches: [{ home: "a", away: "b", date: "2027-03-06", time: "09:00", unitIds: ["u", "u"], blockers: [{ reason: "r", count: "2" }] }], warnings: [""] };
        const s1 = sanitizeSchedule(sched);
        assert.deepEqual(sanitizeSchedule(s1), s1);
    });

    test("sanitize never mutates its input", () => {
        const input = sampleLeague("soccer");
        const copy = structuredClone(input);
        sanitizeLeague(input);
        assert.deepEqual(input, copy);
    });

    test("a rule list survives a JSON round trip through sanitize", () => {
        const rules: Rule[] = RULE_ORDER.map((type, i) => sanitizeRule({ type, id: `r${i}` })!);
        assert.deepEqual(JSON.parse(JSON.stringify(rules)).map(sanitizeRule), rules);
    });
});
