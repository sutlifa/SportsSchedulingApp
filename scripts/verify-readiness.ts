// scripts/verify-readiness.ts
//
// The setup wizard disables Next on every "block" readiness check, and the
// Schedule tab lists them as "Before you schedule". A false block traps a
// person mid-setup; a missed one lets them reach Generate with a league
// that can't schedule. Both are asserted here.
//
//     node --experimental-strip-types scripts/verify-readiness.ts
import { firstOpenStep, readiness, SETUP_STEPS, stepTitle, type StepId } from "../lib/engine/readiness.ts";
import { generate } from "../lib/engine/engine.ts";
import { sampleLeague } from "../lib/engine/sample.ts";
import { emptyLeague } from "../lib/engine/sanitize.ts";
import { SPORT_IDS } from "../lib/engine/sports.ts";
import type { League, Rule } from "../lib/engine/types.ts";
import { dayToIso, isoToDay } from "../lib/engine/dates.ts";

let checks = 0;
function assert(cond: unknown, msg: string): asserts cond {
    checks++;
    if (!cond) {
        console.error(`FAIL: ${msg}`);
        process.exit(1);
    }
}
const clone = (l: League): League => structuredClone(l);
const blocks = (l: League, name = "League", step?: StepId) => readiness(l, name).filter((c) => c.level === "block" && (!step || c.step === step));

// A blank league blocks on every input step, in order, and not on requests/review.
for (const sport of SPORT_IDS) {
    const empty = emptyLeague(sport);
    const steps = new Set(blocks(empty, "").map((c) => c.step));
    for (const s of ["basics", "season", "brackets", "facilities", "time", "teams"] as const) assert(steps.has(s), `${sport}: blank league blocks on ${s}`);
    assert(!steps.has("requests") && !steps.has("review"), `${sport}: requests/review never block`);
    assert(firstOpenStep(readiness(empty, "")) === "basics", `${sport}: blank league opens on basics`);
    assert(firstOpenStep(readiness(empty, "Named")) === "season", `${sport}: named blank league opens on season`);
    for (const s of SETUP_STEPS) assert(stepTitle(s, empty).length > 0, `${sport}: ${s} has a title`);

    // The example league is ready, and Generate places everything it says it can.
    const ex = sampleLeague(sport);
    assert(
        blocks(ex).length === 0,
        `${sport}: example league has no blocks (${blocks(ex)
            .map((c) => c.text)
            .join(" | ")})`,
    );
    assert(firstOpenStep(readiness(ex, "Example")) === "review", `${sport}: example opens on review`);
    const r = generate(ex, [], { scope: "all", seed: 1, maxAttempts: 5, timeBudgetMs: 1e9, now: () => 0 });
    assert(r.placed === r.needed, `${sport}: a league with no blocks schedules fully (${r.placed}/${r.needed})`);
}

const ex = sampleLeague("hockey");
assert(stepTitle("time", ex) === "Ice time", "hockey's time step is “Ice time”");
assert(stepTitle("time", sampleLeague("soccer")) === "Field time", "soccer's time step is “Field time”");

// Season checks.
{
    const l = clone(ex);
    l.settings.seasonEnd = "2000-01-01";
    assert(
        blocks(l, "x", "season").some((c) => /before the first day/.test(c.text)),
        "end before start blocks",
    );
    const m = clone(ex);
    m.settings.blackouts = [{ from: m.settings.seasonStart, to: m.settings.seasonEnd }];
    assert(
        blocks(m, "x", "season").some((c) => /Every day/.test(c.text)),
        "all-blackout season blocks",
    );
}
// Blackouts count only inside the season (Tester: a blackout overlapping the
// first day, or a one-day tournament with an unrelated blackout, falsely
// blocked with "Every day of the season is a blackout date").
{
    const l = clone(ex);
    l.settings.blackouts = [{ from: "2027-02-01", to: "2027-03-07" }];
    assert(!blocks(l, "x", "season").length, "blackout overlapping the season start doesn't block");
    const one = clone(ex);
    one.settings.seasonStart = one.settings.seasonEnd = "2027-03-13";
    one.settings.blackouts = [{ from: "2027-04-03" }, { from: "2026-12-24", to: "2027-01-02" }];
    assert(!readiness(one, "x").some((c) => /Every day/.test(c.text)), "one-day tournament with an unrelated blackout doesn't block");
    one.settings.blackouts = [{ from: "2027-03-10", to: "2027-03-20" }];
    assert(blocks(one, "x", "season").some((c) => /Every day/.test(c.text)), "one-day tournament inside a blackout blocks");
}
// A bracket whose window excludes every slot blocks on time, naming it.
{
    const l = clone(ex);
    l.brackets[0].latest = "06:00";
    l.brackets[0].earliest = "";
    assert(
        blocks(l, "x", "time").some((c) => c.text.startsWith(`${l.brackets[0].name} has no`)),
        "bracket with no usable time blocks",
    );
    l.brackets[0].earliest = "20:00";
    l.brackets[0].latest = "08:00";
    assert(
        blocks(l, "x", "brackets").some((c) => /earliest start is after/.test(c.text)),
        "earliest > latest blocks",
    );
}
// Too few spots for a bracket's games blocks; capacity check counts games, not teams.
{
    const l = clone(ex);
    l.slots = l.slots.slice(0, 1);
    l.availability = [];
    assert(
        blocks(l, "x", "time").some((c) => /^\d+ games are needed but the season has only \d+ game spots\.$/.test(c.text)),
        "under-capacity season blocks",
    );
    // One bracket alone over what fits it is named on its own.
    const one = clone(ex);
    one.brackets[0].matches = 99;
    one.slots = one.slots.slice(0, 2);
    assert(
        blocks(one, "x", "time").some((c) => c.text.startsWith(`${one.brackets[0].name} needs`)),
        "under-capacity bracket blocks, named",
    );
    // More games per team than dates (at maxPerDay) blocks even with spots to spare.
    const many = clone(ex);
    many.brackets[0].matches = 99;
    assert(
        blocks(many, "x", "time").some((c) => c.text.startsWith(`${many.brackets[0].name}: a team needs 99 games but only`)),
        "more games than dates blocks",
    );
}
// No time at all, and time outside the season.
{
    const l = clone(ex);
    l.slots = [];
    l.availability = [];
    assert(
        blocks(l, "x", "time").some((c) => /Add weekly ice time/.test(c.text)),
        "no time blocks, sport-worded",
    );
}
// Teams: alone in a pool blocks, odd total warns, teamless bracket warns.
{
    const l = clone(ex);
    const b = l.brackets[0];
    const first = l.teams.find((t) => t.bracketId === b.id)!;
    first.pool = "Solo";
    assert(
        blocks(l, "x", "teams").some((c) => c.text.startsWith(`${first.name} is the only team`)),
        "pool of one blocks",
    );
    const w = clone(ex);
    w.teams = w.teams.filter((t) => t.bracketId !== w.brackets[0].id);
    assert(
        readiness(w, "x").some((c) => c.level === "warn" && c.text === `${w.brackets[0].name} has no teams yet.`),
        "empty bracket warns",
    );
    const o = clone(ex);
    const bt = o.teams.filter((t) => t.bracketId === o.brackets[0].id);
    bt[0].matches = (bt[0].matches ?? o.brackets[0].matches) + 1;
    const odd = readiness(o, "x").some((c) => c.level === "warn" && /odd total/.test(c.text));
    const total = bt.reduce((n, t) => n + (t.matches ?? o.brackets[0].matches), 0);
    assert(odd === (total % 2 === 1), "odd-total warning matches the arithmetic");
    const lost = clone(ex);
    lost.teams[0].bracketId = "gone";
    assert(
        blocks(lost, "x", "teams").some((c) => /isn’t in a bracket/.test(c.text)),
        "team without bracket blocks",
    );
}
// Requests: an empty rule warns, never blocks.
{
    const l = clone(ex);
    l.teams[0].rules = [{ id: "r1", type: "no_days", mode: "must", days: [] }];
    assert(
        readiness(l, "x").some((c) => c.step === "requests" && c.level === "warn"),
        "empty rule warns",
    );
    assert(!blocks(l, "x", "requests").length, "requests never block");
}

// Must-requests that leave a team too few dates block on Requests, naming
// the team; the same in a bracket's own rules blocks on Brackets instead.
// Either way Generate really does leave games unplaced.
const unplaced = (l: League) => {
    const r = generate(l, [], { scope: "all", seed: 1, maxAttempts: 5, timeBudgetMs: 1e9, now: () => 0 });
    return r.needed - r.placed;
};
{
    const l = clone(sampleLeague("tennis"));
    const team = l.teams.find((x) => x.id === "t10b")!;
    // 10U can't start after 5:30 PM, so the weekday 5 PM slots are its only
    // Tue/Thu time; "only Wednesdays" leaves nothing at all.
    team.rules = [{ id: "rq", mode: "must", type: "only_days", days: [3] }];
    assert(
        blocks(l, "x", "requests").some((c) => c.text === "Example Lightning 10U: its must-requests leave 0 dates it can play, but it needs 5 matches."),
        `team must-requests leaving no dates block on requests (${blocks(l).map((c) => c.text).join(" | ")})`,
    );
    assert(unplaced(l) > 0, "…and Generate really leaves matches unplaced");
    // Prefer never blocks.
    team.rules = [{ id: "rq", mode: "prefer", type: "only_days", days: [3] }];
    assert(!blocks(l, "x").length, "the same request as Prefer doesn't block");
    // Three dates left (at one a day) for five matches.
    team.rules = [{ id: "rq", mode: "must", type: "not_dates", ranges: [{ from: "2027-03-06", to: "2027-05-12" }] }];
    assert(
        blocks(l, "x", "requests").some((c) => /^Example Lightning 10U: its must-requests leave \d dates it can play, but it needs 5 matches\.$/.test(c.text)),
        "team must-requests leaving too few dates block",
    );
    assert(unplaced(l) > 0, "…and Generate really leaves matches unplaced (dates)");

    const b = clone(sampleLeague("hockey"));
    b.brackets[0].rules = [{ id: "rb", mode: "must", type: "only_days", days: [3] }];
    assert(
        blocks(b, "x", "brackets").some((c) => c.text === "10U: its must-rules leave 0 dates its teams can play, but a team needs 5 games."),
        `bracket must-rules leaving no dates block on brackets (${blocks(b).map((c) => c.text).join(" | ")})`,
    );
    assert(!blocks(b, "x", "requests").length, "…and its teams don't repeat it on requests");
}
// "At least n days between" needs (target − 1)·n + 1 days.
{
    const l = clone(sampleLeague("soccer"));
    const team = l.teams.find((x) => x.id === "t14b")!;
    team.rules = [{ id: "rg", mode: "must", type: "min_days_between", n: 20 }];
    assert(
        blocks(l, "x", "requests").some((c) => c.text.startsWith("Example Lightning 14U: “At least 20 days between games” leaves room for only") && c.text.endsWith("but it needs 5.")),
        `days-between too long blocks on requests, naming the team (${blocks(l).map((c) => c.text).join(" | ")})`,
    );
    assert(unplaced(l) > 0, "…and Generate really leaves games unplaced (gap)");
    team.rules = [{ id: "rg", mode: "must", type: "min_days_between", n: 14 }];
    assert(!blocks(l, "x").length, "a gap that fits (14 days × 4 + 1 ≤ the season) doesn't block");
    const b = clone(sampleLeague("soccer"));
    b.brackets[3].rules = [{ id: "rg", mode: "must", type: "min_days_between", n: 30 }];
    assert(
        blocks(b, "x", "brackets").some((c) => c.text.startsWith("18U: “At least 30 days between games” leaves room for only")),
        "a bracket's own days-between blocks on brackets",
    );
}
// A time with fewer free units than one game uses holds no games: warn,
// naming the facility; when that's every time, block on Season, where the
// setting is, instead of the misleading "None of the time falls inside".
{
    const l = clone(sampleLeague("tennis"));
    l.settings.courtsPerMatch = 3;
    const w = readiness(l, "x").filter((c) => c.step === "time" && c.level === "warn");
    assert(
        w.some((c) => c.text === "Example Park Courts has 2 courts free at some times, but a match uses 3, so those times hold no matches."),
        `short time warns, naming the facility (${w.map((c) => c.text).join(" | ")})`,
    );
    const all = clone(sampleLeague("tennis"));
    all.settings.courtsPerMatch = 4;
    assert(
        blocks(all, "x", "season").some((c) => c.text === "A match uses 4 courts, but no time has more than 3 free. Lower “Courts used by one match”, or free more courts."),
        `units per game over every time blocks on season (${blocks(all).map((c) => c.text).join(" | ")})`,
    );
    assert(!readiness(all, "x").some((c) => /falls inside the season/.test(c.text)), "…without the misleading “falls inside the season” block");
    assert(firstOpenStep(readiness(all, "x")) === "season", "…and the wizard opens on Season");
    // Uploads count their courts the same way.
    const up = clone(sampleLeague("tennis"));
    up.settings.courtsPerMatch = 2;
    up.availability = [{ id: "a1", locationId: "loc-center", date: "2027-03-06", time: "08:00", courts: 1, unitIds: [], bracketIds: [] }];
    assert(
        readiness(up, "x").some((c) => c.level === "warn" && c.text.startsWith("Example Tennis Center has 1 court free at some times")),
        `a one-court upload warns (${readiness(up, "x").map((c) => c.text).join(" | ")})`,
    );
}
// A team wanting more games than the rest of its pool plays blocks on
// Teams, and the "odd total" note (wrong cause) is left out; the engine's
// own warning names the real cause too.
{
    const l = clone(sampleLeague("tennis"));
    const team = l.teams.find((x) => x.id === "t10a")!;
    team.matches = 16;
    team.rules = [];
    assert(
        blocks(l, "x", "teams").some((c) => c.text === "Example Hawks 10U wants 16 matches but the rest of its pool has only 15 to give."),
        `greedy team blocks on teams (${blocks(l).map((c) => c.text).join(" | ")})`,
    );
    assert(!readiness(l, "x").some((c) => /odd total/.test(c.text)), "…and no false “odd total” note");
    const r = generate(l, [], { scope: "all", seed: 1, maxAttempts: 5, timeBudgetMs: 1e9, now: () => 0 });
    assert(
        r.warnings.some((x) => /^Example Hawks 10U gets \d+ of 16 matches: the rest of 10U has only 15 to give/.test(x)),
        `engine names the real cause (${r.warnings.join(" | ")})`,
    );
    assert(!r.warnings.some((x) => /odd total/.test(x)), "…not an odd total");
}

// Weekend/week caps counted against the guarantee (a Tester find: these are
// dynamic rules, so the static date count alone let them through as "Ready").
{
    const base = clone(ex);
    base.settings.maxPerDay = 2;
    const end = isoToDay(base.settings.seasonStart) + 27;
    base.settings.seasonEnd = dayToIso(end);
    const b14 = base.brackets.find((b) => b.name === "14U")!;
    const team = base.teams.find((t) => t.bracketId === b14.id)!;
    const satOnly: Rule = { id: "rs", type: "only_days", mode: "must", days: [6] };
    for (const [rule, label] of [
        [{ id: "rw", type: "max_per_weekend", mode: "must", n: 1 } as Rule, "per weekend"],
        [{ id: "rt", type: "max_weekend_total", mode: "must", n: 3 } as Rule, "weekend total"],
        [{ id: "rk", type: "max_per_week", mode: "must", n: 1 } as Rule, "per week"],
    ] as const) {
        const l = clone(base);
        const tm = l.teams.find((t) => t.id === team.id)!;
        tm.rules = [satOnly, rule];
        const hit = blocks(l, "x", "requests").find((c) => c.text.startsWith(`${tm.name}: “`) && /leaves room for only \d+ games in the season, but it needs 5\./.test(c.text));
        assert(hit, `${label} cap blocks on requests (${blocks(l, "x").map((c) => c.text).join(" | ")})`);
        const r = generate(l, [], { scope: "all", seed: 1, maxAttempts: 5, timeBudgetMs: 1e9, now: () => 0 });
        const got = r.matches.filter((m) => m.date && (m.home === tm.id || m.away === tm.id)).length;
        assert(got < 5, `${label}: Generate really is short for the team (${got})`);
        const soft = clone(l);
        soft.teams.find((t) => t.id === team.id)!.rules = [satOnly, { ...rule, mode: "prefer" } as Rule];
        const own = blocks(soft, "x", "requests").filter((c) => c.text.startsWith(`${tm.name}:`));
        assert(!own.length, `${label} as prefer never blocks (${own.map((c) => c.text).join(" | ")})`);
    }
}

// Soundness fuzz: a "leaves room for only" block is a proof, so the team it
// names must really come up short when generated. A false block traps an
// organiser at Next with nothing to fix.
{
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const types = ["max_per_weekend", "max_weekend_total", "max_per_week", "min_days_between"] as const;
    let proofs = 0;
    for (let k = 0; k < 60; k++) {
        const l = sampleLeague((["soccer", "hockey", "tennis"] as const)[k % 3]);
        l.settings.maxPerDay = 1 + Math.floor(rnd() * 2);
        for (const team of l.teams) {
            if (rnd() < 0.7) continue;
            const type = types[Math.floor(rnd() * types.length)];
            const n = type === "min_days_between" ? 7 + Math.floor(rnd() * 14) : type === "max_weekend_total" ? Math.floor(rnd() * 5) : 1;
            team.rules = [...team.rules, { id: `f${k}${team.id}`, type, mode: "must", n } as Rule];
            if (rnd() < 0.3) team.rules.push({ id: `d${k}${team.id}`, type: "only_days", mode: "must", days: [6, 0] });
        }
        const named = readiness(l, "x").filter((c) => c.level === "block" && /leaves room for only/.test(c.text));
        if (!named.length) continue;
        const r = generate(l, [], { scope: "all", seed: 1, maxAttempts: 3, timeBudgetMs: 1e9, now: () => 0 });
        for (const c of named) {
            const team = l.teams.find((t) => c.text.startsWith(`${t.name}:`));
            if (!team) continue;
            const want = Number(/needs (\d+)\.$/.exec(c.text)![1]);
            const got = r.matches.filter((m) => m.date && (m.home === team.id || m.away === team.id)).length;
            assert(got < want, `fuzz ${k}: “${c.text}” but Generate gave ${team.name} ${got}`);
            proofs++;
        }
    }
    assert(proofs > 5, `fuzz exercised the proofs (${proofs})`);
}

console.log(`verify-readiness: ${checks} checks passed`);
