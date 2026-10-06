// scripts/verify-import.ts
//
//     node --experimental-strip-types scripts/verify-import.ts
//
// Facility availability import: the .xlsx reader against real workbooks
// (scripts/fixtures/*.xlsx, written by openpyxl the way Excel writes them),
// the CSV/paste reader, the lenient cell readers, layout guessing, and the
// engine's "sheet replaces the weekly slots for the dates it covers" rule.
import { readFileSync } from "node:fs";
import { audit, generate, prepare } from "../lib/engine/engine.ts";
import { sampleLeague } from "../lib/engine/sample.ts";
import { safeMapUrl } from "../lib/engine/sanitize.ts";
import { guessMapping, parseDelimited, parseWith, readCourts, readDate, readTime, type Ctx } from "../lib/import/sheet.ts";
import { isDateFormat, readXlsx } from "../lib/import/xlsx.ts";

let checks = 0;
function eq(actual: unknown, expected: unknown, msg: string) {
    checks++;
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
        console.error(`FAIL: ${msg}\n  expected ${e}\n  got      ${a}`);
        process.exit(1);
    }
}
function ok(cond: unknown, msg: string) {
    eq(Boolean(cond), true, msg);
}

const ctx: Ctx = { seasonStart: "2027-03-06", seasonEnd: "2027-05-16", fallbackYear: 2027 };
const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

// --- cell readers -------------------------------------------------------------
eq(readDate("3/6", ctx), { date: "2027-03-06", time: null }, "M/D with year from season");
eq(readDate("Sat 3/6", ctx)?.date, "2027-03-06", "weekday prefix ignored");
eq(readDate("Saturday, March 6", ctx)?.date, "2027-03-06", "long weekday + month name");
eq(readDate("Mar 6, 2027", ctx)?.date, "2027-03-06", "month name with year");
eq(readDate("6 March 2027", ctx)?.date, "2027-03-06", "day-first month name");
eq(readDate("2027-03-06", ctx)?.date, "2027-03-06", "ISO");
eq(readDate("3/6/27", ctx)?.date, "2027-03-06", "two-digit year");
eq(readDate("3/6 9:00 AM", ctx), { date: "2027-03-06", time: "09:00" }, "date with time riding along");
eq(readDate({ serial: 46452 }, ctx)?.date, "2027-03-06", "Excel date serial");
eq(readDate({ serial: 46452.375 }, ctx), { date: "2027-03-06", time: "09:00" }, "Excel date-time serial");
eq(readDate("2/30", ctx), null, "impossible date rejected");
eq(readDate("Courts", ctx), null, "text is not a date");
eq(readDate({ serial: 0.375 }, ctx), null, "a time-only serial is not a date");
eq(readDate("12/28", { seasonStart: "2026-12-01", seasonEnd: "2027-02-28", fallbackYear: 2026 })?.date, "2026-12-28", "year inferred across New Year (Dec)");
eq(readDate("1/9", { seasonStart: "2026-12-01", seasonEnd: "2027-02-28", fallbackYear: 2026 })?.date, "2027-01-09", "year inferred across New Year (Jan)");

eq(readTime("9"), "09:00", "bare hour");
eq(readTime("9am"), "09:00", "9am");
eq(readTime("9:30 PM"), "21:30", "PM");
eq(readTime("13:30"), "13:30", "24h");
eq(readTime("6-8pm"), "18:00", "range takes the start, pm carried");
eq(readTime("11-1pm"), "11:00", "11-1pm starts at 11am");
eq(readTime("9:00 - 10:30 AM"), "09:00", "range with spaces");
eq(readTime("noon"), "12:00", "noon");
eq(readTime({ serial: 0.375 }), "09:00", "time serial");
eq(readTime(0.5), "12:00", "unformatted day fraction");
eq(readTime(1330), "13:30", "military number");
eq(readTime("3"), "15:00", "bare 3 is the afternoon");
eq(readTime("Sat 3/6"), null, "a date is not a time");

eq(readCourts(4), 4, "number");
eq(readCourts("4 courts"), 4, "number with words");
eq(readCourts("Courts 1-4"), 4, "court range counts courts");
eq(readCourts("1, 2, 5"), 3, "court list counts courts");
eq(readCourts("closed"), 0, "closed = 0");
eq(readCourts("-"), 0, "dash = 0");
eq(readCourts(null), null, "blank = no slot");
eq(readCourts("lots"), undefined, "unreadable flagged");

ok(isDateFormat("m/d/yyyy") && isDateFormat("h:mm AM/PM") && isDateFormat("[$-409]mmm d") && !isDateFormat("0.00") && !isDateFormat("General") && !isDateFormat('"Court "0'), "date format detection");

// --- rows layout from a real workbook ----------------------------------------------
{
    const [sheet] = await readXlsx(fx("rows.xlsx"));
    eq(sheet.name, "Spring", "sheet name");
    const m = guessMapping(sheet.rows, ctx);
    eq([m.layout, m.header, m.date, m.time, m.courts, m.location], ["rows", 2, 0, 1, 2, 3], "rows layout guessed (title row skipped, header found, all columns)");
    const r = parseWith(sheet.rows, m, ctx);
    eq(
        r.rows.map((x) => [x.date, x.time, x.courts, x.location]),
        [
            ["2027-03-06", "09:00", 6, "Riverside"],
            ["2027-03-06", "11:00", 4, "Riverside"],
            ["2027-03-06", "13:00", 0, "Riverside"],
            ["2027-03-07", "12:00", 4, "Riverside"],
            ["2027-03-07", "14:00", 3, "Lakeview"],
            ["2027-03-13", "09:30", 3, "Riverside"],
        ],
        "rows parsed: merged date fills down, blank date carries down, closed=0, ranges and lists count courts"
    );
    eq(r.problems.map((p) => p.line), [10], "the unreadable date row is reported by its spreadsheet row number");
}

// --- grid: dates down -----------------------------------------------------------------
{
    const sheets = await readXlsx(fx("grid-dates-down.xlsx"));
    eq(sheets.map((s) => s.name), ["March", "April"], "both sheets read");
    const m = guessMapping(sheets[0].rows, ctx);
    eq([m.layout, m.header, m.label], ["dates-down", 0, 0], "dates-down grid guessed");
    const r = parseWith(sheets[0].rows, m, ctx);
    eq(
        r.rows.map((x) => [x.date, x.time, x.courts]),
        [
            ["2027-03-06", "09:00", 4],
            ["2027-03-06", "11:00", 4],
            ["2027-03-06", "13:00", 0],
            ["2027-03-07", "11:00", 6],
            ["2027-03-07", "13:00", 6],
            ["2027-03-09", "18:00", 2],
        ],
        "dates-down grid parsed; blank cells skipped, '-' = closed"
    );
    const april = parseWith(sheets[1].rows, guessMapping(sheets[1].rows, ctx), ctx);
    eq(april.rows.map((x) => [x.date, x.courts]), [["2027-04-03", 5], ["2027-04-03", 5]], "second sheet parses on its own guess");
}

// --- grid: times down, real date headers ---------------------------------------------------
{
    const [sheet] = await readXlsx(fx("grid-times-down.xlsx"));
    const m = guessMapping(sheet.rows, ctx);
    eq([m.layout, m.header, m.label], ["times-down", 0, 0], "times-down grid guessed");
    const r = parseWith(sheet.rows, m, ctx);
    eq(
        r.rows.map((x) => [x.date, x.time, x.courts]),
        [
            ["2027-03-06", "09:00", 3],
            ["2027-03-06", "10:30", 2],
            ["2027-03-13", "09:00", 3],
            ["2027-03-20", "09:00", 0],
            ["2027-03-20", "10:30", 2],
        ],
        "times-down grid parsed"
    );
}

// --- CSV and pasted cells ----------------------------------------------------------------
{
    const csv = 'Date,Time,"Courts, available"\n3/6/2027,9:00 AM,4\n,11:00 AM,"2"\n3/7/2027,noon,closed\n';
    const g = parseDelimited(csv);
    eq(g[0], ["Date", "Time", "Courts, available"], "quoted header with a comma");
    const m = guessMapping(g, ctx);
    eq([m.layout, m.date, m.time, m.courts], ["rows", 0, 1, 2], "CSV columns guessed");
    eq(parseWith(g, m, ctx).rows.map((x) => [x.date, x.time, x.courts]), [["2027-03-06", "09:00", 4], ["2027-03-06", "11:00", 2], ["2027-03-07", "12:00", 0]], "CSV parsed with carry-down");

    const pasted = "\t9:00\t10:30\t12:00\nSat 3/6\t4\t4\t2\nSun 3/7\t\t3\t3\n";
    const pg = parseDelimited(pasted);
    const pm = guessMapping(pg, ctx);
    eq([pm.layout, pm.label], ["dates-down", 0], "pasted grid with an empty corner cell");
    eq(parseWith(pg, pm, ctx).rows.length, 5, "pasted grid rows");

    const noHeader = "3/6/2027,9:00,4\n3/6/2027,11:00,3\n";
    const nm = guessMapping(parseDelimited(noHeader), ctx);
    eq([nm.header, nm.date, nm.time, nm.courts], [-1, 0, 1, 2], "headerless rows still guessed from content");

    const noCourts = "Date,Start\n3/6/2027,9:00\n";
    const cm = guessMapping(parseDelimited(noCourts), ctx);
    eq(cm.courts, null, "no courts column detected");
    eq(parseWith(parseDelimited(noCourts), cm, ctx, { defaultCourts: 3 }).rows[0].courts, 3, "default courts used when the sheet has none");

    const dupes = parseWith(parseDelimited("Date,Time,Courts\n3/6/2027,9:00,4\n3/6/2027,9:00,5\n"), guessMapping(parseDelimited("Date,Time,Courts\n3/6/2027,9:00,4\n"), ctx), ctx);
    eq([dupes.rows.length, dupes.rows[0].courts, dupes.duplicates], [1, 5, 1], "duplicate date+time: last wins and is counted");
}

// --- the engine uses uploaded availability ------------------------------------------------
{
    const league = sampleLeague();
    const loc = "loc-center";
    // 2027-03-06 is a Saturday; the weekly pattern has 4 Saturday slots at the center.
    const before = prepare(league).instances.filter((i) => i.date === "2027-03-06" && i.locationId === loc);
    eq(before.map((i) => i.time), ["09:00", "11:00", "13:00", "15:00"], "weekly pattern before upload");
    league.availability = [
        { id: "a1", date: "2027-03-06", time: "10:00", locationId: loc, courts: 6, bracketIds: [] },
        { id: "a2", date: "2027-03-06", time: "12:00", locationId: loc, courts: 0, bracketIds: [] },
        { id: "a3", date: "2027-03-13", time: "08:00", locationId: loc, courts: 0, bracketIds: [] },
        { id: "a4", date: "2027-03-27", time: "09:00", locationId: loc, courts: 4, bracketIds: [] }, // blackout weekend
        { id: "a5", date: "2027-03-06", time: "10:00", locationId: "gone", courts: 4, bracketIds: [] }, // deleted location
    ];
    league.settings.courtsPerMatch = 2;
    const ctxE = prepare(league);
    const sat = ctxE.instances.filter((i) => i.date === "2027-03-06" && i.locationId === loc);
    eq(sat.map((i) => [i.time, i.capacity]), [["10:00", 3]], "the sheet replaces that day's weekly slots; 6 courts / 2 per match = 3; 0 courts = closed");
    eq(ctxE.instances.filter((i) => i.date === "2027-03-13" && i.locationId === loc).length, 0, "a day the sheet marks closed has no slots at all");
    eq(ctxE.instances.filter((i) => i.date === "2027-03-20" && i.locationId === loc).length, 4, "days the sheet doesn't mention keep the weekly pattern");
    eq(ctxE.instances.filter((i) => i.date === "2027-03-27").length, 0, "blackouts still win over the sheet");
    eq(ctxE.instances.filter((i) => i.date === "2027-03-06" && i.locationId === "loc-park").length, 0, "other locations unaffected (park has no Saturday slots)");
    ok(ctxE.instances.every((i, k) => i.idx === k), "instance indexes are dense");
}

// --- Tester round 2 regressions ---------------------------------------------------------
{
    // Court NAMES: one row per court, counted per time (not "Court 8" = 8 courts).
    const g = parseDelimited("Date,Start,Court\n3/6/2027,9:00,Court 7\n3/6/2027,9:00,Court 8\n3/6/2027,9:00,Stadium\n3/6/2027,11:00,Court 7\n3/7/2027,9:00,Court 2\n");
    const m = guessMapping(g, ctx);
    eq([m.courts, m.courtsMode], [2, "names"], "court-name column detected as names");
    eq(parseWith(g, m, ctx).rows.map((r) => [r.date, r.time, r.courts]), [["2027-03-06", "09:00", 3], ["2027-03-06", "11:00", 1], ["2027-03-07", "09:00", 1]], "court names counted per time");
    // Numbered courts, one row per court: repeated date+time means names even with bare numbers.
    const n = parseDelimited("Date,Time,Court\n3/6/2027,9:00,7\n3/6/2027,9:00,8\n3/6/2027,11:00,7\n3/6/2027,11:00,8\n3/6/2027,13:00,8\n");
    const nm = guessMapping(n, ctx);
    eq(nm.courtsMode, "names", "repeated date+time rows => one row per court");
    eq(parseWith(n, nm, ctx).rows.map((r) => r.courts), [2, 2, 1], "numbered courts counted, not summed");
    // Tester round 3: ordinary counts sheets must stay counts.
    const reserved = parseDelimited("Date,Time,Courts\n3/6/2027,9:00,Reserved\n3/6/2027,10:00,Unavailable\n3/6/2027,11:00,4\n3/6/2027,12:00,Tournament\n3/6/2027,13:00,3\n");
    const rm = guessMapping(reserved, ctx);
    eq(rm.courtsMode, "count", "reserved/unavailable/tournament words don't flip to names");
    eq(parseWith(reserved, rm, ctx).rows.map((r) => r.courts), [0, 0, 4, 0, 3], "reserved/unavailable/tournament read as closed");
    const where = parseDelimited("Date,Time,Courts,Where\n3/6/2027,9:00,4,Riverside\n3/6/2027,9:00,6,Oak Park\n");
    const wm = guessMapping(where, ctx);
    eq([wm.courtsMode, wm.location], ["count", 3], "'Where' is a location column; counts stay counts");
    eq(parseWith(where, wm, ctx).rows.map((r) => r.courts), [4, 6], "two sites at one time keep their own counts");
    const twice = parseDelimited("Date,Time,Courts\n3/6/2027,9:00,4\n3/6/2027,9:00,4\n3/6/2027,11:00,2\n3/6/2027,11:00,2\n");
    const tm = guessMapping(twice, ctx);
    eq([tm.courtsMode, parseWith(twice, tm, ctx).rows.map((r) => r.courts)], ["count", [4, 2]], "pasted-twice rows stay counts (last wins)");
    // Tester round 4: notes don't zero a count; court names with "closed" words are still courts.
    eq([readCourts("3 (1 held for lessons)"), readCourts("6 (camp uses 2)"), readCourts("Courts 1-4, rain backup"), readCourts("Reserved - USTA"), readCourts("Tournament (juniors)"), readCourts("Clinic Court")], [3, 6, 4, 0, 0, undefined], "a number wins over a note; only whole-cell closed words close");
    const clinic = parseDelimited("Date,Time,Court\n3/6/2027,9:00,Clinic Court\n3/6/2027,9:00,Private Court 1\n3/6/2027,9:00,Event Court\n3/6/2027,9:00,Court 4\n3/6/2027,11:00,Reserved\n");
    const clm = guessMapping(clinic, ctx);
    eq([clm.courtsMode, parseWith(clinic, clm, ctx).rows.map((r) => r.courts)], ["names", [4, 0]], "court names containing closed words are kept; a 'Reserved' row closes its time");
    const mixed = parseDelimited("Date,Time,Courts\n3/6/2027,9:00,Hard 4\n3/6/2027,10:00,Clay 2\n3/6/2027,11:00,All\n3/6/2027,12:00,TBD\n");
    eq(guessMapping(mixed, ctx).courtsMode, "count", "'Hard 4' / 'All' / 'TBD' don't flip to names");
    const noted = parseDelimited("Date,Time,Courts\n3/6/2027,9:00,4\n3/6/2027,11:00,4 - event at 1pm\n3/6/2027,13:00,3\n3/6/2027,15:00,2 (lesson at 4pm)\n");
    const ntm = guessMapping(noted, ctx);
    eq([ntm.layout, parseWith(noted, ntm, ctx).rows.map((r) => r.courts)], ["rows", [4, 4, 3, 2]], "times inside court notes don't make the sheet look like a grid");
    // Counts stay counts.
    eq(guessMapping(parseDelimited("Date,Time,Courts\n3/6/2027,9:00,4\n3/6/2027,11:00,6\n3/7/2027,9:00,4\n3/7/2027,11:00,2\n"), ctx).courtsMode, "count", "court counts stay counts");
    // Same time, location in two casings: one row, not two.
    const cs = parseWith(parseDelimited("Date,Time,Courts,Facility\n3/6/2027,9:00,4,Riverside Main\n3/6/2027,9:00,4,riverside main\n"), guessMapping(parseDelimited("Date,Time,Courts,Facility\n3/6/2027,9:00,4,Riverside Main\n"), ctx), ctx);
    eq(cs.rows.length, 1, "location casing doesn't double a court time");

    // Re-import with NEW ids: booked matches still find their court time and count against it.
    const league = sampleLeague();
    league.slots = [];
    league.availability = ["09:00", "11:00", "13:00", "15:00"].flatMap((time) =>
        ["2027-03-06", "2027-03-13", "2027-03-20", "2027-04-03", "2027-04-10", "2027-04-17", "2027-04-24", "2027-05-01", "2027-05-08", "2027-05-15"].map((date) => ({ id: `a${date}${time}`.replace(/[-:]/g, ""), date, time, locationId: "loc-center", courts: 3, bracketIds: [] }))
    );
    const first = generate(league, [], { scope: "all", seed: 4, maxAttempts: 10, timeBudgetMs: 1e9, now: () => 0 });
    const locked = first.matches.map((m) => ({ ...m, locked: m.date !== null }));
    league.availability = league.availability.map((a) => ({ ...a, id: `new${a.id}` }));
    const a1 = audit(league, locked);
    ok([...a1.issues.values()].every((v) => !v.soft.some((x) => x.includes("no longer")) && !v.hard.length), "after a re-import with new ids, booked matches are still attached to their times");
    league.teams.push({ ...league.teams[0], id: "t10x", name: "Extra 10U", rules: [] }, { ...league.teams[1], id: "t10y", name: "Extra2 10U", rules: [] });
    const regen = generate(league, locked, { scope: "all", seed: 5, maxAttempts: 10, timeBudgetMs: 1e9, now: () => 0 });
    const a2 = audit(league, regen.matches);
    a2.usage.forEach((u, i) => ok(u <= a2.ctx.instances[i].capacity, `no overbooking after re-import (${a2.ctx.instances[i].date} ${a2.ctx.instances[i].time})`));

    // A booked time the facility's sheet now marks closed is a must-level problem.
    const booked = locked.find((m) => m.date)!;
    league.availability = league.availability.map((a) => (a.date === booked.date && a.time === booked.time ? { ...a, courts: 0 } : a));
    ok(audit(league, locked).issues.get(booked.id)?.hard.includes("The facility’s sheet has no court time then"), "closed by the facility = hard flag");
}

// --- map pin links: real Google Maps only (Tester bug #3) ---------------------------
for (const good of ["https://maps.app.goo.gl/AbC123", "https://www.google.com/maps/place/Riverside", "https://maps.google.com/?q=x", "https://www.google.co.uk/maps/@51,0,15z", "https://goo.gl/maps/xyz"])
    ok(safeMapUrl(good) !== "", `accepted: ${good}`);
for (const bad of ["https://google.evil.com/maps/place/x", "https://maps.google.attacker.io/", "https://google.com.evil.io/maps", "https://goo.gl/abc", "http://maps.google.com/", "javascript:alert(1)", "https://www.google.com/search?q=x", "https://evilgoogle.com/maps"])
    eq(safeMapUrl(bad), "", `rejected: ${bad}`);

console.log(`verify-import: all ${checks} checks passed.`);
