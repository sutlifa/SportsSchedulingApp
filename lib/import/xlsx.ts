/**
 * A small, dependency-free .xlsx reader: just enough to turn a facility's
 * court-availability workbook into a grid of cells.
 *
 * Why not a library: the established one (SheetJS) is no longer published to
 * npm in a current version, and the alternatives pull in several packages to
 * do what is, for our purposes, "unzip three XML files and read <c> tags".
 * Unzipping uses the platform's DecompressionStream("deflate-raw") (every
 * current browser, Node 22+), so this costs nothing in bundle size.
 *
 * What it handles, because facility sheets do all of these:
 *  - shared strings, inline strings, rich-text runs
 *  - numbers formatted as dates/times, returned as `{ serial }` so the
 *    caller knows "this 46087 is a date, not a court count"
 *  - merged cells (a date written once and merged down over its time rows)
 *    are filled into every cell they cover
 *  - several sheets (one per month is common)
 *
 * Pure apart from DecompressionStream; scripts/verify-import.ts runs it in
 * Node against real workbooks written by Excel-compatible tooling.
 */

/** A cell as read: text, number, boolean, empty, or an Excel date/time serial. */
export type Cell = string | number | boolean | null | { serial: number };
export type Sheet = { name: string; rows: Cell[][] };

const MAX_ROWS = 5000;
const MAX_COLS = 200;

class XlsxError extends Error {}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Reads the zip central directory; returns name -> loader. */
function readZip(buf: Uint8Array): Map<string, () => Promise<Uint8Array>> {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
        if (dv.getUint32(i, true) === 0x06054b50) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) throw new XlsxError("This doesn’t look like an Excel (.xlsx) file.");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = new Map<string, () => Promise<Uint8Array>>();
    const dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
        if (p + 46 > buf.length || dv.getUint32(p, true) !== 0x02014b50) throw new XlsxError("This Excel file looks damaged.");
        const method = dv.getUint16(p + 10, true);
        const compSize = dv.getUint32(p + 20, true);
        const nameLen = dv.getUint16(p + 28, true);
        const extraLen = dv.getUint16(p + 30, true);
        const commentLen = dv.getUint16(p + 32, true);
        const local = dv.getUint32(p + 42, true);
        const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
        p += 46 + nameLen + extraLen + commentLen;
        if (compSize === 0xffffffff || local === 0xffffffff) throw new XlsxError("This Excel file is too large to read here.");
        files.set(name, async () => {
            const lNameLen = dv.getUint16(local + 26, true);
            const lExtraLen = dv.getUint16(local + 28, true);
            const start = local + 30 + lNameLen + lExtraLen;
            const raw = buf.subarray(start, start + compSize);
            if (method === 0) return raw;
            if (method === 8) return inflateRaw(raw);
            throw new XlsxError("This Excel file uses a compression this app can’t read. Save it again as .xlsx or .csv.");
        });
    }
    return files;
}

function decodeXml(s: string): string {
    return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
        const k = e.toLowerCase();
        if (k === "amp") return "&";
        if (k === "lt") return "<";
        if (k === "gt") return ">";
        if (k === "quot") return '"';
        if (k === "apos") return "'";
        const code = k.startsWith("#x") ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    });
}

function attrs(tag: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const m of tag.matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = decodeXml(m[2]);
    return out;
}

/** All text runs inside an <si> or <is>, ignoring phonetic hints. */
function runText(xml: string): string {
    const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
    let out = "";
    for (const m of clean.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) out += decodeXml(m[1]);
    return out;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

/** Does an Excel number format display a date or time? */
export function isDateFormat(code: string): boolean {
    const s = code
        .replace(/"[^"]*"/g, "")
        .replace(/\[[^\]]*\]/g, "")
        .replace(/\\./g, "")
        .replace(/_./g, "");
    if (/^general$/i.test(s.trim())) return false;
    return /[dmyhs]/i.test(s);
}

function colIndex(ref: string): number {
    const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? "";
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
}

function parseRef(ref: string): { r: number; c: number } | null {
    const m = /^([A-Z]+)(\d+)$/i.exec(ref);
    return m ? { r: Number(m[2]) - 1, c: colIndex(m[1]) } : null;
}

export async function readXlsx(data: ArrayBuffer | Uint8Array): Promise<Sheet[]> {
    const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
    const zip = readZip(buf);
    const text = async (name: string) => {
        const f = zip.get(name);
        return f ? new TextDecoder().decode(await f()) : null;
    };

    const workbook = await text("xl/workbook.xml");
    if (!workbook) throw new XlsxError("This doesn’t look like an Excel (.xlsx) file.");
    const rels = (await text("xl/_rels/workbook.xml.rels")) ?? "";
    const relTarget = new Map<string, string>();
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
        const a = attrs(m[0]);
        if (a.Id && a.Target) relTarget.set(a.Id, a.Target.startsWith("/") ? a.Target.slice(1) : `xl/${a.Target}`);
    }

    const shared: string[] = [];
    const sst = await text("xl/sharedStrings.xml");
    if (sst) for (const m of sst.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\s*\/>/g)) shared.push(m[1] ? runText(m[1]) : "");

    // Which style indexes (the `s` attribute on a cell) display as dates.
    const dateStyles = new Set<number>();
    const styles = await text("xl/styles.xml");
    if (styles) {
        const custom = new Map<number, string>();
        for (const m of styles.matchAll(/<numFmt\b[^>]*>/g)) {
            const a = attrs(m[0]);
            custom.set(Number(a.numFmtId), a.formatCode ?? "");
        }
        const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? "";
        let i = 0;
        for (const m of xfs.matchAll(/<xf\b[^>]*>/g)) {
            const id = Number(attrs(m[0]).numFmtId ?? 0);
            if (BUILTIN_DATE_FORMATS.has(id) || (custom.has(id) && isDateFormat(custom.get(id)!))) dateStyles.add(i);
            i++;
        }
    }

    const sheets: Sheet[] = [];
    for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
        const a = attrs(m[0]);
        const target = relTarget.get(a["r:id"] ?? "") ?? "";
        const xml = target ? await text(target) : null;
        if (!xml) continue;
        sheets.push({ name: a.name ?? `Sheet ${sheets.length + 1}`, rows: readSheet(xml, shared, dateStyles) });
    }
    if (!sheets.length) throw new XlsxError("That workbook has no readable sheets.");
    return sheets;
}

function readSheet(xml: string, shared: string[], dateStyles: Set<number>): Cell[][] {
    const rows: Cell[][] = [];
    let rowNo = -1;
    for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
        const ra = attrs(rm[1]);
        rowNo = ra.r ? Number(ra.r) - 1 : rowNo + 1;
        if (rowNo >= MAX_ROWS) break;
        const row: Cell[] = [];
        let col = -1;
        for (const cm of (rm[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
            const ca = attrs(cm[1]);
            col = ca.r ? colIndex(ca.r) : col + 1;
            if (col >= MAX_COLS) continue;
            const body = cm[2] ?? "";
            const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
            let cell: Cell = null;
            switch (ca.t) {
                case "s":
                    cell = v !== undefined ? (shared[Number(v)] ?? "") : null;
                    break;
                case "str":
                    cell = v !== undefined ? decodeXml(v) : null;
                    break;
                case "inlineStr":
                    cell = runText(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "");
                    break;
                case "b":
                    cell = v === "1";
                    break;
                case "e":
                    cell = null;
                    break;
                default:
                    if (v !== undefined && v.trim() !== "") {
                        const n = Number(v);
                        if (Number.isFinite(n)) cell = dateStyles.has(Number(ca.s ?? -1)) ? { serial: n } : n;
                    }
            }
            if (typeof cell === "string") cell = cell.trim() || null;
            row[col] = cell;
        }
        rows[rowNo] = row;
    }
    // Dense rectangle, holes as null.
    const width = Math.min(MAX_COLS, Math.max(0, ...rows.map((r) => (r ? r.length : 0))));
    const grid: Cell[][] = [];
    for (let r = 0; r < rows.length; r++) {
        const src = rows[r] ?? [];
        const out: Cell[] = new Array(width).fill(null);
        for (let c = 0; c < width; c++) out[c] = src[c] ?? null;
        grid.push(out);
    }
    // Merged cells: copy the top-left value into the whole range.
    for (const mm of xml.matchAll(/<mergeCell\b[^>]*ref="([A-Z]+\d+):([A-Z]+\d+)"/gi)) {
        const a = parseRef(mm[1]);
        const b = parseRef(mm[2]);
        if (!a || !b || a.r >= grid.length) continue;
        const v = grid[a.r]?.[a.c] ?? null;
        for (let r = a.r; r <= Math.min(b.r, grid.length - 1); r++) for (let c = a.c; c <= Math.min(b.c, width - 1); c++) if (grid[r][c] === null) grid[r][c] = v;
    }
    return grid;
}

export function isXlsxError(e: unknown): e is Error {
    return e instanceof XlsxError;
}
