import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isDateFormat, isXlsxError, readXlsx } from "../../lib/import/xlsx.ts";
import { sheetXml, workbook, zip } from "../support/xlsx-builder.ts";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../scripts/fixtures/${name}`, import.meta.url)));
const inline = (ref: string, text: string) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
const num = (ref: string, v: number | string, s?: number) => `<c r="${ref}"${s !== undefined ? ` s="${s}"` : ""}><v>${v}</v></c>`;

/** Expect readXlsx to fail with a person-readable XlsxError message. */
async function refuses(data: Uint8Array, message: RegExp) {
    await assert.rejects(readXlsx(data), (e: unknown) => {
        assert.ok(isXlsxError(e), `an XlsxError, got ${(e as Error)?.constructor?.name}: ${(e as Error)?.message}`);
        assert.match((e as Error).message, message);
        return true;
    });
}

describe("readXlsx: cell types", () => {
    test("shared strings (incl. rich-text runs; phonetic hints ignored), inline strings, formula strings", async () => {
        const sharedXml = `<sst><si><t>Date</t></si><si><r><t>Ri</t></r><r><rPr/><t xml:space="preserve">ver </t></r><r><t>side</t></r></si><si><t>漢</t><rPh><t>かん</t></rPh></si><si/></sst>`;
        const xml = sheetXml([{ r: 1, cells: [`<c r="A1" t="s"><v>0</v></c>`, `<c r="B1" t="s"><v>1</v></c>`, `<c r="C1" t="s"><v>2</v></c>`, `<c r="D1" t="s"><v>3</v></c>`, inline("E1", "Inline"), `<c r="F1" t="str"><f>A1</f><v>Formula &amp; text</v></c>`] }]);
        const [s] = await readXlsx(workbook({ sheets: [{ name: "One", xml }], sharedXml }));
        assert.equal(s.name, "One");
        assert.deepEqual(s.rows, [["Date", "River side", "漢", null, "Inline", "Formula & text"]]);
    });

    test("numbers, booleans, errors and blanks", async () => {
        const xml = sheetXml([{ cells: [num("A1", 4), num("B1", "2.5"), `<c r="C1" t="b"><v>1</v></c>`, `<c r="D1" t="b"><v>0</v></c>`, `<c r="E1" t="e"><v>#N/A</v></c>`, `<c r="F1"/>`, `<c r="G1"><v> </v></c>`, inline("H1", "   ")] }]);
        const [s] = await readXlsx(workbook({ sheets: [{ name: "S", xml }] }));
        assert.deepEqual(s.rows, [[4, 2.5, true, false, null, null, null, null]]);
    });

    test("date-formatted numbers come back as { serial } (built-in and custom formats); others stay numbers", async () => {
        // style 0 General, 1 built-in 14 (m/d/yyyy), 2 custom 164 "ddd m/d", 3 custom 165 "0.00", 4 built-in 20 (h:mm)
        const xml = sheetXml([{ cells: [num("A1", 46452, 0), num("B1", 46452, 1), num("C1", 46452.375, 2), num("D1", 46452, 3), num("E1", 0.375, 4)] }]);
        const [s] = await readXlsx(workbook({ sheets: [{ name: "S", xml }], styles: [0, 14, 164, 165, 20], numFmts: { 164: "ddd m/d", 165: "0.00" } }));
        assert.deepEqual(s.rows, [[46452, { serial: 46452 }, { serial: 46452.375 }, 46452, { serial: 0.375 }]]);
    });

    test("XML entities are decoded, numeric and named", async () => {
        const [s] = await readXlsx(workbook({ sheets: [{ name: "Q&A", xml: sheetXml([{ cells: [inline("A1", "Tom &amp; Jerry &#x41;&#66; &lt;3 &quot;x&quot; &apos;y&apos;")] }]) }] }));
        assert.equal(s.name, "Q&A");
        assert.equal(s.rows[0][0], `Tom & Jerry AB <3 "x" 'y'`);
    });
});

describe("readXlsx: shape", () => {
    test("sparse rows and columns become a dense grid with nulls", async () => {
        const xml = sheetXml([
            { r: 2, cells: [inline("B2", "x")] },
            { r: 5, cells: [num("A5", 1), num("D5", 4)] },
        ]);
        const [s] = await readXlsx(workbook({ sheets: [{ name: "S", xml }] }));
        assert.deepEqual(s.rows, [
            [null, null, null, null],
            [null, "x", null, null],
            [null, null, null, null],
            [null, null, null, null],
            [1, null, null, 4],
        ]);
    });

    test("rows and cells without r= attributes are read in order", async () => {
        const xml = `<worksheet><sheetData><row><c t="inlineStr"><is><t>a</t></is></c><c><v>2</v></c></row><row><c><v>3</v></c></row></sheetData></worksheet>`;
        const [s] = await readXlsx(workbook({ sheets: [{ name: "S", xml }] }));
        assert.deepEqual(s.rows, [["a", 2], [3, null]]);
    });

    test("merged cells copy the top-left value over the whole range (but don't overwrite a value)", async () => {
        const xml = sheetXml(
            [
                { r: 1, cells: [inline("A1", "Title")] },
                { r: 2, cells: [num("A2", 46452, 1), num("B2", 9), num("C2", 1)] },
                { r: 3, cells: [num("B3", 10)] },
                { r: 4, cells: [num("B4", 11), num("A4", 7)] },
            ],
            ["A1:C1", "A2:A4"]
        );
        const [s] = await readXlsx(workbook({ sheets: [{ name: "S", xml }], styles: [0, 14] }));
        assert.deepEqual(s.rows, [
            ["Title", "Title", "Title"],
            [{ serial: 46452 }, 9, 1],
            [{ serial: 46452 }, 10, null],
            [7, 11, null],
        ]);
    });

    test("a merge reaching past the data is clipped to the grid, not widened", async () => {
        const xml = sheetXml([{ r: 1, cells: [inline("A1", "Title")] }, { r: 2, cells: [num("A2", 1)] }], ["A1:F9"]);
        const [s] = await readXlsx(workbook({ sheets: [{ name: "S", xml }] }));
        assert.deepEqual(s.rows, [["Title"], [1]]);
    });

    test("several sheets, in workbook order, each with its name", async () => {
        const sheets = ["March", "April", "May"].map((name, i) => ({ name, xml: sheetXml([{ cells: [num("A1", i)] }]) }));
        const out = await readXlsx(workbook({ sheets }));
        assert.deepEqual(out.map((s) => [s.name, s.rows[0][0]]), [["March", 0], ["April", 1], ["May", 2]]);
    });

    test("stored (uncompressed) entries read the same as deflated ones", async () => {
        const opts = { sheets: [{ name: "S", xml: sheetXml([{ cells: [inline("A1", "x"), num("B1", 3)] }]) }] };
        assert.deepEqual(await readXlsx(workbook({ ...opts, method: 0 })), await readXlsx(workbook({ ...opts, method: 8 })));
    });

    test("accepts an ArrayBuffer as well as a Uint8Array", async () => {
        const bytes = workbook({ sheets: [{ name: "S", xml: sheetXml([{ cells: [num("A1", 1)] }]) }] });
        const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        assert.deepEqual(await readXlsx(ab), await readXlsx(bytes));
    });

    test("caps a sheet at 200 columns and 5000 rows", async () => {
        const wide = Array.from({ length: 250 }, (_, i) => `<c><v>${i}</v></c>`).join("");
        const tall = Array.from({ length: 5100 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c></row>`).join("");
        const [w] = await readXlsx(workbook({ sheets: [{ name: "W", xml: `<worksheet><sheetData><row>${wide}</row></sheetData></worksheet>` }] }));
        assert.equal(w.rows[0].length, 200);
        const [t] = await readXlsx(workbook({ sheets: [{ name: "T", xml: `<worksheet><sheetData>${tall}</sheetData></worksheet>` }] }));
        assert.equal(t.rows.length, 5000);
    });

    test("the real Excel-written fixtures read (rows, two-sheet grid, times-down grid)", async () => {
        const [rows] = await readXlsx(fixture("rows.xlsx"));
        assert.equal(rows.name, "Spring");
        assert.equal(rows.rows[0][0], rows.rows[0][1], "the merged title fills across");
        assert.deepEqual((await readXlsx(fixture("grid-dates-down.xlsx"))).map((s) => s.name), ["March", "April"]);
        const [times] = await readXlsx(fixture("grid-times-down.xlsx"));
        assert.ok(times.rows[0].slice(1).some((c) => typeof c === "object" && c !== null && "serial" in c), "date headings are date serials");
    });
});

describe("readXlsx: damaged and wrong files fail with a clear message", () => {
    test("not a zip at all (random bytes, empty, a CSV)", async () => {
        await refuses(new Uint8Array(Array.from({ length: 500 }, (_, i) => (i * 7919) & 255)), /doesn’t look like an Excel \(\.xlsx\) file/);
        await refuses(new Uint8Array(0), /doesn’t look like an Excel/);
        await refuses(new TextEncoder().encode("Date,Time,Courts\n3/6/2027,9:00,4\n"), /doesn’t look like an Excel/);
    });

    test("a zip that isn't a workbook", async () => {
        await refuses(zip([{ name: "word/document.xml", data: "<w/>" }]), /doesn’t look like an Excel/);
    });

    test("a truncated download", async () => {
        const real = fixture("rows.xlsx");
        await refuses(real.slice(0, Math.floor(real.length / 2)), /doesn’t look like an Excel/);
        await refuses(real.slice(real.length - 400), /looks damaged/);
    });

    test("an unsupported compression method", async () => {
        await refuses(zip([{ name: "xl/workbook.xml", data: "<workbook/>", method: 12 }]), /uses a compression this app can’t read/);
    });

    test("a workbook with no readable sheets", async () => {
        await refuses(zip([{ name: "xl/workbook.xml", data: "<workbook><sheets/></workbook>" }]), /no readable worksheets/);
        await refuses(workbook({ sheets: [] }), /no readable worksheets/);
    });

    const unreadable = /^That file isn’t a readable \.xlsx spreadsheet\. Save it again from Excel or Google Sheets, or upload a \.csv\.$/;

    test("damaged compressed data: one plain message, never a blank one", async () => {
        await refuses(zip([{ name: "xl/workbook.xml", data: new Uint8Array([0xff, 0xfe, 0x00, 0x12, 0x99, 0x01, 0x02]), method: 8, asIs: true }]), unreadable);
        // A damaged worksheet (not just the workbook part) too.
        const good = workbook({ sheets: [{ name: "S", xml: sheetXml([{ cells: [num("A1", 1)] }]) }] });
        const real = zip([
            { name: "xl/workbook.xml", data: '<workbook><sheets><sheet name="S" r:id="rId1"/></sheets></workbook>' },
            { name: "xl/_rels/workbook.xml.rels", data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>' },
            { name: "xl/worksheets/sheet1.xml", data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), method: 8, asIs: true },
        ]);
        await refuses(real, unreadable);
        assert.equal((await readXlsx(good))[0].rows[0][0], 1, "the healthy version reads");
    });

    test("an entry offset past the end of the file: the same plain message", async () => {
        const z = zip([{ name: "xl/workbook.xml", data: "<workbook/>" }]);
        const dv = new DataView(z.buffer);
        dv.setUint32(dv.getUint32(z.length - 22 + 16, true) + 42, 999_999, true);
        await refuses(z, unreadable);
    });

    test("randomly corrupted real workbooks only ever fail with a plain, non-empty XlsxError", async () => {
        const real = fixture("grid-dates-down.xlsx");
        let seed = 7;
        const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
        for (let i = 0; i < 150; i++) {
            const bad = real.slice();
            for (let k = 0; k < 1 + Math.floor(rand() * 20); k++) bad[Math.floor(rand() * bad.length)] = Math.floor(rand() * 256);
            try {
                await readXlsx(bad);
            } catch (e) {
                assert.ok(isXlsxError(e), `#${i}: ${(e as Error)?.constructor?.name}: ${(e as Error)?.message}`);
                assert.ok((e as Error).message.length > 20, `#${i}: message "${(e as Error).message}"`);
            }
        }
    });

    test("isXlsxError tells our errors from anything else", () => {
        assert.equal(isXlsxError(new Error("x")), false);
        assert.equal(isXlsxError("x"), false);
        assert.equal(isXlsxError(null), false);
    });
});

describe("isDateFormat", () => {
    test("date and time formats", () => {
        for (const f of ["m/d/yyyy", "d-mmm-yy", "h:mm AM/PM", "[$-409]mmm d", "yyyy-mm-dd hh:mm:ss", "dddd", "[h]:mm"]) assert.equal(isDateFormat(f), true, f);
    });
    test("number, text and quoted-literal formats", () => {
        for (const f of ["0.00", "General", "general", "#,##0", '"Court "0', "0%", "@", "_(* #,##0_)", '"days"\\ 0', "[Red]0.0"]) assert.equal(isDateFormat(f), false, f);
    });
});
