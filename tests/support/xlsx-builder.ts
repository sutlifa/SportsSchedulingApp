/**
 * Builds .xlsx files in memory for the reader tests: a minimal, valid zip
 * (stored or deflated entries, real CRC-32) holding just the parts
 * lib/import/xlsx.ts reads. Lets each test state exactly what the workbook
 * contains -- merged cells, date styles, sparse rows -- instead of depending
 * on a binary fixture nobody can read in a diff.
 */
import { deflateRawSync } from "node:zlib";

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

export function crc32(data: Uint8Array): number {
    let c = 0xffffffff;
    for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

/** `asIs`: write `data` as the entry body without compressing it, whatever `method` says (for corrupt-file tests). */
export type ZipEntry = { name: string; data: string | Uint8Array; method?: 0 | 8 | 12; asIs?: boolean };

/** A zip archive. `method` 0 = stored, 8 = deflate; 12 (bzip2) is written as stored bytes to test refusal. */
export function zip(entries: ZipEntry[]): Uint8Array {
    const enc = new TextEncoder();
    const locals: Uint8Array[] = [];
    const centrals: Uint8Array[] = [];
    let offset = 0;
    for (const e of entries) {
        const raw = typeof e.data === "string" ? enc.encode(e.data) : e.data;
        const method = e.method ?? 8;
        const body = method === 8 && !e.asIs ? new Uint8Array(deflateRawSync(raw)) : raw;
        const name = enc.encode(e.name);
        const crc = crc32(raw);
        const local = new Uint8Array(30 + name.length + body.length);
        const lv = new DataView(local.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true);
        lv.setUint16(8, method, true);
        lv.setUint32(14, crc, true);
        lv.setUint32(18, body.length, true);
        lv.setUint32(22, raw.length, true);
        lv.setUint16(26, name.length, true);
        local.set(name, 30);
        local.set(body, 30 + name.length);
        const central = new Uint8Array(46 + name.length);
        const cv = new DataView(central.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(10, method, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, body.length, true);
        cv.setUint32(24, raw.length, true);
        cv.setUint16(28, name.length, true);
        cv.setUint32(42, offset, true);
        central.set(name, 46);
        locals.push(local);
        centrals.push(central);
        offset += local.length;
    }
    const cdSize = centrals.reduce((n, c) => n + c.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    const out = new Uint8Array(offset + cdSize + 22);
    let p = 0;
    for (const part of [...locals, ...centrals, eocd]) {
        out.set(part, p);
        p += part.length;
    }
    return out;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type SheetSpec = { name: string; xml: string };

/** Sheet XML from rows of raw <c> tags. Each row: { r?: number, cells: string[] }. */
export function sheetXml(rows: { r?: number; cells: string[] }[], merges: string[] = []): string {
    const body = rows.map((row) => `<row${row.r ? ` r="${row.r}"` : ""}>${row.cells.join("")}</row>`).join("");
    const merge = merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : "";
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData>${merge}</worksheet>`;
}

/**
 * A whole workbook. `styles`: cellXfs numFmtIds in order (index = the `s`
 * attribute); `numFmts`: custom formats by id.
 */
export function workbook(opts: {
    sheets: SheetSpec[];
    shared?: string[];
    sharedXml?: string;
    styles?: number[];
    numFmts?: Record<number, string>;
    method?: 0 | 8;
}): Uint8Array {
    const sheetsXml = opts.sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("");
    const entries: ZipEntry[] = [
        { name: "[Content_Types].xml", data: `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>` },
        {
            name: "xl/workbook.xml",
            data: `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetsXml}</sheets></workbook>`,
        },
        {
            name: "xl/_rels/workbook.xml.rels",
            data: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${opts.sheets
                .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
                .join("")}</Relationships>`,
        },
        ...opts.sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: s.xml })),
    ];
    if (opts.sharedXml || opts.shared)
        entries.push({ name: "xl/sharedStrings.xml", data: opts.sharedXml ?? `<?xml version="1.0"?><sst>${opts.shared!.map((s) => `<si><t>${esc(s)}</t></si>`).join("")}</sst>` });
    if (opts.styles) {
        const fmts = Object.entries(opts.numFmts ?? {})
            .map(([id, code]) => `<numFmt numFmtId="${id}" formatCode="${esc(code)}"/>`)
            .join("");
        entries.push({ name: "xl/styles.xml", data: `<?xml version="1.0"?><styleSheet><numFmts>${fmts}</numFmts><cellXfs count="${opts.styles.length}">${opts.styles.map((id) => `<xf numFmtId="${id}"/>`).join("")}</cellXfs></styleSheet>` });
    }
    return zip(entries.map((e) => ({ ...e, method: opts.method ?? 8 })));
}
