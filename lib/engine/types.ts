/**
 * The whole data model for one league season.
 *
 * A league is `{ settings, brackets, locations, slots, teams }` plus a saved
 * `Schedule`. Everything the UI shows about "who is short a match", "which
 * rule does this break" or "how full is Saturday 9am" is DERIVED from those by
 * lib/engine/engine.ts (`audit`) -- nothing derived is ever stored, so it can
 * never drift out of step with the inputs that produced it.
 *
 * Pure types: this file is shared by client components, API routes and the
 * node verify scripts.
 */
import type { SportId } from "./sports.ts";

/** 0 = Sunday ... 6 = Saturday, matching `Date#getUTCDay`. */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * "must" rules are hard constraints: the scheduler will leave a match
 * unplaced rather than break one. "prefer" rules are soft: the scheduler
 * avoids breaking them, but will if that's the only way to fit the match.
 */
export type RuleMode = "must" | "prefer";

/** Inclusive date range of ISO dates (YYYY-MM-DD). `to` absent = one day. */
export type DateRange = { from: string; to?: string };

type RuleBase = { id: string; mode: RuleMode };

export type Rule = RuleBase &
    (
        | { type: "max_per_weekend"; n: number }
        | { type: "max_weekend_total"; n: number }
        | { type: "max_per_week"; n: number }
        | { type: "max_on_day"; day: DayOfWeek; n: number }
        | { type: "no_days"; days: DayOfWeek[] }
        | { type: "only_days"; days: DayOfWeek[] }
        | { type: "not_dates"; ranges: DateRange[] }
        | { type: "no_start_after"; time: string }
        | { type: "no_start_before"; time: string }
        | { type: "only_locations"; locationIds: string[] }
        | { type: "avoid_locations"; locationIds: string[] }
        | { type: "min_days_between"; n: number }
        | { type: "not_same_time"; teamIds: string[] }
        | { type: "not_same_day"; teamIds: string[] }
        | { type: "note"; text: string }
    );

export type RuleType = Rule["type"];

/** An age bracket, e.g. "10U". Its limits apply to every team in it. */
export type Bracket = {
    id: string;
    name: string;
    /** Matches each team is guaranteed against its pool. */
    matches: number;
    /** "HH:MM" 24h, or "" for no limit. */
    earliest: string;
    latest: string;
    /** Days this bracket may play. Empty = any day. */
    days: DayOfWeek[];
    color: string;
    /** Rules that apply to every team in the bracket, on top of their own. */
    rules: Rule[];
};

/**
 * One named playing area inside a facility: "Sheet A" in an ice arena,
 * "Field 3" at a soccer complex, "Court 2" in a gym. Optional -- a facility
 * with no units just has a number of games at once per time slot.
 */
export type Unit = { id: string; name: string };

export type Location = {
    id: string;
    name: string;
    /** The facility's sheets / fields / courts, in display order. */
    units: Unit[];
    address: string;
    /** A Google Maps link to the exact pin, pasted by the user. Optional. */
    mapUrl: string;
    notes: string;
};

/** A weekly repeating start time at a location. */
export type Slot = {
    id: string;
    day: DayOfWeek;
    time: string;
    locationId: string;
    /** How many games can be on at once in this slot (ignored when unitIds names the units). */
    capacity: number;
    /**
     * Which of the location's units are free in this slot. When set, games at
     * once = units / settings.courtsPerMatch, and each game is assigned
     * specific units. Empty = an unnamed `capacity`.
     */
    unitIds: string[];
    /** Brackets allowed in this slot. Empty = all brackets. */
    bracketIds: string[];
};

/**
 * One dated block of court time from a facility's availability sheet.
 *
 * For any (location, date) that has at least one of these, they REPLACE that
 * location's weekly slots on that date -- the facility's sheet is the truth
 * for the days it covers, and the weekly pattern fills in the rest. A row
 * with 0 courts marks a time as closed.
 */
export type Availability = {
    id: string;
    date: string;
    time: string;
    locationId: string;
    courts: number;
    /** The named units free at this time, when the facility's sheet names them. */
    unitIds: string[];
    /** Brackets allowed. Empty = all brackets. */
    bracketIds: string[];
};

export type Team = {
    id: string;
    name: string;
    bracketId: string;
    /** Teams only play opponents with the same bracket AND pool. "" = the bracket's main pool. */
    pool: string;
    /** Club / organisation, used to avoid stacking one club's teams in the same time slot. */
    club: string;
    captain: string;
    contact: string;
    /** Overrides the bracket's match count. null = use the bracket's. */
    matches: number | null;
    rules: Rule[];
    notes: string;
};

export type Settings = {
    /** Decides the wording everywhere (lib/engine/sports.ts). Missing = tennis. */
    sport: SportId;
    seasonStart: string;
    seasonEnd: string;
    /** Dates nobody plays (holidays, facility closures). */
    blackouts: DateRange[];
    /** Max matches one team plays on a single day. */
    maxPerDay: number;
    /** Typical match length, so two starts closer than this count as overlapping. */
    matchMinutes: number;
    /** Max matches involving one club at the same date and time. null = no limit. */
    clubLimit: number | null;
    clubLimitMode: RuleMode;
    /**
     * Courts one match occupies (a team match often plays several lines at
     * once). Uploaded availability is in courts; this turns it into matches
     * at once. Weekly slots are entered directly as matches at once.
     */
    courtsPerMatch: number;
};

export type League = {
    settings: Settings;
    brackets: Bracket[];
    locations: Location[];
    slots: Slot[];
    /** Dated court availability uploaded from facility sheets. */
    availability: Availability[];
    teams: Team[];
};

export type Match = {
    id: string;
    home: string;
    away: string;
    bracketId: string;
    pool: string;
    /** null = the scheduler could not place it (see `note`). */
    date: string | null;
    time: string | null;
    locationId: string | null;
    slotId: string | null;
    /** The specific units (sheet, field, court) this game is on, when the time names them. */
    unitIds?: string[];
    /** Locked matches survive a regenerate untouched. Moving a match locks it. */
    locked: boolean;
    /** Why an unplaced match could not be placed. */
    note?: string;
    /**
     * For an unplaced match: the most common reasons it was blocked, each with
     * how many of the season's open times that reason ruled out. The UI turns
     * these into a fix and a link to the tab where it's made (advice.ts).
     */
    blockers?: { reason: string; count: number }[];
};

export type Schedule = {
    matches: Match[];
    generatedAt: string | null;
    warnings: string[];
};
