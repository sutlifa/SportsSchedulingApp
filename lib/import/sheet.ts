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
import { dayToIso, isoToDay } from "../engine/dates.ts";
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
    courtsMode: "count" | "names";
    /** grid layouts: the column holding the row labels (dates or times). */
    label: number;
};

export type ParsedRow = { date: string; time: string; courts: number; location: string | null; line: number };
export type Problem = { line: number; message: string };
export type ParseResult = { rows: ParsedRow[]; problems: Problem[]; duplicates: number };

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
 * exception is a court's own name: "Clinic Court", "Event Court 2" and
 * "Private Court 1" are courts, not closures. Note "3 (1 held for lessons)"
 * doesn't start with a closed word, so its leading number wins.
 */
const CLOSED_CELL = /^(reserved|unavailable|not available|tournament|blocked|maintenance|private|lessons?|camp|clinic|event|hold|held|rain ?out|rain|closed)\b(?!\s*courts?\b)/i;

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
    courts: /court|avail|^#|qty|count|number|^cts?\b/i,
    location: /locat|facility|site|venue|club|park|center|centre|^where$/i,
};

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
    const base: Mapping = { layout: "rows", header: -1, date: null, time: null, courts: null, location: null, courtsMode: "count", label: 0 };

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
    // ("Start": 9, 13); otherwise 4 is a court count, not 4pm.
    const time = pick(KEYWORDS.time, (c, col) => !looksLikeDate(c, ctx) && readTime(c) !== null && (typeof c !== "number" || c < 1 || KEYWORDS.time.test(headText(col))), 0.5);
    const courts = pick(KEYWORDS.courts, (c) => readCourts(c) !== undefined && readCourts(c) !== null && !looksLikeDate(c, ctx) && (typeof c === "number" || !looksLikeTime(c, ctx)), 0.6);
    let location: number | null = null;
    for (let c = 0; c < width; c++) if (!taken.has(c) && KEYWORDS.location.test(headText(c))) location = c;
    return { ...base, header, date, time, courts, location, courtsMode: guessCourtsMode(grid, header, courts) };
}

/** "Court 7", "Ct. 3", "#4": a reference to ONE court, not a count. */
const SINGLE_COURT = /^(court|ct)\.?\s*#?\s*\d+[a-z]?$|^#\s*\d+$/i;

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
    if (/^(court|ct)\.?\s*(#|no\.?|number|name)?$/i.test(head)) return "names";
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
        if (SINGLE_COURT.test(t) || (!/\d/.test(t) && /\bcourts?\b|stadium|grandstand/i.test(t) && !CLOSED_CELL.test(t))) named++;
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
    let duplicates = 0;
    // Location casing varies within one sheet ("Riverside Main" / "riverside
    // main"); the same court time must not be counted twice because of it.
    const keyOf = (row: { date: string; time: string; location: string | null }) => `${row.date}|${row.time}|${(row.location ?? "").trim().toLowerCase()}`;
    const named = new Map<string, { row: ParsedRow; names: Set<string> }>();
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
        for (let r = m.header + 1; r < grid.length; r++) {
            const row = grid[r];
            if (nonEmpty(row).length === 0) continue;
            const line = r + 1;
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
            if (m.courtsMode === "names") {
                // One row per court: collect distinct court names per time.
                const k = keyOf({ date: d.date, time, location: loc });
                const entry = named.get(k) ?? { row: { date: d.date, time, courts: 0, location: loc, line }, names: new Set<string>() };
                named.set(k, entry);
                if (m.courts === null) entry.names.add(`row ${line}`);
                else {
                    const c = row[m.courts];
                    if (isBlank(c)) problem(line, "No court named");
                    // Only a whole-cell "closed" marker is skipped; "Clinic Court" is a court.
                    else if (!(typeof c === "string" && (CLOSED_CELL.test(c.trim()) || /^(-|–|—|x|closed|none|n\/?a)$/i.test(c.trim())))) entry.names.add(cellText(c).toLowerCase());
                    // a "closed" row adds no court but still marks the time as covered (0)
                }
                continue;
            }
            let courts: number | null | undefined = opts.defaultCourts;
            if (m.courts !== null) {
                courts = readCourts(row[m.courts]);
                if (courts === undefined) {
                    problem(line, `Couldn’t read the number of courts “${cellText(row[m.courts])}”`);
                    continue;
                }
                if (courts === null) {
                    problem(line, "No number of courts");
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
                    problem(line, `Couldn’t read the number of courts “${cellText(row[col.c])}”`);
                    continue;
                }
                const date = m.layout === "dates-down" ? label : col.date!;
                const time = m.layout === "dates-down" ? col.time! : label;
                add({ date, time, courts, location: null, line });
            }
        }
    }
    for (const { row, names } of named.values()) add({ ...row, courts: names.size });
    const rows = [...out.values()].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    return { rows, problems, duplicates };
}
