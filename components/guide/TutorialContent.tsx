"use client";

import Link from "next/link";
import CopyBlock from "@/components/CopyBlock";
import { APP_NAME } from "@/lib/brand";
import { cap, SPORTS, sportText, type SportId, type Terms } from "@/lib/engine/sports";
import { B, Expect, SportPicker, Step, Tip, useGuideSport } from "./parts";

/*
 * The tutorial is written against the app's exact labels ("Upload a facility
 * spreadsheet", "Sheets free", "Games placed"), in whichever sport the reader
 * picks. scripts/e2e/tutorial.mjs drives the real UI through it word for word
 * -- same team lists (read from this file), times, unit names and sample
 * sheet -- in every sport, and checks every "You should see". If a label or
 * an expected result here changes, change the script too, and run it.
 *
 * It's its own page, not a section of /guide: the header links to both, and
 * two links landing on one long page read as the same place.
 */

export const TEAMS_10U = `Riverside Hawks 10U, , Riverside
Lakeview Lightning 10U, , Lakeview
Oak Hill Storm 10U, , Oak Hill
Westfield Wolves 10U, , Westfield`;

export const TEAMS_12U = `Riverside Hawks 12U, A, Riverside
Lakeview Lightning 12U, A, Lakeview
Oak Hill Storm 12U, A, Oak Hill
Westfield Wolves 12U, A, Westfield
Riverside Rockets 12U, B, Riverside
Lakeview Bears 12U, B, Lakeview
Oak Hill Thunder 12U, B, Oak Hill
Westfield Kings 12U, B, Westfield`;

export const TEAMS_14U = `Riverside Hawks 14U, , Riverside
Lakeview Lightning 14U, , Lakeview
Oak Hill Thunder 14U, , Oak Hill
Westfield Wolves 14U, , Westfield
Riverside Rockets 14U, , Riverside
Lakeview Bears 14U, , Lakeview`;

const STEPS: [string, string][] = [
    ["t-create", "Create the league"],
    ["t-season", "Season dates"],
    ["t-brackets", "Age brackets"],
    ["t-locations", "Facilities"],
    ["t-slots", "Weekly time"],
    ["t-facility-sheet", "Facility spreadsheet"],
    ["t-teams", "Teams"],
    ["t-rules", "Requests"],
    ["t-generate", "Generate"],
    ["t-adjust", "Adjust by hand"],
    ["t-problems", "Problems explained"],
    ["t-share", "Share and back up"],
];

export default function TutorialContent() {
    const [sport, choose] = useGuideSport();
    return <Tutorial t={SPORTS[sport]} sport={sport} choose={choose} />;
}

function Tutorial({ t, sport, choose }: { t: Terms; sport: SportId; choose: (s: SportId) => void }) {
    const w = (text: string) => sportText(text, t);
    const [fac1, fac2] = t.facility;
    const short1 = fac1.split(" ")[0]; // "Riverside"
    const Units = cap(t.units);
    const Unit = cap(t.unit);
    const Matches = cap(t.matches);
    const tab = `Facilities & ${t.time}`;
    const Time = cap(t.time);
    const file = `${sport}-april-2027`;
    const u = (i: number) => t.unitLabel(i);

    return (
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-8 lg:grid-cols-[14rem_minmax(0,1fr)]">
            <nav className="hidden lg:block" aria-label="Tutorial steps">
                <div className="sticky top-6 grid gap-1 text-sm">
                    <div className="label">Steps</div>
                    {STEPS.map(([id, label], i) => (
                        <a key={id} href={`#${id}`} className="rounded px-2 py-1 text-muted hover:bg-surface-2 hover:text-fg">
                            {i + 1}. {label}
                        </a>
                    ))}
                </div>
            </nav>

            <article className="grid min-w-0 gap-4">
                <header className="grid gap-4">
                    <h1 className="font-display text-5xl font-bold uppercase tracking-wide">Tutorial</h1>
                    <p className="max-w-2xl text-lg text-muted">
                        Build a complete {t.name.toLowerCase()} league in {APP_NAME}, start to finish, in about 20 minutes, with a sample facility spreadsheet to practise on. For
                        how everything works and what each message means, see the{" "}
                        <Link href={`/guide?sport=${sport}`} className="font-semibold text-accent underline">
                            guide
                        </Link>
                        .
                    </p>
                    <div className="card flex flex-wrap items-center gap-3 border-accent/40 bg-accent-soft p-3">
                        <SportPicker sport={sport} onChange={choose} id="guide-sport-tutorial" label="Show this tutorial for" />
                        <span className="text-sm text-muted">Every step below, and the sample spreadsheet, follows this choice.</span>
                    </div>
                    <ol className="flex flex-wrap gap-2 text-sm lg:hidden">
                        {STEPS.map(([id, label], i) => (
                            <li key={id}>
                                <a href={`#${id}`} className="chip bg-surface-2 text-fg">
                                    {i + 1}. {label}
                                </a>
                            </li>
                        ))}
                    </ol>
                </header>

                <p className="max-w-3xl">
                    You’ll build <strong>Spring 2027 Youth {t.name}</strong>: three brackets, 18 teams, two facilities with named {t.units}, weekly {t.time}, one facility
                    spreadsheet and five {t.captain} requests. Use these exact values the first time; every step tells you what you should see. Then build your real league the same
                    way, or delete this one from <B>Season</B>.
                </p>
                <Tip>
                    Changes save automatically. The top-right corner of a league says <B>Saved</B> (or <B>Saved in this browser</B> if the site isn’t connected to its database).
                    You only press Save inside pop-up editors.
                </Tip>

                <Step n={1} id="t-create" title="Create the league">
                    <ol>
                        <li>
                            Press <B>New league</B> in the top bar (on a phone: <B>Menu</B> → <B>New league or tournament</B>).
                        </li>
                        <li>
                            Type the name <strong>Spring 2027 Youth {t.name}</strong>.
                        </li>
                        <li>
                            Set <B>Sport</B> to <strong>{t.name}</strong>.
                        </li>
                        <li>
                            Leave <B>Guided setup</B> selected and press <B>Start guided setup</B>.
                        </li>
                    </ol>
                    <Expect>
                        the setup wizard, on <strong>1. Name & sport</strong> (“Step 1 of 8”), with a <strong>{t.name}</strong> label next to the league’s name and the line “This
                        league talks about {t.units} ({u(0)}, {u(1)}), {t.time}, {t.matches} and {t.captains}.” Press <B>Next: Season</B>.
                    </Expect>
                    <Tip>
                        Every step lists what’s <strong>Needed</strong> (<B>Next</B> stays greyed out until it’s done), what to <strong>Check</strong>, and <strong>Notes</strong>.
                        The step list at the top jumps to any step. <B>Exit setup</B> opens the full editor at any time, and its <B>Setup guide</B> button brings you back to the
                        first step still missing something.
                    </Tip>
                </Step>

                <Step n={2} id="t-season" title="Set the season dates">
                    <ol>
                        <li>
                            On the <B>Season</B> step, set <B>First day</B> to <strong>03/06/2027</strong> and <B>Last day</B> to <strong>05/16/2027</strong>.
                        </li>
                        <li>
                            Under <B>Blackout dates</B>, set <B>From</B> 03/27/2027 and <B>To (optional)</B> 03/28/2027 (Easter weekend), then press <B>Add dates</B>.
                        </li>
                        <li>
                            Under <B>League-wide rules</B>, set <B>Same club at the same time</B> to <strong>2</strong>, “where possible”. Leave the rest as they are.
                        </li>
                    </ol>
                    <Expect>
                        “Sat, Mar 6, 2027 to Sun, May 16, 2027, about 11 weeks.” and a chip reading <strong>Sat, Mar 27 – Sun, Mar 28</strong>. The “Needed: Set the season’s first
                        and last day” line is gone, and <B>Next: Brackets & pools</B> can be pressed. Press it.
                    </Expect>
                    <Tip>
                        <strong>
                            {Units} used by one {t.match}
                        </strong>{" "}
                        is for {t.matches} that take more than one {t.unit} at once (a tennis team match playing three lines uses three courts). Leave it at 1 here.
                    </Tip>
                </Step>

                <Step n={3} id="t-brackets" title="Add the age brackets">
                    <p>
                        On the <B>Brackets & pools</B> step, press <B>Add bracket</B> three times and fill in:
                    </p>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[30rem] text-sm">
                            <thead className="text-left">
                                <tr className="border-b border-border">
                                    <th className="label py-1">Name</th>
                                    <th className="label py-1">Guaranteed {t.matches} per team</th>
                                    <th className="label py-1">Latest start</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                <tr>
                                    <td className="py-1.5 font-semibold">10U</td>
                                    <td>5</td>
                                    <td>05:30 PM</td>
                                </tr>
                                <tr>
                                    <td className="py-1.5 font-semibold">12U</td>
                                    <td>5</td>
                                    <td>06:30 PM</td>
                                </tr>
                                <tr>
                                    <td className="py-1.5 font-semibold">14U</td>
                                    <td>5</td>
                                    <td>leave blank (no limit)</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <p>
                        Press <B>Save bracket</B> after each.
                    </p>
                    <Expect>
                        three bracket cards. 10U reads “5 guaranteed {t.matches} per team · starts until 5:30 PM”. Each says “No teams yet.” Press <B>Next: Facilities</B>.
                    </Expect>
                </Step>

                <Step n={4} id="t-locations" title={`Add the facilities and their ${t.units}`}>
                    <ol>
                        <li>
                            On the <B>Facilities</B> step, press <B>Add facility</B>. <B>Facility name</B>: <strong>{fac1}</strong>. Add its real address in <B>Address</B> if you
                            like.
                        </li>
                        <li>
                            Under <B>{Units} at this facility</B>, <B>Starting from</B> already says <strong>{u(0)}</strong>. Set <B>How many</B> to <strong>3</strong> and press{" "}
                            <B>
                                Add {u(0)}, {u(1)}, {u(2)}
                            </B>
                            .
                        </li>
                        <li>
                            Optional map pin: press the <B>Search Google Maps for…</B> link, find the right place, press <strong>Share → Copy link</strong>, and paste it into the
                            map link box. Only Google Maps links are accepted.
                        </li>
                        <li>
                            Press <B>Save facility</B>. Then add a second facility, <strong>{fac2}</strong>, with <B>How many</B> at <strong>2</strong> ({u(0)}, {u(1)}).
                        </li>
                    </ol>
                    <Expect>
                        two facility cards: “3 {t.units}: {u(0)}, {u(1)}, {u(2)}” and “2 {t.units}: {u(0)}, {u(1)}”, each with a “Find on Google Maps” link and “0 weekly time
                        slots”. Press <B>Next: {Time}</B>.
                    </Expect>
                    <Tip>
                        Names can be anything: “Center {t.unit}”, “{u(0)}”, “Upper {t.unit}”. Use <B>Add</B> next to the single-name box for one-offs, rename a {t.unit} by typing
                        over its name, or remove it with ✕.
                    </Tip>
                </Step>

                <Step n={5} id="t-slots" title={`Add the weekly ${t.time}`}>
                    <p>
                        On the <B>{Time}</B> step, in <B>Add time slots</B>, add three batches. Choose the days, type the times and pick the facility. All its {t.units} start
                        selected under <B>{Units} free</B>. Then press <B>Add … slots</B>:
                    </p>
                    <ul>
                        <li>
                            <strong>Sat</strong> · times <code className="font-mono">9, 11, 1pm, 3pm</code> · {fac1} · all 3 {t.units} (3 {t.matches} at once) → 4 slots
                        </li>
                        <li>
                            <strong>Sun</strong> · times <code className="font-mono">12pm, 2pm</code> · {fac1} · all 3 {t.units} → 2 slots
                        </li>
                        <li>
                            <strong>Tue and Thu</strong> · times <code className="font-mono">5pm, 7pm</code> · {fac2} · both {t.units} (2 {t.matches} at once) → 4 slots
                        </li>
                    </ul>
                    <p className="text-sm text-muted">
                        Check the “Reads as:” line under the times box before adding. It shows how your typing was understood. Leave <B>Open to</B> empty so every bracket can use
                        these slots; bracket start limits still apply. Un-tick a {t.unit} if it isn’t free at that time.
                    </p>
                    <Expect>
                        a table of 10 weekly time slots with their {t.units} listed, and the line “26 {t.match} spots a week · … across the season · … {t.matches} needed.”
                    </Expect>
                </Step>

                <Step n={6} id="t-facility-sheet" title="Upload a facility spreadsheet">
                    <p>
                        {fac1} sent its exact April {t.time}, one row per {t.unit}. Download the sample:{" "}
                        <a className="font-semibold text-accent underline" href={`/tutorial/${file}.xlsx`} download>
                            {file}.xlsx
                        </a>{" "}
                        (or{" "}
                        <a className="text-accent underline" href={`/tutorial/${file}.csv`} download>
                            the CSV version
                        </a>
                        ). Its columns are Date, Start and {t.unitHeading}, with a “Tournament” and a “Reserved” closure. The .xlsx also has a title row above the headings.
                    </p>
                    <ol>
                        <li>
                            On the same <B>{Time}</B> step, under <B>Facility availability</B>, press <B>Upload a facility spreadsheet</B> and choose the file.
                        </li>
                        <li>
                            Check the guess: <B>Layout</B> <em>One row per time slot</em>; <B>Heading row</B> <em>Row 3</em> for the .xlsx (it has a title row) or <em>Row 1</em>{" "}
                            for the CSV; <B>{Units} column</B> <em>Column C</em>; and <B>Each row is</B> <em>One {t.unit}, by name</em>. If a facility’s spreadsheet is read
                            wrongly, change these and the result updates straight away.
                        </li>
                        <li>
                            Set <B>Location</B> to <strong>{fac1}</strong>.
                        </li>
                        <li>
                            Read <B>What was read</B>, then press <B>Import 12 time slots</B>.
                        </li>
                    </ol>
                    <Expect>
                        “<strong>12</strong> time slots on <strong>5</strong> dates, Sat, Apr 3, 2027 to Sat, Apr 24, 2027.” The table lists each time with its {t.units} (e.g. “
                        {u(0)}, {u(1)}, {u(2)}”) and the Tournament and Reserved rows show <strong>Closed</strong>. After importing: “Imported 12 {t.time} slots on 5 dates from{" "}
                        {file}.xlsx.” and a {short1} card under Facility availability.
                    </Expect>
                    <Tip>
                        On those 5 dates the spreadsheet <em>replaces</em> {short1}’s weekly {t.time}. On Sunday Apr 11 there’s 11:00 and 1:00 instead of the usual 12:00 and 2:00.
                        On Saturday Apr 10 only 9:00 is open, with {u(0)} and {u(1)}: the tournament closes 11:00, and 1:00 and 3:00 aren’t listed. Every other date keeps the
                        weekly pattern. The spreadsheet’s {t.unit} names match the ones you added in step 4, so no new ones appear (the <B>Facilities</B> step still lists three).
                        Press <B>Show dates</B> on the card to check.
                    </Tip>
                    <p>
                        Press <B>Next: Teams</B>.
                    </p>
                </Step>

                <Step n={7} id="t-teams" title="Add the teams">
                    <p>
                        On the <B>Teams</B> step, press <B>Paste a list instead</B>. Each line is <em>team name, pool, club</em>. Leave the pool blank (two commas) when the bracket
                        is one group. For each list: choose the bracket under <B>Bracket for all of these</B>, paste, and press <B>Add … teams</B>.
                    </p>
                    <p className="font-semibold">10U:</p>
                    <CopyBlock text={TEAMS_10U} />
                    <p className="font-semibold">12U (two pools, A and B):</p>
                    <CopyBlock text={TEAMS_12U} />
                    <p className="font-semibold">14U:</p>
                    <CopyBlock text={TEAMS_14U} />
                    <Expect>
                        <strong>Teams (18)</strong>, grouped by bracket, with 12U split into “Pool A · 4 teams” and “Pool B · 4 teams”. Back on the <B>Brackets & pools</B> step
                        (press it in the step list at the top), the 10U and 12U pools note that some opponents will be played twice. With only 3 other teams in a pool, 5{" "}
                        {t.matches} means repeats, spread as evenly as possible. Go back to <B>Teams</B> and press <B>Next: Requests</B>.
                    </Expect>
                    <Tip>
                        To add one team at a time, use the <B>Add a team</B> form. You can paste straight from a spreadsheet too, since tabs work the same as commas.
                    </Tip>
                </Step>

                <Step n={8} id="t-rules" title={`Enter the ${t.captains}’ requests`}>
                    <p>
                        On the <B>Requests</B> step, find each team, press <B>Add requests</B>, choose a rule from <B>Add a rule…</B>, press <B>Add rule</B>, fill it in, then{" "}
                        <B>Save team</B>:
                    </p>
                    <ol>
                        <li>
                            <strong>Riverside Hawks 12U</strong> (“can’t play more than once a weekend”): <em>{w("Max matches in one weekend")}</em> → 1, <B>Must</B>.
                        </li>
                        <li>
                            <strong>Lakeview Lightning 14U</strong> (“no more than 3 {t.matches} on Saturday/Sunday”): <em>{w("Max weekend matches all season")}</em> → 3,{" "}
                            <B>Must</B>.
                        </li>
                        <li>
                            <strong>Oak Hill Thunder 12U</strong> (shares a {t.captain} with Oak Hill Thunder 14U): <em>Not at the same time as other teams</em> → choose{" "}
                            <strong>Oak Hill Thunder 14U</strong>, <B>Must</B>.
                        </li>
                        <li>
                            <strong>Westfield Wolves 10U</strong> (spring break): <em>Unavailable dates</em> → From 04/10/2027 To 04/11/2027 → <B>Add dates</B>, <B>Must</B>.
                        </li>
                        <li>
                            <strong>Oak Hill Storm 12U</strong> (“we’d rather not play Tuesdays”): <em>Can’t play on certain days</em> → Tue, then switch it to <B>Prefer</B>.
                        </li>
                    </ol>
                    <Expect>
                        each team’s card shows its request as a chip, e.g. “At most 1 {t.match} per weekend” and, in amber, “Prefers: Not on Tuesdays”, and the note “5 of 18 teams
                        have requests.” Press <B>Next: Review & schedule</B>.
                    </Expect>
                    <Tip>
                        The sentence on the chip is exactly what the scheduler quotes if this rule ever stops a {t.match} being placed. Rules for a whole age group go on the
                        bracket instead (<B>Brackets & pools</B> → Edit → <em>Rules for every team in this bracket</em>). Later, outside setup, requests are on the <B>Teams</B> tab
                        under each team’s <B>Edit</B>.
                    </Tip>
                </Step>

                <Step n={9} id="t-generate" title="Generate the season">
                    <p>
                        On <B>Review & schedule</B>, the check at the top reads <strong>Ready to schedule</strong>. Notes (such as a facility with no address) don’t stop anything.
                        Leave <em>All brackets</em> selected and press <B>Generate schedule</B>. It takes a second or two. It tries many arrangements and keeps the best one.
                    </p>
                    <Expect>
                        <strong>{Matches} placed 45 of 45</strong>, <strong>Not placed 0</strong>, <strong>Break a must-rule 0</strong>, <strong>Teams short 0</strong> (“everyone’s
                        covered”), and the season listed by date from Sat, Mar 6. Each {t.match} names its {t.unit}: “{fac1} · {u(1)}”.
                    </Expect>
                    <p>
                        Press <B>Finish setup</B>. The league opens on its <B>Schedule</B> tab, with the other tabs beside it: <B>Teams</B>, <B>Brackets & pools</B>, <B>{tab}</B>{" "}
                        and <B>Season</B>. The rest of the tutorial uses these tabs.
                    </p>
                    <p>Check that the requests were respected:</p>
                    <ul>
                        <li>
                            Choose <strong>By team</strong> and open <strong>Riverside Hawks 12U</strong>: 5/5 {t.matches}, never two on the same weekend.
                        </li>
                        <li>
                            <strong>Westfield Wolves 10U</strong> has nothing on Apr 10–11; no 10U {t.match} starts after 5:30 PM.
                        </li>
                        <li>
                            <strong>{Unit} use</strong> shows every time with {t.matches} booked / {t.matches} at once. Nothing is over capacity, and Apr 10 at {short1} has only
                            9:00 AM, for 2.
                        </li>
                    </ul>
                </Step>

                <Step n={10} id="t-adjust" title="Adjust by hand">
                    <ol>
                        <li>
                            Choose <strong>By date</strong>, find a <strong>12U</strong> or <strong>14U</strong> {t.match} and press <B>Move</B>. (Not a 10U one: step 11
                            reschedules 10U, and a locked 10U {t.match} would stay put and change the numbers you’re told to expect there.)
                        </li>
                        <li>
                            The list shows every open time that fits <em>every</em> rule (amber lines miss a preference), with the {t.units} still free. Pick one, choose a {t.unit}{" "}
                            in the <B>{Unit}:</B> menu, and press <B>Move here and lock</B>.
                        </li>
                        <li>
                            Press <B>Regenerate schedule</B> and confirm. The locked {t.match} stays exactly where you put it, on the {t.unit} you chose, while the rest is rebuilt
                            around it.
                        </li>
                    </ol>
                    <Expect>
                        the moved {t.match} shows a <strong>Locked</strong> badge and its {t.unit} before and after regenerating, and the totals still read 45 of 45 and 0 must-rule
                        breaks.
                    </Expect>
                    <Tip>
                        To redo one age group only, pick it in the <B>Schedule</B> menu (e.g. “14U only”) before regenerating. In the Move dialog you can also{" "}
                        <B>Change {t.unit}</B> without changing the time, <B>Swap home/away</B>, or <B>Take off the schedule</B>.
                    </Tip>
                </Step>

                <Step n={11} id="t-problems" title="See how problems are explained (optional, 2 minutes)">
                    <p>Make the schedule impossible on purpose to see what {APP_NAME} tells you:</p>
                    <ol>
                        <li>
                            On <B>Brackets & pools</B>, edit <strong>10U</strong>, set <B>Latest start</B> to <strong>08:00 AM</strong>, and save.
                        </li>
                        <li>
                            On <B>Schedule</B>, choose <em>10U only</em> and press <B>Regenerate schedule</B>.
                        </li>
                    </ol>
                    <Expect>
                        <strong>Couldn’t place (10)</strong>. Each {t.match} lists its blockers, such as “10U can’t start after 8:00 AM (ruled out … times)”, with a fix (“Widen the
                        bracket’s earliest/latest start…”) and a <B>Go to Brackets & pools</B> button.
                    </Expect>
                    <p>
                        Put 10U’s latest start back to <strong>05:30 PM</strong> and regenerate 10U. You should be back to 45 of 45.
                    </p>
                </Step>

                <Step n={12} id="t-share" title="Share it and keep a backup">
                    <ul>
                        <li>
                            <B>Download CSV</B> on <B>Schedule</B> gives the whole season for Excel or Google Sheets: date, day, start, bracket, pool, home, away, facility,{" "}
                            {t.unit}, address and map link.
                        </li>
                        <li>
                            <B>Copy all team schedules</B>, or <B>Copy for the {t.captain}</B> on one team (in <strong>By team</strong>), copies text ready to paste into an email.
                        </li>
                        <li>
                            <B>Season</B> → <B>Download backup</B> saves the whole league to a file. <B>Replace from a backup…</B> or <em>New league → A backup file</em> brings it
                            back.
                        </li>
                    </ul>
                    <Expect>
                        a CSV with a header row and 45 {t.match} rows, each naming its {t.unit}, and a <em>…-backup.json</em> file.
                    </Expect>
                    <p>That’s a whole league. For your real season or tournament, follow the same steps with your dates, brackets, facilities and teams.</p>
                </Step>
            </article>
        </div>
    );
}
