/**
 * "Is this league ready to schedule, and if not, what's missing?" -- one
 * answer shared by the setup wizard, the Schedule tab's checklist and the
 * verify script.
 *
 * Goes past "is it filled in": it checks that each bracket actually has
 * time it can use (its start window, its days, slots' "Open to") and enough
 * of it for its games, that its must-rules and each team's must-requests
 * leave enough dates (and enough room for "days between"), that no time is
 * too small for the units one game uses, and that no team is alone in its
 * pool or wants more games than the rest of its pool plays -- the things
 * that otherwise only show up as unplaced games after Generate.
 *
 * A false block traps a person mid-setup, so every block here is a proof
 * that Generate can't place everything, never a guess that it might not.
 *
 *   block -- scheduling can't succeed until this is fixed (Next is disabled)
 *   warn  -- it will schedule, but probably not how you want
 *   info  -- worth knowing, nothing to do
 *
 * Pure. Wording follows the league's sport.
 */
import { bracketHard, compileStatic, prepare, teamTarget, poolKey, type Instance } from "./engine.ts";
import { formatRange, isIsoDate, isoToDay, isWeekend, rangesToDays, weekendKey, weekKey } from "./dates.ts";
import { describeRule, type NameLookup } from "./rules.ts";
import { cap, termsFor } from "./sports.ts";
import type { League, Rule } from "./types.ts";

export const SETUP_STEPS = ["basics", "season", "brackets", "facilities", "time", "teams", "requests", "review"] as const;
export type StepId = (typeof SETUP_STEPS)[number];
export type Level = "block" | "warn" | "info";
export type Check = { step: StepId; level: Level; text: string };

export function stepTitle(step: StepId, league: League): string {
    const t = termsFor(league.settings.sport);
    return {
        basics: "Name & sport",
        season: "Season",
        brackets: "Brackets & pools",
        facilities: "Facilities",
        time: cap(t.time),
        teams: "Teams",
        requests: "Requests",
        review: "Review & schedule",
    }[step];
}

export function readiness(league: League, name: string): Check[] {
    const t = termsFor(league.settings.sport);
    const out: Check[] = [];
    const add = (step: StepId, level: Level, text: string) => out.push({ step, level, text });
    const s = league.settings;

    // --- basics -------------------------------------------------------------
    if (!name.trim()) add("basics", "block", "Give the league or tournament a name.");

    // --- season -------------------------------------------------------------
    const hasDates = isIsoDate(s.seasonStart) && isIsoDate(s.seasonEnd);
    if (!hasDates) add("season", "block", "Set the season’s first and last day.");
    else if (s.seasonEnd < s.seasonStart) add("season", "block", "The last day is before the first day.");
    else {
        const days = isoToDay(s.seasonEnd) - isoToDay(s.seasonStart) + 1;
        if (days > 400) add("season", "warn", `The season is ${Math.round(days / 7)} weeks long. Check the dates.`);
        // Only blackout days INSIDE the season count: a long holiday that
        // starts before the first day (or a one-day tournament with last
        // year's blackouts still listed) used to add up to "every day".
        const first = isoToDay(s.seasonStart);
        const last = isoToDay(s.seasonEnd);
        let dark = 0;
        for (const d of rangesToDays(s.blackouts)) if (d >= first && d <= last) dark++;
        for (const r of s.blackouts) {
            if (r.from > s.seasonEnd || (r.to ?? r.from) < s.seasonStart) add("season", "warn", `Blackout ${formatRange(r)} is outside the season, so it does nothing.`);
        }
        if (dark >= days) add("season", "block", "Every day of the season is a blackout date.");
    }

    // --- brackets -----------------------------------------------------------
    if (!league.brackets.length) add("brackets", "block", "Add at least one bracket (an age group or division, e.g. 10U).");
    for (const b of league.brackets) {
        if (b.matches <= 0) add("brackets", "warn", `${b.name} gives each team 0 ${t.matches}.`);
        if (b.earliest && b.latest && b.earliest > b.latest) add("brackets", "block", `${b.name}: the earliest start is after the latest start.`);
    }

    // --- facilities ---------------------------------------------------------
    if (!league.locations.length) add("facilities", "block", "Add at least one facility.");
    for (const l of league.locations) {
        if (!l.units.length) add("facilities", "info", `${l.name} has no named ${t.units}, so ${t.matches} there won’t say which ${t.unit}.`);
        if (!l.address.trim()) add("facilities", "info", `${l.name} has no address. Exports and coach texts are clearer with one.`);
    }

    // --- time ---------------------------------------------------------------
    const ctx = prepare(league);
    const usedLocations = new Set([...league.slots.map((x) => x.locationId), ...league.availability.map((x) => x.locationId)]);

    // prepare() drops a time whose free units can't make one game (2 courts
    // free, 3 per match), so on its own that reads as "no time in the season"
    // and sends the person to check dates that are fine. Re-run it at one
    // unit per game (without teams, which is the costly part) to see what
    // the units-per-game setting alone is hiding.
    const perGame = ctx.unitsPerMatch;
    let unitsTooMany = false;
    if (perGame > 1 && hasDates && s.seasonEnd >= s.seasonStart) {
        const loose = prepare({ ...league, teams: [], settings: { ...s, courtsPerMatch: 1 } });
        const uploads = new Set(league.availability.map((a) => a.id));
        // Units free at a time, or Infinity for a weekly slot that just says
        // "N games at once" (that number isn't divided by units per game).
        const unitsAt = (i: Instance) => i.unitIds.length || (uploads.has(i.slotId) ? i.capacity : Infinity);
        if (!ctx.instances.length && loose.instances.length) {
            unitsTooMany = true;
            const most = Math.max(...loose.instances.map(unitsAt));
            add(
                "season",
                "block",
                `A ${t.match} uses ${perGame} ${t.units}, but no time has more than ${most} free. Lower “${cap(t.units)} used by one ${t.match}”, or free more ${t.units}.`,
            );
        } else {
            const short = new Map<string, number>();
            for (const i of loose.instances) {
                const n = unitsAt(i);
                if (n < perGame) short.set(i.locationId, Math.max(short.get(i.locationId) ?? 0, n));
            }
            for (const l of league.locations) {
                const n = short.get(l.id);
                if (n !== undefined)
                    add(
                        "time",
                        "warn",
                        `${l.name} has ${n} ${n === 1 ? t.unit : t.units} free at some times, but a ${t.match} uses ${perGame}, so those times hold no ${t.matches}.`,
                    );
            }
        }
    }

    if (!league.slots.length && !league.availability.length) add("time", "block", `Add weekly ${t.time}, or upload a facility’s spreadsheet.`);
    else if (hasDates && s.seasonEnd >= s.seasonStart && !ctx.instances.length && !unitsTooMany)
        add("time", "block", `None of the ${t.time} falls inside the season. Check the slots’ days and the season dates.`);
    for (const l of league.locations) if (!usedLocations.has(l.id)) add("time", "info", `${l.name} has no ${t.time} yet.`);

    // Must-rules (the bracket's, then each team's) can rule out so many times
    // that a team can't reach its games however the rest is arranged. Each
    // check runs only when the level above it passed, so one cause gets one
    // message, on the step where it's fixed.
    const live = new Set(league.locations.map((l) => l.id));
    const mustTests = (rules: Rule[]) =>
        rules.flatMap((r) => {
            const test = r.mode === "must" ? compileStatic(r, live) : null;
            return test ? [test] : [];
        });
    const datesOf = (list: Instance[]) => [...new Set(list.map((i) => i.day))].sort((a, b) => a - b);
    // At least n days apart: the most games a team could fit on these days,
    // taking the earliest day each time (greedy is exact for this).
    const fitApart = (days: number[], n: number) => {
        let count = 0;
        let last = -Infinity;
        for (const d of days) if (d - last >= n) {
            count++;
            last = d;
        }
        return count;
    };
    /**
     * The most games these days can hold under ONE must-rule that limits how
     * often a team plays -- days apart, per weekend, weekend total, per week
     * -- each day still holding at most maxPerDay. Each is an exact count for
     * its rule alone, so a result below the target is a proof the team will
     * come up short, never a guess. The tightest rule is reported. Rules are
     * taken one at a time on purpose: their combination is the scheduler's
     * job, and a bound that mixed them could only be looser, not wrong.
     */
    const tightest = (rules: Rule[], days: number[]): { rule: Rule; fit: number } | null => {
        const perDay = s.maxPerDay;
        let best: { rule: Rule; fit: number } | null = null;
        for (const r of rules) {
            if (r.mode !== "must") continue;
            let fit: number;
            if (r.type === "min_days_between" && r.n > 0) fit = fitApart(days, r.n);
            else if (r.type === "max_per_weekend") {
                const weekends = new Map<number, number>();
                let weekdays = 0;
                for (const d of days) {
                    const k = weekendKey(d);
                    if (k === null) weekdays++;
                    else weekends.set(k, (weekends.get(k) ?? 0) + 1);
                }
                fit = weekdays * perDay + [...weekends.values()].reduce((n, c) => n + Math.min(r.n, c * perDay), 0);
            } else if (r.type === "max_weekend_total") {
                const weekend = days.filter(isWeekend).length;
                fit = (days.length - weekend) * perDay + Math.min(r.n, weekend * perDay);
            } else if (r.type === "max_per_week") {
                const weeks = new Map<number, number>();
                for (const d of days) weeks.set(weekKey(d), (weeks.get(weekKey(d)) ?? 0) + 1);
                fit = [...weeks.values()].reduce((n, c) => n + Math.min(r.n, c * perDay), 0);
            } else continue;
            if (!best || fit < best.fit) best = { rule: r, fit };
        }
        return best;
    };
    const ruleLookup: NameLookup = { team: (id) => league.teams.find((x) => x.id === id)?.name, location: (id) => league.locations.find((x) => x.id === id)?.name, terms: t };
    const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    /** "1 game" / "5 games", "1 game spot" / "30 game spots". */
    const games$ = (n: number) => plural(n, t.match, t.matches);
    const spots$ = (n: number) => plural(n, `${t.match} spot`, `${t.match} spots`);
    /** Brackets whose own must-rules already explain a shortfall, so their teams don't repeat it. */
    const bracketShort = new Set<string>();

    const teamsByBracket = new Map<string, number>();
    for (const team of league.teams) teamsByBracket.set(team.bracketId, (teamsByBracket.get(team.bracketId) ?? 0) + 1);
    let needed = 0;
    for (const b of league.brackets) {
        const bracketTeams = league.teams.filter((x) => x.bracketId === b.id);
        const games = Math.floor(bracketTeams.reduce((n, x) => n + teamTarget(x, b), 0) / 2);
        needed += games;
        if (!ctx.instances.length) continue;
        const usable = ctx.instances.filter((i) => bracketHard(b, i) === null);
        const spots = usable.reduce((n, i) => n + i.capacity, 0);
        // A team plays at most maxPerDay a day, so its games need that many
        // distinct dates. Capacity alone misses this: 4 teams × 99 games fit
        // in 220 spots but not in an 11-week season.
        const most = bracketTeams.reduce((n, x) => Math.max(n, teamTarget(x, b)), 0);
        const dates = new Set(usable.map((i) => i.date)).size;
        if (!usable.length) {
            add("time", "block", `${b.name} has no ${t.time} it can use: check its start window and days, and each slot’s “Open to”.`);
            bracketShort.add(b.id);
        } else {
            if (most > dates * s.maxPerDay) {
                add("time", "block", `${b.name}: a team needs ${games$(most)} but only ${dates} ${dates === 1 ? "date fits" : "dates fit"} it, at ${s.maxPerDay} a day at most.`);
                bracketShort.add(b.id);
            } else if (most > 0) {
                const tests = mustTests(b.rules);
                const days = datesOf(usable.filter((i) => tests.every((ok) => ok(i))));
                const limit = tightest(b.rules, days);
                if (most > days.length * s.maxPerDay) {
                    add("brackets", "block", `${b.name}: its must-rules leave ${plural(days.length, "date", "dates")} its teams can play, but a team needs ${games$(most)}.`);
                    bracketShort.add(b.id);
                } else if (limit && limit.fit < most) {
                    add("brackets", "block", `${b.name}: “${describeRule(limit.rule, ruleLookup)}” leaves room for only ${games$(limit.fit)} in the season, but a team needs ${most}.`);
                    bracketShort.add(b.id);
                }
            }
            if (games && spots < games) add("time", "block", `${b.name} needs ${games$(games)} but only ${spots$(spots)} ${spots === 1 ? "fits" : "fit"} it.`);
            else if (games && spots < games * 1.5)
                add("time", "warn", `${b.name} is tight: ${games$(games)} for ${spots$(spots)} that fit it. Some requests may not be met.`);
        }
    }
    const total = ctx.instances.reduce((n, i) => n + i.capacity, 0);
    if (ctx.instances.length && needed && total < needed) add("time", "block", `${games$(needed)} ${needed === 1 ? "is" : "are"} needed but the season has only ${spots$(total)}.`);

    // --- teams --------------------------------------------------------------
    if (league.teams.length < 2) add("teams", "block", "Add the teams (at least two).");
    const brackets = new Map(league.brackets.map((b) => [b.id, b]));
    for (const team of league.teams) if (!brackets.has(team.bracketId)) add("teams", "block", `${team.name} isn’t in a bracket.`);
    const pools = new Map<string, typeof league.teams>();
    for (const team of league.teams) {
        if (!brackets.has(team.bracketId)) continue;
        const k = poolKey(team.bracketId, team.pool);
        pools.set(k, [...(pools.get(k) ?? []), team]);
    }
    for (const members of pools.values()) {
        const b = brackets.get(members[0].bracketId)!;
        const label = `${b.name}${members[0].pool.trim() ? ` · Pool ${members[0].pool.trim()}` : ""}`;
        if (members.length === 1) {
            add("teams", "block", `${members[0].name} is the only team in ${label}, so it has nobody to play.`);
            continue;
        }
        // Every game a team plays, another pool member plays too, so no team
        // can get more than the rest of its pool plays in total. When that's
        // the cause, an "odd total" note would point at the wrong fix, so it
        // is left out for that pool.
        const sum = members.reduce((n, x) => n + teamTarget(x, b), 0);
        let greedy = false;
        for (const x of members) {
            const want = teamTarget(x, b);
            if (want > sum - want) {
                greedy = true;
                add("teams", "block", `${x.name} wants ${games$(want)} but the rest of its pool has only ${sum - want} to give.`);
            }
        }
        if (!greedy && sum % 2 === 1) add("teams", "warn", `${label} has an odd total of ${t.matches}, so one team will get one fewer.`);
    }
    for (const b of league.brackets) if (!teamsByBracket.get(b.id)) add("teams", "warn", `${b.name} has no teams yet.`);

    // --- requests -----------------------------------------------------------
    let withRules = 0;
    for (const team of league.teams) {
        if (team.rules.length) withRules++;
        for (const r of team.rules) {
            const text = describeRule(r, ruleLookup);
            if (/^No (days|dates|locations|teams) chosen yet$|^Empty note$/.test(text)) add("requests", "warn", `${team.name}: a “${text.toLowerCase()}” rule does nothing yet.`);
        }
    }
    for (const team of league.teams) {
        const tc = ctx.teams.get(team.id);
        if (!tc || !tc.target || bracketShort.has(team.bracketId) || !ctx.instances.length) continue;
        // staticHard already folds in the bracket's window, its rules and the
        // team's own -- the generator's own answer to "can it play here?".
        const days = datesOf(ctx.instances.filter((i) => tc.staticHard[i.idx] === null));
        if (tc.target > days.length * s.maxPerDay) {
            add("requests", "block", `${team.name}: its must-requests leave ${plural(days.length, "date", "dates")} it can play, but it needs ${games$(tc.target)}.`);
            continue;
        }
        // Days-apart and per-weekend/week caps, the bracket's and the team's
        // own, measured on the days this team can actually play.
        const limit = tightest([...tc.bracket.rules, ...team.rules], days);
        if (limit && limit.fit < tc.target)
            add("requests", "block", `${team.name}: “${describeRule(limit.rule, ruleLookup)}” leaves room for only ${games$(limit.fit)} in the season, but it needs ${tc.target}.`);
    }
    if (league.teams.length) add("requests", "info", `${withRules} of ${league.teams.length} teams have requests. Add any you’ve been sent; you can always add more later.`);

    return out;
}

/** The first step that still has something blocking it, or "review". */
export function firstOpenStep(checks: Check[]): StepId {
    return SETUP_STEPS.find((s) => checks.some((c) => c.step === s && c.level === "block")) ?? "review";
}
