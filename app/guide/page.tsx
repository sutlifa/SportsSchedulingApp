import Link from "next/link";
import CopyBlock from "@/components/CopyBlock";

export const metadata = {
    title: "Guide",
    description: "How Courtside works, a step-by-step tutorial for building a league, and what every error means.",
};

/*
 * The guide is written against the app's exact labels ("Upload a facility
 * sheet", "Matches at once"...). scripts/e2e/tutorial.mjs drives the real UI
 * through this tutorial word for word, using the same team lists, times and
 * sample sheet, and checks every "You should see" -- so if a label or an
 * expected result here changes, change the script too, and run it.
 */

const TEAMS_10U = `Riverside Aces 10U, , Riverside
Lakeview Lobs 10U, , Lakeview
Oak Hill Volleys 10U, , Oak Hill
Westfield Rally 10U, , Westfield`;

const TEAMS_12U = `Riverside Aces 12U, A, Riverside
Lakeview Smash 12U, A, Lakeview
Oak Hill Spin 12U, A, Oak Hill
Westfield Drop Shot 12U, A, Westfield
Riverside Baseline 12U, B, Riverside
Lakeview Deuce 12U, B, Lakeview
Oak Hill Topspin 12U, B, Oak Hill
Westfield Love 12U, B, Westfield`;

const TEAMS_14U = `Riverside Aces 14U, , Riverside
Lakeview Smash 14U, , Lakeview
Oak Hill Topspin 14U, , Oak Hill
Westfield Ad In 14U, , Westfield
Riverside Slice 14U, , Riverside
Lakeview Net Rush 14U, , Lakeview`;

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

/** UI label, styled like the control it names. */
function B({ children }: { children: React.ReactNode }) {
    return <strong className="whitespace-nowrap rounded bg-accent-soft px-1.5 py-0.5 font-semibold text-fg">{children}</strong>;
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

const TOC: [string, string][] = [
    ["how-it-works", "How Courtside works"],
    ["tutorial", "Tutorial: build a league start to finish"],
    ["facility-sheets", "Facility spreadsheets"],
    ["rules", "Team and bracket rules"],
    ["errors", "Errors and how to fix them"],
    ["faq", "Questions"],
];

export default function GuidePage() {
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
                <header>
                    <h1 className="font-display text-5xl font-bold uppercase tracking-wide">Courtside guide</h1>
                    <p className="mt-3 max-w-2xl text-lg text-muted">
                        Courtside builds a tennis league’s whole season schedule from your brackets, courts and every team’s requests, then lets you adjust it by hand.
                        The tutorial below builds a complete league in about 20 minutes, with a sample facility spreadsheet to practise on.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
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
                    <ol className="mt-6 flex flex-wrap gap-2 text-sm lg:hidden">
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
                    <H2 id="how-it-works">How Courtside works</H2>
                    <p className="max-w-3xl">
                        A <strong>league</strong> is one season. You describe the season once, and Courtside does the matching and the timetabling. Each part has
                        its own tab inside the league:
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {(
                            [
                                ["Season", "First and last day, blackout dates, and league-wide limits like matches per day and courts per match."],
                                ["Brackets & pools", "Age groups (10U, 12U…), how many matches each team is guaranteed, and start-time limits such as “10U never after 5:30 PM”."],
                                ["Courts & times", "Your facilities, the weekly time slots with how many matches can be on at once, and facility spreadsheets for specific dates."],
                                ["Teams", "Every team with its bracket, pool and club, plus the captain’s requests as rules."],
                                ["Schedule", "Generate the season, see problems with their fixes, move and lock matches, and export for captains."],
                            ] as const
                        ).map(([tab, what]) => (
                            <div key={tab} className="card p-4">
                                <div className="font-display text-xl font-bold uppercase">{tab}</div>
                                <p className="mt-1 text-sm text-muted">{what}</p>
                            </div>
                        ))}
                    </div>
                    <H3>Words used in the app</H3>
                    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                        {(
                            [
                                ["Bracket", "An age group. Teams only ever play teams in their own bracket."],
                                ["Pool", "A group inside a bracket. Teams only play teams in their own pool. Leave it blank if the bracket is one group."],
                                ["Guaranteed matches", "How many matches every team gets against its pool (5 by default). Teams don’t have to play every week."],
                                ["Location", "A facility. Add the address and a Google Maps pin so families can find it."],
                                ["Weekly time slot", "A start time that repeats every week at a location, like “Saturdays 9:00 AM at Riverside”."],
                                ["Matches at once", "How many matches can start in a slot at the same time."],
                                ["Facility sheet", "A spreadsheet from a facility listing exact dates, times and courts. For the dates it covers, it replaces the weekly slots."],
                                ["Must / Prefer", "A Must rule is never broken by the scheduler. A Prefer rule is avoided, but broken if that’s the only way to fit a match."],
                                ["Lock", "A locked match stays put when you regenerate. Moving a match by hand locks it."],
                                ["Club", "Used to avoid having too many of one club’s teams on court at the same time."],
                            ] as const
                        ).map(([t, d]) => (
                            <div key={t}>
                                <dt className="font-semibold">{t}</dt>
                                <dd className="text-sm text-muted">{d}</dd>
                            </div>
                        ))}
                    </dl>
                </section>

                {/* ------------------------------------------------------------------ */}
                <section className="grid gap-4">
                    <H2 id="tutorial">Tutorial: build a league start to finish</H2>
                    <p className="max-w-3xl">
                        You’ll build <strong>Spring 2027 Junior Team Tennis</strong>: three brackets, 18 teams, two facilities, weekly court times, one facility
                        spreadsheet and five captain requests. Use these exact values the first time, and every step tells you what you should see. Then build
                        your real league the same way, or delete this one from <B>Season</B>.
                    </p>
                    <Tip>
                        Changes save automatically. The top-right corner of a league says <B>Saved</B> (or <B>Saved in this browser</B> if the site isn’t
                        connected to its database). You never need a Save button except inside pop-up editors.
                    </Tip>

                    <Step n={1} id="t-create" title="Create the league">
                        <ol>
                            <li>
                                Go to <Link href="/" className="font-semibold text-accent underline">Your leagues</Link>.
                            </li>
                            <li>
                                Under <B>New league</B>, type the name <strong>Spring 2027 Junior Team Tennis</strong>.
                            </li>
                            <li>
                                Leave <B>A blank league</B> selected and press <B>Create league</B>.
                            </li>
                        </ol>
                        <Expect>
                            the league opens on its <B>Season</B> tab. On the <B>Schedule</B> tab, a <em>Before you schedule</em> checklist lists what’s left to
                            set up.
                        </Expect>
                    </Step>

                    <Step n={2} id="t-season" title="Set the season dates">
                        <ol>
                            <li>
                                On <B>Season</B>, set <B>First day</B> to <strong>03/06/2027</strong> and <B>Last day</B> to <strong>05/16/2027</strong>.
                            </li>
                            <li>
                                Under <B>Blackout dates</B>, set <B>From</B> 03/27/2027 and <B>To (optional)</B> 03/28/2027 (Easter weekend), then press{" "}
                                <B>Add dates</B>.
                            </li>
                            <li>
                                Under <B>League-wide rules</B>, set <B>Same club at the same time</B> to <strong>2</strong>, “where possible”. Leave the other
                                settings as they are.
                            </li>
                        </ol>
                        <Expect>
                            “Sat, Mar 6, 2027 to Sun, May 16, 2027, about 11 weeks.” and a chip reading <strong>Sat, Mar 27 – Sun, Mar 28</strong>.
                        </Expect>
                        <Tip>
                            <strong>Courts used by one match</strong> matters when a facility sheet lists courts. If one team match plays three lines at once, set it
                            to 3, so 6 courts count as 2 matches at once. Leave it at 1 for this tutorial.
                        </Tip>
                    </Step>

                    <Step n={3} id="t-brackets" title="Add the age brackets">
                        <p>
                            On <B>Brackets & pools</B>, press <B>Add bracket</B> three times and fill in:
                        </p>
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[30rem] text-sm">
                                <thead className="text-left">
                                    <tr className="border-b border-border">
                                        <th className="label py-1">Name</th>
                                        <th className="label py-1">Guaranteed matches per team</th>
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
                        <Expect>three bracket cards. 10U reads “5 guaranteed matches per team · starts until 5:30 PM”. Each says “No teams yet.”</Expect>
                    </Step>

                    <Step n={4} id="t-locations" title="Add the facilities">
                        <ol>
                            <li>
                                On <B>Courts & times</B>, press <B>Add location</B>. <B>Facility name</B>: <strong>Riverside Tennis Center</strong>. Type its real
                                address in <B>Address</B> if you like.
                            </li>
                            <li>
                                Optional map pin: press the <B>Search Google Maps for…</B> link, find the right place, press <strong>Share → Copy link</strong>,
                                and paste it into the map link box. Only Google Maps links are accepted.
                            </li>
                            <li>
                                Press <B>Save location</B>, then add a second location: <strong>Lakeview Park Courts</strong>.
                            </li>
                        </ol>
                        <Expect>two location cards, each with a “Find on Google Maps” link (or “Open pinned map” if you pasted a pin) and “0 weekly time slots”.</Expect>
                    </Step>

                    <Step n={5} id="t-slots" title="Add the weekly court times">
                        <p>
                            In <B>Add time slots</B> on the same tab, add three batches. Choose the days, type the times, pick the location, set{" "}
                            <B>Matches at once</B>, then press <B>Add … slots</B>:
                        </p>
                        <ul>
                            <li>
                                <strong>Sat</strong> · times <code className="font-mono">9, 11, 1pm, 3pm</code> · Riverside Tennis Center · 3 at once → 4 slots
                            </li>
                            <li>
                                <strong>Sun</strong> · times <code className="font-mono">12pm, 2pm</code> · Riverside Tennis Center · 3 at once → 2 slots
                            </li>
                            <li>
                                <strong>Tue and Thu</strong> · times <code className="font-mono">5pm, 7pm</code> · Lakeview Park Courts · 2 at once → 4 slots
                            </li>
                        </ul>
                        <p className="text-sm text-muted">
                            Check the “Reads as:” line under the times box before adding. It shows how your typing was understood. Leave <B>Open to</B> with
                            nothing selected so every bracket can use these slots; bracket start limits still apply.
                        </p>
                        <Expect>
                            a table of 10 weekly time slots, and the line “26 match spots a week · … across the season · 45 matches needed.” (45 appears once the
                            teams are in).
                        </Expect>
                    </Step>

                    <Step n={6} id="t-facility-sheet" title="Upload a facility spreadsheet">
                        <p>
                            Riverside sent its exact April availability. Download the sample:{" "}
                            <a className="font-semibold text-accent underline" href="/tutorial/riverside-april-2027.xlsx" download>
                                riverside-april-2027.xlsx
                            </a>{" "}
                            (or{" "}
                            <a className="text-accent underline" href="/tutorial/riverside-april-2027.csv" download>
                                the CSV version
                            </a>
                            ). Both have dates down the side, start times across the top, and cells such as “Tournament”, “Reserved” and “-”; the .xlsx also has a title row above the headings.
                        </p>
                        <ol>
                            <li>
                                On <B>Courts & times</B>, under <B>Facility availability</B>, press <B>Upload a facility sheet</B> and choose the file.
                            </li>
                            <li>
                                Check the guess: <B>Layout</B> should be <em>Grid: dates down the side, times across the top</em> and <B>Heading row</B>{" "}
                                <em>Row 3</em> for the .xlsx (it has a title row) or <em>Row 1</em> for the CSV. If a facility’s sheet is read wrongly, change these and the result updates straight away.
                            </li>
                            <li>
                                Set <B>Location</B> to <strong>Riverside Tennis Center</strong>.
                            </li>
                            <li>
                                Read <B>What was read</B>, then press <B>Import 20 time slots</B>.
                            </li>
                        </ol>
                        <Expect>
                            “<strong>20</strong> time slots on <strong>5</strong> dates, Sat, Apr 3, 2027 to Sat, Apr 24, 2027.” In the table the Tournament,
                            Reserved and “-” cells show <strong>Closed</strong>. After importing: “Imported 20 time slots on 5 dates from
                            riverside-april-2027.xlsx.” and a Riverside card under Facility availability.
                        </Expect>
                        <Tip>
                            On those 5 dates the sheet <em>replaces</em> Riverside’s weekly slots: on Sunday Apr 11 Riverside has 11:00 and 1:00 instead of the
                            usual 12:00 and 2:00, and the Apr 10 tournament closes the afternoon. Every other date keeps the weekly pattern. Press{" "}
                            <B>Show dates</B> on the card to check.
                        </Tip>
                    </Step>

                    <Step n={7} id="t-teams" title="Add the teams">
                        <p>
                            On <B>Teams</B>, press <B>Paste a list instead</B>. Each line is <em>team name, pool, club</em>. Leave the pool blank (two commas) when
                            the bracket is one group. For each list: choose the bracket under <B>Bracket for all of these</B>, paste, and press <B>Add … teams</B>.
                        </p>
                        <p className="font-semibold">10U:</p>
                        <CopyBlock text={TEAMS_10U} />
                        <p className="font-semibold">12U (two pools, A and B):</p>
                        <CopyBlock text={TEAMS_12U} />
                        <p className="font-semibold">14U:</p>
                        <CopyBlock text={TEAMS_14U} />
                        <Expect>
                            <strong>Teams (18)</strong>, grouped by bracket, with 12U split into “Pool A · 4 teams” and “Pool B · 4 teams”. On{" "}
                            <B>Brackets & pools</B>, 10U and 12U pools note that some opponents will be played twice. With only 3 other teams in a pool, 5
                            matches means repeats, spread as evenly as possible.
                        </Expect>
                        <Tip>
                            To add one team at a time, use the <B>Add a team</B> form: name, bracket, pool, club and (optionally) a different number of matches.
                            You can paste straight from a spreadsheet too, since tabs work the same as commas.
                        </Tip>
                    </Step>

                    <Step n={8} id="t-rules" title="Enter the captains’ requests">
                        <p>
                            Find each team on <B>Teams</B>, press <B>Edit</B>, choose a rule from <B>Add a rule…</B>, press <B>Add rule</B>, fill it in, then{" "}
                            <B>Save team</B>:
                        </p>
                        <ol>
                            <li>
                                <strong>Riverside Aces 12U</strong> (“can’t play more than once a weekend”): <em>Max matches in one weekend</em> → 1, <B>Must</B>.
                            </li>
                            <li>
                                <strong>Lakeview Smash 14U</strong> (“no more than 3 matches on Saturday/Sunday”): <em>Max weekend matches all season</em> → 3,{" "}
                                <B>Must</B>.
                            </li>
                            <li>
                                <strong>Oak Hill Topspin 12U</strong> (shares a coach with Oak Hill Topspin 14U): <em>Not at the same time as other teams</em> →
                                choose <strong>Oak Hill Topspin 14U</strong>, <B>Must</B>.
                            </li>
                            <li>
                                <strong>Westfield Rally 10U</strong> (spring break): <em>Unavailable dates</em> → From 04/10/2027 To 04/11/2027 → <B>Add dates</B>,{" "}
                                <B>Must</B>.
                            </li>
                            <li>
                                <strong>Oak Hill Spin 12U</strong> (“we’d rather not play Tuesdays”): <em>Can’t play on certain days</em> → Tue, then switch it to{" "}
                                <B>Prefer</B>.
                            </li>
                        </ol>
                        <Expect>
                            each team’s card shows its request as a chip, e.g. “At most 1 match per weekend” and, in amber, “Prefers: Not on Tuesdays”.
                        </Expect>
                        <Tip>
                            The sentence on the chip is exactly what the scheduler quotes if this rule ever stops a match being placed. Rules for a whole age group
                            go on the bracket instead (<B>Brackets & pools</B> → Edit → <em>Rules for every team in this bracket</em>).
                        </Tip>
                    </Step>

                    <Step n={9} id="t-generate" title="Generate the season">
                        <p>
                            On <B>Schedule</B>, leave <em>All brackets</em> selected and press <B>Generate schedule</B>. It takes a second or two. It tries many
                            arrangements and keeps the best one.
                        </p>
                        <Expect>
                            <strong>Matches placed 45 of 45</strong>, <strong>Not placed 0</strong>, <strong>Break a must-rule 0</strong>,{" "}
                            <strong>Teams short 0</strong> (“everyone’s covered”), and the season listed by date from Sat, Mar 6.
                        </Expect>
                        <p>Check that the requests were respected:</p>
                        <ul>
                            <li>
                                Choose <strong>By team</strong> and open <strong>Riverside Aces 12U</strong>: 5/5 matches, never two on the same weekend.
                            </li>
                            <li>
                                <strong>Westfield Rally 10U</strong> has nothing on Apr 10–11; no 10U match starts after 5:30 PM.
                            </li>
                            <li>
                                <strong>Court use</strong> shows every time with matches used / matches at once. Nothing is over capacity, and Apr 10 at Riverside has no
                                1:00 or 3:00 slot (the tournament).
                            </li>
                        </ul>
                    </Step>

                    <Step n={10} id="t-adjust" title="Adjust by hand">
                        <ol>
                            <li>
                                Choose <strong>By date</strong>, find a <strong>12U</strong> or <strong>14U</strong> match and press <B>Move</B>. (Not a
                                10U one: step 11 reschedules 10U, and a locked 10U match would stay put and change the numbers you’re told to expect there.)
                            </li>
                            <li>
                                The list shows every open time that fits <em>every</em> rule (amber lines miss a preference). Pick one and press{" "}
                                <B>Move here and lock</B>.
                            </li>
                            <li>
                                Press <B>Regenerate schedule</B> and confirm. The locked match stays exactly where you put it while the rest is rebuilt around it.
                            </li>
                        </ol>
                        <Expect>
                            the moved match shows a <strong>Locked</strong> badge before and after regenerating, and the totals still read 45 of 45 and 0 must-rule
                            breaks.
                        </Expect>
                        <Tip>
                            To redo one age group only, pick it in the <B>Schedule</B> menu (e.g. “14U only”) before regenerating. Other brackets aren’t touched.
                            In the Move dialog you can also <B>Swap home/away</B> or <B>Take off the schedule</B>.
                        </Tip>
                    </Step>

                    <Step n={11} id="t-problems" title="See how problems are explained (optional, 2 minutes)">
                        <p>Make the schedule impossible on purpose to see what Courtside tells you:</p>
                        <ol>
                            <li>
                                On <B>Brackets & pools</B>, edit <strong>10U</strong>, set <B>Latest start</B> to <strong>08:00 AM</strong>, and save.
                            </li>
                            <li>
                                On <B>Schedule</B>, choose <em>10U only</em> and press <B>Regenerate schedule</B>.
                            </li>
                        </ol>
                        <Expect>
                            <strong>Couldn’t place (10)</strong>. Each match lists its blockers, such as “10U can’t start after 8:00 AM (ruled out … times)”,
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
                                away, location, address and map link.
                            </li>
                            <li>
                                <B>Copy all team schedules</B>, or <B>Copy for the captain</B> on one team (in <strong>By team</strong>), copies text ready to paste
                                into an email.
                            </li>
                            <li>
                                <B>Season</B> → <B>Download backup</B> saves the whole league to a file. <B>Replace from a backup…</B> or <em>New league → A backup
                                file</em> brings it back.
                            </li>
                        </ul>
                        <Expect>
                            a CSV with a header row and 45 match rows, and a <em>…-backup.json</em> file.
                        </Expect>
                        <p>
                            That’s a whole league. For your real season, follow the same steps with your dates, brackets, facilities and teams.
                        </p>
                    </Step>
                </section>

                {/* ------------------------------------------------------------------ */}
                <section className="grid gap-3">
                    <H2 id="facility-sheets">Facility spreadsheets</H2>
                    <p className="max-w-3xl">
                        Facilities send their court times in different layouts. Courtside reads <strong>.xlsx</strong> (Excel, Google Sheets → Download →
                        Microsoft Excel), <strong>.csv</strong>, or cells copied from a spreadsheet and pasted into the upload box. Old <strong>.xls</strong> files
                        need to be saved again as .xlsx or .csv first.
                    </p>
                    <H3>Layouts it understands</H3>
                    <ul className="list-disc pl-6">
                        <li>
                            <strong>One row per time slot</strong>: Date | Start time | Courts (| Location). A date written once and left blank below it carries down,
                            and merged date cells are fine.
                        </li>
                        <li>
                            <strong>One row per court</strong>: Date | Time | Court (“Court 7”, “Stadium”). Courts at the same date and time are counted. A column
                            headed “Court” or “Court #” is read this way, and the dialog says so.
                        </li>
                        <li>
                            <strong>Grid</strong>: dates down the side and start times across the top, or the other way round, with courts in the cells.
                        </li>
                    </ul>
                    <H3>How cells are read</H3>
                    <ul className="list-disc pl-6">
                        <li>Dates: 3/6, Sat 3/6, March 6, 2027-03-06, real Excel dates. With no year, the year that falls in your season is used.</li>
                        <li>Times: 9, 9:00, 9am, 13:30, 0930, and ranges like 6-8pm (the start time is used).</li>
                        <li>
                            Courts: 4, “4 courts”, “Courts 1-4” (4), “1, 2, 5” (3), and “3 (1 held for lessons)” (3, since a leading number wins).
                        </li>
                        <li>
                            <strong>Closed</strong> (0 courts): a blank-looking dash, x, closed, none, or a cell starting with Reserved, Unavailable, Tournament,
                            Blocked, Maintenance, Private, Lessons, Camp, Clinic, Event, Hold or Rain. A court’s own name like “Clinic Court” still counts as a court.
                        </li>
                    </ul>
                    <H3>What an import changes</H3>
                    <p className="max-w-3xl">
                        For each location and date in the file, the uploaded times <strong>replace</strong> that location’s weekly slots on that date. Other
                        dates keep the weekly pattern, and blackout dates still win. Importing again only replaces the dates in the new file, so monthly sheets
                        can be imported one after another. Matches already booked into those times stay attached. <B>Remove upload</B> on a location’s card
                        goes back to its weekly slots.
                    </p>
                </section>

                {/* ------------------------------------------------------------------ */}
                <section className="grid gap-3">
                    <H2 id="rules">Team and bracket rules</H2>
                    <p className="max-w-3xl">
                        Add rules to a team (<B>Teams</B> → Edit) or to a whole bracket. Each can be <strong>Must</strong> (never broken by the scheduler)
                        or <strong>Prefer</strong> (avoided where possible).
                    </p>
                    <div className="overflow-x-auto rounded-lg border border-border">
                        <table className="w-full min-w-[36rem] text-sm">
                            <thead className="bg-surface-2 text-left">
                                <tr>
                                    <th className="label px-3 py-2">Rule</th>
                                    <th className="label px-3 py-2">Captain says…</th>
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
                                        ["Only at / Not at certain locations", "“Home courts only.” / “Not at Lakeview.”"],
                                        ["Days between matches", "“At least 3 days apart.”"],
                                        ["Not at the same time as other teams", "Shared coach or siblings. Works both ways automatically."],
                                        ["Not on the same day as other teams", "Same, for whole days."],
                                        ["Other request (note only)", "Anything else. Kept with the team for you; the scheduler doesn’t act on it."],
                                    ] as const
                                ).map(([r, e]) => (
                                    <tr key={r}>
                                        <td className="px-3 py-2 font-semibold">{r}</td>
                                        <td className="px-3 py-2 text-muted">{e}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <p className="text-sm text-muted">
                        League-wide limits live on <B>Season</B>: max matches per team per day, match length (starts closer together than this count as
                        overlapping), courts used by one match, and how many of one club’s matches may be on court at the same time.
                    </p>
                </section>

                {/* ------------------------------------------------------------------ */}
                <section className="grid gap-3">
                    <H2 id="errors">Errors and how to fix them</H2>
                    <p className="max-w-3xl">
                        Courtside always says what went wrong and what to do. Problems on the <B>Schedule</B> tab come with a <em>Fix</em> line and a button to the
                        tab where you make the change. Messages that end in <strong>(Reference ABC123)</strong> came from the server: send that code to whoever
                        runs the site, as it points to the exact entry in the server log.
                    </p>

                    <H3 id="errors-scheduling">Matches that couldn’t be placed</H3>
                    <p className="max-w-3xl">
                        A match is left unplaced rather than break a <strong>Must</strong> rule. For each one, Courtside checks every open time in the season and
                        lists the reasons that ruled out the most times.
                    </p>
                    <ErrTable
                        rows={[
                            ["All courts are already taken at that time", "Every time that otherwise fits is full.", "Add weekly time slots, raise “Matches at once”, or upload more facility availability (Courts & times)."],
                            ["This time slot isn’t open to 12U", "Slots are reserved for other brackets via “Open to”.", "Edit a slot and add 12U, or add slots for 12U (Courts & times)."],
                            ["10U can’t start after 5:30 PM", "The bracket’s start window excludes the open times.", "Widen Earliest/Latest start, or add slots inside the window (Brackets & pools)."],
                            ["14U doesn’t play on Tuesdays", "The bracket’s “Plays on” days exclude these times.", "Add the day, or add slots on the bracket’s days (Brackets & pools)."],
                            ["Lakeview Smash 14U already plays that day", "The team’s other matches use up the open days.", "Add more dates or slots, or raise “Max matches per team per day” (Season)."],
                            ["Riverside Aces 12U: At most 1 match per weekend", "That team’s own rule rules the times out.", "Loosen the rule, switch it to Prefer, or add slots that fit it (Teams)."],
                            ["Oak Hill Topspin 12U: not at the same time as Oak Hill Topspin 14U", "Two linked teams compete for the same times.", "Switch the rule to Prefer, or add slots at other times (Teams)."],
                            ["More than 2 Riverside matches on court at the same time", "The club limit (set to “always”) keeps the club’s teams apart.", "Raise the limit or set it to “where possible” (Season)."],
                            ["There are no time slots in the season to put it in", "No dates or slots exist.", "Check First/Last day, then add weekly slots or a facility sheet."],
                        ]}
                    />
                    <H3>Warnings from the last run</H3>
                    <ErrTable
                        rows={[
                            ["X gets 4 of 5 matches: … has an odd total", "Teams × matches in a pool is odd, so one match can’t be paired.", "Add or remove a team, or give one team one match more or fewer."],
                            ["X is the only team in 10U · Pool B", "A pool of one has nobody to play.", "Move the team to another pool, or add a team to its pool (Teams)."],
                            ["X isn’t in an age bracket", "Its bracket was deleted.", "Edit the team and choose a bracket."],
                            ["There are no open time slots in the season", "Season dates or slots are missing.", "Set the season dates and add time slots."],
                        ]}
                    />
                    <H3>Flags on placed matches</H3>
                    <ErrTable
                        rows={[
                            ["Breaks: …", "A Must rule is broken, usually after a hand move or after rules or courts changed.", "Press Move: the list shows times that fit every rule. Or regenerate."],
                            ["Misses preference: …", "A Prefer rule couldn’t be kept.", "Usually fine. Move the match if it matters."],
                            ["Breaks: The facility’s sheet has no court time then", "A newer facility sheet doesn’t include this time (or marks it closed).", "Move the match, or upload a corrected sheet."],
                            ["Breaks: Its location was deleted", "The facility was removed.", "Move the match or regenerate."],
                            ["Misses preference: This time is no longer in the weekly slots…", "Its weekly slot was changed or removed.", "Move it to a current time."],
                        ]}
                    />

                    <H3 id="errors-import">Facility sheet messages</H3>
                    <ErrTable
                        rows={[
                            ["This doesn’t look like an Excel (.xlsx) file.", "The file isn’t a real .xlsx (renamed, or another format).", "Open it in Excel or Google Sheets and save/download as .xlsx or .csv."],
                            ["That’s the old .xls format.", "Excel 97–2003 files can’t be read.", "File → Save As → Excel Workbook (.xlsx) or CSV."],
                            ["Nothing could be read with these settings.", "The layout or columns were guessed wrong.", "Change Layout, Heading row and the column choices; the preview updates."],
                            ["Row 12: Couldn’t read the date “…”", "That cell isn’t a date (often a note or a typo).", "Usually ignore it, or fix the cell and upload again."],
                            ["Row 12: Couldn’t read the number of courts “…”", "The courts cell has no number and isn’t a closed word.", "Fix the cell, or check the column choice."],
                            ["Reading each row as one court", "The courts column holds court names, so courts at the same time are counted.", "If it’s really a number of courts, change “Each row is”."],
                            ["N repeated date/time rows: the last one wins", "The same date and time appears more than once.", "Check the preview. For separate courts per row, choose “One court, by name”."],
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
                        Some sign-in errors appear on Google’s own page, before Courtside is involved. The site owner fixes those in Google Cloud Console (APIs &
                        Services → Credentials / OAuth consent screen) and Vercel’s Environment Variables, then redeploys.
                    </p>
                    <ErrTable
                        rows={[
                            ["Google: Error 401: invalid_client (“The OAuth client was not found”)", "AUTH_GOOGLE_ID in Vercel isn’t the Client ID of the Google OAuth client.", "Copy the Client ID from Google Cloud → Credentials into AUTH_GOOGLE_ID, and that client’s secret into AUTH_GOOGLE_SECRET, then redeploy."],
                            ["Google: Error 400: redirect_uri_mismatch", "The site’s address isn’t an authorised redirect URI.", "Add https://<your site>/api/auth/callback/google under Authorized redirect URIs."],
                            ["Google: Access blocked / app has not completed verification / access_denied", "The account isn’t a test user while the app is in Testing.", "Google Auth Platform → Audience → Test users: add the account (or publish the app)."],
                            ["Courtside: AccessDenied", "Google or the app refused the account.", "Same as above: add the account as a test user."],
                            ["Courtside: Configuration", "A server setting is wrong (Google ID/secret, AUTH_SECRET) or the database couldn’t save the account.", "Check the four settings in Vercel, redeploy, try again."],
                            ["Courtside: OAuthCallback / Callback", "The sign-in round trip didn’t complete (often cancelled or timed out).", "Try again."],
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
                                ["Do teams have to play every week?", "No. Courtside only guarantees each team its number of matches, spread across the season instead of bunched together."],
                                ["Can two age groups have different schedules?", "Yes. Give a bracket “Plays on” days or a start window, or restrict a slot with “Open to”."],
                                ["What if everything is at one facility?", "Add one location. Multiple locations are optional."],
                                ["Who can see my leagues?", "Only the Google account that created them. Each account has its own leagues."],
                                ["Can I keep working if the site is down?", "Every change to a league is also saved in your browser. The home page lists these copies with Download backup, and a backup file opens in any copy of Courtside, including one run on your own computer."],
                                ["Does regenerating undo my hand changes?", "No: matches you moved (or locked) stay put. Only unlocked matches in the chosen brackets are rebuilt."],
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
