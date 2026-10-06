/**
 * Small, explicit league builders for the unit tests.
 *
 * Every engine test builds the SMALLEST league that shows the behaviour, so a
 * failure points at one rule rather than at the 24-team example league. The
 * defaults: tennis, one bracket "b" (5 games each, no window), one location
 * "l" with no named units, season 2027-03-01 (a Monday) .. 2027-03-31.
 */
import { generate, type GenerateResult } from "../../lib/engine/engine.ts";
import type { Bracket, DayOfWeek, League, Location, Match, Rule, Settings, Slot, Team } from "../../lib/engine/types.ts";

export function team(id: string, over: Partial<Team> = {}): Team {
    return { id, name: id.toUpperCase(), bracketId: "b", pool: "", club: "", captain: "", contact: "", matches: null, rules: [], notes: "", ...over };
}

export function bracket(id = "b", over: Partial<Bracket> = {}): Bracket {
    return { id, name: id.toUpperCase(), matches: 5, earliest: "", latest: "", days: [], color: "#123456", rules: [], ...over };
}

export function location(id = "l", over: Partial<Location> = {}): Location {
    return { id, name: `Loc ${id}`, address: "", mapUrl: "", notes: "", units: [], ...over };
}

export function slot(id: string, day: DayOfWeek, time: string, over: Partial<Slot> = {}): Slot {
    return { id, day, time, locationId: "l", capacity: 1, unitIds: [], bracketIds: [], ...over };
}

export function settings(over: Partial<Settings> = {}): Settings {
    return {
        sport: "tennis",
        seasonStart: "2027-03-01",
        seasonEnd: "2027-03-31",
        blackouts: [],
        maxPerDay: 1,
        matchMinutes: 90,
        clubLimit: null,
        clubLimitMode: "must",
        courtsPerMatch: 1,
        ...over,
    };
}

export type LeagueOver = Omit<Partial<League>, "settings"> & { settings?: Partial<Settings> };

export function league(over: LeagueOver = {}): League {
    const { settings: s, ...rest } = over;
    return {
        brackets: [bracket()],
        locations: [location()],
        slots: [],
        availability: [],
        teams: [],
        ...rest,
        settings: settings(s),
    };
}

/** A slot on every day of the week at `time`, capacity `cap`. */
export function everyDay(time: string, cap = 1, over: Partial<Slot> = {}): Slot[] {
    return ([0, 1, 2, 3, 4, 5, 6] as DayOfWeek[]).map((d) => slot(`s${d}-${time.replace(":", "")}`, d, time, { capacity: cap, ...over }));
}

/** Deterministic generate: fixed clock, so the attempt count never depends on machine speed. */
export function run(l: League, prev: Match[] = [], over: { scope?: string; seed?: number; maxAttempts?: number } = {}): GenerateResult {
    return generate(l, prev, { scope: over.scope ?? "all", seed: over.seed ?? 1, maxAttempts: over.maxAttempts ?? 20, timeBudgetMs: 1e9, now: () => 0 });
}

export function rule<T extends Rule["type"]>(type: T, fields: Omit<Extract<Rule, { type: T }>, "id" | "mode" | "type">, mode: "must" | "prefer" = "must", id = `r-${type}`): Rule {
    return { id, mode, type, ...fields } as unknown as Rule;
}

export function gamesOf(ms: Match[], teamId: string): Match[] {
    return ms.filter((m) => m.home === teamId || m.away === teamId);
}

export const placed = (ms: Match[]) => ms.filter((m) => m.date !== null);
export const unplaced = (ms: Match[]) => ms.filter((m) => m.date === null);

export function match(id: string, home: string, away: string, over: Partial<Match> = {}): Match {
    return { id, home, away, bracketId: "b", pool: "", date: null, time: null, locationId: null, slotId: null, locked: false, ...over };
}
