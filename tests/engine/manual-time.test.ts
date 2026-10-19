// "Set the date and time by hand" (Move dialog): a game moved to a time that
// isn't one of the slots (a rain-out the facility fitted in). It's flagged
// softly, not as a broken rule -- even on a date a facility sheet covers --
// while team rules, double bookings and a deleted facility still count.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { adviceFor } from "../../lib/engine/advice.ts";
import { audit, generate } from "../../lib/engine/engine.ts";
import { sampleLeague } from "../../lib/engine/sample.ts";
import { sanitizeSchedule } from "../../lib/engine/sanitize.ts";
import type { League, Match } from "../../lib/engine/types.ts";

const MSG = "Set by hand at a time that isn’t one of the facility’s slots";
const setup = () => {
    const l: League = structuredClone(sampleLeague("tennis"));
    const r = generate(l, [], { scope: "all", seed: 2, maxAttempts: 3, timeBudgetMs: 1e9, now: () => 0 });
    return { l, matches: r.matches };
};
const handSet = (m: Match, patch: Partial<Match>): Match => ({ ...m, slotId: null, locked: true, manual: true, ...patch });

describe("hand-set date and time", () => {
    test("an off-slot time is a soft note, not a broken rule", () => {
        const { l, matches } = setup();
        const m = matches.find((x) => x.date)!;
        const moved = matches.map((x) => (x.id === m.id ? handSet(x, { time: "06:15" }) : x));
        const v = audit(l, moved).issues.get(m.id);
        assert.ok(v, "flagged");
        assert.equal(v!.hard.length, 0, `no hard issue: ${v!.hard.join("; ")}`);
        assert.ok(v!.soft.includes(MSG));
    });

    test("even on a date a facility spreadsheet covers", () => {
        const { l, matches } = setup();
        const m = matches.find((x) => x.date)!;
        l.availability = [{ id: "av1", date: m.date!, time: "09:00", locationId: m.locationId!, courts: 2, unitIds: [], bracketIds: [] }];
        const moved = matches.map((x) => (x.id === m.id ? handSet(x, { time: "06:15" }) : x));
        const v = audit(l, moved).issues.get(m.id)!;
        assert.equal(v.hard.length, 0);
        assert.ok(v.soft.includes(MSG));
        // Without the hand-set flag, the same game IS a hard problem there.
        const plain = matches.map((x) => (x.id === m.id ? { ...x, slotId: null, time: "06:15" } : x));
        assert.ok(audit(l, plain).issues.get(m.id)!.hard.length > 0);
    });

    test("team rules still apply to a hand-set game", () => {
        const { l, matches } = setup();
        const m = matches.find((x) => x.date)!;
        const team = l.teams.find((t) => t.id === m.home)!;
        team.rules = [...team.rules, { id: "late", mode: "must", type: "no_start_after", time: "07:00" }];
        const moved = matches.map((x) => (x.id === m.id ? handSet(x, { time: "21:00" }) : x));
        assert.ok(audit(l, moved).issues.get(m.id)!.hard.some((h) => /Start no later than 7:00 AM/.test(h)));
    });

    test("a deleted facility is still a hard problem", () => {
        const { l, matches } = setup();
        const m = matches.find((x) => x.date)!;
        const moved = matches.map((x) => (x.id === m.id ? handSet(x, { locationId: "gone" }) : x));
        assert.ok(audit(l, moved).issues.get(m.id)!.hard.includes("Its location was deleted"));
    });

    test("the flag survives saving only on placed games, and has advice in every sport", () => {
        const s = sanitizeSchedule({ matches: [
            { id: "a", home: "t1", away: "t2", bracketId: "b", pool: "", date: "2027-03-06", time: "06:15", locationId: "l", slotId: null, locked: true, manual: true },
            { id: "b", home: "t1", away: "t2", bracketId: "b", pool: "", date: null, time: null, locationId: null, slotId: null, locked: false, manual: true },
        ] });
        assert.equal(s.matches[0].manual, true);
        assert.equal(s.matches[1].manual, undefined);
        for (const sport of ["tennis", "hockey", "soccer"] as const) {
            const l = sampleLeague(sport);
            const a = adviceFor(MSG, l);
            assert.ok(a && a.tab === "courts", sport);
        }
    });
});
