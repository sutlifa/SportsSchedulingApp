"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import CopyBlock from "@/components/CopyBlock";
import { APP_NAME } from "@/lib/brand";
import { cap, isSportId, SPORT_IDS, SPORTS, sportText, type SportId, type Terms } from "@/lib/engine/sports";

/*
 * The guide is written against the app's exact labels ("Upload a facility
 * sheet", "Sheets free", "Games placed"), in whichever sport the reader picks.
 * scripts/e2e/tutorial.mjs drives the real UI through this tutorial word for
 * word -- same team lists, times, unit names and sample sheet -- in several
 * sports, and checks every "You should see". If a label or an expected
 * result here changes, change the script too, and run it.
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

const STORE_KEY = "seasonsmith.guide.sport";

function H2({ id, children }: { id: string; children: React.ReactNode }) {
    return (
        <h2 id={id} className="scroll-mt-24 border-b-4 border-ball pb-1 font-display text-3xl font-bold uppercase tracking-wide">
            {children}
        </h2>
    );
}

function H3({ id, children }: { id?: string; children: React.ReactNode }) {
    return (
        <h3 id={id} className="mt-8 scroll-mt-24 font-display text-2xl font-bold uppercase tracking-wide">
            {children}
        </h3>
    );
}

function Step({ n, title, id, children }: { n: number; title: string; id: string; children: React.ReactNode }) {
    return (
        <section id={id} className="card scroll-mt-24 p-5">
            <div className="flex items-baseline gap-3">
                <span className="font-display text-3xl font-bold text-accent tabular">{String(n).padStart(2, "0")}</span>
                <h3 className="font-display text-2xl font-bold uppercase tracking-wide">{title}</h3>
            </div>
            <div className="mt-3 grid gap-3 leading-relaxed [&_li]:mt-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6">{children}</div>
        </section>
    );
}

function Expect({ children }: { children: React.ReactNode }) {
    return (
        <div className="rounded-lg border border-ok/40 bg-ok-soft p-3 text-sm">
            <strong className="text-ok">You should see:</strong> {children}
        </div>
    );
}

function Tip({ children }: { children: React.ReactNode }) {
    return <div className="rounded-lg bg-surface-2 p-3 text-sm text-muted">{children}</div>;
}

/** A UI label, styled like the control it names. */
function B({ children }: { children: React.ReactNode }) {
    return <strong className="rounded bg-accent-soft px-1.5 py-0.5 font-semibold text-fg">{children}</strong>;
}

function ErrTable({ rows }: { rows: [string, string, string][] }) {
    return (
        <div className="my-3 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[40rem] text-sm">
                <thead className="bg-surface-2 text-left">
                    <tr>
                        <th className="label px-3 py-2">Message</th>
                        <th className="label px-3 py-2">What it means</th>
                        <th className="label px-3 py-2">How to fix it</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-border align-top">
                    {rows.map(([m, means, fix]) => (
                        <tr key={m}>
                            <td className="px-3 py-2 font-semibold">{m}</td>
                            <td className="px-3 py-2 text-muted">{means}</td>
                            <td className="px-3 py-2">{fix}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function SportPicker({ sport, onChange, id }: { sport: SportId; onChange: (s: SportId) => void; id: string }) {
    return (
        <label className="flex flex-wrap items-center gap-2 text-sm font-semibold" htmlFor={id}>
            Show this guide for
            <select id={id} className="input w-auto" value={sport} onChange={(e) => isSportId(e.target.value) && onChange(e.target.value)}>
                {SPORT_IDS.map((s) => (
                    <option key={s} value={s}>
                        {SPORTS[s].name}
                    </option>
                ))}
            </select>
        </label>
    );
}

const TOC: [string, string][] = [
    ["how-it-works", "How it works"],
    ["tutorial", "Tutorial: build a league start to finish"],
    ["facility-sheets", "Facility spreadsheets"],
    ["rules", "Team and bracket rules"],
    ["errors", "Errors and how to fix them"],
    ["faq", "Questions"],
];

export default function GuideContent() {
    // Rendered for soccer first (the server can't know the reader's choice),
    // then switched after mount to ?sport=… or the last sport picked here.
    // Reading the choice in the initializer would render differently on the
    // server and in the browser, which React reports as a hydration error.
    const [sport, setSport] = useState<SportId>("soccer");
    useEffect(() => {
        let wanted: string | null = null;
        try {
            wanted = new URLSearchParams(window.location.search).get("sport") ?? window.localStorage.getItem(STORE_KEY);
        } catch {
            // storage blocked: keep the default
        }
        if (isSportId(wanted)) {
            const next = wanted;
            void Promise.resolve().then(() => setSport(next));
        }
    }, []);
    const choose = (s: SportId) => {
        setSport(s);
        try {
            window.localStorage.setItem(STORE_KEY, s);
        } catch {
            // ignore
        }
    };
    const t: Terms = SPORTS[sport];
    return <Guide t={t} sport={sport} choose={choose} />;
}

function Guide({ t, sport, choose }: { t: Terms; sport: SportId; choose: (s: SportId) => void }) {
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
            <nav className="hidden lg:block" aria-label="Guide contents">
                <div className="sticky top-6 grid gap-1 text-sm">
                    <div className="label">On this page</div>
                    {TOC.map(([id, label]) => (
                        <a key={id} href={`#${id}`} className="rounded px-2 py-1 text-muted hover:bg-surface-2 hover:text-fg">
                            {label}
                        </a>
                    ))}
                </div>
            </nav>

            <article className="grid min-w-0 gap-10">
                <header className="grid gap-4">
                    <h1 className="font-display text-5xl font-bold uppercase tracking-wide">{APP_NAME} guide</h1>
                    <p className="max-w-2xl text-lg text-muted">
                        {APP_NAME} builds a whole season, or a tournament’s pool play, from your brackets, facilities, {t.time} and every team’s requests, and then
                        lets you adjust it by hand. The tutorial builds a complete {t.name.toLowerCase()} league in about 20 minutes, with a sample facility
                        spreadsheet to practise on.
                    </p>
                    <div className="card flex flex-wrap items-center justify-between gap-3 border-accent/40 bg-accent-soft p-3">
                        <SportPicker sport={sport} onChange={choose} id="guide-sport" />
                        <span className="text-sm text-muted">
                            The guide uses {t.name.toLowerCase()} words: {t.time}, {t.units} ({u(0)}, {u(1)}…), {t.matches}, {t.captains}.
                        </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <a href="#tutorial" className="btn-primary">
                            Start the tutorial
                        </a>
                        <a href="#errors" className="btn-secondary">
                            Look up an error
                        </a>
                        <Link href="/" className="btn-ghost">
                            Your leagues
                        </Link>
                    </div>
                    <ol className="flex flex-wrap gap-2 text-sm lg:hidden">
                        {TOC.map(([id, label]) => (
                            <li key={id}>
                                <a href={`#${id}`} className="chip bg-surface-2 text-fg">
                                    {label}
                                </a>
                            </li>
                        ))}
                    </ol>
                </header>

                {/* ------------------------------------------------------------------ */}
                <section className="grid gap-4">
                    <H2 id="how-it-works">How it works</H2>
                    <p className="max-w-3xl">
                        A <strong>league</strong> is one season or one tournament, in one sport. You describe it once and {APP_NAME} does the pairing and the
                        timetabling. A new league starts in <strong>guided setup</strong>: eight steps (name & sport, season, brackets & pools, facilities,{" "}
                        {t.time}, teams, requests, review & schedule), each checked as you go, so that by the end everything a full schedule needs is in place.
                        After that, each part has its own tab inside the league:
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {(
                            [
                                ["Season", `The sport, first and last day, blackout dates, and league-wide limits like ${t.matches} per day and ${t.units} per ${t.match}.`],
                                ["Brackets & pools", `Age groups (10U, 12U…), how many ${t.matches} each team is guaranteed, and start-time limits such as “10U never after 5:30 PM”.`],
                                [tab, `Your facilities and their ${t.units} (${u(0)}, ${u(1)}…), the weekly ${t.time}, and facility spreadsheets for specific dates.`],
                                ["Teams", `Every team with its bracket, pool and club, plus the ${t.captain}’s requests as rules.`],
                                ["Schedule", `Generate the season, see problems with their fixes, move and lock ${t.matches}, and export for ${t.captains}.`],
                            ] as const
                        ).map(([name, what]) => (
                            <div key={name} className="card p-4">
                                <div className="font-display text-xl font-bold uppercase">{name}</div>
                                <p className="mt-1 text-sm text-muted">{what}</p>
                            </div>
                        ))}
                    </div>
                    <H3>Words used in the app</H3>
                    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                        {(
                            [
                                ["Sport", `Chosen when you create a league (and changeable on Season). It sets the words: ${t.time}, ${t.units}, ${t.matches}, ${t.captains}.`],
                                ["Bracket", "An age group or division. Teams only ever play teams in their own bracket."],
                                ["Pool", "A group inside a bracket. Teams only play teams in their own pool. Leave it blank if the bracket is one group."],
                                [`Guaranteed ${t.matches}`, `How many ${t.matches} every team gets against its pool (5 by default). Teams don’t have to play every week.`],
                                ["Facility", `A building or site: ${fac1}. Add the address and a Google Maps pin so families can find it.`],
                                [Units, `The named playing areas inside a facility: ${u(0)}, ${u(1)}… Each ${t.match} is given one, and schedules say which.`],
                                [`Weekly ${t.time}`, `A start time that repeats every week at a facility, with which ${t.units} are free: “Saturdays 9:00 AM, ${u(0)}–${u(2)}”.`],
                                ["Facility sheet", `A spreadsheet from a facility listing exact dates, times and ${t.units}. For the dates it covers, it replaces the weekly ${t.time}.`],
                                ["Must / Prefer", `A Must rule is never broken by the scheduler. A Prefer rule is avoided, but broken if that’s the only way to fit a ${t.match}.`],
                                ["Lock", `A locked ${t.match} stays put when you regenerate. Moving a ${t.match} by hand locks it.`],
                            ] as const
                        ).map(([term, d]) => (
                            <div key={term}>
                                <dt className="font-semibold">{term}</dt>
                                <dd className="text-sm text-muted">{d}</dd>
                            </div>
                        ))}
                    </dl>
                </section>

                {/* ------------------------------------------------------------------ */}
                <section className="grid gap-4">
                    <H2 id="tutorial">Tutorial: build a league start to finish</H2>
                    <div className="card flex flex-wrap items-center gap-3 p-3">
                        <SportPicker sport={sport} onChange={choose} id="guide-sport-tutorial" />
                        <span className="text-sm text-muted">Every step below, and the sample spreadsheet, follows this choice.</span>
                    </div>
                    <p className="max-w-3xl">
                        You’ll build <strong>Spring 2027 Youth {t.name}</strong>: three brackets, 18 teams, two facilities with named {t.units}, weekly {t.time}, one
                        facility spreadsheet and five {t.captain} requests. Use these exact values the first time; every step tells you what you should see. Then
                        build your real league the same way, or delete this one from <B>Season</B>.
                    </p>
                    <Tip>
                        Changes save automatically. The top-right corner of a league says <B>Saved</B> (or <B>Saved in this browser</B> if the site isn’t
                        connected to its database). You only press Save inside pop-up editors.
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
                            the setup wizard, on <strong>1. Name & sport</strong> (“Step 1 of 8”), with a <strong>{t.name}</strong> label next to the league’s name
                            and the line “This league talks about {t.units} ({u(0)}, {u(1)}), {t.time}, {t.matches} and {t.captains}.” Press{" "}
                            <B>Next: Season</B>.
                        </Expect>
                        <Tip>
                            Every step lists what’s <strong>Needed</strong> (<B>Next</B> stays greyed out until it’s done), what to <strong>Check</strong>, and{" "}
                            <strong>Notes</strong>. The step list at the top jumps to any step. <B>Exit setup</B> opens the full editor at any time, and its{" "}
                            <B>Setup guide</B> button brings you back to the first step still missing something.
                        </Tip>
                    </Step>

                    <Step n={2} id="t-season" title="Set the season dates">
                        <ol>
                            <li>
                                On the <B>Season</B> step, set <B>First day</B> to <strong>03/06/2027</strong> and <B>Last day</B> to <strong>05/16/2027</strong>.
                            </li>
                            <li>
                                Under <B>Blackout dates</B>, set <B>From</B> 03/27/2027 and <B>To (optional)</B> 03/28/2027 (Easter weekend), then press{" "}
                                <B>Add dates</B>.
                            </li>
                            <li>
                                Under <B>League-wide rules</B>, set <B>Same club at the same time</B> to <strong>2</strong>, “where possible”. Leave the rest as they
                                are.
                            </li>
                        </ol>
                        <Expect>
                            “Sat, Mar 6, 2027 to Sun, May 16, 2027, about 11 weeks.” and a chip reading <strong>Sat, Mar 27 – Sun, Mar 28</strong>. The
                            “Needed: Set the season’s first and last day” line is gone, and <B>Next: Brackets & pools</B> can be pressed. Press it.
                        </Expect>
                        <Tip>
                            <strong>
                                {Units} used by one {t.match}
                            </strong>{" "}
                            is for {t.matches} that take more than one {t.unit} at once (a tennis team match playing three lines uses three courts). Leave it at 1
                            here.
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
                            three bracket cards. 10U reads “5 guaranteed {t.matches} per team · starts until 5:30 PM”. Each says “No teams yet.” Press{" "}
                            <B>Next: Facilities</B>.
                        </Expect>
                    </Step>

                    <Step n={4} id="t-locations" title={`Add the facilities and their ${t.units}`}>
                        <ol>
                            <li>
                                On the <B>Facilities</B> step, press <B>Add facility</B>. <B>Facility name</B>: <strong>{fac1}</strong>. Add its real address in <B>Address</B>{" "}
                                if you like.
                            </li>
                            <li>
                                Under <B>
                                    {Units} at this facility
                                </B>
                                , <B>Starting from</B> already says <strong>{u(0)}</strong>. Set <B>How many</B> to <strong>3</strong> and press{" "}
                                <B>
                                    Add {u(0)}, {u(1)}, {u(2)}
                                </B>
                                .
                            </li>
                            <li>
                                Optional map pin: press the <B>Search Google Maps for…</B> link, find the right place, press <strong>Share → Copy link</strong>,
                                and paste it into the map link box. Only Google Maps links are accepted.
                            </li>
                            <li>
                                Press <B>Save facility</B>. Then add a second facility, <strong>{fac2}</strong>, with <B>How many</B> at <strong>2</strong> (
                                {u(0)}, {u(1)}).
                            </li>
                        </ol>
                        <Expect>
                            two facility cards: “3 {t.units}: {u(0)}, {u(1)}, {u(2)}” and “2 {t.units}: {u(0)}, {u(1)}”, each with a “Find on Google Maps” link
                            and “0 weekly time slots”. Press <B>Next: {Time}</B>.
                        </Expect>
                        <Tip>
                            Names can be anything: “Center {t.unit}”, “{u(0)}”, “Upper {t.unit}”. Use <B>Add</B> next to the single-name box for one-offs, rename
                            a {t.unit} by typing over its name, or remove it with ✕.
                        </Tip>
                    </Step>

                    <Step n={5} id="t-slots" title={`Add the weekly ${t.time}`}>
                        <p>
                            On the <B>{Time}</B> step, in <B>Add time slots</B>, add three batches. Choose the days, type the times and pick the facility. All its {t.units}{" "}
                            start selected under <B>{Units} free</B>. Then press <B>Add … slots</B>:
                        </p>
                        <ul>
                            <li>
                                <strong>Sat</strong> · times <code className="font-mono">9, 11, 1pm, 3pm</code> · {fac1} · all 3 {t.units} (3 {t.matches} at once) →
                                4 slots
                            </li>
                            <li>
                                <strong>Sun</strong> · times <code className="font-mono">12pm, 2pm</code> · {fac1} · all 3 {t.units} → 2 slots
                            </li>
                            <li>
                                <strong>Tue and Thu</strong> · times <code className="font-mono">5pm, 7pm</code> · {fac2} · both {t.units} (2 {t.matches} at once) →
                                4 slots
                            </li>
                        </ul>
                        <p className="text-sm text-muted">
                            Check the “Reads as:” line under the times box before adding. It shows how your typing was understood. Leave <B>Open to</B> empty so
                            every bracket can use these slots; bracket start limits still apply. Un-tick a {t.unit} if it isn’t free at that time.
                        </p>
                        <Expect>
                            a table of 10 weekly time slots with their {t.units} listed, and the line “26 {t.match} spots a week · … across the season · … {t.matches}{" "}
                            needed.”
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
                            ). Its columns are Date, Start and {t.unitHeading}, with a “Tournament” and a “Reserved” closure. The .xlsx also has a title row above
                            the headings.
                        </p>
                        <ol>
                            <li>
                                On the same <B>{Time}</B> step, under <B>Facility availability</B>, press <B>Upload a facility spreadsheet</B> and choose the
                                file.
                            </li>
                            <li>
                                Check the guess: <B>Layout</B> <em>One row per time slot</em>; <B>Heading row</B> <em>Row 3</em> for the .xlsx (it has a title
                                row) or <em>Row 1</em> for the CSV; <B>{Units} column</B> <em>Column C</em>; and <B>Each row is</B>{" "}
                                <em>
                                    One {t.unit}, by name
                                </em>
                                . If a facility’s spreadsheet is read wrongly, change these and the result updates straight away.
                            </li>
                            <li>
                                Set <B>Location</B> to <strong>{fac1}</strong>.
                            </li>
                            <li>
                                Read <B>What was read</B>, then press <B>Import 12 time slots</B>.
                            </li>
                        </ol>
                        <Expect>
                            “<strong>12</strong> time slots on <strong>5</strong> dates, Sat, Apr 3, 2027 to Sat, Apr 24, 2027.” The table lists each time with its{" "}
                            {t.units} (e.g. “{u(0)}, {u(1)}, {u(2)}”) and the Tournament and Reserved rows show <strong>Closed</strong>. After importing: “Imported
                            12 {t.time} slots on 5 dates from {file}.xlsx.” and a {short1} card under Facility availability.
                        </Expect>
                        <Tip>
                            On those 5 dates the spreadsheet <em>replaces</em> {short1}’s weekly {t.time}. On Sunday Apr 11 there’s 11:00 and 1:00 instead of the usual
                            12:00 and 2:00. On Saturday Apr 10 only 9:00 is open, with {u(0)} and {u(1)}: the tournament closes 11:00, and 1:00 and 3:00 aren’t
                            listed. Every other date keeps the weekly pattern. The spreadsheet’s {t.unit} names match the ones you added in step 4, so no new ones
                            appear (the <B>Facilities</B> step still lists three). Press <B>Show dates</B> on the card to check.
                        </Tip>
                        <p>
                            Press <B>Next: Teams</B>.
                        </p>
                    </Step>

                    <Step n={7} id="t-teams" title="Add the teams">
                        <p>
                            On the <B>Teams</B> step, press <B>Paste a list instead</B>. Each line is <em>team name, pool, club</em>. Leave the pool blank (two commas) when
                            the bracket is one group. For each list: choose the bracket under <B>Bracket for all of these</B>, paste, and press <B>Add … teams</B>.
                        </p>
                        <p className="font-semibold">10U:</p>
                        <CopyBlock text={TEAMS_10U} />
                        <p className="font-semibold">12U (two pools, A and B):</p>
                        <CopyBlock text={TEAMS_12U} />
                        <p className="font-semibold">14U:</p>
                        <CopyBlock text={TEAMS_14U} />
                        <Expect>
                            <strong>Teams (18)</strong>, grouped by bracket, with 12U split into “Pool A · 4 teams” and “Pool B · 4 teams”. Back on the{" "}
                            <B>Brackets & pools</B> step (press it in the step list at the top), the 10U and 12U pools note that some opponents will be played
                            twice. With only 3 other teams in a pool, 5 {t.matches} means repeats, spread as evenly as possible. Go back to <B>Teams</B> and press{" "}
                            <B>Next: Requests</B>.
                        </Expect>
                        <Tip>
                            To add one team at a time, use the <B>Add a team</B> form. You can paste straight from a spreadsheet too, since tabs work the same as
                            commas.
                        </Tip>
                    </Step>

                    <Step n={8} id="t-rules" title={`Enter the ${t.captains}’ requests`}>
                        <p>
                            On the <B>Requests</B> step, find each team, press <B>Add requests</B>, choose a rule from <B>Add a rule…</B>, press <B>Add rule</B>,
                            fill it in, then <B>Save team</B>:
                        </p>
                        <ol>
                            <li>
                                <strong>Riverside Hawks 12U</strong> (“can’t play more than once a weekend”): <em>{w("Max matches in one weekend")}</em> → 1,{" "}
                                <B>Must</B>.
                            </li>
                            <li>
                                <strong>Lakeview Lightning 14U</strong> (“no more than 3 {t.matches} on Saturday/Sunday”):{" "}
                                <em>{w("Max weekend matches all season")}</em> → 3, <B>Must</B>.
                            </li>
                            <li>
                                <strong>Oak Hill Thunder 12U</strong> (shares a {t.captain} with Oak Hill Thunder 14U): <em>Not at the same time as other teams</em> →
                                choose <strong>Oak Hill Thunder 14U</strong>, <B>Must</B>.
                            </li>
                            <li>
                                <strong>Westfield Wolves 10U</strong> (spring break): <em>Unavailable dates</em> → From 04/10/2027 To 04/11/2027 → <B>Add dates</B>,{" "}
                                <B>Must</B>.
                            </li>
                            <li>
                                <strong>Oak Hill Storm 12U</strong> (“we’d rather not play Tuesdays”): <em>Can’t play on certain days</em> → Tue, then switch it to{" "}
                                <B>Prefer</B>.
                            </li>
                        </ol>
                        <Expect>
                            each team’s card shows its request as a chip, e.g. “At most 1 {t.match} per weekend” and, in amber, “Prefers: Not on Tuesdays”, and
                            the note “5 of 18 teams have requests.” Press <B>Next: Review & schedule</B>.
                        </Expect>
                        <Tip>
                            The sentence on the chip is exactly what the scheduler quotes if this rule ever stops a {t.match} being placed. Rules for a whole age
                            group go on the bracket instead (<B>Brackets & pools</B> → Edit → <em>Rules for every team in this bracket</em>). Later, outside setup,
                            requests are on the <B>Teams</B> tab under each team’s <B>Edit</B>.
                        </Tip>
                    </Step>

                    <Step n={9} id="t-generate" title="Generate the season">
                        <p>
                            On <B>Review & schedule</B>, the check at the top reads <strong>Ready to schedule</strong>. Notes (such as a facility with no address)
                            don’t stop anything. Leave <em>All brackets</em> selected and press <B>Generate schedule</B>. It takes a second or two. It tries many
                            arrangements and keeps the best one.
                        </p>
                        <Expect>
                            <strong>
                                {Matches} placed 45 of 45
                            </strong>
                            , <strong>Not placed 0</strong>, <strong>Break a must-rule 0</strong>, <strong>Teams short 0</strong> (“everyone’s covered”), and the
                            season listed by date from Sat, Mar 6. Each {t.match} names its {t.unit}: “{fac1} · {u(1)}”.
                        </Expect>
                        <p>
                            Press <B>Finish setup</B>. The league opens on its <B>Schedule</B> tab, with the other tabs beside it: <B>Teams</B>,{" "}
                            <B>Brackets & pools</B>, <B>{tab}</B> and <B>Season</B>. The rest of the tutorial uses these tabs.
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
                                <strong>{Unit} use</strong> shows every time with {t.matches} booked / {t.matches} at once. Nothing is over capacity, and Apr 10 at{" "}
                                {short1} has only 9:00 AM, for 2.
                            </li>
                        </ul>
                    </Step>

                    <Step n={10} id="t-adjust" title="Adjust by hand">
                        <ol>
                            <li>
                                Choose <strong>By date</strong>, find a <strong>12U</strong> or <strong>14U</strong> {t.match} and press <B>Move</B>. (Not a 10U
                                one: step 11 reschedules 10U, and a locked 10U {t.match} would stay put and change the numbers you’re told to expect there.)
                            </li>
                            <li>
                                The list shows every open time that fits <em>every</em> rule (amber lines miss a preference), with the {t.units} still free. Pick
                                one, choose a {t.unit} in the <B>{Unit}:</B> menu, and press <B>Move here and lock</B>.
                            </li>
                            <li>
                                Press <B>Regenerate schedule</B> and confirm. The locked {t.match} stays exactly where you put it, on the {t.unit} you chose, while
                                the rest is rebuilt around it.
                            </li>
                        </ol>
                        <Expect>
                            the moved {t.match} shows a <strong>Locked</strong> badge and its {t.unit} before and after regenerating, and the totals still read 45
                            of 45 and 0 must-rule breaks.
                        </Expect>
                        <Tip>
                            To redo one age group only, pick it in the <B>Schedule</B> menu (e.g. “14U only”) before regenerating. In the Move dialog you can
                            also <B>Change {t.unit}</B> without changing the time, <B>Swap home/away</B>, or <B>Take off the schedule</B>.
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
                            <strong>Couldn’t place (10)</strong>. Each {t.match} lists its blockers, such as “10U can’t start after 8:00 AM (ruled out … times)”,
                            with a fix (“Widen the bracket’s earliest/latest start…”) and a <B>Go to Brackets & pools</B> button.
                        </Expect>
                        <p>
                            Put 10U’s latest start back to <strong>05:30 PM</strong> and regenerate 10U. You should be back to 45 of 45.
                        </p>
                    </Step>

                    <Step n={12} id="t-share" title="Share it and keep a backup">
                        <ul>
                            <li>
                                <B>Download CSV</B> on <B>Schedule</B> gives the whole season for Excel or Google Sheets: date, day, start, bracket, pool, home,
                                away, facility, {t.unit}, address and map link.
                            </li>
                            <li>
                                <B>Copy all team schedules</B>, or <B>Copy for the {t.captain}</B> on one team (in <strong>By team</strong>), copies text ready to
                                paste into an email.
                            </li>
                            <li>
                                <B>Season</B> → <B>Download backup</B> saves the whole league to a file. <B>Replace from a backup…</B> or{" "}
                                <em>New league → A backup file</em> brings it back.
                            </li>
                        </ul>
                        <Expect>
                            a CSV with a header row and 45 {t.match} rows, each naming its {t.unit}, and a <em>…-backup.json</em> file.
                        </Expect>
                        <p>That’s a whole league. For your real season or tournament, follow the same steps with your dates, brackets, facilities and teams.</p>
                    </Step>
                </section>

                {/* ------------------------------------------------------------------ */}
                <section className="grid gap-3">
                    <H2 id="facility-sheets">Facility spreadsheets</H2>
                    <p className="max-w-3xl">
                        Facilities send their {t.time} in different layouts. {APP_NAME} reads <strong>.xlsx</strong> (Excel; Google Sheets → Download → Microsoft
                        Excel), <strong>.csv</strong>, or cells copied from a spreadsheet and pasted into the upload box. Old <strong>.xls</strong> files need to be
                        saved again as .xlsx or .csv first.
                    </p>
                    <H3>Layouts it understands</H3>
                    <ul className="list-disc pl-6">
                        <li>
                            <strong>One row per time slot</strong>: Date | Start time | {Units} (a number) | Location. A date written once and left blank below it
                            carries down, and merged date cells are fine.
                        </li>
                        <li>
                            <strong>
                                One row per {t.unit}
                            </strong>
                            : Date | Start | {t.unitHeading} (“{u(0)}”, “{u(1)}”). The {t.units} at the same date and time are counted, and their names are added to
                            the facility. A column headed “{t.unitHeading}” or “{t.unitHeading} #” is read this way, and the dialog says so.
                        </li>
                        <li>
                            <strong>Grid</strong>: dates down the side and start times across the top, or the other way round, with a number of {t.units} in each
                            cell.
                        </li>
                    </ul>
                    <H3>How cells are read</H3>
                    <ul className="list-disc pl-6">
                        <li>Dates: 3/6, Sat 3/6, March 6, 2027-03-06, real Excel dates. With no year, the year that falls in your season is used.</li>
                        <li>Times: 9, 9:00, 9am, 13:30, 0930, and ranges like 6-8pm (the start time is used).</li>
                        <li>
                            {Units}: 4, “4 {t.units}”, “{Units} 1-4” (4), “1, 2, 5” (3), or names like “{u(0)}”. “3 (1 held for lessons)” reads as 3: a leading number
                            wins.
                        </li>
                        <li>
                            <strong>Closed</strong> (nothing free): a dash, x, closed, none, or a cell starting with Reserved, Unavailable, Tournament, Blocked,
                            Maintenance, Private, Lessons, Camp, Clinic, Event, Hold or Rain. A {t.unit}’s own name like “Clinic {Unit}” still counts as a {t.unit}.
                        </li>
                    </ul>
                    <H3>What an import changes</H3>
                    <p className="max-w-3xl">
                        For each facility and date in the file, the uploaded times <strong>replace</strong> that facility’s weekly {t.time} on that date. Other
                        dates keep the weekly pattern, and blackout dates still win. Importing again only replaces the dates in the new file, so monthly spreadsheets
                        can be imported one after another. {Matches} already booked into those times stay attached, on the same {t.unit} where it’s still free. <B>Remove upload</B> on a facility’s card
                        goes back to its weekly {t.time}.
                    </p>
                </section>

                {/* ------------------------------------------------------------------ */}
                <section className="grid gap-3">
                    <H2 id="rules">Team and bracket rules</H2>
                    <p className="max-w-3xl">
                        Add rules to a team (<B>Teams</B> → Edit) or to a whole bracket. Each can be <strong>Must</strong> (never broken by the scheduler) or{" "}
                        <strong>Prefer</strong> (avoided where possible).
                    </p>
                    <div className="overflow-x-auto rounded-lg border border-border">
                        <table className="w-full min-w-[36rem] text-sm">
                            <thead className="bg-surface-2 text-left">
                                <tr>
                                    <th className="label px-3 py-2">Rule</th>
                                    <th className="label px-3 py-2">{cap(t.captain)} says…</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {(
                                    [
                                        ["Max matches in one weekend", "“Can’t play more than once a weekend.” → 1"],
                                        ["Max weekend matches all season", "“No more than 3 matches on Sat/Sun.” → 3"],
                                        ["Max matches in one week", "“Only one match a week.” (Mon–Sun)"],
                                        ["Max matches on one weekday, all season", "“At most 2 Sunday matches.”"],
                                        ["Can’t play on certain days", "“Never on Tuesdays.”"],
                                        ["Can only play on certain days", "“Weekends only.”"],
                                        ["Unavailable dates", "“Spring break, Apr 10–11.”"],
                                        ["Can’t start later than / earlier than", "“Nothing after 6 PM.” / “Not before 10.”"],
                                        ["Only at / Not at certain locations", "“Home facility only.” / “Not at Lakeview.”"],
                                        ["Days between matches", "“At least 3 days apart.”"],
                                        ["Not at the same time as other teams", "Shared coach or siblings. Works both ways automatically."],
                                        ["Not on the same day as other teams", "Same, for whole days."],
                                        ["Other request (note only)", "Anything else. Kept with the team for you; the scheduler doesn’t act on it."],
                                    ] as const
                                ).map(([r, e]) => (
                                    <tr key={r}>
                                        <td className="px-3 py-2 font-semibold">{w(r)}</td>
                                        <td className="px-3 py-2 text-muted">{w(e)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <p className="text-sm text-muted">
                        League-wide limits live on <B>Season</B>: max {t.matches} per team per day, {t.match} length (starts closer together than this count as
                        overlapping), {t.units} used by one {t.match}, and how many of one club’s {t.matches} may be on at the same time.
                    </p>
                </section>

                {/* ------------------------------------------------------------------ */}
                <section className="grid gap-3">
                    <H2 id="errors">Errors and how to fix them</H2>
                    <p className="max-w-3xl">
                        {APP_NAME} always says what went wrong and what to do. Problems on the <B>Schedule</B> tab come with a <em>Fix</em> line and a button to
                        the tab where you make the change. Messages that end in <strong>(Reference ABC123)</strong> came from the server: send that code to whoever
                        runs the site, as it points to the exact entry in the server log.
                    </p>

                    <H3 id="errors-scheduling">{Matches} that couldn’t be placed</H3>
                    <p className="max-w-3xl">
                        A {t.match} is left unplaced rather than break a <strong>Must</strong> rule. For each one, {APP_NAME} checks every open time in the season
                        and lists the reasons that ruled out the most times.
                    </p>
                    <ErrTable
                        rows={[
                            [`Every ${t.unit} is already booked at that time`, "Every time that otherwise fits is full.", `Add weekly ${t.time}, add ${t.units} to a slot, or upload more facility availability (${tab}).`],
                            ["This time slot isn’t open to 12U", "Slots are reserved for other brackets via “Open to”.", `Edit a slot and add 12U, or add slots for 12U (${tab}).`],
                            ["10U can’t start after 5:30 PM", "The bracket’s start window excludes the open times.", "Widen Earliest/Latest start, or add slots inside the window (Brackets & pools)."],
                            ["14U doesn’t play on Tuesdays", "The bracket’s “Plays on” days exclude these times.", "Add the day, or add slots on the bracket’s days (Brackets & pools)."],
                            ["Lakeview Lightning 14U already plays that day", `The team’s other ${t.matches} use up the open days.`, `Add more dates or slots, or raise “Max ${t.matches} per team per day” (Season).`],
                            [`Riverside Hawks 12U: At most 1 ${t.match} per weekend`, "That team’s own rule rules the times out.", "Loosen the rule, switch it to Prefer, or add slots that fit it (Teams)."],
                            ["Oak Hill Thunder 12U: not at the same time as Oak Hill Thunder 14U", "Two linked teams compete for the same times.", "Switch the rule to Prefer, or add slots at other times (Teams)."],
                            [`More than 2 Riverside ${t.matches} at the same time`, "The club limit (set to “always”) keeps the club’s teams apart.", "Raise the limit or set it to “where possible” (Season)."],
                            ["There are no time slots in the season to put it in", "No dates or slots exist.", `Check First/Last day, then add weekly ${t.time} or upload a facility spreadsheet.`],
                        ]}
                    />
                    <H3>Warnings from the last run</H3>
                    <ErrTable
                        rows={[
                            [`X gets 4 of 5 ${t.matches}: … has an odd total`, `Teams × ${t.matches} in a pool is odd, so one ${t.match} can’t be paired.`, `Add or remove a team, or give one team one ${t.match} more or fewer.`],
                            ["X is the only team in 10U · Pool B", "A pool of one has nobody to play.", "Move the team to another pool, or add a team to its pool (Teams)."],
                            ["X isn’t in an age bracket", "Its bracket was deleted.", "Edit the team and choose a bracket."],
                            ["There are no open time slots in the season", "Season dates or slots are missing.", `Set the season dates and add weekly ${t.time}.`],
                        ]}
                    />
                    <H3>Flags on placed {t.matches}</H3>
                    <ErrTable
                        rows={[
                            ["Breaks: …", "A Must rule is broken, usually after a hand move or after rules or facilities changed.", "Press Move: the list shows times that fit every rule. Or regenerate."],
                            ["Misses preference: …", "A Prefer rule couldn’t be kept.", `Usually fine. Move the ${t.match} if it matters.`],
                            [
                                `Breaks: ${u(1)} has two ${t.matches} at once`,
                                `Two ${t.matches} hold the same ${t.unit}. ${APP_NAME} never does this itself, and sorts it out on the next change to a facility or its times, so it only shows in a schedule saved by an earlier version or restored from an old backup.`,
                                `Use “Change ${t.unit}” in the Move dialog, or regenerate.`,
                            ],
                            [
                                `Misses preference: No ${t.unit} assigned: every ${t.unit} is booked at that time`,
                                `A ${t.unit} was removed from the facility or the slot, or “${Units} used by one ${t.match}” went up, and no free ${t.unit} is left at that time. (Where one is free, the ${t.match} moves to it by itself.)`,
                                `Add a ${t.unit} to that slot, lower “${Units} used by one ${t.match}”, or move the ${t.match} to a time with a free ${t.unit} (${tab}).`,
                            ],
                            [`Misses preference: ${u(2)} isn’t listed as free at that time`, `The ${t.unit} was taken out of that slot or that date’s uploaded availability.`, `Move the ${t.match} to a free ${t.unit}, or regenerate.`],
                            [`Breaks: The facility’s spreadsheet has no ${t.time} then`, "A newer facility spreadsheet doesn’t include this time (or marks it closed).", `Move the ${t.match}, or upload a corrected file.`],
                            ["Breaks: Its location was deleted", "The facility was removed.", `Move the ${t.match} or regenerate.`],
                            ["Misses preference: This time is no longer in the weekly slots…", "Its weekly slot was changed or removed.", "Move it to a current time."],
                        ]}
                    />

                    <H3 id="errors-import">Facility spreadsheet messages</H3>
                    <ErrTable
                        rows={[
                            ["This doesn’t look like an Excel (.xlsx) file.", "The file isn’t a real .xlsx (renamed, or another format).", "Open it in Excel or Google Sheets and save/download as .xlsx or .csv."],
                            ["That’s the old .xls format.", "Excel 97–2003 files can’t be read.", "File → Save As → Excel Workbook (.xlsx) or CSV."],
                            ["Nothing could be read with these settings.", "The layout or columns were guessed wrong.", "Change Layout, Heading row and the column choices; the preview updates."],
                            ["Row 12: Couldn’t read the date “…”", "That cell isn’t a date (often a note or a typo).", "Usually ignore it, or fix the cell and upload again."],
                            ["Row 12: Couldn’t read how many are free: “…”", `The ${t.units} cell has no number and isn’t a closed word or a ${t.unit} name.`, "Fix the cell, or check the column choice."],
                            ["Row 12: Nothing listed as free", `The ${t.units} cell is empty on a row that has a date and time.`, "Fill it in, or ignore the row."],
                            [`Reading each row as one ${t.unit}`, `The ${t.units} column holds names, so ${t.units} at the same time are counted.`, `If it’s really a number of ${t.units}, change “Each row is”.`],
                            ["N repeated date/time rows: the last one wins", "The same date and time appears more than once.", `Check the preview. For separate ${t.units} per row, choose “One ${t.unit}, by name”.`],
                            ["N of these fall outside the season dates", "Dates before the first or after the last day.", "They’re kept but unused; widen the season to use them."],
                        ]}
                    />

                    <H3 id="errors-saving">Saving</H3>
                    <ErrTable
                        rows={[
                            ["Saved / Saved in this browser", "All changes are stored (in your account, or only in this browser if the site isn’t connected to its database).", "Nothing."],
                            ["Unsaved changes… / Saving…", "A save is about to happen or is under way.", "Wait a moment before closing the page."],
                            ["Not saved: changed elsewhere", "The league was saved from another tab or device after you opened it. Nothing is overwritten silently.", "Choose “Load their version (drop mine)” or “Keep mine (replace theirs)”. “Download my version” keeps a copy first."],
                            ["Not saved yet: You’ve been signed out…", "Your sign-in expired.", "Sign in again in another tab; your changes stay on screen and retry."],
                            ["Not saved yet: The server is busy or restarting (error 503)", "A temporary server problem.", "Nothing; it retries every few seconds. Download a backup if it lasts."],
                            ["Couldn’t save … (Reference ABC123)", "A server error.", "It retries. Every change is also kept in this browser; send the reference code if it lasts."],
                            ["This league is too large to save.", "Over the size limit (thousands of teams).", "Split the season into two leagues."],
                            ["Saved in this browser only (yellow banner)", "The site isn’t connected to its database. The banner lists the missing settings.", "Whoever runs the site adds them in Vercel. Meanwhile, download backups."],
                            ["Couldn’t reach the database just now… (Reference …)", "The database is down, paused, or over its usage limit.", "Reload later. Use Backup copies in this browser → Download backup to keep working."],
                        ]}
                    />

                    <H3 id="errors-sign-in">Sign-in</H3>
                    <p className="max-w-3xl text-sm text-muted">
                        Some sign-in errors appear on Google’s own page, before {APP_NAME} is involved. The site owner fixes those in Google Cloud Console (APIs &
                        Services → Credentials / OAuth consent screen) and Vercel’s Environment Variables, then redeploys.
                    </p>
                    <ErrTable
                        rows={[
                            ["Google: Error 401: invalid_client (“The OAuth client was not found”)", "AUTH_GOOGLE_ID in Vercel isn’t the Client ID of the Google OAuth client.", "Copy the Client ID from Google Cloud → Credentials into AUTH_GOOGLE_ID, and that client’s secret into AUTH_GOOGLE_SECRET, then redeploy."],
                            ["Google: Error 400: redirect_uri_mismatch", "The site’s address isn’t an authorised redirect URI.", "Add https://<your site>/api/auth/callback/google under Authorized redirect URIs."],
                            ["Google: Access blocked / app has not completed verification / access_denied", "The account isn’t a test user while the app is in Testing.", "Google Auth Platform → Audience → Test users: add the account (or publish the app)."],
                            [`${APP_NAME}: AccessDenied`, "Google or the app refused the account.", "Same as above: add the account as a test user."],
                            [`${APP_NAME}: Configuration`, "A server setting is wrong (Google ID/secret, AUTH_SECRET) or the database couldn’t save the account.", "Check the four settings in Vercel, redeploy, try again."],
                            [`${APP_NAME}: OAuthCallback / Callback`, "The sign-in round trip didn’t complete (often cancelled or timed out).", "Try again."],
                        ]}
                    />

                    <H3 id="errors-pages">Error pages</H3>
                    <ErrTable
                        rows={[
                            ["Not found", "The address is wrong, the league was deleted, or it belongs to a different Google account.", "Go to Your leagues; check which account you’re signed in with."],
                            ["Couldn’t load this league (Reference …)", "The database didn’t answer.", "Reload later; download a backup copy from the home page meanwhile."],
                            ["Something went wrong", "The page crashed in the browser.", "Press Try again. If it repeats, send the message and Reference shown at the bottom."],
                        ]}
                    />
                </section>

                {/* ------------------------------------------------------------------ */}
                <section className="grid gap-3">
                    <H2 id="faq">Questions</H2>
                    <dl className="grid gap-4">
                        {(
                            [
                                ["Which sports does it support?", `${SPORT_IDS.map((s) => SPORTS[s].name).join(", ")}. The sport only changes the words; everything works the same.`],
                                ["Can I schedule a tournament?", `Yes: set the season to the tournament’s dates and each team’s guaranteed ${t.matches} to the pool-play count. Brackets and pools work the same way.`],
                                ["Do teams have to play every week?", `No. ${APP_NAME} only guarantees each team its number of ${t.matches}, spread across the season instead of bunched together.`],
                                [`Do I have to name the ${t.units}?`, `No. Without names, a time slot just says how many ${t.matches} fit at once. Names let every ${t.match} say which ${t.unit} it’s on.`],
                                ["Can two age groups have different schedules?", "Yes. Give a bracket “Plays on” days or a start window, or restrict a slot with “Open to”."],
                                ["What if everything is at one facility?", "Add one facility. Multiple facilities are optional."],
                                ["Who can see my leagues?", "Only the Google account that created them. Each account has its own leagues. See Privacy."],
                                ["Can I keep working if the site is down?", `Every change to a league is also saved in your browser. The home page lists these copies with Download backup, and a backup file opens in any copy of ${APP_NAME}, including one run on your own computer.`],
                                ["Does regenerating undo my hand changes?", `No: ${t.matches} you moved (or locked) stay put, on the same ${t.unit}. Only unlocked ${t.matches} in the chosen brackets are rebuilt.`],
                            ] as const
                        ).map(([q, a]) => (
                            <div key={q}>
                                <dt className="font-semibold">{q}</dt>
                                <dd className="text-muted">{a}</dd>
                            </div>
                        ))}
                    </dl>
                </section>
            </article>
        </div>
    );
}
