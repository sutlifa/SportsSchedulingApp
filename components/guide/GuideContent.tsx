"use client";

import Link from "next/link";
import { APP_NAME } from "@/lib/brand";
import { cap, SPORT_IDS, SPORTS, sportText, type SportId, type Terms } from "@/lib/engine/sports";
import { B, H2, H3, SportPicker, useGuideSport } from "./parts";

/*
 * The guide (/guide): how it works, facility spreadsheets, the rules, every
 * error and its fix, in whichever sport the reader picks. The step-by-step
 * tutorial is its own page (TutorialContent.tsx, /tutorial). The guide is
 * written against the app's exact labels too: keep them in step with the UI.
 */

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
    ["how-it-works", "How it works"],
    ["facility-sheets", "Facility spreadsheets"],
    ["rules", "Team and bracket rules"],
    ["errors", "Errors and how to fix them"],
    ["faq", "Questions"],
];

export default function GuideContent() {
    const [sport, choose] = useGuideSport();
    const t: Terms = SPORTS[sport];
    return <Guide t={t} sport={sport} choose={choose} />;
}

function Guide({ t, sport, choose }: { t: Terms; sport: SportId; choose: (s: SportId) => void }) {
    const w = (text: string) => sportText(text, t);
    const [fac1] = t.facility;
    const Units = cap(t.units);
    const Unit = cap(t.unit);
    const Matches = cap(t.matches);
    const tab = `Facilities & ${t.time}`;
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
                        lets you adjust it by hand. The{" "}
                        <Link href={`/tutorial?sport=${sport}`} className="font-semibold text-accent underline">
                            tutorial
                        </Link>{" "}
                        builds a complete {t.name.toLowerCase()} league in about 20 minutes, with a sample facility spreadsheet to practise on.
                    </p>
                    <div className="card flex flex-wrap items-center justify-between gap-3 border-accent/40 bg-accent-soft p-3">
                        <SportPicker sport={sport} onChange={choose} id="guide-sport" />
                        <span className="text-sm text-muted">
                            The guide uses {t.name.toLowerCase()} words: {t.time}, {t.units} ({u(0)}, {u(1)}…), {t.matches}, {t.captains}.
                        </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Link href={`/tutorial?sport=${sport}`} className="btn-primary">
                            Start the tutorial
                        </Link>
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
                            [
                                `X gets 6 of 8 ${t.matches}: the rest of … has only 6 to give`,
                                `Every ${t.match} needs an opponent from the same pool, and X wants more ${t.matches} than the rest of its pool plays in total.`,
                                `Add a team to the pool, or give X fewer ${t.matches} (Teams).`,
                            ],
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
