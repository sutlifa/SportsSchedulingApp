import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { cellText, guessMapping, parseDelimited, parseWith, readCourts, readDate, readTime, type Ctx, type Mapping } from "../../lib/import/sheet.ts";

const ctx: Ctx = { seasonStart: "2027-03-06", seasonEnd: "2027-05-16", fallbackYear: 2027 };
const grid = (text: string) => parseDelimited(text);
const guess = (text: string) => guessMapping(grid(text), ctx);
const parse = (text: string, m?: Partial<Mapping>, opts?: { defaultCourts: number }) => {
    const g = grid(text);
    return parseWith(g, { ...guessMapping(g, ctx), ...m }, ctx, opts);
};
const rows = (r: ReturnType<typeof parse>) => r.rows.map((x) => [x.date, x.time, x.courts]);

describe("parseDelimited", () => {
    test("CSV with quotes: embedded commas, doubled quotes, newlines inside quotes", () => {
        assert.deepEqual(grid('Date,Time,"Courts, available"\n"3/6/2027","9:00","He said ""4"""\na,"multi\nline",c'), [
            ["Date", "Time", "Courts, available"],
            ["3/6/2027", "9:00", 'He said "4"'],
            ["a", "multi\nline", "c"],
        ]);
    });

    test("a quote in the middle of a field is literal", () => {
        assert.deepEqual(grid('x"y"z,b'), [['x"y"z', "b"]]);
    });

    test("BOM, CRLF and old-Mac CR line endings", () => {
        assert.deepEqual(grid("﻿Date,Time\r\n3/6,9\r\n"), [["Date", "Time"], ["3/6", "9"]]);
        assert.deepEqual(grid('﻿"Date",Time\n'), [["Date", "Time"]]);
        assert.deepEqual(grid("a,b\rc,d"), [["a", "b"], ["c", "d"]]);
    });

    test("tab-separated (pasted cells) wins when the first line has a tab", () => {
        assert.deepEqual(grid("a\tb,c\n1\t2,3"), [["a", "b,c"], ["1", "2,3"]]);
    });

    test("semicolon-separated when the first line has more semicolons than commas (European Excel)", () => {
        assert.deepEqual(grid("Date;Time;Courts\n6.3.2027;9,30;4"), [["Date", "Time", "Courts"], ["6.3.2027", "9,30", "4"]]);
        assert.deepEqual(grid("a;b,c,d\n1;2,3,4"), [["a;b", "c", "d"], ["1;2", "3", "4"]], "more commas: comma-separated");
    });

    test("cells are trimmed, empty cells are null, ragged rows are padded, blank lines kept as empty rows", () => {
        assert.deepEqual(grid("  a  , ,c\n\nd\n"), [["a", null, "c"], [null, null, null], ["d", null, null]]);
    });

    test("empty input; no trailing empty row for a final newline", () => {
        assert.deepEqual(grid(""), []);
        assert.deepEqual(grid("a,b\n"), [["a", "b"]]);
    });

    test("stops at 5000 rows", () => {
        assert.equal(grid("1,2\n".repeat(6000)).length, 5000);
    });
});

describe("readDate", () => {
    const d = (c: Parameters<typeof readDate>[0], c2: Ctx = ctx) => readDate(c, c2)?.date ?? null;

    test("US numeric forms, with or without a year (year inferred from the season)", () => {
        for (const s of ["3/6", "3/6/2027", "3/6/27", "03/06/2027", "3-6-27", "3.6.2027"]) assert.equal(d(s), "2027-03-06", s);
    });

    test("ISO, with a time riding along", () => {
        assert.deepEqual(readDate("2027-03-06", ctx), { date: "2027-03-06", time: null });
        assert.deepEqual(readDate("2027-03-06T09:00", ctx), { date: "2027-03-06", time: "09:00" });
        assert.deepEqual(readDate("2027-03-06 9am", ctx), { date: "2027-03-06", time: "09:00" });
        assert.deepEqual(readDate("3/6 9:00 AM", ctx), { date: "2027-03-06", time: "09:00" });
        assert.deepEqual(readDate("3/6, 9:30am", ctx), { date: "2027-03-06", time: "09:30" });
        assert.deepEqual(readDate("3/6 noon", ctx), { date: "2027-03-06", time: "12:00" });
    });

    test("month names either way round, ordinals, weekdays ignored", () => {
        for (const s of ["Mar 6", "Mar. 6", "March 6", "March 6th", "Mar 6, 2027", "6 March 2027", "6th March 2027", "Sat 3/6", "Saturday, March 6", "Sat, Mar 6 2027", "sat. 3/6"]) assert.equal(d(s), "2027-03-06", s);
    });

    test("Excel serials: formatted ({serial}) and unformatted numbers in the date range", () => {
        assert.deepEqual(readDate({ serial: 46452 }, ctx), { date: "2027-03-06", time: null });
        assert.deepEqual(readDate({ serial: 46452.375 }, ctx), { date: "2027-03-06", time: "09:00" });
        assert.deepEqual(readDate(46452.5, ctx), { date: "2027-03-06", time: "12:00" });
        assert.equal(d(19_999), null, "too small to be a plausible date serial: a number");
        assert.equal(d(80_000), null);
        assert.equal(d({ serial: 0.375 }), null, "a time-only serial is not a date");
        assert.equal(d({ serial: 0 }), null);
    });

    test("year inference across New Year, and the fallback year without a season", () => {
        const winter: Ctx = { seasonStart: "2026-12-01", seasonEnd: "2027-02-28", fallbackYear: 2026 };
        assert.equal(d("12/28", winter), "2026-12-28");
        assert.equal(d("1/9", winter), "2027-01-09");
        assert.equal(d("Jan 9", winter), "2027-01-09");
        assert.equal(d("3/6", { seasonStart: "", seasonEnd: "", fallbackYear: 2031 }), "2031-03-06");
        assert.equal(d("3/6", { seasonStart: "2029-01-01", seasonEnd: "", fallbackYear: 2031 }), "2029-03-06", "a start date alone gives the year");
    });

    test("impossible or non-dates are null", () => {
        for (const c of ["2/30/2027", "13/1", "0/6", "3/32", "Courts", "Foo 6", "3/6/1899", "", "  ", null, true, false, 5]) assert.equal(d(c as never), null, String(c));
    });
});

describe("readTime", () => {
    const cases: [Parameters<typeof readTime>[0], string | null][] = [
        ["9", "09:00"],
        ["9am", "09:00"],
        ["9 a.m.", "09:00"],
        ["9:30 PM", "21:30"],
        ["9:30p", "21:30"],
        ["9:00:00", "09:00"],
        ["13:30", "13:30"],
        ["9.30", "09:30"],
        ["noon", "12:00"],
        ["midnight", "00:00"],
        ["12am", "00:00"],
        ["12:30 PM", "12:30"],
        ["7", "07:00"],
        ["6", "18:00"],
        ["3", "15:00"],
        ["6-8pm", "18:00"],
        ["11-1pm", "11:00"],
        ["12-2pm", "12:00"],
        ["11am-1pm", "11:00"],
        ["9:00 - 10:30 AM", "09:00"],
        ["9–10:30", "09:00"],
        ["10 to 11am", "10:00"],
        ["25:00", null],
        ["9:60", null],
        ["abc", null],
        ["Sat 3/6", null],
        ["  ", null],
        [null, null],
        [true, null],
        [13, "13:00"],
        [5, "17:00"],
        [0, "00:00"],
        [930, "09:30"],
        [1330, "13:30"],
        [2400, null],
        [24, null],
        [-1, null],
        [0.5, "12:00"],
        [{ serial: 0.375 }, "09:00"],
        [{ serial: 46452.75 }, "18:00"],
        [{ serial: 46452 }, null],
        [{ serial: 0 }, "00:00"],
    ];
    for (const [input, want] of cases) test(`${JSON.stringify(input)} -> ${want}`, () => assert.equal(readTime(input), want));
});

describe("readCourts", () => {
    test("counts: numbers, numbers with words, ranges, lists", () => {
        const cases: [Parameters<typeof readCourts>[0], number][] = [
            [4, 4],
            [4.7, 4],
            ["4", 4],
            ["4 courts", 4],
            ["Courts 1-4", 4],
            ["Courts 1 to 4", 4],
            ["1, 2, 5", 3],
            ["4 & 5", 2],
            ["1 and 2", 2],
            ["2;3", 2],
            ["4-2", 4],
            ["3 (1 held for lessons)", 3],
            ["Courts 1-4, rain backup", 4],
            ["#4", 4],
            [{ serial: 3 }, 3],
            [true, 1],
        ];
        for (const [c, n] of cases) assert.equal(readCourts(c), n, JSON.stringify(c));
    });

    test("closed: marker words, and any cell that STARTS with a closed word", () => {
        for (const c of ["closed", "-", "–", "x", "none", "N/A", "na", "no", "full", "booked", "0", "Reserved", "Reserved (2)", "Tournament - courts 1-6", "Clinic 9-11am", "Unavailable", "Maintenance", "Rain out", "Event courts 1-4", "Lesson Court 5-6", "Tournament sheets A-B", false])
            assert.equal(readCourts(c as never), 0, JSON.stringify(c));
    });

    test("a single court's NAME that starts with a closed word is not closed", () => {
        assert.equal(readCourts("Event Court 2"), 2);
        assert.equal(readCourts("Private Court 1"), 1);
        assert.equal(readCourts("Clinic Court"), undefined, "a name with no number: unreadable as a count (fine in names mode)");
    });

    test("blank = no slot (null); unreadable = undefined", () => {
        for (const c of [null, "", "   "]) assert.equal(readCourts(c), null);
        for (const c of ["lots", "TBD", "All", 250, -1, { serial: 3.5 }]) assert.equal(readCourts(c as never), undefined, JSON.stringify(c));
    });
});

describe("cellText", () => {
    test("text for every cell type", () => {
        assert.deepEqual([cellText(null), cellText({ serial: 46452 }), cellText(4), cellText(" x "), cellText(true)], ["", "#46452", "4", "x", "true"]);
    });
});

describe("guessMapping", () => {
    test("rows: header found below a title row, every column picked", () => {
        const m = guess("Riverside - Spring 2027,Riverside - Spring 2027,Riverside - Spring 2027,Riverside - Spring 2027\n\nDate,Start time,Courts,Location\n3/6/2027,9:00,4,Riverside\n3/6/2027,11:00,2,Riverside\n");
        assert.deepEqual([m.layout, m.header, m.date, m.time, m.courts, m.location, m.courtsMode], ["rows", 2, 0, 1, 2, 3, "count"]);
    });

    test("rows without a header are guessed from the content", () => {
        const m = guess("3/6/2027,9:00,4\n3/6/2027,11:00,3\n");
        assert.deepEqual([m.header, m.date, m.time, m.courts], [-1, 0, 1, 2]);
    });

    test("rows: columns in any order, and a missing courts column", () => {
        const m = guess("Courts,Time,Date\n4,9:00,3/6/2027\n2,11:00,3/7/2027\n");
        assert.deepEqual([m.date, m.time, m.courts], [2, 1, 0]);
        assert.equal(guess("Date,Start\n3/6/2027,9:00\n").courts, null);
    });

    test("a bare number is a time only under a time heading", () => {
        const m = guess("Date,Start,Courts\n3/6/2027,9,4\n3/6/2027,13,2\n");
        assert.deepEqual([m.time, m.courts], [1, 2]);
        assert.deepEqual(rows(parse("Date,Start,Courts\n3/6/2027,9,4\n3/6/2027,13,2\n")), [["2027-03-06", "09:00", 4], ["2027-03-06", "13:00", 2]]);
    });

    test(
        "a CSV courts column of bare numbers isn't taken for the time column when there is no time heading",
        { todo: "BUG: guessMapping's time test only exempts NUMBER cells (lib/import/sheet.ts:378); in a CSV every cell is text, so 'Date,Courts / 3/6/2027,4' maps Courts as the time (4 -> 16:00) and imports 1 court at 4 PM instead of 4 courts" },
        () => {
            const m = guess("Date,Courts\n3/6/2027,4\n3/7/2027,2\n");
            assert.equal(m.time, null);
            assert.equal(m.courts, 1);
        }
    );

    test("dates-down grid (times across the top), with an empty corner cell", () => {
        const m = guess("\t9:00\t10:30\t12:00\nSat 3/6\t4\t4\t2\nSun 3/7\t\t3\tclosed\n");
        assert.deepEqual([m.layout, m.header, m.label], ["dates-down", 0, 0]);
    });

    test("times-down grid (dates across the top)", () => {
        const m = guess("Time,Sat 3/6,Sat 3/13,Sat 3/20\n9:00 AM,3,3,-\n10:30 AM,2,,2\n");
        assert.deepEqual([m.layout, m.header, m.label], ["times-down", 0, 0]);
    });

    test("courts: names mode for one-row-per-court sheets, in every sport's words", () => {
        for (const [head, a, b] of [["Court", "Court 7", "Stadium"], ["Sheet", "Sheet A", "Sheet B"], ["Field", "Field 3", "Field 4"], ["Court #", "#4", "#5"]]) {
            const m = guess(`Date,Time,${head}\n3/6/2027,9:00,${a}\n3/6/2027,9:00,${b}\n`);
            assert.equal(m.courtsMode, "names", head);
        }
    });

    test("courts: counts stay counts (quantities, closed words, notes, 'Hard 4')", () => {
        for (const body of ["Courts\n4\n6\n4", "Courts available\n4\nReserved\n3", "Fields available\n4\n2", "Courts\nHard 4\nClay 2\nAll\nTBD"]) {
            const [head, ...vals] = body.split("\n");
            const text = `Date,Time,${head}\n` + vals.map((v, i) => `3/6/2027,${9 + i}:00,${v}`).join("\n");
            assert.equal(guess(text).courtsMode, "count", body);
        }
    });

    test("times inside court notes don't make the sheet look like a grid", () => {
        const m = guess("Date,Time,Courts\n3/6/2027,9:00,4\n3/6/2027,11:00,4 - event at 1pm\n3/6/2027,13:00,3\n");
        assert.equal(m.layout, "rows");
    });

    test("an empty sheet guesses rows with nothing picked", () => {
        const m = guessMapping([], ctx);
        assert.deepEqual([m.layout, m.header, m.date, m.time, m.courts, m.location], ["rows", -1, null, null, null, null]);
    });
});

describe("parseWith", () => {
    test("rows: carry-down dates, closed = 0, sorted by date then time, spreadsheet line numbers", () => {
        const r = parse("Date,Time,Courts\n3/7/2027,9:00,2\n3/6/2027,11:00,4\n,9:00,closed\n");
        assert.deepEqual(rows(r), [["2027-03-06", "09:00", 0], ["2027-03-06", "11:00", 4], ["2027-03-07", "09:00", 2]]);
        assert.deepEqual(r.rows.map((x) => x.line), [4, 3, 2]);
        assert.deepEqual(r.problems, []);
    });

    test("rows: a time riding in the date cell is used when there's no time column", () => {
        const r = parse("When,Courts\n3/6/2027 9:00 AM,4\n3/6/2027 11:00 AM,2\n", { time: null, courts: 1 });
        assert.deepEqual(rows(r), [["2027-03-06", "09:00", 4], ["2027-03-06", "11:00", 2]]);
    });

    test("rows: every problem in plain words, by spreadsheet line", () => {
        const r = parse("Date,Time,Courts\n3/6/2027,9:00,4\nsoon,9:00,4\n3/6/2027,late,4\n3/6/2027,,4\n3/6/2027,13:00,lots\n3/6/2027,14:00,\n");
        assert.deepEqual(r.problems, [
            { line: 3, message: "Couldn’t read the date “soon”" },
            { line: 4, message: "Couldn’t read the time “late”" },
            { line: 5, message: "No start time" },
            { line: 6, message: "Couldn’t read how many are free: “lots”" },
            { line: 7, message: "Nothing listed as free" },
        ]);
        assert.equal(r.rows.length, 1);
        assert.deepEqual(parse("Date,Time,Courts\n,9:00,4\n").problems, [{ line: 2, message: "No date" }], "no date to carry down");
    });

    test("rows: no date column is a single clear problem", () => {
        const r = parse("A,B\n1,2\n", { date: null });
        assert.deepEqual(r, { rows: [], problems: [{ line: 0, message: "Choose which column holds the date." }], duplicates: 0 });
    });

    test("rows: duplicate date+time (+location, any casing) -- last wins, counted", () => {
        const r = parse("Date,Time,Courts,Facility\n3/6/2027,9:00,4,Riverside Main\n3/6/2027,9:00,5,riverside main\n3/6/2027,9:00,2,Oak\n");
        assert.deepEqual(r.rows.map((x) => [x.courts, x.location]), [[5, "riverside main"], [2, "Oak"]]);
        assert.equal(r.duplicates, 1);
    });

    test("rows: no courts column uses the default count", () => {
        assert.deepEqual(rows(parse("Date,Start\n3/6/2027,9:00\n", {}, { defaultCourts: 3 })), [["2027-03-06", "09:00", 3]]);
    });

    test("names mode: distinct names per time, first spelling kept, closed rows give 0, names travel as units", () => {
        const r = parse("Date,Time,Field\n3/6/2027,9:00,Field 3\n3/6/2027,9:00,Field 4\n3/6/2027,9:00,field 3\n3/6/2027,11:00,Tournament\n3/6/2027,13:00,\n");
        // The blank-court row is reported; it never adds capacity (0 at 13:00).
        assert.deepEqual(r.rows.map((x) => [x.time, x.courts, x.units ?? null]), [["09:00", 2, ["Field 3", "Field 4"]], ["11:00", 0, null], ["13:00", 0, null]]);
        assert.deepEqual(r.problems, [{ line: 6, message: "No court named" }]);
    });

    test("names mode with no courts column: each row is one court, no unit names", () => {
        const r = parse("Date,Time\n3/6/2027,9:00\n3/6/2027,9:00\n3/6/2027,11:00\n", { courtsMode: "names", courts: null });
        assert.deepEqual(r.rows.map((x) => [x.time, x.courts, x.units ?? null]), [["09:00", 2, null], ["11:00", 1, null]]);
    });

    test("dates-down grid: blank cells skipped, closed = 0, label carry-down, bad headings reported", () => {
        const r = parse("Date,9:00,10:30,soonish\nSat 3/6,4,,2\n,1,2,3\nSun 3/7,-,3,\n", { layout: "dates-down", header: 0, label: 0 });
        assert.deepEqual(rows(r), [["2027-03-06", "09:00", 1], ["2027-03-06", "10:30", 2], ["2027-03-07", "09:00", 0], ["2027-03-07", "10:30", 3]]);
        assert.deepEqual(r.problems, [{ line: 1, message: "Couldn’t read the time heading “soonish”" }]);
        assert.equal(r.duplicates, 1, "the carried-down row repeats 3/6 9:00");
    });

    test("times-down grid: dates across the top", () => {
        const r = parse("Time,Sat 3/6,Sat 3/13,not a date\n9:00 AM,3,x,1\n10:30 AM,2,lots,\nlater,1,1,\n", { layout: "times-down", header: 0, label: 0 });
        assert.deepEqual(rows(r), [["2027-03-06", "09:00", 3], ["2027-03-06", "10:30", 2], ["2027-03-13", "09:00", 0]]);
        assert.deepEqual(r.problems.map((p) => p.message), ["Couldn’t read the date heading “not a date”", "Couldn’t read how many are free: “lots”", "Couldn’t read the time “later”"]);
    });

    test("problems are capped at 500", () => {
        const r = parse("Date,Time,Courts\n" + "soon,9:00,4\n".repeat(700));
        assert.equal(r.problems.length, 500);
    });
});
