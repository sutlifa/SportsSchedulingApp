/**
 * Coerces untrusted JSON (a request body, an imported backup file, a
 * localStorage blob from an older version of the app) into a well-formed
 * League / Schedule.
 *
 * Coerce, don't reject: a backup missing a field added later should load
 * with that field defaulted, not fail with "invalid file". Anything that
 * cannot be made sense of is dropped, never passed through -- the engine
 * assumes every array is an array and every time is "HH:MM".
 *
 * Pure; shared by the API routes and the client.
 */
import { isIsoDate, isTime } from "./dates.ts";
import { RULE_DEFS } from "./rules.ts";
import { isSportId, SPORTS, type SportId } from "./sports.ts";
import type { Availability, Bracket, Unit, DateRange, DayOfWeek, League, Location, Match, Rule, RuleMode, RuleType, Schedule, Settings, Slot, Team } from "./types.ts";

const LIMITS = { brackets: 50, locations: 100, slots: 500, availability: 15_000, teams: 1000, rules: 60, matches: 10_000, text: 2000 };

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === "object" && !Array.isArray(v) ? (v as J) : {});
const arr = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
const str = (v: unknown, max = 200): string => (typeof v === "string" ? v.slice(0, max) : "");
const int = (v: unknown, def: number, min: number, max: number): number => {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
};
const id = (v: unknown, fallback: string): string => {
    const s = str(v, 64);
    return /^[A-Za-z0-9_-]+$/.test(s) ? s : fallback;
};
const time = (v: unknown): string => (isTime(v) ? v : "");
const mode = (v: unknown): RuleMode => (v === "prefer" ? "prefer" : "must");
const day = (v: unknown): DayOfWeek | null => {
    const n = typeof v === "number" ? v : NaN;
    return Number.isInteger(n) && n >= 0 && n <= 6 ? (n as DayOfWeek) : null;
};
const days = (v: unknown): DayOfWeek[] => [...new Set(arr(v, 7).map(day).filter((d): d is DayOfWeek => d !== null))];
const ids = (v: unknown, max = 200): string[] => [...new Set(arr(v, max).map((x) => id(x, "")).filter(Boolean))];
const ranges = (v: unknown): DateRange[] =>
    arr(v, 200)
        .map(obj)
        .filter((r) => isIsoDate(r.from))
        .map((r) => (isIsoDate(r.to) && r.to !== r.from ? { from: r.from as string, to: r.to as string } : { from: r.from as string }));

let counter = 0;
const fresh = (prefix: string) => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;

/**
 * Ids must be unique where the engine keys maps by them: two teams (or slots,
 * units, matches...) sharing an id silently merged -- two units with one id
 * counted as two games at once on one real unit. The FIRST holder keeps the
 * id and later ones get a fresh id. References (a team's bracketId, a match's
 * home, a slot's unitIds) therefore keep pointing where every `find()` in the
 * app already pointed them -- at the first -- so nothing that resolved before
 * resolves differently now. Idempotent: a second pass finds nothing to change.
 */
const unique = (seen: Set<string>, prefix: string) => (v: string): string => {
    let x = v;
    while (seen.has(x)) x = fresh(prefix);
    seen.add(x);
    return x;
};

export function sanitizeRule(v: unknown): Rule | null {
    const r = obj(v);
    const type = r.type as RuleType;
    // Own keys only: `in` also finds Object.prototype's ("constructor",
    // "toString", "__proto__"), which fell through the switch below and came
    // back as `undefined` -- a rule that then crashed audit/readiness/generate.
    if (typeof type !== "string" || !Object.hasOwn(RULE_DEFS, type)) return null;
    const base = { id: id(r.id, fresh("r")), mode: mode(r.mode) };
    switch (type) {
        case "max_per_weekend":
        case "max_weekend_total":
        case "max_per_week":
            return { ...base, type, n: int(r.n, 1, 0, 99) };
        case "min_days_between":
            return { ...base, type, n: int(r.n, 3, 0, 60) };
        case "max_on_day":
            return { ...base, type, day: day(r.day) ?? 0, n: int(r.n, 1, 0, 99) };
        case "no_days":
        case "only_days":
            return { ...base, type, days: days(r.days) };
        case "not_dates":
            return { ...base, type, ranges: ranges(r.ranges) };
        case "no_start_after":
        case "no_start_before":
            return { ...base, type, time: time(r.time) || (type === "no_start_after" ? "18:00" : "10:00") };
        case "only_locations":
        case "avoid_locations":
            return { ...base, type, locationIds: ids(r.locationIds) };
        case "not_same_time":
        case "not_same_day":
            return { ...base, type, teamIds: ids(r.teamIds) };
        case "note":
            return { ...base, type, text: str(r.text, LIMITS.text) };
    }
}

// `r && typeof r === "object"`, not `r !== null`: a sanitizer that ever returns
// something else (it once returned undefined) must still never put a non-rule
// in the list the engine walks.
const rules = (v: unknown): Rule[] => {
    const once = unique(new Set(), "r");
    return arr(v, LIMITS.rules)
        .map(sanitizeRule)
        .filter((r): r is Rule => !!r && typeof r === "object")
        .map((r) => ({ ...r, id: once(r.id) }));
};

export function defaultSettings(sport: SportId = "tennis"): Settings {
    // Each sport starts with its usual game length (hockey 75, tennis 90...).
    return { sport, seasonStart: "", seasonEnd: "", blackouts: [], maxPerDay: 1, matchMinutes: SPORTS[sport].minutes, clubLimit: null, clubLimitMode: "prefer", courtsPerMatch: 1 };
}

export function emptyLeague(sport: SportId = "tennis"): League {
    return { settings: defaultSettings(sport), brackets: [], locations: [], slots: [], availability: [], teams: [] };
}

export function emptySchedule(): Schedule {
    return { matches: [], generatedAt: null, warnings: [] };
}

export function sanitizeLeague(v: unknown): League {
    const d = obj(v);
    const s = obj(d.settings);
    const def = defaultSettings();
    const settings: Settings = {
        // Leagues saved before sports existed were all tennis.
        sport: isSportId(s.sport) ? s.sport : "tennis",
        seasonStart: isIsoDate(s.seasonStart) ? s.seasonStart : "",
        seasonEnd: isIsoDate(s.seasonEnd) ? s.seasonEnd : "",
        blackouts: ranges(s.blackouts),
        maxPerDay: int(s.maxPerDay, def.maxPerDay, 1, 5),
        matchMinutes: int(s.matchMinutes, def.matchMinutes, 15, 600),
        clubLimit: s.clubLimit === null || s.clubLimit === undefined || s.clubLimit === "" ? null : int(s.clubLimit, 2, 1, 50),
        clubLimitMode: mode(s.clubLimitMode ?? def.clubLimitMode),
        courtsPerMatch: int(s.courtsPerMatch, def.courtsPerMatch, 1, 20),
    };
    const bracketId = unique(new Set(), "b");
    const brackets: Bracket[] = arr(d.brackets, LIMITS.brackets).map((x) => {
        const b = obj(x);
        return {
            id: bracketId(id(b.id, fresh("b"))),
            name: str(b.name, 60) || "Unnamed bracket",
            matches: int(b.matches, 5, 0, 99),
            earliest: time(b.earliest),
            latest: time(b.latest),
            days: days(b.days),
            color: /^#[0-9a-fA-F]{6}$/.test(str(b.color)) ? str(b.color) : "#2f7fb8",
            rules: rules(b.rules),
        };
    });
    const locationId = unique(new Set(), "l");
    const locations: Location[] = arr(d.locations, LIMITS.locations).map((x) => {
        const l = obj(x);
        const units: Unit[] = [];
        // Within a facility: one unit per name (case-insensitive), one per id.
        const unitId = unique(new Set(), "u");
        for (const u of arr(l.units, 100).map(obj)) {
            const name = str(u.name, 60).trim();
            if (name && !units.some((x) => x.name.toLowerCase() === name.toLowerCase())) units.push({ id: unitId(id(u.id, fresh("u"))), name });
        }
        return { id: locationId(id(l.id, fresh("l"))), name: str(l.name, 120) || "Unnamed location", address: str(l.address, 300), mapUrl: safeMapUrl(str(l.mapUrl, 1000)), notes: str(l.notes, LIMITS.text), units };
    });
    const slots: Slot[] = arr(d.slots, LIMITS.slots)
        .map((x) => {
            const sl = obj(x);
            return { id: id(sl.id, fresh("s")), day: day(sl.day) ?? 6, time: time(sl.time), locationId: id(sl.locationId, ""), capacity: int(sl.capacity, 1, 0, 100), unitIds: ids(sl.unitIds, 100), bracketIds: ids(sl.bracketIds, LIMITS.brackets) };
        })
        .filter((sl) => sl.time);
    // Weekly slots and uploaded rows share one namespace: both become an
    // instance's slotId, and the engine keys instances by (date, slotId).
    const timeId = unique(new Set(), "s");
    for (const sl of slots) sl.id = timeId(sl.id);
    const availability: Availability[] = arr(d.availability, LIMITS.availability)
        .map((x) => {
            const a = obj(x);
            return { id: id(a.id, fresh("a")), date: isIsoDate(a.date) ? a.date : "", time: time(a.time), locationId: id(a.locationId, ""), courts: int(a.courts, 0, 0, 200), unitIds: ids(a.unitIds, 100), bracketIds: ids(a.bracketIds, LIMITS.brackets) };
        })
        .filter((a) => a.date && a.time && a.locationId);
    for (const a of availability) a.id = timeId(a.id);
    const teamId = unique(new Set(), "t");
    const teams: Team[] = arr(d.teams, LIMITS.teams).map((x) => {
        const t = obj(x);
        return {
            id: teamId(id(t.id, fresh("t"))),
            name: str(t.name, 120) || "Unnamed team",
            bracketId: id(t.bracketId, ""),
            pool: str(t.pool, 40),
            club: str(t.club, 80),
            captain: str(t.captain, 120),
            contact: str(t.contact, 200),
            matches: t.matches === null || t.matches === undefined || t.matches === "" ? null : int(t.matches, 5, 0, 99),
            rules: rules(t.rules),
            notes: str(t.notes, LIMITS.text),
        };
    });
    return { settings, brackets, locations, slots, availability, teams };
}

export function sanitizeSchedule(v: unknown): Schedule {
    const s = obj(v);
    const matches: Match[] = arr(s.matches, LIMITS.matches).map((x, i) => {
        const m = obj(x);
        const placed = isIsoDate(m.date) && isTime(m.time);
        return {
            id: id(m.id, `m${i}`),
            home: id(m.home, ""),
            away: id(m.away, ""),
            bracketId: id(m.bracketId, ""),
            pool: str(m.pool, 40),
            date: placed ? (m.date as string) : null,
            time: placed ? (m.time as string) : null,
            locationId: placed ? id(m.locationId, "") || null : null,
            slotId: placed ? id(m.slotId, "") || null : null,
            ...(placed && Array.isArray(m.unitIds) && m.unitIds.length ? { unitIds: ids(m.unitIds, 20) } : {}),
            locked: m.locked === true,
            ...(typeof m.note === "string" && m.note ? { note: m.note.slice(0, 1000) } : {}),
            ...(Array.isArray(m.blockers) && m.blockers.length
                ? {
                      blockers: arr(m.blockers, 5)
                          .map(obj)
                          .filter((b) => typeof b.reason === "string" && b.reason)
                          .map((b) => ({ reason: str(b.reason, 300), count: int(b.count, 0, 0, 100_000) })),
                  }
                : {}),
        };
    });
    // A team can't play itself; and match ids key the audit and unit
    // assignment, so a repeated id is re-issued (first one keeps it).
    const matchId = unique(new Set(), "m");
    return {
        matches: matches.filter((m) => m.home && m.away && m.home !== m.away).map((m) => ({ ...m, id: matchId(m.id) })),
        generatedAt: typeof s.generatedAt === "string" ? s.generatedAt.slice(0, 40) : null,
        warnings: arr(s.warnings, 200).map((w) => str(w, 500)).filter(Boolean),
    };
}

/**
 * Only Google Maps links are kept as pins. The link is rendered as an
 * <a href>, so letting any string through would let an imported file plant
 * a `javascript:` URL behind the "Open map" button.
 */
export function safeMapUrl(url: string): string {
    try {
        const u = new URL(url.trim());
        if (u.protocol !== "https:") return "";
        const host = u.hostname.toLowerCase();
        const path = u.pathname.toLowerCase();
        // Exact Google hosts only. A loose "google.*" match would also accept
        // google.evil.com or maps.google.attacker.io, and goo.gl is a general
        // shortener, so it is only trusted for its /maps/ links.
        const googleHost = /^(www\.|maps\.)?google\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(host);
        const ok =
            host === "maps.app.goo.gl" ||
            (host === "goo.gl" && path.startsWith("/maps/")) ||
            (googleHost && (host.startsWith("maps.") || path.startsWith("/maps")));
        return ok ? u.toString() : "";
    } catch {
        return "";
    }
}

/** A Google Maps search link for a facility: always works, no API key needed. */
export function mapSearchUrl(name: string, address: string): string {
    const q = [name, address].map((s) => s.trim()).filter(Boolean).join(", ");
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
