/**
 * Turns a facility's availability spreadsheet (any of the shapes facilities
 * actually send) into dated rows of { date, start time, courts }.
 *
 * Facilities don't agree on a format, so this GUESSES and the UI shows the
 * guess for the person to correct:
 *
 *   rows        Date | Time | Courts [| Location]  — one line per slot. A date
 *               written once and left blank below it carries down.
 *   dates-down  Dates down the side, start times across the top, courts in
 *               the cells.
 *   times-down  Start times down the side, dates across the top.
 *
 * Cells are read leniently: "3/6", "Sat 3/6", "March 6, 2027", "2027-03-06",
 * Excel date serials; "9", "9:00", "9am", "9:00 - 10:30 AM", "13:30"; courts
 * as "4", "4 courts", "Courts 1-4" (= 4), "1, 2, 5" (= 3), "closed" / "-" (= 0).
 * US month/day order, since this is a US league tool.
 *
 * Pure. scripts/verify-import.ts covers every shape above.
 */
import { dayToIso, formatDate, isoToDay } from "../engine/dates.ts";
import type { Cell } from "./xlsx.ts";

export type { Cell };
export type Layout = "rows" | "dates-down" | "times-down";

export type Mapping = {
    layout: Layout;
    /** Index of the header row, or -1 when the sheet has none. */
    header: number;
    /** rows layout: column indexes, null = not in the sheet. */
    date: number | null;
    time: number | null;
    courts: number | null;
    location: number | null;
    /**
     * rows layout: what the courts column holds. "count" = how many courts
     * ("4"); "names" = one row per court ("Court 7", "Stadium"), so courts at
     * a time = distinct names at that date+time. With no courts column,
     * "names" means each row is one court.
     */
    courtsMode: "count" | "names" | "matches";
    /** grid layouts: the column holding the row labels (dates or times). */
    label: number;
    /**
     * rows layout: columns that, when anything is written in them, mean the
     * row's slot is already taken -- a league's own schedule sheet has Home /
     * Visiting columns, and a note merged across them ("No Courts - Academy
     * Day") closes those rows. Blank in all of them = free.
     */
    booked?: number[];
    /** rows layout: a weekday column ("Fri", "Sat"), checked against the date. */
    day?: number | null;
};

/**
 * `units`: the named sheets / fields / courts free at that time, as written in
 * the sheet ("Sheet A"), when it lists them one per row. The import attaches
 * them to the facility's units (creating any it doesn't have yet).
 */
export type ParsedRow = { date: string; time: string; courts: number; location: string | null; line: number; units?: string[] };
export type Problem = { line: number; message: string };
/**
 * `taken`: rows left out because a booked column had something in it.
 * `headings`: one-cell rows ("Week 1", "Turkey Weekend - No Play") skipped as
 * section headings rather than reported as problems.
 * `notes`: rows that WERE used but look wrong ("says Sun, but the date is a
 * Saturday"), for the person to check.
 */
export type ParseResult = { rows: ParsedRow[]; problems: Problem[]; duplicates: number; taken?: number; headings?: number; notes?: Problem[] };

export type Ctx = {
    /** Used to pick the year when a cell says "3/6" with no year. */
    seasonStart: string;
    seasonEnd: string;
    /** Year to assume when there is no season either. */
    fallbackYear: number;
};

// ---------------------------------------------------------------------------
// CSV / pasted cells
// ---------------------------------------------------------------------------

/** RFC 4180-ish CSV, or tab-separated (what copying cells from Excel/Sheets gives). */
export function parseDelimited(text: string): Cell[][] {
    const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
    const delim = firstLine.includes("\t") ? "\t" : (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
    const rows: Cell[][] = [];
    let row: Cell[] = [];
    let field = "";
    let quoted = false;
    const push = () => {
        const t = field.trim();
        row.push(t === "" ? null : t);
        field = "";
    };
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quoted) {
            if (ch === '"' && text[i + 1] === '"') {
                field += '"';
                i++;
            } else if (ch === '"') quoted = false;
            else field += ch;
        } else if (ch === '"' && field.trim() === "") {
            field = "";
            quoted = true;
        } else if (ch === delim) push();
        else if (ch === "\n" || ch === "\r") {
            if (ch === "\r" && text[i + 1] === "\n") i++;
            push();
            rows.push(row);
            row = [];
        } else field += ch;
        if (rows.length >= 5000) break;
    }
    if (field !== "" || row.length) {
        push();
        rows.push(row);
    }
    const width = Math.max(0, ...rows.map((r) => r.length));
    return rows.map((r) => [...r, ...new Array(width - r.length).fill(null)]);
}

// ---------------------------------------------------------------------------
// Cell readers
// ---------------------------------------------------------------------------

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAY = /\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day|nesday|rsday|urday)?\b\.?,?/gi;
/** Excel's day 0 is 1899-12-30 (the Lotus 1900 leap-year bug, baked in). */
const EXCEL_EPOCH_DAY = isoToDay("1899-12-30");

export function cellText(c: Cell): string {
    if (c === null || c === undefined) return "";
    if (typeof c === "object") return `#${c.serial}`;
    return String(c).trim();
}

// Typed as a null-guard so the non-blank branch narrows away null. (A
// whitespace-only string also counts as blank; callers only ever use the
// true branch to skip, so the slightly-too-narrow true branch is harmless.)
const isBlank = (c: Cell): c is null => c === null || c === undefined || (typeof c === "string" && c.trim() === "");

function validDate(y: number, m: number, d: number): string | null {
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return dayToIso(isoToDay(iso)) === iso ? iso : null;
}

function inferYear(m: number, d: number, ctx: Ctx): number {
    const startY = /^\d{4}/.test(ctx.seasonStart) ? Number(ctx.seasonStart.slice(0, 4)) : ctx.fallbackYear;
    const mid = /^\d{4}-\d{2}-\d{2}$/.test(ctx.seasonStart) && /^\d{4}-\d{2}-\d{2}$/.test(ctx.seasonEnd)
        ? (isoToDay(ctx.seasonStart) + isoToDay(ctx.seasonEnd)) / 2
        : null;
    if (mid === null) return startY;
    let best = startY;
    let bestDist = Infinity;
    for (const y of [startY - 1, startY, startY + 1]) {
        const iso = validDate(y, m, d);
        if (!iso) continue;
        const dist = Math.abs(isoToDay(iso) - mid);
        if (dist < bestDist) {
            bestDist = dist;
            best = y;
        }
    }
    return best;
}

function fromSerial(serial: number): { date: string | null; time: string | null } {
    const whole = Math.floor(serial);
    const mins = Math.round((serial - whole) * 1440) % 1440;
    const time = serial - whole > 1e-9 ? `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}` : null;
    const date = whole >= 1 ? dayToIso(EXCEL_EPOCH_DAY + whole) : null;
    return { date, time };
}

/** A date (and possibly a time riding along with it, e.g. "3/6 9:00 AM"). */
export function readDate(c: Cell, ctx: Ctx): { date: string; time: string | null } | null {
    if (isBlank(c) || typeof c === "boolean") return null;
    if (typeof c === "object") {
        const r = fromSerial(c.serial);
        return r.date && c.serial >= 1 ? { date: r.date, time: r.time } : null;
    }
    if (typeof c === "number") {
        // An unformatted Excel date serial (roughly 1955-2119).
        if (c >= 20000 && c < 80000) {
            const r = fromSerial(c);
            return r.date ? { date: r.date, time: r.time } : null;
        }
        return null;
    }
    const s = c.replace(WEEKDAY, " ").replace(/\s+/g, " ").trim();
    let m: RegExpExecArray | null;
    let y: number, mo: number, d: number, rest: string | undefined;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ]+(.+))?$/.exec(s))) {
        [y, mo, d, rest] = [Number(m[1]), Number(m[2]), Number(m[3]), m[4]];
    } else if ((m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?(?:,? (.+))?$/.exec(s))) {
        mo = Number(m[1]);
        d = Number(m[2]);
        y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : inferYear(mo, d, ctx);
        rest = m[4];
    } else if ((m = /^([a-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?(?:,? (.+))?$/i.exec(s))) {
        mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
        d = Number(m[2]);
        if (!mo) return null;
        y = m[3] ? Number(m[3]) : inferYear(mo, d, ctx);
        rest = m[4];
    } else if ((m = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]{3,9})\.?(?:,? (\d{4}))?(?:,? (.+))?$/i.exec(s))) {
        mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
        d = Number(m[1]);
        if (!mo) return null;
        y = m[3] ? Number(m[3]) : inferYear(mo, d, ctx);
        rest = m[4];
    } else return null;
    const date = validDate(y, mo, d);
    if (!date) return null;
    return { date, time: rest ? readTime(rest) : null };
}

function hm(h: number, min: number): string | null {
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

type TimeTok = { h: number; min: number; ap: "a" | "p" | null };

function timeToken(s: string): TimeTok | null {
    const t = s.trim().toLowerCase().replace(/\s+/g, "");
    if (t === "noon") return { h: 12, min: 0, ap: "p" };
    if (t === "midnight") return { h: 0, min: 0, ap: "a" };
    const m = /^(\d{1,2})(?:[:.](\d{2}))?(?::\d{2})?([ap])?\.?m?\.?$/.exec(t);
    if (!m) return null;
    return { h: Number(m[1]), min: m[2] ? Number(m[2]) : 0, ap: (m[3] as "a" | "p" | undefined) ?? null };
}

function to24(t: TimeTok): number {
    if (t.ap === "p" && t.h < 12) return t.h + 12;
    if (t.ap === "a" && t.h === 12) return 0;
    if (!t.ap && t.h >= 1 && t.h <= 6) return t.h + 12; // nobody starts a junior match at 3am
    return t.h;
}

/** A start time. Ranges ("9:00 - 10:30 AM", "6-8pm") give their start. */
export function readTime(c: Cell): string | null {
    if (isBlank(c) || typeof c === "boolean") return null;
    if (typeof c === "object") return fromSerial(c.serial).time ?? (c.serial % 1 === 0 && c.serial < 1 ? "00:00" : null);
    if (typeof c === "number") {
        if (c >= 0 && c < 1) return fromSerial(c).time ?? "00:00";
        if (Number.isInteger(c) && c >= 0 && c <= 23) return hm(to24({ h: c, min: 0, ap: null }), 0);
        if (Number.isInteger(c) && c >= 100 && c <= 2359 && c % 100 < 60) return hm(Math.floor(c / 100), c % 100); // 930, 1330
        return null;
    }
    const parts = c.split(/\s*(?:-|–|—|\bto\b)\s*/i);
    const start = timeToken(parts[0]);
    if (!start) return null;
    const end = parts[1] ? timeToken(parts[1]) : null;
    if (!start.ap && end?.ap) {
        // "6-8pm" is 6pm; "11-1pm" is 11am.
        const asEnd = { ...start, ap: end.ap };
        start.ap = to24(asEnd) <= to24(end) ? end.ap : end.ap === "p" ? "a" : "p";
    }
    return hm(to24(start), start.min);
}

/**
 * A cell that SAYS a court is unavailable: it STARTS with a closed word,
 * whatever follows ("Tournament - courts 1-6", "Clinic 9-11am",
 * "Reserved (2)" -- ambiguous, so it errs toward not booking). The one
 * exception is exactly a court's own name -- ONE court, singular, at most
 * one number: "Clinic Court", "Event Court 2", "Private Ct 1". A plural or
 * a range ("Tournament courts 1-6", "Lesson Court 5-6") is a closure note. Note "3 (1 held for lessons)"
 * doesn't start with a closed word, so its leading number wins.
 */
const CLOSED_CELL = /^(reserved|unavailable|not available|tournament|blocked|maintenance|private|lessons?|camp|clinic|event|hold|held|rain ?out|rain|closed)\b(?!\s*(court|ct\.?|sheet|field|fld|rink|diamond|pitch|gym)(\s*#?\s*(\d+[a-z]?|[a-z]))?\s*$)/i;

/** Courts available. null = blank (no slot); 0 = explicitly closed. undefined = unreadable. */
export function readCourts(c: Cell): number | null | undefined {
    if (isBlank(c)) return null;
    if (typeof c === "boolean") return c ? 1 : 0;
    if (typeof c === "object") return Number.isInteger(c.serial) && c.serial >= 0 && c.serial < 200 ? c.serial : undefined;
    if (typeof c === "number") return c >= 0 && c < 200 ? Math.floor(c) : undefined;
    const s = c.toLowerCase().trim();
    // Facilities write "reserved", "tournament" etc. where a court is NOT
    // available. These must read as closed, never as an open court.
    if (/^(-|–|—|x|closed|none|n\/?a|no|full|booked|0)$/.test(s)) return 0;
    // Starts with a closed word: closed, even with numbers after it.
    if (CLOSED_CELL.test(s)) return 0;
    // Otherwise a number wins over any note riding along with it; no number
    // at all is unreadable.
    if (!/\d/.test(s)) return undefined;
    const items = s.split(/\s*(?:,|;|&|\band\b)\s*/).filter((x) => /\d/.test(x));
    if (items.length >= 2) return items.length;
    const range = /(\d+)\s*(?:-|–|to)\s*(\d+)/.exec(s);
    if (range && Number(range[2]) > Number(range[1])) return Number(range[2]) - Number(range[1]) + 1;
    const n = /\d+/.exec(s);
    return n ? Number(n[0]) : undefined;
}

// ---------------------------------------------------------------------------
// Guessing the layout
// ---------------------------------------------------------------------------

const KEYWORDS: Record<"date" | "time" | "courts" | "location", RegExp> = {
    date: /\bdate\b|^day$|^dates?$/i,
    time: /time|start|slot|hour/i,
    // Every sport's word for a playing area: "Courts", "Sheets", "Fields"...
    courts: /court|avail|^#|qty|count|number|^cts?\b|sheet|field|rink|ice|diamond|pitch|gym|space/i,
    location: /locat|facility|site|venue|club|park|center|centre|^where$/i,
};

/** Headings of a league's own schedule columns: never a playing-area count. */
const NOT_COURTS = /match|game|team|home|away|visit|opponent|\bdiv|age|bracket|level|notes?|comments?|score|result|player/i;
/** Columns where any text means the slot is already taken (a team, "No Courts"). */
const BOOKED = /home|away|visit|opponent|\bteams?\b|match ?up|players?|booked|reserved/i;
/**
 * Also taken when filled -- but ONLY on a sheet with no courts column. On a
 * facility sheet with a real Courts column, Notes holds "Lights on" or
 * "indoor", and reading those rows as taken closed good court time.
 */
const BOOKED_IF_NO_COURTS = /notes?|comments?/i;
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
/** "Fri", "Saturday", "sat " -> 0..6 (Sun = 0), else null. */
function weekdayOf(c: Cell): number | null {
    if (typeof c !== "string") return null;
    const t = c.trim().toLowerCase();
    if (t.length < 3) return null;
    const i = WEEKDAYS.findIndex((d) => t.startsWith(d) && "sunday monday tuesday wednesday thursday friday saturday tues weds thur thurs".split(" ").some((full) => full.startsWith(t) || t === d || t === `${d}.`));
    return i < 0 ? null : i;
}
const DAY_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const nonEmpty = (row: Cell[] | undefined) => (row ?? []).filter((c) => !isBlank(c));

/** For header detection only: text-ish cells that read as a time (not bare numbers, which are usually court counts). */
// In a CSV every cell is text, so a bare "4" must not read as 4pm here: a
// heading that is a time says so with a colon, am/pm or "noon".
// The whole cell must be a time or time range ("9:00", "1pm", "6-8pm"), so
// a courts cell with a note ("4 - event at 1pm") can't pose as a heading.
const CLEAN_TIME = /^\s*(noon|\d{1,2}([:.]\d{2})?\s*([ap]\.?m?\.?)?)(\s*(-|–|—|to)\s*\d{1,2}([:.]\d{2})?\s*([ap]\.?m?\.?)?)?\s*$/i;
const looksLikeTime = (c: Cell, ctx: Ctx) =>
    c !== null &&
    ((typeof c === "string" && CLEAN_TIME.test(c) && /:|\d\s*[ap]|noon/i.test(c)) || typeof c === "object") &&
    !readDate(c, ctx) &&
    readTime(c) !== null;
const looksLikeDate = (c: Cell, ctx: Ctx) => readDate(c, ctx) !== null;

export function guessMapping(grid: Cell[][], ctx: Ctx): Mapping {
    const scan = Math.min(grid.length, 25);
    const base: Mapping = { layout: "rows", header: -1, date: null, time: null, courts: null, location: null, courtsMode: "count", label: 0, booked: [], day: null };

    // Grid layouts: a row whose cells (after the first filled one) are mostly times, or mostly dates.
    for (let r = 0; r < scan; r++) {
        const row = grid[r];
        const filled = row.map((c, i) => [c, i] as const).filter(([c]) => !isBlank(c));
        if (filled.length < 3 || new Set(filled.map(([c]) => cellText(c))).size < 2) continue;
        const rest = filled.slice(1);
        const times = rest.filter(([c]) => looksLikeTime(c, ctx)).length;
        const dates = rest.filter(([c]) => looksLikeDate(c, ctx)).length;
        const label = labelColumn(grid, r, filled[0][1]);
        if (times / rest.length >= 0.6 && times >= 2) return { ...base, layout: "dates-down", header: r, label };
        if (dates / rest.length >= 0.6 && dates >= 2) return { ...base, layout: "times-down", header: r, label };
    }

    // Rows layout. The header is the first row that names at least two of
    // our columns (Date, Time, Courts...); failing that, the first row of
    // mostly non-numeric text. Rows whose cells are all the same value are a
    // merged title ("Riverside Tennis Center - Spring 2027") and never count.
    const distinct = (row: Cell[]) => new Set(nonEmpty(row).map(cellText)).size;
    const keywordHits = (row: Cell[]) =>
        Object.values(KEYWORDS).filter((kw) => row.some((c) => typeof c === "string" && kw.test(c))).length;
    let header = -1;
    for (let r = 0; r < scan; r++) {
        if (distinct(grid[r]) >= 2 && keywordHits(grid[r]) >= 2) {
            header = r;
            break;
        }
    }
    if (header < 0) {
        for (let r = 0; r < scan; r++) {
            const f = nonEmpty(grid[r]);
            if (distinct(grid[r]) < 2) continue;
            const texty = f.filter((c) => typeof c === "string" && !looksLikeDate(c, ctx) && readTime(c) === null && !/^\d+$/.test(c)).length;
            if (texty / f.length >= 0.5) header = r;
            break; // the first substantial row is either the header or data
        }
    }
    const width = Math.max(0, ...grid.slice(0, scan + 50).map((r) => r.length));
    const data = grid.slice(header + 1, header + 1 + 80).filter((r) => nonEmpty(r).length >= 2);
    const score = (col: number, test: (c: Cell, col: number) => boolean) => {
        const cells = data.map((r) => r[col]).filter((c) => !isBlank(c));
        return cells.length ? cells.filter((c) => test(c, col)).length / cells.length : 0;
    };
    const headText = (col: number) => (header >= 0 ? cellText(grid[header][col] ?? null) : "");
    const taken = new Set<number>();
    const pick = (kw: RegExp, test: (c: Cell, col: number) => boolean, min: number): number | null => {
        let best: number | null = null;
        let bestScore = 0;
        for (let c = 0; c < width; c++) {
            if (taken.has(c)) continue;
            const s = score(c, test) + (kw.test(headText(c)) ? 0.5 : 0);
            if (s > bestScore) {
                bestScore = s;
                best = c;
            }
        }
        if (best === null || bestScore < min) return null;
        taken.add(best);
        return best;
    };
    const date = pick(KEYWORDS.date, (c) => looksLikeDate(c, ctx), 0.5);
    // A bare number only counts as a time when its column is headed like one
    // ("Start": 9, 13); otherwise 4 is a court count, not 4pm. That holds for
    // a CSV's text "4" exactly as for a spreadsheet's number 4 -- testing only
    // number cells let "Date,Courts / 3/6/2027,4" import 1 court at 4 PM.
    const bareNumber = (c: Cell) => (typeof c === "number" && c >= 1) || (typeof c === "string" && /^\s*\d+\s*$/.test(c));
    const time = pick(KEYWORDS.time, (c, col) => !looksLikeDate(c, ctx) && readTime(c) !== null && (!bareNumber(c) || KEYWORDS.time.test(headText(col))), 0.5);
    // A playing-area column holds counts ("4") or names ("Sheet A", "Field 3").
    // A schedule sheet's own columns (Match #, Home Team, Age Div) are never
    // the playing-area column, however their few filled cells read: a note
    // like "No Courts - Academy Day" in Home Team once made it the "courts"
    // column and every blank row read as "nothing free". A real courts column
    // is also filled on most rows, not on a handful.
    for (let c = 0; c < width; c++) if (NOT_COURTS.test(headText(c))) taken.add(c);
    const filledShare = (col: number) => (data.length ? data.filter((r) => !isBlank(r[col])).length / data.length : 0);
    const courtsCol = pick(KEYWORDS.courts, (c) => (typeof c === "string" && SINGLE_COURT.test(c.trim())) || (readCourts(c) !== undefined && readCourts(c) !== null && !looksLikeDate(c, ctx) && (typeof c === "number" || !looksLikeTime(c, ctx))), 0.6);
    const courts = courtsCol !== null && filledShare(courtsCol) >= 0.3 ? courtsCol : null;
    for (let c = 0; c < width; c++) if (NOT_COURTS.test(headText(c)) && c !== date && c !== time) taken.delete(c);
    let location: number | null = null;
    for (let c = 0; c < width; c++) if (!taken.has(c) && c !== courts && KEYWORDS.location.test(headText(c))) location = c;
    const used = new Set([date, time, courts, location].filter((c): c is number => c !== null));
    // The Day column first, so a column of weekdays is never also a "taken"
    // column -- that read every row as taken and closed every time.
    let day: number | null = null;
    for (let c = 0; c < width && day === null; c++) {
        if (used.has(c)) continue;
        const cells = data.map((r) => r[c]).filter((x) => !isBlank(x));
        if (cells.length >= 3 && cells.filter((x) => weekdayOf(x) !== null).length / cells.length >= 0.8) day = c;
    }
    const booked: number[] = [];
    for (let c = 0; c < width; c++) {
        if (used.has(c) || c === day) continue;
        const h = headText(c);
        if (BOOKED.test(h) || (courts === null && BOOKED_IF_NO_COURTS.test(h))) booked.push(c);
    }
    // No playing-area column. If dates+times repeat ("Fri 8:00 PM" on three
    // rows), each row is one court: three rows = three games at once. Merging
    // them into one slot cut a facility's time to about a third. If every
    // time appears once, it's a list of open times, and the person says how
    // many courts each has ("A time slot" + a number).
    let repeats = false;
    if (courts === null && date !== null) {
        const seen = new Set<string>();
        for (const r of data) {
            const d = readDate(r[date], ctx);
            const tm = time !== null ? readTime(r[time]) : (d?.time ?? null);
            if (!d || !tm) continue;
            const k = `${d.date}|${tm}|${location !== null ? cellText(r[location]).toLowerCase() : ""}`;
            if (seen.has(k)) {
                repeats = true;
                break;
            }
            seen.add(k);
        }
    }
    // A league's own schedule sheet (Home/Visiting columns) lists MATCHES,
    // one per row -- not courts. Reading its rows as courts and dividing by
    // "courts used by one match" (2 for a tennis team match) halved her
    // season: 109 rows became ~50 match spots and setup said not enough.
    const teamCols = booked.some((c) => /home|away|visit|opponent|\bteams?\b|match ?up/i.test(headText(c)));
    const rowsMode = repeats ? (teamCols ? "matches" : "names") : "count";
    return { ...base, header, date, time, courts, location, booked, day, courtsMode: courts === null ? rowsMode : guessCourtsMode(grid, header, courts) };
}

/** "Court 7", "Ct. 3", "#4": a reference to ONE court, not a count. */
/** "Court 7", "Sheet A", "Field 3", "Ct. 2", "#4": ONE unit, not a count. */
const SINGLE_COURT = /^(court|ct|sheet|field|fld|rink|diamond|pitch|gym|space)\.?\s*#?\s*(\d+[a-z]?|[a-z])$|^#\s*\d+$/i;

/**
 * Count vs names -- deliberately conservative, because guessing "names" on a
 * counts sheet silently changes the numbers (two times sharing a slot, or a
 * pasted duplicate, would collapse). Names only when:
 *  - most filled courts cells are court LABELS ("Court 7", "Ct 3", "#4",
 *    "Stadium") -- words that mean closed ("Reserved") don't count as labels;
 *  - or the column is headed like a single court ("Court", "Court #",
 *    "Court No.") rather than a quantity ("Courts", "Courts available").
 * Everything else stays a count. The dialog says when names was picked.
 */
function guessCourtsMode(grid: Cell[][], header: number, courts: number | null): "count" | "names" {
    if (courts === null) return "count";
    const head = header >= 0 ? cellText(grid[header][courts] ?? null).trim() : "";
    if (/^(court|ct|sheet|field|fld|rink|diamond|pitch|gym|space)\.?\s*(#|no\.?|number|name)?$/i.test(head)) return "names";
    let named = 0;
    let filled = 0;
    for (const row of grid.slice(header + 1, header + 201)) {
        const c = row[courts];
        if (isBlank(c)) continue;
        filled++;
        if (typeof c !== "string") continue;
        const t = c.trim();
        // Only things that look like a court's NAME: "Court 7", "#4", or words
        // like "Stadium" / "Center Court". "All", "TBD" or "Hard 4" are not.
        if (SINGLE_COURT.test(t) || (!/\d/.test(t) && /\b(courts?|fields?|sheets?|rinks?|diamonds?|pitch(es)?|gyms?)\b|stadium|grandstand/i.test(t) && !CLOSED_CELL.test(t))) named++;
    }
    return filled > 0 && named / filled >= 0.5 ? "names" : "count";
}

/** The column under a grid header that holds the row labels: the first filled one, nudged to where the data actually is. */
function labelColumn(grid: Cell[][], header: number, firstFilled: number): number {
    // In a grid the header's first filled cell is usually the corner label
    // ("Date") or the first time; the label column is the left-most column
    // that has values in the rows below.
    const below = grid.slice(header + 1, header + 30);
    for (let c = 0; c <= firstFilled; c++) if (below.some((r) => !isBlank(r[c]))) return c;
    return 0;
}

// ---------------------------------------------------------------------------
// Parsing with a mapping
// ---------------------------------------------------------------------------

export function parseWith(grid: Cell[][], m: Mapping, ctx: Ctx, opts: { defaultCourts: number } = { defaultCourts: 1 }): ParseResult {
    const out = new Map<string, ParsedRow>();
    const problems: Problem[] = [];
    const notes: Problem[] = [];
    let duplicates = 0;
    let taken = 0;
    let headings = 0;
    /** count mode: times where every row was taken, so they read as closed. */
    const closed = new Map<string, ParsedRow>();
    // Location casing varies within one sheet ("Riverside Main" / "riverside
    // main"); the same court time must not be counted twice because of it.
    const keyOf = (row: { date: string; time: string; location: string | null }) => `${row.date}|${row.time}|${(row.location ?? "").trim().toLowerCase()}`;
    const named = new Map<string, { row: ParsedRow; names: Map<string, string> }>();
    const add = (row: ParsedRow) => {
        const k = keyOf(row);
        if (out.has(k)) duplicates++;
        out.set(k, row);
    };
    const problem = (line: number, message: string) => {
        if (problems.length < 500) problems.push({ line, message });
    };

    if (m.layout === "rows") {
        if (m.date === null) return { rows: [], problems: [{ line: 0, message: "Choose which column holds the date." }], duplicates };
        let lastDate: string | null = null;
        const booked = (m.booked ?? []).filter((c) => c !== m.date && c !== m.time && c !== m.courts && c !== m.location && c !== m.day);
        for (let r = m.header + 1; r < grid.length; r++) {
            const row = grid[r];
            if (nonEmpty(row).length === 0) continue;
            const line = r + 1;
            // "Week 1", "Turkey Weekend - No Play": a section heading (one
            // cell, often merged across the row, so every cell holds it). A
            // row holding only a time (",6:00 PM" under a date written once
            // per day) is NOT a heading: it takes the date from above.
            const only = new Set(nonEmpty(row).map(cellText));
            const single = only.size === 1 ? nonEmpty(row)[0] : null;
            if (single !== null && !readDate(row[m.date], ctx) && readTime(single) === null && !readDate(single, ctx)) {
                headings++;
                continue;
            }
            const dc = row[m.date];
            let d = readDate(dc, ctx);
            if (!d && isBlank(dc) && lastDate) d = { date: lastDate, time: null };
            if (!d) {
                problem(line, isBlank(dc) ? "No date" : `Couldn’t read the date “${cellText(dc)}”`);
                continue;
            }
            lastDate = d.date;
            const time = m.time !== null ? readTime(row[m.time]) : d.time;
            if (!time) {
                problem(line, m.time !== null && !isBlank(row[m.time]) ? `Couldn’t read the time “${cellText(row[m.time])}”` : "No start time");
                continue;
            }
            const loc = m.location !== null ? cellText(row[m.location]) || null : null;
            if (m.day !== null && m.day !== undefined) {
                const said = weekdayOf(row[m.day]);
                const actual = new Date(`${d.date}T12:00:00Z`).getUTCDay();
                if (said !== null && said !== actual)
                    notes.push({ line, message: `Says ${cellText(row[m.day]).trim()}, but ${formatDate(d.date, true)} is a ${DAY_NAME[actual]}. Used the date.` });
            }
            const isTaken = booked.some((c) => !isBlank(row[c]));
            if (isTaken) taken++;
            // "matches" counts rows exactly like one-court-per-row; the import
            // dialog then stores each row as a whole match's worth of courts.
            if (m.courtsMode === "names" || m.courtsMode === "matches") {
                // One row per court: collect distinct court names per time.
                const k = keyOf({ date: d.date, time, location: loc });
                const c = m.courts === null ? null : row[m.courts];
                // A blank court cell is reported and adds NOTHING -- like a
                // blank count in counts mode. Creating the time first made it a
                // 0-court row, i.e. "closed", from a cell that said nothing.
                if (m.courts !== null && isBlank(c)) {
                    problem(line, "No court named");
                    continue;
                }
                const entry = named.get(k) ?? { row: { date: d.date, time, courts: 0, location: loc, line }, names: new Map<string, string>() };
                named.set(k, entry);
                // A taken row still marks its time as covered by the file, so
                // a time whose rows are all taken reads as closed (0).
                if (isTaken) continue;
                if (m.courts === null) entry.names.set(`row ${line}`, "");
                else {
                    // Only a whole-cell "closed" marker is skipped; "Clinic Court" is a court.
                    if (!(typeof c === "string" && (CLOSED_CELL.test(c.trim()) || /^(-|–|—|x|closed|none|n\/?a)$/i.test(c.trim())))) {
                        // First spelling wins ("Field 3" over a later "field 3").
                        const key = cellText(c).toLowerCase();
                        if (!entry.names.has(key)) entry.names.set(key, cellText(c));
                    }
                    // a "closed" row adds no court but still marks the time as covered (0)
                }
                continue;
            }
            if (isTaken) {
                const k = keyOf({ date: d.date, time, location: loc });
                if (!closed.has(k)) closed.set(k, { date: d.date, time, courts: 0, location: loc, line });
                continue;
            }
            let courts: number | null | undefined = opts.defaultCourts;
            if (m.courts !== null) {
                courts = readCourts(row[m.courts]);
                if (courts === undefined) {
                    problem(line, `Couldn’t read how many are free: “${cellText(row[m.courts])}”`);
                    continue;
                }
                if (courts === null) {
                    problem(line, "Nothing listed as free");
                    continue;
                }
            }
            add({ date: d.date, time, courts, location: loc, line });
        }
    } else {
        const head = grid[m.header] ?? [];
        // Column -> the date or time it represents.
        const cols: { c: number; date?: string; time?: string }[] = [];
        for (let c = 0; c < head.length; c++) {
            if (c === m.label || isBlank(head[c])) continue;
            if (m.layout === "dates-down") {
                const t = readTime(head[c]);
                if (t) cols.push({ c, time: t });
                else problem(m.header + 1, `Couldn’t read the time heading “${cellText(head[c])}”`);
            } else {
                const d = readDate(head[c], ctx);
                if (d) cols.push({ c, date: d.date });
                else problem(m.header + 1, `Couldn’t read the date heading “${cellText(head[c])}”`);
            }
        }
        let lastLabel: string | null = null;
        for (let r = m.header + 1; r < grid.length; r++) {
            const row = grid[r];
            if (nonEmpty(row).length === 0) continue;
            const line = r + 1;
            const lc = row[m.label];
            let label: string | null = null;
            if (m.layout === "dates-down") label = readDate(lc, ctx)?.date ?? null;
            else label = readTime(lc);
            if (!label && isBlank(lc)) label = lastLabel;
            if (!label) {
                problem(line, `Couldn’t read the ${m.layout === "dates-down" ? "date" : "time"} “${cellText(lc)}”`);
                continue;
            }
            lastLabel = label;
            for (const col of cols) {
                const courts = readCourts(row[col.c]);
                if (courts === null) continue;
                if (courts === undefined) {
                    problem(line, `Couldn’t read how many are free: “${cellText(row[col.c])}”`);
                    continue;
                }
                const date = m.layout === "dates-down" ? label : col.date!;
                const time = m.layout === "dates-down" ? col.time! : label;
                add({ date, time, courts, location: null, line });
            }
        }
    }
    for (const { row, names } of named.values()) {
        // Real names (not the "row N" stand-ins used when there's no court column) travel with the row.
        const real = [...names.values()].filter(Boolean);
        add({ ...row, courts: names.size, ...(real.length === names.size && real.length ? { units: real } : {}) });
    }
    for (const [k, row] of closed) if (!out.has(k)) out.set(k, row);
    const rows = [...out.values()].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    return { rows, problems, duplicates, taken, headings, notes };
}
