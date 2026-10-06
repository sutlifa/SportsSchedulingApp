/**
 * The scheduler.
 *
 * Two jobs, done in this order every attempt:
 *
 *  1. PAIRING -- inside each pool, decide who plays whom so every team gets
 *     its guaranteed number of matches, spreading repeats evenly (a 4-team
 *     pool playing 5 matches each must meet some opponents twice; nobody
 *     should meet one opponent three times while never seeing another).
 *  2. PLACEMENT -- put each pairing into a concrete (date, start time,
 *     location) with a free court, never breaking a "must" rule, and scoring
 *     candidates so "prefer" rules hold where possible and each team's
 *     matches are spread across the season rather than bunched up.
 *
 * Placement is greedy, hardest-match-first, and that is not optimal on its
 * own: an early choice can strand a later match. So the whole thing is
 * re-run with different random tie-breaks (and different pairings) until a
 * time budget runs out, and the best attempt wins -- fewest unplaced
 * matches first, then lowest total penalty. In practice a few dozen attempts
 * finds a full schedule whenever one is reasonably findable, in well under
 * two seconds, which is the right trade for an interactive "Generate" button.
 *
 * Teams are not required to play every week. Nothing here asks for one
 * match per week; the spreading penalty only discourages bunching.
 *
 * Pure: no I/O, no Date.now() unless injected, deterministic for a given
 * seed. scripts/verify-engine.ts checks the invariants -- run it after any
 * change here.
 */
import {
    dayToIso,
    dowOf,
    DAY_PLURAL,
    formatTime,
    isIsoDate,
    isTime,
    isoToDay,
    isWeekend,
    rangesToDays,
    toMinutes,
    weekKey,
    weekendKey,
} from "./dates.ts";
import { describeRule, type NameLookup } from "./rules.ts";
import type { Bracket, League, Match, Rule, RuleMode, Team } from "./types.ts";

// ---------------------------------------------------------------------------
// Context: everything derived from the league once, before any attempt runs.
// ---------------------------------------------------------------------------

/** One concrete occurrence of a weekly slot on a real date. */
export type Instance = {
    idx: number;
    day: number;
    date: string;
    time: string;
    minutes: number;
    slotId: string;
    locationId: string;
    capacity: number;
    bracketIds: Set<string> | null;
};

type StaticRuleCheck = { rule: Rule; text: string; test: (inst: Instance) => boolean };
type DynamicRule = Extract<
    Rule,
    { type: "max_per_weekend" | "max_weekend_total" | "max_per_week" | "max_on_day" | "min_days_between" }
>;

type TeamCtx = {
    team: Team;
    bracket: Bracket;
    target: number;
    club: string;
    staticRules: StaticRuleCheck[];
    dynamicRules: { rule: DynamicRule; text: string }[];
    /** Other team id -> mode. Symmetric: if A lists B, B gets A too. */
    sameTime: Map<string, RuleMode>;
    sameDay: Map<string, RuleMode>;
    /** Per instance: first "must" violation from static rules + bracket limits, or null. */
    staticHard: (string | null)[];
    /** Per instance: "prefer" violations from static rules. */
    staticSoft: string[][];
};

export type Ctx = {
    league: League;
    teams: Map<string, TeamCtx>;
    instances: Instance[];
    instByKey: Map<string, Instance>;
    /**
     * `${date}|${time}|${locationId}` -> instance. A saved match whose slot id
     * is gone (a facility sheet re-imported, a weekly slot deleted and
     * re-added) still finds the same court time by WHEN and WHERE, so it keeps
     * counting against that time's capacity instead of silently not.
     */
    instByTime: Map<string, Instance>;
    /** `${locationId}|${date}` pairs that a facility sheet defines. */
    covered: Set<string>;
    startDay: number;
    endDay: number;
    seasonDays: number;
    maxPerDay: number;
    matchMinutes: number;
    clubLimit: number | null;
    clubMode: RuleMode;
    lookup: NameLookup;
    warnings: string[];
};

export function instanceKey(date: string, slotId: string): string {
    return `${date}|${slotId}`;
}

export function poolKey(bracketId: string, pool: string): string {
    return `${bracketId}::${pool.trim().toLowerCase()}`;
}

export function teamTarget(team: Team, bracket: Bracket | undefined): number {
    const n = team.matches ?? bracket?.matches ?? 0;
    return Math.max(0, Math.floor(n));
}

export function makeLookup(league: League): NameLookup {
    const t = new Map(league.teams.map((x) => [x.id, x.name]));
    const l = new Map(league.locations.map((x) => [x.id, x.name]));
    return { team: (id) => t.get(id), location: (id) => l.get(id) };
}

function compileStatic(rule: Rule, liveLocations: Set<string>): ((inst: Instance) => boolean) | null {
    switch (rule.type) {
        case "no_days": {
            const s = new Set<number>(rule.days);
            return (i) => !s.has(dowOf(i.day));
        }
        case "only_days": {
            const s = new Set<number>(rule.days);
            return (i) => s.size === 0 || s.has(dowOf(i.day));
        }
        case "not_dates": {
            const s = rangesToDays(rule.ranges);
            return (i) => !s.has(i.day);
        }
        case "no_start_after": {
            if (!isTime(rule.time)) return null;
            const t = toMinutes(rule.time);
            return (i) => i.minutes <= t;
        }
        case "no_start_before": {
            if (!isTime(rule.time)) return null;
            const t = toMinutes(rule.time);
            return (i) => i.minutes >= t;
        }
        case "only_locations": {
            // Ids of deleted locations are dropped, so an "only at X" whose X
            // was deleted reads -- and behaves -- as no restriction, matching
            // describeRule ("No locations chosen yet") instead of silently
            // blocking every slot.
            const s = new Set(rule.locationIds.filter((id) => liveLocations.has(id)));
            return (i) => s.size === 0 || s.has(i.locationId);
        }
        case "avoid_locations": {
            const s = new Set(rule.locationIds);
            return (i) => !s.has(i.locationId);
        }
        default:
            return null;
    }
}

function bracketHard(b: Bracket, inst: Instance): string | null {
    if (inst.bracketIds && !inst.bracketIds.has(b.id)) return `This time slot isn’t open to ${b.name}`;
    if (isTime(b.earliest) && inst.minutes < toMinutes(b.earliest))
        return `${b.name} can’t start before ${formatTime(b.earliest)}`;
    if (isTime(b.latest) && inst.minutes > toMinutes(b.latest))
        return `${b.name} can’t start after ${formatTime(b.latest)}`;
    if (b.days.length && !b.days.includes(dowOf(inst.day))) return `${b.name} doesn’t play on ${DAY_PLURAL[dowOf(inst.day)]}`;
    return null;
}

export function prepare(league: League): Ctx {
    const warnings: string[] = [];
    const lookup = makeLookup(league);
    const s = league.settings;
    const brackets = new Map(league.brackets.map((b) => [b.id, b]));

    // Instances: every weekly slot on every non-blackout date in the season.
    const instances: Instance[] = [];
    let startDay = 0;
    let endDay = -1;
    if (isIsoDate(s.seasonStart) && isIsoDate(s.seasonEnd)) {
        startDay = isoToDay(s.seasonStart);
        endDay = isoToDay(s.seasonEnd);
    }
    const locations = new Set(league.locations.map((l) => l.id));
    const blackout = rangesToDays(s.blackouts);
    const courtsPerMatch = Math.max(1, Math.floor(s.courtsPerMatch || 1));
    const slots = league.slots
        .filter((sl) => isTime(sl.time) && locations.has(sl.locationId) && sl.capacity > 0)
        .sort((a, b) => toMinutes(a.time) - toMinutes(b.time));
    // Uploaded facility availability replaces the weekly pattern for every
    // (location, date) it mentions -- including dates it marks closed (0
    // courts), which is exactly how a facility says "not that Saturday".
    const avail = (league.availability ?? []).filter((a) => isIsoDate(a.date) && isTime(a.time) && locations.has(a.locationId));
    const covered = new Set(avail.map((a) => `${a.locationId}|${a.date}`));
    const availByDay = new Map<number, typeof avail>();
    for (const a of avail) {
        const d = isoToDay(a.date);
        if (!availByDay.has(d)) availByDay.set(d, []);
        availByDay.get(d)!.push(a);
    }
    // A season longer than ~2 years is a typo; cap the loop rather than hang the tab.
    for (let d = startDay; d <= endDay && d - startDay < 800; d++) {
        if (blackout.has(d)) continue;
        const dow = dowOf(d);
        const date = dayToIso(d);
        const today: Instance[] = [];
        for (const sl of slots) {
            if (sl.day !== dow || covered.has(`${sl.locationId}|${date}`)) continue;
            today.push({
                idx: 0,
                day: d,
                date,
                time: sl.time,
                minutes: toMinutes(sl.time),
                slotId: sl.id,
                locationId: sl.locationId,
                capacity: Math.floor(sl.capacity),
                bracketIds: sl.bracketIds.length ? new Set(sl.bracketIds) : null,
            });
        }
        for (const a of availByDay.get(d) ?? []) {
            const capacity = Math.floor(a.courts / courtsPerMatch);
            if (capacity <= 0) continue;
            today.push({
                idx: 0,
                day: d,
                date,
                time: a.time,
                minutes: toMinutes(a.time),
                slotId: a.id,
                locationId: a.locationId,
                capacity,
                bracketIds: a.bracketIds.length ? new Set(a.bracketIds) : null,
            });
        }
        today.sort((x, y) => x.minutes - y.minutes);
        for (const inst of today) instances.push({ ...inst, idx: instances.length });
    }
    const instByKey = new Map(instances.map((i) => [instanceKey(i.date, i.slotId), i]));
    const instByTime = new Map<string, Instance>();
    for (const i of instances) {
        const k = `${i.date}|${i.time}|${i.locationId}`;
        if (!instByTime.has(k)) instByTime.set(k, i);
    }

    const liveLocations = new Set(league.locations.map((l) => l.id));
    const teams = new Map<string, TeamCtx>();
    for (const team of league.teams) {
        const bracket = brackets.get(team.bracketId);
        if (!bracket) {
            warnings.push(`${team.name} isn’t in an age bracket, so it can’t be scheduled.`);
            continue;
        }
        const rules = [...bracket.rules, ...team.rules];
        const staticRules: StaticRuleCheck[] = [];
        const dynamicRules: TeamCtx["dynamicRules"] = [];
        for (const rule of rules) {
            const text = `${team.name}: ${describeRule(rule, lookup)}`;
            const test = compileStatic(rule, liveLocations);
            if (test) staticRules.push({ rule, text, test });
            else if (
                rule.type === "max_per_weekend" ||
                rule.type === "max_weekend_total" ||
                rule.type === "max_per_week" ||
                rule.type === "max_on_day" ||
                rule.type === "min_days_between"
            )
                dynamicRules.push({ rule, text });
        }
        const staticHard: (string | null)[] = [];
        const staticSoft: string[][] = [];
        for (const inst of instances) {
            let hard = bracketHard(bracket, inst);
            const soft: string[] = [];
            for (const r of staticRules) {
                if (r.test(inst)) continue;
                if (r.rule.mode === "prefer") soft.push(r.text);
                else if (!hard) hard = r.text;
            }
            staticHard.push(hard);
            staticSoft.push(soft);
        }
        teams.set(team.id, {
            team,
            bracket,
            target: teamTarget(team, bracket),
            club: team.club.trim().toLowerCase(),
            staticRules,
            dynamicRules,
            sameTime: new Map(),
            sameDay: new Map(),
            staticHard,
            staticSoft,
        });
    }

    // "Not at the same time as X" has to hold from both sides, or scheduling
    // X second would walk straight past the rule that lives on the other team.
    const strongest = (a: RuleMode | undefined, b: RuleMode): RuleMode => (a === "must" || b === "must" ? "must" : "prefer");
    for (const tc of teams.values()) {
        for (const rule of [...tc.bracket.rules, ...tc.team.rules]) {
            if (rule.type !== "not_same_time" && rule.type !== "not_same_day") continue;
            for (const other of rule.teamIds) {
                const oc = teams.get(other);
                if (!oc || other === tc.team.id) continue;
                const key = rule.type === "not_same_time" ? "sameTime" : "sameDay";
                tc[key].set(other, strongest(tc[key].get(other), rule.mode));
                oc[key].set(tc.team.id, strongest(oc[key].get(tc.team.id), rule.mode));
            }
        }
    }

    return {
        league,
        teams,
        instances,
        instByKey,
        instByTime,
        covered,
        startDay,
        endDay,
        seasonDays: Math.max(1, endDay - startDay + 1),
        maxPerDay: Math.max(1, Math.floor(s.maxPerDay || 1)),
        matchMinutes: Math.max(1, Math.floor(s.matchMinutes || 90)),
        clubLimit: s.clubLimit && s.clubLimit > 0 ? Math.floor(s.clubLimit) : null,
        clubMode: s.clubLimitMode,
        lookup,
        warnings,
    };
}

// ---------------------------------------------------------------------------
// State: what has been placed so far in one attempt.
// ---------------------------------------------------------------------------

type Game = { day: number; minutes: number };

/** Where a match sits. `idx` is -1 for a kept match whose slot no longer exists. */
export type Spot = { idx: number; day: number; minutes: number; locationId: string; time: string; date: string; slotId: string };

type State = {
    used: number[];
    games: Map<string, Game[]>;
    /**
     * `${day}|${club}` -> start minutes of that club's matches that day (one
     * entry per match). Checked by OVERLAP (within matchMinutes), like the
     * team and not_same_time checks: staggered 9:00 / 9:30 / 10:00 starts are
     * all on court at once and must count against the club limit together.
     */
    clubAt: Map<string, number[]>;
    /** `${day}|${minutes}|${bracketId}` -> matches of that bracket at that start. */
    bracketAt: Map<string, number>;
    dayLoad: Map<number, number>;
};

function newState(ctx: Ctx): State {
    return { used: new Array(ctx.instances.length).fill(0), games: new Map(), clubAt: new Map(), bracketAt: new Map(), dayLoad: new Map() };
}

function clubsOf(ctx: Ctx, home: string, away: string): string[] {
    const out: string[] = [];
    for (const id of [home, away]) {
        const c = ctx.teams.get(id)?.club;
        if (c && !out.includes(c)) out.push(c);
    }
    return out;
}

function bump(map: Map<string, number> | Map<number, number>, key: string | number, by: number) {
    const m = map as Map<string | number, number>;
    const v = (m.get(key) ?? 0) + by;
    if (v === 0) m.delete(key);
    else m.set(key, v);
}

function place(ctx: Ctx, st: State, home: string, away: string, spot: Spot, by: 1 | -1) {
    if (spot.idx >= 0) st.used[spot.idx] += by;
    for (const id of [home, away]) {
        let g = st.games.get(id);
        if (!g) st.games.set(id, (g = []));
        if (by === 1) g.push({ day: spot.day, minutes: spot.minutes });
        else {
            const i = g.findIndex((x) => x.day === spot.day && x.minutes === spot.minutes);
            if (i >= 0) g.splice(i, 1);
        }
    }
    for (const c of clubsOf(ctx, home, away)) {
        const k = `${spot.day}|${c}`;
        const list = st.clubAt.get(k) ?? [];
        if (by === 1) list.push(spot.minutes);
        else {
            const i = list.indexOf(spot.minutes);
            if (i >= 0) list.splice(i, 1);
        }
        if (list.length) st.clubAt.set(k, list);
        else st.clubAt.delete(k);
    }
    const b = ctx.teams.get(home)?.bracket.id;
    if (b) bump(st.bracketAt, `${spot.day}|${spot.minutes}|${b}`, by);
    bump(st.dayLoad, spot.day, by);
}

function spotOf(inst: Instance): Spot {
    return { idx: inst.idx, day: inst.day, minutes: inst.minutes, locationId: inst.locationId, time: inst.time, date: inst.date, slotId: inst.slotId };
}

// ---------------------------------------------------------------------------
// Checking one placement.
// ---------------------------------------------------------------------------

export type Verdict = { hard: string[]; soft: string[] };

function dynamicOk(rule: DynamicRule, games: Game[], day: number): boolean {
    switch (rule.type) {
        case "max_per_weekend": {
            const w = weekendKey(day);
            if (w === null) return true;
            return games.filter((g) => weekendKey(g.day) === w).length < rule.n;
        }
        case "max_weekend_total":
            if (!isWeekend(day)) return true;
            return games.filter((g) => isWeekend(g.day)).length < rule.n;
        case "max_per_week": {
            const w = weekKey(day);
            return games.filter((g) => weekKey(g.day) === w).length < rule.n;
        }
        case "max_on_day": {
            if (dowOf(day) !== rule.day) return true;
            return games.filter((g) => dowOf(g.day) === rule.day).length < rule.n;
        }
        case "min_days_between":
            return games.every((g) => Math.abs(g.day - day) >= rule.n);
    }
}

/**
 * Every rule a placement would break, split into must / prefer.
 *
 * `firstHardOnly` stops at the first must-violation -- the generator only
 * needs a yes/no and this runs hundreds of thousands of times. The audit and
 * the "move this match" picker pass false to get the full list.
 */
function check(ctx: Ctx, st: State, home: string, away: string, spot: Spot, capacity: number, firstHardOnly: boolean): Verdict {
    const hard: string[] = [];
    const soft: string[] = [];
    const stop = () => firstHardOnly && hard.length > 0;

    if (spot.idx >= 0 && st.used[spot.idx] >= capacity) {
        hard.push("All courts are already taken at that time");
        if (stop()) return { hard, soft };
    }

    for (const id of [home, away]) {
        const tc = ctx.teams.get(id);
        if (!tc) continue;
        if (spot.idx >= 0) {
            const sh = tc.staticHard[spot.idx];
            if (sh) {
                hard.push(sh);
                if (stop()) return { hard, soft };
            }
            soft.push(...tc.staticSoft[spot.idx]);
        }
        const games = st.games.get(id) ?? [];
        const sameDay = games.filter((g) => g.day === spot.day);
        if (sameDay.length >= ctx.maxPerDay) {
            hard.push(`${tc.team.name} already plays that day`);
            if (stop()) return { hard, soft };
        } else if (sameDay.some((g) => Math.abs(g.minutes - spot.minutes) < ctx.matchMinutes)) {
            hard.push(`${tc.team.name} is already playing at that time`);
            if (stop()) return { hard, soft };
        }
        for (const { rule, text } of tc.dynamicRules) {
            if (dynamicOk(rule, games, spot.day)) continue;
            if (rule.mode === "prefer") soft.push(text);
            else {
                hard.push(text);
                if (stop()) return { hard, soft };
            }
        }
        for (const [other, mode] of tc.sameTime) {
            if (other === home || other === away) continue;
            const og = st.games.get(other);
            if (!og?.some((g) => g.day === spot.day && Math.abs(g.minutes - spot.minutes) < ctx.matchMinutes)) continue;
            const text = `${tc.team.name}: not at the same time as ${ctx.lookup.team(other) ?? "another team"}`;
            if (mode === "prefer") soft.push(text);
            else {
                hard.push(text);
                if (stop()) return { hard, soft };
            }
        }
        for (const [other, mode] of tc.sameDay) {
            if (other === home || other === away) continue;
            if (!st.games.get(other)?.some((g) => g.day === spot.day)) continue;
            const text = `${tc.team.name}: not on the same day as ${ctx.lookup.team(other) ?? "another team"}`;
            if (mode === "prefer") soft.push(text);
            else {
                hard.push(text);
                if (stop()) return { hard, soft };
            }
        }
    }

    if (ctx.clubLimit !== null) {
        for (const c of clubsOf(ctx, home, away)) {
            if (clubOverlap(ctx, st, spot.day, spot.minutes, c) + 1 <= ctx.clubLimit) continue;
            const name = ctx.teams.get(home)?.club.trim().toLowerCase() === c ? ctx.teams.get(home)!.team.club : ctx.teams.get(away)!.team.club;
            const text = `More than ${ctx.clubLimit} ${name} ${ctx.clubLimit === 1 ? "match" : "matches"} on court at the same time`;
            if (ctx.clubMode === "prefer") soft.push(text);
            else {
                hard.push(text);
                if (stop()) return { hard, soft };
            }
        }
    }
    // Duplicate texts appear when both teams share a bracket-wide rule.
    return { hard: [...new Set(hard)], soft: [...new Set(soft)] };
}

/**
 * Lower is better. Only called for placements with no hard violations.
 * The weights were tuned by eye against the verify fixtures: a broken
 * "prefer" rule (60) outweighs any amount of bunching, which outweighs
 * slot crowding, which outweighs random tie-breaking.
 */
/** Matches of this club already on court at an overlapping time that day. */
function clubOverlap(ctx: Ctx, st: State, day: number, minutes: number, club: string): number {
    const list = st.clubAt.get(`${day}|${club}`);
    if (!list) return 0;
    let n = 0;
    for (const m of list) if (Math.abs(m - minutes) < ctx.matchMinutes) n++;
    return n;
}

function score(ctx: Ctx, st: State, home: string, away: string, inst: Instance, softCount: number, rand: number): number {
    let s = softCount * 60;
    for (const id of [home, away]) {
        const tc = ctx.teams.get(id)!;
        // Ideal spacing if this team's matches were spread evenly over the season.
        const ideal = Math.max(3, ctx.seasonDays / Math.max(1, tc.target));
        for (const g of st.games.get(id) ?? []) {
            const gap = Math.abs(g.day - inst.day);
            if (gap < ideal) s += ((ideal - gap) / ideal) ** 2 * 40;
        }
    }
    s += (st.used[inst.idx] / inst.capacity) * 6;
    s += (st.bracketAt.get(`${inst.day}|${inst.minutes}|${ctx.teams.get(home)!.bracket.id}`) ?? 0) * 3;
    for (const c of clubsOf(ctx, home, away)) s += clubOverlap(ctx, st, inst.day, inst.minutes, c) * 8;
    s += (st.dayLoad.get(inst.day) ?? 0) * 0.15;
    return s + rand * 4;
}

// ---------------------------------------------------------------------------
// Pairing.
// ---------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Pairs within one pool so each team reaches `need`.
 *
 * Greedy: the neediest team takes the opponent it has met least. That can
 * end with one team still short while everyone else is done; the repair
 * step then breaks an existing pairing (x vs y) into (short vs x) and
 * (short vs y), which keeps x and y at the same count and gives the short
 * team two. After that, a team can only be short if the pool's total is odd
 * (5 teams x 5 matches = 25 team-slots can't be split into pairs) or the
 * pool has one team -- both reported as warnings, never hidden.
 */
export function pairPool(ids: string[], need: Map<string, number>, meets: Map<string, number>, rng: () => number): [string, string][] {
    const left = new Map(ids.map((id) => [id, Math.max(0, need.get(id) ?? 0)]));
    const met = new Map(meets);
    const pairs: [string, string][] = [];
    const meet = (a: string, b: string) => met.get(pairKey(a, b)) ?? 0;
    for (let guard = 0; guard < 10_000; guard++) {
        const open = shuffle(ids.filter((id) => left.get(id)! > 0), rng).sort((x, y) => left.get(y)! - left.get(x)!);
        if (open.length < 2) break;
        const a = open[0];
        const b = open.slice(1).sort((x, y) => meet(a, x) - meet(a, y) || left.get(y)! - left.get(x)!)[0];
        pairs.push([a, b]);
        left.set(a, left.get(a)! - 1);
        left.set(b, left.get(b)! - 1);
        met.set(pairKey(a, b), meet(a, b) + 1);
    }
    for (const short of ids) {
        while (left.get(short)! >= 2) {
            // Break the pairing whose teams the short team has met least.
            let best = -1;
            let bestCost = Infinity;
            pairs.forEach(([x, y], i) => {
                if (x === short || y === short) return;
                const cost = meet(short, x) + meet(short, y) - meet(x, y) * 0.5 + rng() * 0.1;
                if (cost < bestCost) {
                    bestCost = cost;
                    best = i;
                }
            });
            if (best < 0) break;
            const [x, y] = pairs[best];
            pairs.splice(best, 1, [short, x], [short, y]);
            met.set(pairKey(x, y), meet(x, y) - 1);
            met.set(pairKey(short, x), meet(short, x) + 1);
            met.set(pairKey(short, y), meet(short, y) + 1);
            left.set(short, left.get(short)! - 2);
        }
    }
    return pairs;
}

/** How unevenly opponents repeat: sum of squared meeting counts. Lower = more even. */
function repeatCost(pairs: [string, string][], meets: Map<string, number>): number {
    const m = new Map(meets);
    for (const [a, b] of pairs) m.set(pairKey(a, b), (m.get(pairKey(a, b)) ?? 0) + 1);
    let c = 0;
    for (const v of m.values()) c += v * v;
    return c;
}

// ---------------------------------------------------------------------------
// Generate.
// ---------------------------------------------------------------------------

export type GenerateOptions = {
    /** "all", or one bracket id: only that bracket's unlocked matches are replaced. */
    scope: string;
    seed: number;
    timeBudgetMs?: number;
    maxAttempts?: number;
    now?: () => number;
};

export type GenerateResult = {
    matches: Match[];
    warnings: string[];
    needed: number;
    placed: number;
    attempts: number;
};

function matchTeamsExist(ctx: Ctx, m: Match): boolean {
    return ctx.teams.has(m.home) && ctx.teams.has(m.away);
}

/** Where a saved match sits, or null if it is unplaced / malformed. */
export function spotForMatch(ctx: Ctx, m: Match): Spot | null {
    if (!m.date || !m.time || !isIsoDate(m.date) || !isTime(m.time)) return null;
    const inst =
        (m.slotId ? ctx.instByKey.get(instanceKey(m.date, m.slotId)) : undefined) ??
        (m.locationId ? ctx.instByTime.get(`${m.date}|${m.time}|${m.locationId}`) : undefined);
    if (inst && inst.time === m.time) return spotOf(inst);
    return {
        idx: -1,
        day: isoToDay(m.date),
        minutes: toMinutes(m.time),
        locationId: m.locationId ?? "",
        time: m.time,
        date: m.date,
        slotId: m.slotId ?? "",
    };
}

export function generate(league: League, previous: Match[], opts: GenerateOptions): GenerateResult {
    const now = opts.now ?? (() => Date.now());
    const ctx = prepare(league);
    const warnings = [...ctx.warnings];
    const inScope = (bracketId: string) => opts.scope === "all" || opts.scope === bracketId;

    if (ctx.instances.length === 0) {
        warnings.push("There are no open time slots in the season. Check the season dates and add weekly time slots.");
    }

    const kept = previous.filter((m) => matchTeamsExist(ctx, m) && (m.locked || !inScope(m.bracketId)));

    // Group in-scope teams into pools.
    const pools = new Map<string, string[]>();
    for (const tc of ctx.teams.values()) {
        if (!inScope(tc.bracket.id)) continue;
        const k = poolKey(tc.bracket.id, tc.team.pool);
        if (!pools.has(k)) pools.set(k, []);
        pools.get(k)!.push(tc.team.id);
    }

    // What the kept matches already cover.
    const keptCount = new Map<string, number>();
    const keptMeets = new Map<string, number>();
    for (const m of kept) {
        keptCount.set(m.home, (keptCount.get(m.home) ?? 0) + 1);
        keptCount.set(m.away, (keptCount.get(m.away) ?? 0) + 1);
        keptMeets.set(pairKey(m.home, m.away), (keptMeets.get(pairKey(m.home, m.away)) ?? 0) + 1);
    }
    const need = new Map<string, number>();
    for (const ids of pools.values())
        for (const id of ids) need.set(id, Math.max(0, ctx.teams.get(id)!.target - (keptCount.get(id) ?? 0)));

    // Static candidate list per pairing, cached across attempts.
    const candCache = new Map<string, Instance[]>();
    const candidatesFor = (a: string, b: string) => {
        const k = pairKey(a, b);
        let c = candCache.get(k);
        if (!c) {
            const ta = ctx.teams.get(a)!;
            const tb = ctx.teams.get(b)!;
            c = ctx.instances.filter((i) => !ta.staticHard[i.idx] && !tb.staticHard[i.idx]);
            candCache.set(k, c);
        }
        return c;
    };

    const budget = opts.timeBudgetMs ?? 1500;
    const maxAttempts = opts.maxAttempts ?? 400;
    const started = now();

    type Attempt = { placed: Match[]; unplaced: Match[]; penalty: number; st: State; shortfalls: string[] };
    let best: Attempt | null = null;
    let attempts = 0;
    let neededTotal = 0;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (attempt >= 3 && now() - started > budget) break;
        if (best && best.unplaced.length === 0 && attempt >= 12 && now() - started > budget / 3) break;
        attempts++;
        const rng = mulberry32((opts.seed + attempt * 7919) >>> 0);
        const st = newState(ctx);
        for (const m of kept) {
            const spot = spotForMatch(ctx, m);
            if (spot) place(ctx, st, m.home, m.away, spot, 1);
        }

        // Pair every pool (best of a few tries for even repeats).
        const pairs: { home: string; away: string; bracketId: string; pool: string }[] = [];
        const shortfalls: string[] = [];
        for (const ids of pools.values()) {
            const first = ctx.teams.get(ids[0])!;
            const poolName = `${first.bracket.name}${first.team.pool.trim() ? ` · Pool ${first.team.pool.trim()}` : ""}`;
            if (ids.length < 2) {
                if ((need.get(ids[0]) ?? 0) > 0)
                    shortfalls.push(`${first.team.name} is the only team in ${poolName}, so it has nobody to play.`);
                continue;
            }
            let bestPairs: [string, string][] = [];
            let bestCost = Infinity;
            for (let t = 0; t < 6; t++) {
                const p = pairPool(ids, need, keptMeets, rng);
                const got = p.length * 2;
                const cost = -got * 1000 + repeatCost(p, keptMeets);
                if (cost < bestCost) {
                    bestCost = cost;
                    bestPairs = p;
                }
            }
            const got = new Map<string, number>();
            for (const [a, b] of bestPairs) {
                got.set(a, (got.get(a) ?? 0) + 1);
                got.set(b, (got.get(b) ?? 0) + 1);
            }
            for (const id of ids) {
                const n = need.get(id) ?? 0;
                if ((got.get(id) ?? 0) < n) {
                    const tc = ctx.teams.get(id)!;
                    shortfalls.push(
                        `${tc.team.name} gets ${tc.target - n + (got.get(id) ?? 0)} of ${tc.target} matches: ${poolName} has an odd total, so one team must come up one short (or add a team).`
                    );
                }
            }
            // Alternate home/away so each team hosts about half.
            const homes = new Map<string, number>();
            for (const m of kept) homes.set(m.home, (homes.get(m.home) ?? 0) + 1);
            for (const [a, b] of bestPairs) {
                const ha = homes.get(a) ?? 0;
                const hb = homes.get(b) ?? 0;
                const aHome = ha < hb || (ha === hb && rng() < 0.5);
                const [home, away] = aHome ? [a, b] : [b, a];
                homes.set(home, (homes.get(home) ?? 0) + 1);
                pairs.push({ home, away, bracketId: first.bracket.id, pool: first.team.pool.trim() });
            }
        }
        neededTotal = pairs.length;

        // Hardest first: fewest statically possible spots, jittered so attempts differ.
        const order = pairs
            .map((p) => ({ p, k: candidatesFor(p.home, p.away).length * (0.8 + rng() * 0.4) }))
            .sort((x, y) => x.k - y.k)
            .map((x) => x.p);

        const placed: Match[] = [];
        const unplaced: Match[] = [];
        let penalty = 0;
        for (const p of order) {
            let bestInst: Instance | null = null;
            let bestScore = Infinity;
            for (const inst of candidatesFor(p.home, p.away)) {
                const spot = spotOf(inst);
                const v = check(ctx, st, p.home, p.away, spot, inst.capacity, true);
                if (v.hard.length) continue;
                const sc = score(ctx, st, p.home, p.away, inst, v.soft.length, rng());
                if (sc < bestScore) {
                    bestScore = sc;
                    bestInst = inst;
                }
            }
            const id = `m${(opts.seed >>> 0).toString(36)}${attempt.toString(36)}x${(placed.length + unplaced.length).toString(36)}`;
            if (bestInst) {
                place(ctx, st, p.home, p.away, spotOf(bestInst), 1);
                penalty += bestScore;
                placed.push({
                    id,
                    home: p.home,
                    away: p.away,
                    bracketId: p.bracketId,
                    pool: p.pool,
                    date: bestInst.date,
                    time: bestInst.time,
                    locationId: bestInst.locationId,
                    slotId: bestInst.slotId,
                    locked: false,
                });
            } else {
                unplaced.push({ id, home: p.home, away: p.away, bracketId: p.bracketId, pool: p.pool, date: null, time: null, locationId: null, slotId: null, locked: false });
            }
        }
        const better =
            !best ||
            unplaced.length < best.unplaced.length ||
            (unplaced.length === best.unplaced.length && penalty < best.penalty);
        if (better) best = { placed, unplaced, penalty, st, shortfalls };
    }

    if (!best) return { matches: kept, warnings, needed: 0, placed: 0, attempts };

    // Explain each unplaced match: tally the first blocking reason over every spot.
    for (const m of best.unplaced) {
        const tally = new Map<string, number>();
        for (const inst of ctx.instances) {
            const v = check(ctx, best.st, m.home, m.away, spotOf(inst), inst.capacity, true);
            const r = v.hard[0];
            if (r) tally.set(r, (tally.get(r) ?? 0) + 1);
        }
        const top = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
        m.note = top.length
            ? `No spot fits. Most common blockers: ${top.map(([r, n]) => `${r} (${n} ${n === 1 ? "time" : "times"})`).join("; ")}.`
            : "There are no time slots in the season to put it in.";
    }

    warnings.push(...best.shortfalls);
    const all = [...kept, ...best.placed, ...best.unplaced];
    return { matches: sortMatches(all), warnings, needed: neededTotal, placed: best.placed.length, attempts };
}

export function sortMatches(matches: Match[]): Match[] {
    return [...matches].sort((a, b) => {
        if (!a.date !== !b.date) return a.date ? -1 : 1;
        return (a.date ?? "").localeCompare(b.date ?? "") || (a.time ?? "").localeCompare(b.time ?? "") || a.id.localeCompare(b.id);
    });
}

// ---------------------------------------------------------------------------
// Audit: re-check a saved (possibly hand-edited) schedule against the rules.
// ---------------------------------------------------------------------------

export type TeamSummary = {
    teamId: string;
    target: number;
    placed: number;
    unplaced: number;
    weekendMatches: number;
    homeMatches: number;
};

export type Audit = {
    issues: Map<string, Verdict>;
    teams: Map<string, TeamSummary>;
    /** instance idx -> matches placed there. */
    usage: number[];
    ctx: Ctx;
};

export function audit(league: League, matches: Match[]): Audit {
    const ctx = prepare(league);
    const st = newState(ctx);
    const spots = new Map<string, Spot>();
    for (const m of matches) {
        if (!matchTeamsExist(ctx, m)) continue;
        const spot = spotForMatch(ctx, m);
        if (!spot) continue;
        spots.set(m.id, spot);
        place(ctx, st, m.home, m.away, spot, 1);
    }
    const issues = new Map<string, Verdict>();
    for (const m of matches) {
        if (!matchTeamsExist(ctx, m)) {
            issues.set(m.id, { hard: ["One of these teams has been deleted"], soft: [] });
            continue;
        }
        const spot = spots.get(m.id);
        if (!spot) continue;
        place(ctx, st, m.home, m.away, spot, -1);
        const cap = spot.idx >= 0 ? ctx.instances[spot.idx].capacity : Infinity;
        const v = check(ctx, st, m.home, m.away, spot, cap, false);
        if (spot.idx < 0) {
            if (!ctx.league.locations.some((l) => l.id === m.locationId)) v.hard.unshift("Its location was deleted");
            // The facility's own sheet covers this date and has no court time
            // at this hour (or says closed): that's a hard fact, not a taste.
            else if (ctx.covered.has(`${m.locationId}|${m.date}`)) v.hard.unshift("The facility’s sheet has no court time then");
            else v.soft.unshift("This time is no longer in the weekly slots or the facility’s availability");
        }
        place(ctx, st, m.home, m.away, spot, 1);
        if (v.hard.length || v.soft.length) issues.set(m.id, v);
    }
    const teams = new Map<string, TeamSummary>();
    for (const tc of ctx.teams.values()) {
        teams.set(tc.team.id, { teamId: tc.team.id, target: tc.target, placed: 0, unplaced: 0, weekendMatches: 0, homeMatches: 0 });
    }
    for (const m of matches) {
        for (const id of [m.home, m.away]) {
            const s = teams.get(id);
            if (!s) continue;
            const spot = spots.get(m.id);
            if (spot) {
                s.placed++;
                if (isWeekend(spot.day)) s.weekendMatches++;
            } else s.unplaced++;
            if (id === m.home) s.homeMatches++;
        }
    }
    return { issues, teams, usage: st.used, ctx };
}

export type SpotOption = { inst: Instance; used: number; verdict: Verdict };

/** Every slot in the season, judged for moving `matchId` there, with all other matches in place. */
export function moveOptions(league: League, matches: Match[], matchId: string): SpotOption[] {
    const ctx = prepare(league);
    const st = newState(ctx);
    const target = matches.find((m) => m.id === matchId);
    if (!target) return [];
    for (const m of matches) {
        if (m.id === matchId || !matchTeamsExist(ctx, m)) continue;
        const spot = spotForMatch(ctx, m);
        if (spot) place(ctx, st, m.home, m.away, spot, 1);
    }
    return ctx.instances.map((inst) => ({
        inst,
        used: st.used[inst.idx],
        verdict: check(ctx, st, target.home, target.away, spotOf(inst), inst.capacity, false),
    }));
}
