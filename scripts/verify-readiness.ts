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
import type { League } from "../lib/engine/types.ts";

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

console.log(`verify-readiness: ${checks} checks passed`);
