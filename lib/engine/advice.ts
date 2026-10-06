/**
 * Turns a scheduling problem ("All courts are already taken at that time",
 * "Aces 12U: At most 1 match per weekend") into what to DO about it and
 * where in the app to do it.
 *
 * The reasons come from engine.ts's check()/audit() and describeRule(), so
 * this matches on their exact wording -- if a message there changes, the
 * matching case here must change with it (scripts/verify-engine.ts checks
 * every message the engine can produce gets specific advice).
 */
import type { League } from "./types.ts";

export type AdviceTab = "courts" | "brackets" | "teams" | "season";
export type Advice = { tip: string; tab: AdviceTab | null; tabLabel: string };

const TAB_LABEL: Record<AdviceTab, string> = {
    courts: "Courts & times",
    brackets: "Brackets & pools",
    teams: "Teams",
    season: "Season",
};

const make = (tip: string, tab: AdviceTab | null): Advice => ({ tip, tab, tabLabel: tab ? TAB_LABEL[tab] : "" });

export function adviceFor(reason: string, league: League): Advice {
    let m: RegExpExecArray | null;
    if (/^All courts are already taken/.test(reason))
        return make("Every open time that fits is already full. Add weekly time slots, raise “Matches at once” on a slot, or upload more facility availability.", "courts");
    if ((m = /^This time slot isn’t open to (.+)$/.exec(reason)))
        return make(`Slots are reserved for other brackets. Add ${m[1]} to a slot’s “Open to”, or add time slots for ${m[1]}.`, "courts");
    if ((m = /^(.+) can’t start (before|after) (.+)$/.exec(reason)))
        return make(`${m[1]}’s start-time window rules this time out. Widen the bracket’s earliest/latest start, or add time slots inside it.`, "brackets");
    if ((m = /^(.+) doesn’t play on (.+)$/.exec(reason)))
        return make(`${m[1]} is limited to certain days. Add ${m[2]} under “Plays on”, or add time slots on the days it does play.`, "brackets");
    if (/ already plays that day$| is already playing at that time$/.test(reason))
        return make("This team’s other matches already use the open days. Add more dates or time slots, or raise “Max matches per team per day”.", "season");
    if (/^More than \d+ .+ on court at the same time$/.test(reason))
        return make("The club limit keeps one club’s teams apart. Raise it, set it to “where possible”, or add time slots at other times.", "season");
    if (/^Its location was deleted$/.test(reason)) return make("Move the match to another time, or regenerate to place it again.", "courts");
    if (/^The facility’s sheet has no court time then$/.test(reason))
        return make("The facility’s uploaded sheet doesn’t include this time. Move the match, or upload an updated sheet.", "courts");
    if (/^This time is no longer in the weekly slots/.test(reason))
        return make("The slot this match used was changed or removed. Move it to a current time.", "courts");
    if (/^There are no time slots in the season/.test(reason))
        return make("Check the season’s first and last day, then add weekly time slots or upload facility availability.", "courts");
    // "<Team>: not at the same time as <Other>" / "<Team>: <rule sentence>"
    const team = league.teams.find((t) => reason.startsWith(`${t.name}: `));
    if (team) {
        const rule = reason.slice(team.name.length + 2);
        if (/^not (at the same time|on the same day) as /.test(rule))
            return make(`${team.name} can’t play alongside another team, so they compete for the same times. Switch the rule to “Prefer”, or add time slots.`, "teams");
        return make(`This is ${team.name}’s rule “${rule}”. Loosen it, switch it to “Prefer”, or add time slots that fit it.`, "teams");
    }
    return make("Try moving the match by hand, or regenerate.", null);
}
