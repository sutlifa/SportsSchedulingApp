/**
 * "Is this league ready to schedule, and if not, what's missing?" -- one
 * answer shared by the setup wizard, the Schedule tab's checklist and the
 * verify script.
 *
 * Goes past "is it filled in": it checks that each bracket actually has
 * time it can use (its start window, its days, slots' "Open to") and enough
 * of it for its games, and that no team is alone in its pool -- the things
 * that otherwise only show up as unplaced games after Generate.
 *
 *   block -- scheduling can't succeed until this is fixed (Next is disabled)
 *   warn  -- it will schedule, but probably not how you want
 *   info  -- worth knowing, nothing to do
 *
 * Pure. Wording follows the league's sport.
 */
import { bracketHard, prepare, teamTarget, poolKey } from "./engine.ts";
import { formatRange, isIsoDate, isoToDay, rangesToDays } from "./dates.ts";
import { describeRule, type NameLookup } from "./rules.ts";
import { cap, termsFor } from "./sports.ts";
import type { League } from "./types.ts";

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
        const blackout = rangesToDays(s.blackouts);
        for (const r of s.blackouts) {
            if (r.from > s.seasonEnd || (r.to ?? r.from) < s.seasonStart) add("season", "warn", `Blackout ${formatRange(r)} is outside the season, so it does nothing.`);
        }
        if (blackout.size >= days) add("season", "block", "Every day of the season is a blackout date.");
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
    if (!league.slots.length && !league.availability.length) add("time", "block", `Add weekly ${t.time}, or upload a facility’s spreadsheet.`);
    else if (hasDates && s.seasonEnd >= s.seasonStart && !ctx.instances.length)
        add("time", "block", `None of the ${t.time} falls inside the season. Check the slots’ days and the season dates.`);
    for (const l of league.locations) if (!usedLocations.has(l.id)) add("time", "info", `${l.name} has no ${t.time} yet.`);

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
        if (!usable.length) add("time", "block", `${b.name} has no ${t.time} it can use: check its start window and days, and each slot’s “Open to”.`);
        else if (games && spots < games) add("time", "block", `${b.name} needs ${games} ${t.matches} but only ${spots} ${t.match} spots fit it.`);
        else if (games && spots < games * 1.5) add("time", "warn", `${b.name} is tight: ${games} ${t.matches} for ${spots} ${t.match} spots that fit it. Some requests may not be met.`);
    }
    const total = ctx.instances.reduce((n, i) => n + i.capacity, 0);
    if (ctx.instances.length && needed && total < needed) add("time", "block", `${needed} ${t.matches} are needed but the season has only ${total} ${t.match} spots.`);

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
        if (members.length === 1) add("teams", "block", `${members[0].name} is the only team in ${label}, so it has nobody to play.`);
        else if (members.reduce((n, x) => n + teamTarget(x, b), 0) % 2 === 1)
            add("teams", "warn", `${label} has an odd total of ${t.matches}, so one team will get one fewer.`);
    }
    for (const b of league.brackets) if (!teamsByBracket.get(b.id)) add("teams", "warn", `${b.name} has no teams yet.`);

    // --- requests -----------------------------------------------------------
    const lookup: NameLookup = { team: (id) => league.teams.find((x) => x.id === id)?.name, location: (id) => league.locations.find((x) => x.id === id)?.name, terms: t };
    let withRules = 0;
    for (const team of league.teams) {
        if (team.rules.length) withRules++;
        for (const r of team.rules) {
            const text = describeRule(r, lookup);
            if (/^No (days|dates|locations|teams) chosen yet$|^Empty note$/.test(text)) add("requests", "warn", `${team.name}: a “${text.toLowerCase()}” rule does nothing yet.`);
        }
    }
    if (league.teams.length) add("requests", "info", `${withRules} of ${league.teams.length} teams have requests. Add any you’ve been sent; you can always add more later.`);

    return out;
}

/** The first step that still has something blocking it, or "review". */
export function firstOpenStep(checks: Check[]): StepId {
    return SETUP_STEPS.find((s) => checks.some((c) => c.step === s && c.level === "block")) ?? "review";
}
