/**
 * Turns a scheduling problem ("All courts are already taken at that time",
 * "Aces 12U: At most 1 match per weekend") into what to DO about it and
 * where in the app to do it.
 *
 * The reasons come from engine.ts's check()/audit() and describeRule(), so
 * this matches on their exact wording -- if a message there changes, the
 * matching case here must change with it (scripts/verify-engine.ts checks
 * every message the engine can produce gets specific advice, in every sport).
 *
 * The tips speak the league's sport (termsFor(league.settings.sport)): a
 * hockey league reads "Add a sheet to that slot" and "Max games per team per
 * day", the Season tab's real label there. The patterns stay sport-neutral
 * (".+" where the engine puts a sport word) so one regex serves every sport.
 */
import { cap, termsFor, type Terms } from "./sports.ts";
import type { League } from "./types.ts";

export type AdviceTab = "courts" | "brackets" | "teams" | "season";
export type Advice = { tip: string; tab: AdviceTab | null; tabLabel: string };

/**
 * The tab names, as the editor shows them. Keep in step with tabsFor in
 * components/workspace/Workspace.tsx: the "Go to …" button names the tab, so
 * a label that differs sends the person looking for a tab that isn't there.
 */
function tabLabel(tab: AdviceTab, t: Terms): string {
    if (tab === "courts") return `Facilities & ${t.time}`;
    return { brackets: "Brackets & pools", teams: "Teams", season: "Season" }[tab];
}

export function adviceFor(reason: string, league: League): Advice {
    const t = termsFor(league.settings.sport);
    const make = (tip: string, tab: AdviceTab | null): Advice => ({ tip, tab, tabLabel: tab ? tabLabel(tab, t) : "" });
    let m: RegExpExecArray | null;
    // Before the "Every … is already booked" case: this message ends with a
    // similar clause but starts differently, and needs a different fix.
    if (/^(No .+ assigned|Only \d+ of \d+ .+ assigned): every .+ is booked at that time$/.test(reason))
        return make(
            `Every ${t.unit} free at that time is taken. Add a ${t.unit} to that slot (or upload more availability), lower “${cap(t.units)} used by one ${t.match}”, or move the ${t.match} to a time with a free ${t.unit}.`,
            "courts"
        );
    if (/^(No .+ assigned|Only \d+ of \d+ .+ assigned)$/.test(reason))
        return make(`A ${t.unit} is free at that time. Press Move and pick it under “Change ${t.unit}”, or regenerate.`, "courts");
    if (/^Every .+ is already booked at that time$/.test(reason))
        return make(
            `Every open time that fits is already full. Add weekly time slots, add more ${t.units} to a slot, raise its “at once”, or upload more facility availability.`,
            "courts"
        );
    if ((m = /^(.+) has two .+ at once$/.exec(reason))) return make(`${m[1]} is double-booked. Move one of the two, or regenerate to reassign.`, "courts");
    if ((m = /^(.+) isn’t listed as free at that time$/.exec(reason)))
        return make(`${m[1]} isn’t in that time’s free list any more. Move the ${t.match} to a free ${t.unit}, or regenerate.`, "courts");
    if ((m = /^This time slot isn’t open to (.+)$/.exec(reason)))
        return make(`Slots are reserved for other brackets. Add ${m[1]} to a slot’s “Open to”, or add time slots for ${m[1]}.`, "courts");
    if ((m = /^(.+) can’t start (before|after) (.+)$/.exec(reason)))
        return make(`${m[1]}’s start-time window rules this time out. Widen the bracket’s earliest/latest start, or add time slots inside it.`, "brackets");
    if ((m = /^(.+) doesn’t play on (.+)$/.exec(reason)))
        return make(`${m[1]} is limited to certain days. Add ${m[2]} under “Plays on”, or add time slots on the days it does play.`, "brackets");
    if (/ already plays that day$| is already playing at that time$/.test(reason))
        return make(`This team’s other ${t.matches} already use the open days. Add more dates or time slots, or raise “Max ${t.matches} per team per day”.`, "season");
    if (/^More than \d+ .+ at the same time$/.test(reason))
        return make("The club limit keeps one club’s teams apart. Raise it, set it to “where possible”, or add time slots at other times.", "season");
    if (/^Its location was deleted$/.test(reason)) return make(`Move the ${t.match} to another time, or regenerate to place it again.`, "courts");
    if (/^The facility’s spreadsheet has no .+ then$/.test(reason))
        return make(`The facility’s uploaded spreadsheet doesn’t include this time. Move the ${t.match}, or upload an updated file.`, "courts");
    if (/^This time is no longer in the weekly slots/.test(reason))
        return make(`The slot this ${t.match} used was changed or removed. Move it to a current time.`, "courts");
    if (/^There are no time slots in the season/.test(reason))
        return make("Check the season’s first and last day, then add weekly time slots or upload facility availability.", "courts");
    // "<Team>: not at the same time as <Other>" / "<Team>: <rule sentence>"
    const team = league.teams.find((x) => reason.startsWith(`${x.name}: `));
    if (team) {
        const rule = reason.slice(team.name.length + 2);
        if (/^not (at the same time|on the same day) as /.test(rule))
            return make(`${team.name} can’t play alongside another team, so they compete for the same times. Switch the rule to “Prefer”, or add time slots.`, "teams");
        return make(`This is ${team.name}’s rule “${rule}”. Loosen it, switch it to “Prefer”, or add time slots that fit it.`, "teams");
    }
    return make(`Try moving the ${t.match} by hand, or regenerate.`, null);
}
