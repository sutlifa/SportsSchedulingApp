import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    DAY_LONG,
    DAY_PLURAL,
    DAY_SHORT,
    dayToIso,
    dowOf,
    formatDate,
    formatRange,
    formatTime,
    isIsoDate,
    isTime,
    isoToDay,
    isWeekend,
    parseTimes,
    rangesToDays,
    toMinutes,
    weekendKey,
    weekKey,
} from "../../lib/engine/dates.ts";

// The module's whole point is that day numbers have no time zone. Run under a
// zone with DST so a regression to local-time arithmetic shows up here even
// on a UTC CI box. (Node re-reads TZ on change.)
process.env.TZ = "America/New_York";

const d = isoToDay;

describe("isoToDay / dayToIso", () => {
    test("epoch is day 0 and round-trips", () => {
        assert.equal(d("1970-01-01"), 0);
        assert.equal(dayToIso(0), "1970-01-01");
        assert.equal(dayToIso(-1), "1969-12-31");
    });

    test("round-trips every day of a leap year and a common year", () => {
        for (const start of ["2027-01-01", "2028-01-01"]) {
            const first = d(start);
            for (let i = 0; i < 366; i++) assert.equal(d(dayToIso(first + i)), first + i);
        }
    });

    test("leap years: Feb 29 exists in 2028 and 2000, not 2027 or 2100", () => {
        assert.equal(d("2028-03-01") - d("2028-02-28"), 2);
        assert.equal(d("2000-03-01") - d("2000-02-28"), 2);
        assert.equal(d("2027-03-01") - d("2027-02-28"), 1);
        assert.equal(d("2100-03-01") - d("2100-02-28"), 1);
        assert.equal(dayToIso(d("2028-02-28") + 1), "2028-02-29");
    });

    test("month and year ends roll over", () => {
        assert.equal(dayToIso(d("2027-01-31") + 1), "2027-02-01");
        assert.equal(dayToIso(d("2027-04-30") + 1), "2027-05-01");
        assert.equal(dayToIso(d("2026-12-31") + 1), "2027-01-01");
        assert.equal(d("2027-01-01") - d("2026-12-31"), 1);
    });

    test("adding 7 days across both DST changes lands on the same weekday, a whole number of days later", () => {
        // US DST 2027: starts Sun Mar 14, ends Sun Nov 7.
        for (const iso of ["2027-03-13", "2027-03-14", "2027-11-06", "2027-11-07"]) {
            const next = d(iso) + 7;
            assert.ok(Number.isInteger(next));
            assert.equal(dowOf(next), dowOf(d(iso)));
            assert.equal(d(dayToIso(next)) - d(iso), 7);
        }
        assert.equal(dayToIso(d("2027-03-13") + 1), "2027-03-14");
        assert.equal(dayToIso(d("2027-03-14") + 1), "2027-03-15");
        assert.equal(dayToIso(d("2027-11-06") + 2), "2027-11-08");
    });
});

describe("dowOf / isWeekend / weekendKey / weekKey", () => {
    test("weekday of known dates, including before 1970", () => {
        assert.equal(dowOf(0), 4, "1970-01-01 was a Thursday");
        assert.equal(dowOf(-1), 3);
        assert.equal(dowOf(-4), 0);
        assert.equal(dowOf(d("2027-03-06")), 6);
        assert.equal(dowOf(d("2027-03-14")), 0);
        assert.equal(dowOf(d("2028-02-29")), 2);
        assert.equal(dowOf(d("1969-07-20")), 0);
    });

    test("isWeekend is Saturday and Sunday only", () => {
        const sat = d("2027-03-06");
        assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((i) => isWeekend(sat + i)), [true, true, false, false, false, false, false]);
    });

    test("weekendKey: Saturday is its own key, Sunday belongs to the Saturday before, weekdays are null", () => {
        const sat = d("2027-03-06");
        assert.equal(weekendKey(sat), sat);
        assert.equal(weekendKey(sat + 1), sat);
        for (let i = 2; i < 7; i++) assert.equal(weekendKey(sat + i), null);
        // Across a month end: Sat Jul 31 + Sun Aug 1 2027 are one weekend.
        assert.equal(weekendKey(d("2027-08-01")), d("2027-07-31"));
    });

    test("weekKey is the Monday of a Mon–Sun week (Sunday is the END of the week)", () => {
        const mon = d("2027-03-08");
        for (let i = 0; i < 7; i++) assert.equal(weekKey(mon + i), mon, dayToIso(mon + i));
        assert.equal(weekKey(mon - 1), mon - 7, "the Sunday before belongs to the previous week");
        assert.equal(dowOf(weekKey(d("2027-01-01"))), 1);
        assert.equal(dayToIso(weekKey(d("2027-01-01"))), "2026-12-28", "a week can straddle the new year");
    });
});

describe("isIsoDate / isTime / toMinutes", () => {
    test("isIsoDate accepts real YYYY-MM-DD dates only", () => {
        for (const ok of ["2027-03-06", "2028-02-29", "1999-12-31"]) assert.equal(isIsoDate(ok), true, ok);
        for (const bad of ["2027-3-6", "03/06/2027", "2027-13-01", "2027-00-10", "2027-03-06T00:00", "", " 2027-03-06", null, undefined, 20270306, {}])
            assert.equal(isIsoDate(bad), false, String(bad));
    });

    test("isIsoDate rejects impossible calendar days (Feb 30, Apr 31, Feb 29 in a common year)", () => {
        for (const bad of ["2027-02-30", "2027-04-31", "2027-02-29", "2100-02-29", "2027-06-31", "2027-01-32", "2027-01-00"]) assert.equal(isIsoDate(bad), false, bad);
        for (const ok of ["2028-02-29", "2000-02-29", "2027-04-30", "2027-12-31", "2027-01-01"]) assert.equal(isIsoDate(ok), true, ok);
    });

    test("isTime is strict 24h HH:MM", () => {
        for (const ok of ["00:00", "09:05", "12:00", "23:59"]) assert.equal(isTime(ok), true, ok);
        for (const bad of ["24:00", "9:00", "09:60", "09:00:00", "9am", "", null, 900]) assert.equal(isTime(bad), false, String(bad));
    });

    test("toMinutes", () => {
        assert.equal(toMinutes("00:00"), 0);
        assert.equal(toMinutes("09:30"), 570);
        assert.equal(toMinutes("23:59"), 1439);
    });
});

describe("formatTime / formatDate / formatRange", () => {
    test("formatTime: 12-hour clock with AM/PM, midnight and noon right", () => {
        assert.equal(formatTime("00:00"), "12:00 AM");
        assert.equal(formatTime("00:05"), "12:05 AM");
        assert.equal(formatTime("09:00"), "9:00 AM");
        assert.equal(formatTime("11:59"), "11:59 AM");
        assert.equal(formatTime("12:00"), "12:00 PM");
        assert.equal(formatTime("13:05"), "1:05 PM");
        assert.equal(formatTime("18:30"), "6:30 PM");
        assert.equal(formatTime("23:59"), "11:59 PM");
    });

    test("formatTime: blank for anything that isn't HH:MM", () => {
        for (const bad of [null, undefined, "", "9:00", "25:00", "noon"]) assert.equal(formatTime(bad), "");
    });

    test("formatDate: weekday, month, day; year only when asked", () => {
        assert.equal(formatDate("2027-03-06"), "Sat, Mar 6");
        assert.equal(formatDate("2027-03-06", true), "Sat, Mar 6, 2027");
        assert.equal(formatDate("2028-02-29"), "Tue, Feb 29");
        assert.equal(formatDate("2027-12-31", true), "Fri, Dec 31, 2027");
        assert.equal(formatDate(null), "");
        assert.equal(formatDate(undefined), "");
        assert.equal(formatDate("March 6"), "");
    });

    test("formatRange: one day, same-day range, real range", () => {
        assert.equal(formatRange({ from: "2027-03-06" }), "Sat, Mar 6");
        assert.equal(formatRange({ from: "2027-03-06", to: "2027-03-06" }), "Sat, Mar 6");
        assert.equal(formatRange({ from: "2027-03-06", to: "2027-03-07" }), "Sat, Mar 6 – Sun, Mar 7");
    });

    test("day name tables line up with dowOf", () => {
        assert.equal(DAY_SHORT[dowOf(d("2027-03-06"))], "Sat");
        assert.equal(DAY_LONG[0], "Sunday");
        assert.equal(DAY_PLURAL[6], "Saturdays");
        assert.equal(DAY_SHORT.length + DAY_LONG.length + DAY_PLURAL.length, 21);
    });
});

describe("rangesToDays", () => {
    test("single days, ranges, and reversed ranges", () => {
        const s = rangesToDays([{ from: "2027-03-06" }, { from: "2027-03-10", to: "2027-03-12" }, { from: "2027-03-20", to: "2027-03-18" }]);
        assert.deepEqual([...s].sort((a, b) => a - b).map(dayToIso), ["2027-03-06", "2027-03-10", "2027-03-11", "2027-03-12", "2027-03-18", "2027-03-19", "2027-03-20"]);
    });

    test("a range across a month and year end", () => {
        const s = rangesToDays([{ from: "2027-12-30", to: "2028-01-02" }]);
        assert.equal(s.size, 4);
        assert.ok(s.has(d("2027-12-31")) && s.has(d("2028-01-01")));
    });

    test("malformed entries are skipped; a malformed `to` means one day", () => {
        const s = rangesToDays([{ from: "nope" }, { from: "2027-03-06", to: "garbage" }, { from: "" }]);
        assert.deepEqual([...s], [d("2027-03-06")]);
        assert.equal(rangesToDays([]).size, 0);
    });

    test("overlapping ranges count each day once", () => {
        assert.equal(rangesToDays([{ from: "2027-03-01", to: "2027-03-10" }, { from: "2027-03-05", to: "2027-03-15" }]).size, 15);
    });

    test("a typo'd multi-year range is capped at 366 days", () => {
        assert.equal(rangesToDays([{ from: "2027-01-01", to: "2207-01-01" }]).size, 366);
    });
});

describe("parseTimes", () => {
    const cases: [string, string[]][] = [
        ["9", ["09:00"]],
        ["9am", ["09:00"]],
        ["9 am", ["09:00"]],
        ["9a, 5p", ["09:00", "17:00"]],
        ["13:30", ["13:30"]],
        ["1.30pm", ["13:30"]],
        ["9.30", ["09:30"]],
        ["10:15am", ["10:15"]],
        ["0930", ["09:30"]],
        ["1330", ["13:30"]],
        ["12am", ["00:00"]],
        ["12pm", ["12:00"]],
        ["12", ["12:00"]],
        ["6", ["18:00"]],
        ["6:59", ["18:59"]],
        ["7", ["07:00"]],
        ["9, 10:30, 1pm, 17:45", ["09:00", "10:30", "13:00", "17:45"]],
        ["9;10\n11 / 12", ["09:00", "10:00", "11:00", "12:00"]],
    ];
    for (const [input, want] of cases) test(JSON.stringify(input), () => assert.deepEqual(parseTimes(input), want));

    test("a bare hour under 7 is the afternoon, but am/pm and military times are taken literally", () => {
        assert.deepEqual(parseTimes("1, 3, 6"), ["13:00", "15:00", "18:00"]);
        assert.deepEqual(parseTimes("3am"), ["03:00"]);
        assert.deepEqual(parseTimes("0300"), ["03:00"]);
    });

    test("duplicates collapse, first spelling's order kept", () => {
        assert.deepEqual(parseTimes("9, 9am, 09:00, 10, 9"), ["09:00", "10:00"]);
        assert.deepEqual(parseTimes("17:00, 5pm, 5"), ["17:00"]);
    });

    test("garbage and impossible times give nothing", () => {
        assert.deepEqual(parseTimes(""), []);
        assert.deepEqual(parseTimes("abc"), []);
        assert.deepEqual(parseTimes("2400"), []);
        assert.deepEqual(parseTimes("9:75"), []);
        assert.deepEqual(parseTimes("25"), []);
        assert.deepEqual(parseTimes("noon"), [], "a word it doesn't know must not invent a time");
    });

    test("a five-digit (or longer) number is not a time", () => {
        assert.deepEqual(parseTimes("12345"), []);
        assert.deepEqual(parseTimes("123456789"), []);
        assert.deepEqual(parseTimes("12345, 9am"), ["09:00"], "the rest of the list still reads");
    });

    test("every result is a valid HH:MM", () => {
        for (const [input] of cases) for (const t of parseTimes(input)) assert.ok(isTime(t), `${input} -> ${t}`);
    });
});
