/**
 * The tutorial's downloadable sample sheets (public/tutorial/<sport>-april-2027.*)
 * must read exactly as /tutorial says they do, in both formats and every sport:
 * one row per unit, 12 times on 5 dates, two of them closed, no problems.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { guessMapping, parseDelimited, parseWith, type Ctx } from "../../lib/import/sheet.ts";
import { readXlsx } from "../../lib/import/xlsx.ts";
import { SPORT_IDS, SPORTS } from "../../lib/engine/sports.ts";

const ctx: Ctx = { seasonStart: "2027-03-06", seasonEnd: "2027-05-16", fallbackYear: 2027 };
const file = (sport: string, ext: string) => new URL(`../../public/tutorial/${sport}-april-2027.${ext}`, import.meta.url);

// The same pattern of free units in every sport's sheet.
const EXPECTED: [string, string, number][] = [
    ["2027-04-03", "09:00", 3],
    ["2027-04-03", "11:00", 2],
    ["2027-04-03", "13:00", 3],
    ["2027-04-10", "09:00", 2],
    ["2027-04-10", "11:00", 0],
    ["2027-04-11", "11:00", 2],
    ["2027-04-11", "13:00", 1],
    ["2027-04-17", "09:00", 3],
    ["2027-04-17", "11:00", 3],
    ["2027-04-24", "09:00", 0],
    ["2027-04-24", "11:00", 2],
    ["2027-04-24", "13:00", 1],
];

describe("tutorial sample sheets", () => {
    for (const sport of SPORT_IDS) {
        for (const kind of ["csv", "xlsx"] as const) {
            test(`${sport}-april-2027.${kind}`, async () => {
                const grid = kind === "xlsx" ? (await readXlsx(readFileSync(file(sport, kind))))[0].rows : parseDelimited(readFileSync(file(sport, kind), "utf8"));
                const m = guessMapping(grid, ctx);
                assert.deepEqual([m.layout, m.header, m.courtsMode], ["rows", kind === "xlsx" ? 2 : 0, "names"]);
                const r = parseWith(grid, m, ctx);
                assert.deepEqual(r.problems, []);
                assert.equal(r.duplicates, 0);
                assert.deepEqual(r.rows.map((x) => [x.date, x.time, x.courts]), EXPECTED);
                // Unit names come through in the sport's own naming, ready to attach to a facility.
                const t = SPORTS[sport];
                const names = new Set(r.rows.flatMap((x) => x.units ?? []));
                assert.deepEqual([...names].sort(), [0, 1, 2].map(t.unitLabel).sort());
                for (const x of r.rows) assert.equal(x.units?.length ?? 0, x.courts);
            });
        }
    }
});
