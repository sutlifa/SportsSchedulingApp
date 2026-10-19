// "Fill the earliest times first" (settings.fill = "pack"): an organiser with
// 18 slots a week saw the spreading score use 6 in week one. Packed, every
// slot is used as early as the rules allow and the season may end early.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { audit, generate, prepare } from "../../lib/engine/engine.ts";
import { isoToDay, weekKey } from "../../lib/engine/dates.ts";
import { sampleLeague } from "../../lib/engine/sample.ts";
import { sanitizeLeague } from "../../lib/engine/sanitize.ts";
import type { League } from "../../lib/engine/types.ts";

const run = (l: League, seed = 1) => generate(l, [], { scope: "all", seed, maxAttempts: 6, timeBudgetMs: 1e9, now: () => 0 });
const weeks = (l: League, matches: { date: string | null }[]) => {
    const cap = new Map<number, number>();
    for (const i of prepare(l).instances) cap.set(weekKey(i.day), (cap.get(weekKey(i.day)) ?? 0) + i.capacity);
    const used = new Map<number, number>();
    for (const m of matches) if (m.date) used.set(weekKey(isoToDay(m.date)), (used.get(weekKey(isoToDay(m.date))) ?? 0) + 1);
    return [...cap.keys()].sort((a, b) => a - b).map((w) => ({ used: used.get(w) ?? 0, cap: cap.get(w)! }));
};

describe("fill the earliest times first", () => {
    test("old leagues (no fill setting) stay 'spread'; the setting round-trips", () => {
        const l = sampleLeague("tennis") as League & { settings: { fill?: string } };
        delete l.settings.fill;
        assert.equal(sanitizeLeague(l).settings.fill, "spread");
        assert.equal(sanitizeLeague({ ...l, settings: { ...l.settings, fill: "pack" } }).settings.fill, "pack");
        assert.equal(sanitizeLeague({ ...l, settings: { ...l.settings, fill: "bogus" } }).settings.fill, "spread");
    });

    for (const sport of ["tennis", "hockey", "soccer"] as const) {
        test(`${sport}: packing places everything, breaks no must-rule, and front-loads the season`, () => {
            const spread = structuredClone(sampleLeague(sport));
            const pack = structuredClone(sampleLeague(sport));
            pack.settings.fill = "pack";
            const rs = run(spread);
            const rp = run(pack);
            assert.equal(rp.placed, rp.needed, "every match placed");
            const a = audit(pack, rp.matches);
            assert.ok([...a.issues.values()].every((v) => v.hard.length === 0), "no must-rule broken");
            const last = (ms: typeof rp.matches) => ms.filter((m) => m.date).map((m) => m.date!).sort().at(-1)!;
            assert.ok(last(rp.matches) <= last(rs.matches), `packed season ends no later (${last(rp.matches)} vs ${last(rs.matches)})`);
            // The first week is used at least as fully as when spreading, and more than half full.
            const wp = weeks(pack, rp.matches);
            const ws = weeks(spread, rs.matches);
            assert.ok(wp[0].used >= ws[0].used, `week 1: packed ${wp[0].used} vs spread ${ws[0].used}`);
            assert.ok(wp[0].used / wp[0].cap > 0.5, `week 1 packed ${wp[0].used}/${wp[0].cap}`);
        });
    }

    test("packing still honours weekly limits", () => {
        const l = structuredClone(sampleLeague("tennis"));
        l.settings.fill = "pack";
        for (const b of l.brackets) b.rules = [...b.rules, { id: `w${b.id}`, mode: "must", type: "max_per_week", n: 1 }];
        const r = run(l);
        const per = new Map<string, number>();
        for (const m of r.matches)
            if (m.date)
                for (const t of [m.home, m.away]) {
                    const k = `${t}|${weekKey(isoToDay(m.date))}`;
                    per.set(k, (per.get(k) ?? 0) + 1);
                }
        assert.ok([...per.values()].every((n) => n <= 1), "at most 1 per team per week");
    });
});
