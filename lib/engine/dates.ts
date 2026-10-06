/**
 * Date arithmetic on plain integers ("day numbers" since 1970-01-01, UTC).
 *
 * Deliberately NOT `Date` objects in local time: a season straddles the
 * daylight-saving change in March and November, and local-time arithmetic
 * across that boundary produces a day that is 23 or 25 hours long -- which
 * silently turns "add 7 days" into "6 days and 23 hours" and drops a
 * Saturday off the schedule. Day numbers have no time zone and no DST.
 */
import type { DateRange, DayOfWeek } from "./types.ts";

const MS_PER_DAY = 86_400_000;

export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const DAY_PLURAL = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A real calendar date written YYYY-MM-DD. Checked by round trip, not by
 * Date.parse: Date.parse("2027-02-30") is a number (it rolls over to Mar 2),
 * so an impossible date used to pass and quietly became a different day.
 */
export function isIsoDate(s: unknown): s is string {
    return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && dayToIso(isoToDay(s)) === s;
}

export function isoToDay(iso: string): number {
    const [y, m, d] = iso.split("-").map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

export function dayToIso(day: number): string {
    return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** 1970-01-01 was a Thursday (4). */
export function dowOf(day: number): DayOfWeek {
    return (((day + 4) % 7) + 7) % 7 as DayOfWeek;
}

export function isWeekend(day: number): boolean {
    const d = dowOf(day);
    return d === 0 || d === 6;
}

/** The Saturday that starts this day's weekend, or null on a weekday. */
export function weekendKey(day: number): number | null {
    const d = dowOf(day);
    if (d === 6) return day;
    if (d === 0) return day - 1;
    return null;
}

/** Monday of this day's Mon-Sun week. */
export function weekKey(day: number): number {
    return day - ((dowOf(day) + 6) % 7);
}

export function isTime(s: unknown): s is string {
    return typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

export function toMinutes(time: string): number {
    const [h, m] = time.split(":").map(Number);
    return h * 60 + m;
}

/** "18:30" -> "6:30 PM" */
export function formatTime(time: string | null | undefined): string {
    if (!time || !isTime(time)) return "";
    const [h, m] = time.split(":").map(Number);
    const suffix = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** "2027-03-06" -> "Sat, Mar 6" */
export function formatDate(iso: string | null | undefined, withYear = false): string {
    if (!iso || !isIsoDate(iso)) return "";
    const day = isoToDay(iso);
    const [y, m, d] = iso.split("-").map(Number);
    return `${DAY_SHORT[dowOf(day)]}, ${MONTHS[m - 1]} ${d}${withYear ? `, ${y}` : ""}`;
}

export function formatRange(r: DateRange): string {
    if (!r.to || r.to === r.from) return formatDate(r.from);
    return `${formatDate(r.from)} – ${formatDate(r.to)}`;
}

/** Every day number covered by a list of ranges. Malformed entries are skipped. */
export function rangesToDays(ranges: DateRange[]): Set<number> {
    const out = new Set<number>();
    for (const r of ranges) {
        if (!isIsoDate(r.from)) continue;
        const a = isoToDay(r.from);
        const b = r.to && isIsoDate(r.to) ? isoToDay(r.to) : a;
        // Cap a single range at a year so a typo'd year can't build a
        // multi-million-entry set.
        for (let d = Math.min(a, b); d <= Math.max(a, b) && d - Math.min(a, b) < 366; d++) out.add(d);
    }
    return out;
}

/**
 * Lenient time-list parser for the "add several start times" box:
 * "9, 10:30, 1pm, 17:45" -> ["09:00","10:30","13:00","17:45"].
 * A bare number under 7 with no am/pm is read as PM, since nobody schedules
 * a junior tennis match at 3 in the morning.
 */
export function parseTimes(text: string): string[] {
    const out: string[] = [];
    // "9", "9:30", "9.30", "0930" / "1330" (military), each with optional am/pm.
    // Whole numbers only: without the lookbehind, "12345" matched its last
    // four digits and came back as 23:45.
    const re = /(?<!\d)(\d{1,4})(?:[:.](\d{2}))?\s*(am|pm|a|p)?(?![\d])/gi;
    for (const m of text.matchAll(re)) {
        let h: number;
        let min: number;
        if (m[1].length >= 3 && !m[2]) {
            h = Math.floor(Number(m[1]) / 100);
            min = Number(m[1]) % 100;
        } else {
            if (m[1].length > 2) continue;
            h = Number(m[1]);
            min = m[2] ? Number(m[2]) : 0;
        }
        const ap = m[3]?.toLowerCase();
        const military = m[1].length >= 3;
        if (ap?.startsWith("p") && h < 12) h += 12;
        if (ap?.startsWith("a") && h === 12) h = 0;
        if (!ap && !military && h >= 1 && h < 7) h += 12;
        if (h > 23 || min > 59) continue;
        const t = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
        if (!out.includes(t)) out.push(t);
    }
    return out;
}
