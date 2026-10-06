/**
 * The catalogue of per-team / per-bracket scheduling rules: what each one is
 * called, what its defaults are, and how to say it in a sentence.
 *
 * The sentence matters more than it looks. It is shown on the team card, in
 * the rule editor, AND in the scheduler's explanation of why a match could
 * not be placed ("Aces 12U: at most 1 match per weekend") -- one wording in
 * all three places is what lets someone connect "this match is stuck" to
 * "because of that rule I added in September".
 */
import { DAY_PLURAL, formatRange, formatTime } from "./dates.ts";
import type { DayOfWeek, Rule, RuleMode, RuleType } from "./types.ts";

export type RuleFieldKind = "count" | "day" | "days" | "ranges" | "time" | "locations" | "teams" | "text";

export type RuleDef = {
    label: string;
    /** One-line hint shown under the rule picker. */
    hint: string;
    fields: { key: string; kind: RuleFieldKind; label: string }[];
    defaults: () => Omit<Rule, "id" | "mode" | "type">;
    /** Note-only rules are shown to the scheduler (you), never enforced. */
    noteOnly?: boolean;
};

export const RULE_DEFS: Record<RuleType, RuleDef> = {
    max_per_weekend: {
        label: "Max matches in one weekend",
        hint: "e.g. “Can’t play more than once a weekend” → 1",
        fields: [{ key: "n", kind: "count", label: "Matches per weekend" }],
        defaults: () => ({ n: 1 }),
    },
    max_weekend_total: {
        label: "Max weekend matches all season",
        hint: "e.g. “No more than 3 matches on Sat/Sun” → 3",
        fields: [{ key: "n", kind: "count", label: "Weekend matches in season" }],
        defaults: () => ({ n: 3 }),
    },
    max_per_week: {
        label: "Max matches in one week",
        hint: "Counts Monday through Sunday.",
        fields: [{ key: "n", kind: "count", label: "Matches per week" }],
        defaults: () => ({ n: 1 }),
    },
    max_on_day: {
        label: "Max matches on one weekday, all season",
        hint: "e.g. at most 2 Sunday matches all season.",
        fields: [
            { key: "day", kind: "day", label: "Day" },
            { key: "n", kind: "count", label: "Matches" },
        ],
        defaults: () => ({ day: 0 as DayOfWeek, n: 2 }),
    },
    no_days: {
        label: "Can’t play on certain days",
        hint: "Every week, all season.",
        fields: [{ key: "days", kind: "days", label: "Days" }],
        defaults: () => ({ days: [] as DayOfWeek[] }),
    },
    only_days: {
        label: "Can only play on certain days",
        hint: "Every week, all season.",
        fields: [{ key: "days", kind: "days", label: "Days" }],
        defaults: () => ({ days: [6, 0] as DayOfWeek[] }),
    },
    not_dates: {
        label: "Unavailable dates",
        hint: "Spring break, tournaments, school events.",
        fields: [{ key: "ranges", kind: "ranges", label: "Dates" }],
        defaults: () => ({ ranges: [] }),
    },
    no_start_after: {
        label: "Can’t start later than",
        hint: "Latest start time.",
        fields: [{ key: "time", kind: "time", label: "Latest start" }],
        defaults: () => ({ time: "18:00" }),
    },
    no_start_before: {
        label: "Can’t start earlier than",
        hint: "Earliest start time.",
        fields: [{ key: "time", kind: "time", label: "Earliest start" }],
        defaults: () => ({ time: "10:00" }),
    },
    only_locations: {
        label: "Only at certain locations",
        hint: "",
        fields: [{ key: "locationIds", kind: "locations", label: "Locations" }],
        defaults: () => ({ locationIds: [] }),
    },
    avoid_locations: {
        label: "Not at certain locations",
        hint: "",
        fields: [{ key: "locationIds", kind: "locations", label: "Locations" }],
        defaults: () => ({ locationIds: [] }),
    },
    min_days_between: {
        label: "Days between matches",
        hint: "3 = a Saturday match means nothing before Tuesday.",
        fields: [{ key: "n", kind: "count", label: "At least this many days apart" }],
        defaults: () => ({ n: 3 }),
    },
    not_same_time: {
        label: "Not at the same time as other teams",
        hint: "Shared coach, siblings on both teams.",
        fields: [{ key: "teamIds", kind: "teams", label: "Teams" }],
        defaults: () => ({ teamIds: [] }),
    },
    not_same_day: {
        label: "Not on the same day as other teams",
        hint: "Applies both ways.",
        fields: [{ key: "teamIds", kind: "teams", label: "Teams" }],
        defaults: () => ({ teamIds: [] }),
    },
    note: {
        label: "Other request (note only)",
        hint: "Kept with the team for you to read. The scheduler doesn’t act on it.",
        fields: [{ key: "text", kind: "text", label: "Request" }],
        defaults: () => ({ text: "" }),
        noteOnly: true,
    },
};

export const RULE_ORDER = Object.keys(RULE_DEFS) as RuleType[];

export function newRule(type: RuleType, id: string, mode: RuleMode = "must"): Rule {
    return { id, mode, type, ...RULE_DEFS[type].defaults() } as Rule;
}

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? "" : "es"}`;
}

function list(items: string[]): string {
    if (items.length <= 1) return items[0] ?? "";
    return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

export type NameLookup = {
    team: (id: string) => string | undefined;
    location: (id: string) => string | undefined;
};

/** The rule as a sentence. `lookup` turns ids into names; unknown ids are dropped. */
export function describeRule(rule: Rule, lookup: NameLookup): string {
    switch (rule.type) {
        case "max_per_weekend":
            return `At most ${plural(rule.n, "match")} per weekend`;
        case "max_weekend_total":
            return `At most ${plural(rule.n, "match")} on Sat/Sun all season`;
        case "max_per_week":
            return `At most ${plural(rule.n, "match")} per week`;
        case "max_on_day":
            return `At most ${plural(rule.n, "match")} on ${DAY_PLURAL[rule.day]} all season`;
        case "no_days":
            return rule.days.length ? `Not on ${list(rule.days.map((d) => DAY_PLURAL[d]))}` : "No days chosen yet";
        case "only_days":
            return rule.days.length ? `Only on ${list(rule.days.map((d) => DAY_PLURAL[d]))}` : "No days chosen yet";
        case "not_dates":
            return rule.ranges.length ? `Unavailable ${rule.ranges.map(formatRange).join("; ")}` : "No dates chosen yet";
        case "no_start_after":
            return `Start no later than ${formatTime(rule.time)}`;
        case "no_start_before":
            return `Start no earlier than ${formatTime(rule.time)}`;
        case "only_locations": {
            const names = rule.locationIds.map(lookup.location).filter(Boolean) as string[];
            return names.length ? `Only at ${list(names)}` : "No locations chosen yet";
        }
        case "avoid_locations": {
            const names = rule.locationIds.map(lookup.location).filter(Boolean) as string[];
            return names.length ? `Not at ${list(names)}` : "No locations chosen yet";
        }
        case "min_days_between":
            return `At least ${rule.n} day${rule.n === 1 ? "" : "s"} between matches`;
        case "not_same_time": {
            const names = rule.teamIds.map(lookup.team).filter(Boolean) as string[];
            return names.length ? `Not at the same time as ${list(names)}` : "No teams chosen yet";
        }
        case "not_same_day": {
            const names = rule.teamIds.map(lookup.team).filter(Boolean) as string[];
            return names.length ? `Not on the same day as ${list(names)}` : "No teams chosen yet";
        }
        case "note":
            return rule.text || "Empty note";
    }
}
