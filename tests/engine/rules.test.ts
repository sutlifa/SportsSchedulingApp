import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { describeRule, newRule, RULE_DEFS, RULE_ORDER, type NameLookup } from "../../lib/engine/rules.ts";
import { sanitizeRule } from "../../lib/engine/sanitize.ts";
import { SPORT_IDS, SPORTS } from "../../lib/engine/sports.ts";
import type { Rule, RuleMode, RuleType } from "../../lib/engine/types.ts";

/**
 * Compile-time completeness: adding a rule type to types.ts without adding it
 * here fails `npm run typecheck`, so these tests can't silently skip it.
 */
const ALL_TYPES: Record<RuleType, true> = {
    max_per_weekend: true,
    max_weekend_total: true,
    max_per_week: true,
    max_on_day: true,
    no_days: true,
    only_days: true,
    not_dates: true,
    no_start_after: true,
    no_start_before: true,
    only_locations: true,
    avoid_locations: true,
    min_days_between: true,
    not_same_time: true,
    not_same_day: true,
    note: true,
};

const names: Record<string, string> = { t1: "Hawks", t2: "Storm", t3: "Wolves", l1: "Riverside", l2: "Lakeview", l3: "Oak Park" };
const lookup: NameLookup = { team: (id) => names[id], location: (id) => names[id] };
const hockey: NameLookup = { ...lookup, terms: SPORTS.hockey };
const r = (fields: Record<string, unknown>, mode: RuleMode = "must"): Rule => ({ id: "x", mode, ...fields }) as Rule;

describe("RULE_DEFS", () => {
    test("covers exactly the rule types, in RULE_ORDER", () => {
        assert.deepEqual(Object.keys(RULE_DEFS).sort(), Object.keys(ALL_TYPES).sort());
        assert.deepEqual([...RULE_ORDER].sort(), Object.keys(ALL_TYPES).sort());
    });

    test("every def has a label, fields whose keys its defaults fill, and defaults that sanitize unchanged", () => {
        for (const type of RULE_ORDER) {
            const def = RULE_DEFS[type];
            assert.ok(def.label.length > 0, type);
            assert.equal(typeof def.hint, "string");
            assert.ok(def.fields.length > 0, type);
            const defaults = def.defaults() as Record<string, unknown>;
            for (const f of def.fields) assert.ok(f.key in defaults, `${type}.${f.key} has a default`);
            for (const mode of ["must", "prefer"] as const) {
                const rule = newRule(type, "rid", mode);
                assert.deepEqual(sanitizeRule(rule), rule, `${type} defaults survive sanitize`);
            }
        }
    });

    test("defaults() returns a fresh object each time (editing one rule can't edit another)", () => {
        const a = RULE_DEFS.no_days.defaults() as { days: number[] };
        a.days.push(3);
        assert.deepEqual((RULE_DEFS.no_days.defaults() as { days: number[] }).days, []);
    });

    test("only the note rule is note-only", () => {
        assert.deepEqual(RULE_ORDER.filter((t) => RULE_DEFS[t].noteOnly), ["note"]);
    });

    test("newRule defaults to must and carries the id and type", () => {
        const rule = newRule("max_per_week", "abc");
        assert.deepEqual(rule, { id: "abc", mode: "must", type: "max_per_week", n: 1 });
    });

    test("labels are tennis words, so sportText can translate them", () => {
        assert.match(RULE_DEFS.max_per_weekend.label, /matches/);
    });
});

describe("describeRule", () => {
    test("must and prefer read the same (the mode is shown separately)", () => {
        for (const type of RULE_ORDER) {
            const base = newRule(type, "x");
            assert.equal(describeRule({ ...base, mode: "prefer" } as Rule, lookup), describeRule(base, lookup), type);
        }
    });

    test("count rules, singular and plural, tennis and hockey", () => {
        const cases: [Record<string, unknown>, string, string][] = [
            [{ type: "max_per_weekend", n: 1 }, "At most 1 match per weekend", "At most 1 game per weekend"],
            [{ type: "max_per_weekend", n: 2 }, "At most 2 matches per weekend", "At most 2 games per weekend"],
            [{ type: "max_per_weekend", n: 0 }, "At most 0 matches per weekend", "At most 0 games per weekend"],
            [{ type: "max_weekend_total", n: 3 }, "At most 3 matches on Sat/Sun all season", "At most 3 games on Sat/Sun all season"],
            [{ type: "max_weekend_total", n: 1 }, "At most 1 match on Sat/Sun all season", "At most 1 game on Sat/Sun all season"],
            [{ type: "max_per_week", n: 1 }, "At most 1 match per week", "At most 1 game per week"],
            [{ type: "max_on_day", day: 0, n: 2 }, "At most 2 matches on Sundays all season", "At most 2 games on Sundays all season"],
            [{ type: "max_on_day", day: 6, n: 1 }, "At most 1 match on Saturdays all season", "At most 1 game on Saturdays all season"],
            [{ type: "min_days_between", n: 1 }, "At least 1 day between matches", "At least 1 day between games"],
            [{ type: "min_days_between", n: 6 }, "At least 6 days between matches", "At least 6 days between games"],
            [{ type: "min_days_between", n: 0 }, "At least 0 days between matches", "At least 0 days between games"],
        ];
        for (const [fields, tennis, ice] of cases) {
            assert.equal(describeRule(r(fields), lookup), tennis);
            assert.equal(describeRule(r(fields), hockey), ice);
        }
    });

    test("day lists: one, two, three days, and none chosen", () => {
        assert.equal(describeRule(r({ type: "no_days", days: [2] }), lookup), "Not on Tuesdays");
        assert.equal(describeRule(r({ type: "no_days", days: [6, 0] }), lookup), "Not on Saturdays or Sundays");
        assert.equal(describeRule(r({ type: "only_days", days: [1, 3, 5] }), lookup), "Only on Mondays, Wednesdays or Fridays");
        assert.equal(describeRule(r({ type: "no_days", days: [] }), lookup), "No days chosen yet");
        assert.equal(describeRule(r({ type: "only_days", days: [] }), lookup), "No days chosen yet");
    });

    test("dates: single day, range, several ranges, none", () => {
        assert.equal(describeRule(r({ type: "not_dates", ranges: [{ from: "2027-03-06" }] }), lookup), "Unavailable Sat, Mar 6");
        assert.equal(
            describeRule(r({ type: "not_dates", ranges: [{ from: "2027-04-10", to: "2027-04-11" }, { from: "2027-05-01" }] }), lookup),
            "Unavailable Sat, Apr 10 – Sun, Apr 11; Sat, May 1"
        );
        assert.equal(describeRule(r({ type: "not_dates", ranges: [] }), lookup), "No dates chosen yet");
    });

    test("start times in 12-hour words", () => {
        assert.equal(describeRule(r({ type: "no_start_after", time: "18:00" }), lookup), "Start no later than 6:00 PM");
        assert.equal(describeRule(r({ type: "no_start_before", time: "09:30" }), lookup), "Start no earlier than 9:30 AM");
        assert.equal(describeRule(r({ type: "no_start_before", time: "12:00" }), lookup), "Start no earlier than 12:00 PM");
    });

    test("locations: names looked up, unknown ids dropped, all-unknown reads as none chosen", () => {
        assert.equal(describeRule(r({ type: "only_locations", locationIds: ["l1"] }), lookup), "Only at Riverside");
        assert.equal(describeRule(r({ type: "only_locations", locationIds: ["l1", "gone", "l2", "l3"] }), lookup), "Only at Riverside, Lakeview or Oak Park");
        assert.equal(describeRule(r({ type: "avoid_locations", locationIds: ["l2"] }), lookup), "Not at Lakeview");
        assert.equal(describeRule(r({ type: "only_locations", locationIds: ["gone"] }), lookup), "No locations chosen yet");
        assert.equal(describeRule(r({ type: "avoid_locations", locationIds: [] }), lookup), "No locations chosen yet");
    });

    test("teams: names looked up, unknown ids dropped", () => {
        assert.equal(describeRule(r({ type: "not_same_time", teamIds: ["t1", "t2"] }), lookup), "Not at the same time as Hawks or Storm");
        assert.equal(describeRule(r({ type: "not_same_day", teamIds: ["gone", "t3"] }), lookup), "Not on the same day as Wolves");
        assert.equal(describeRule(r({ type: "not_same_time", teamIds: ["gone"] }), lookup), "No teams chosen yet");
        assert.equal(describeRule(r({ type: "not_same_day", teamIds: [] }), lookup), "No teams chosen yet");
    });

    test("a lookup that knows nothing never prints an id or 'undefined'", () => {
        const blind: NameLookup = { team: () => undefined, location: () => undefined };
        for (const type of RULE_ORDER) {
            const rule = { ...newRule(type, "x"), ...(type.includes("location") ? { locationIds: ["l1"] } : {}), ...(type.startsWith("not_same") ? { teamIds: ["t1"] } : {}) } as Rule;
            const text = describeRule(rule, blind);
            assert.doesNotMatch(text, /undefined|\bl1\b|\bt1\b/, `${type}: ${text}`);
            assert.ok(text.length > 0);
        }
    });

    test("notes are shown as written; empty reads 'Empty note'", () => {
        assert.equal(describeRule(r({ type: "note", text: "Early games please" }), lookup), "Early games please");
        assert.equal(describeRule(r({ type: "note", text: "" }), lookup), "Empty note");
    });

    test("no lookup terms = tennis words; every sport speaks its own", () => {
        const rule = r({ type: "max_per_week", n: 2 });
        assert.equal(describeRule(rule, lookup), "At most 2 matches per week");
        for (const id of SPORT_IDS) assert.equal(describeRule(rule, { ...lookup, terms: SPORTS[id] }), `At most 2 ${SPORTS[id].matches} per week`);
    });
});
