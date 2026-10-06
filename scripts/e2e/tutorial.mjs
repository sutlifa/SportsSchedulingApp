// scripts/e2e/tutorial.mjs
//
// Walks the /tutorial page in a real browser, word for word -- same league
// name, dates, brackets, facilities and their units, times, sample sheet,
// team lists and requests -- in each sport given, and checks every "You
// should see". If the guide or the UI changes, this is what notices that
// they no longer agree.
//
// Run against a server in browser mode (no env vars), e.g.:
//
//   npm run build && npx next start -p 3004 &
//   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.mjs \
//     node --experimental-strip-types --no-warnings scripts/e2e/tutorial.mjs
//
// SPORTS=hockey,soccer,tennis (the default) picks which sports to walk.
// Playwright is deliberately NOT a dependency of this repo; install it in a
// scratch directory and point PLAYWRIGHT_MODULE at it. Chromium is taken
// from CHROMIUM_PATH (default /opt/pw-browsers/chromium) if it exists.
import { existsSync, readFileSync } from "node:fs";
import { audit } from "../../lib/engine/engine.ts";
import { isoToDay, toMinutes, weekendKey, isWeekend } from "../../lib/engine/dates.ts";
import { SPORTS, cap } from "../../lib/engine/sports.ts";

const BASE = process.env.BASE_URL ?? "http://localhost:3004";
const SPORT_LIST = (process.env.SPORTS ?? "hockey,soccer,tennis").split(",").map((s) => s.trim()).filter(Boolean);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const exe = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";
const browser = await chromium.launch(existsSync(exe) ? { executablePath: exe } : {});
const guideSrc = readFileSync(new URL("../../components/guide/TutorialContent.tsx", import.meta.url), "utf8");
const list = (name) => new RegExp(`export const ${name} = \`([\\s\\S]*?)\`;`).exec(guideSrc)[1];

let total = 0;
for (const sport of SPORT_LIST) {
    const t = SPORTS[sport];
    if (!t) throw new Error(`Unknown sport ${sport}`);
    total += await walk(sport, t);
}
console.log(`tutorial e2e: all ${total} checks passed (${SPORT_LIST.join(", ")}).`);
await browser.close();

async function walk(sport, t) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15_000);
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    const u = (i) => t.unitLabel(i);
    const [fac1, fac2] = t.facility;
    const short1 = fac1.split(" ")[0];
    const facTab = `Facilities & ${t.time}`;
    const file = `${sport}-april-2027`;
    const leagueName = `Spring 2027 Youth ${t.name}`;

    let step = "";
    let checks = 0;
    const STEP = (s) => {
        step = s;
        console.log(`[${sport}] STEP ${s}`);
    };
    const ok = (cond, msg) => {
        checks++;
        if (!cond) throw new Error(`[${sport}] [${step}] ${msg}`);
    };
    const see = async (text, opts = {}) => {
        await page.getByText(text, opts).first().waitFor({ state: "visible" });
        checks++;
    };
    const tab = (name) => page.getByRole("button", { name, exact: true }).click();
    // The setup wizard: its Next button, and its step list (whose buttons also
    // carry a number/tick and a screen-reader status, hence the regex).
    const next = (title) => page.getByRole("button", { name: `Next: ${title}`, exact: true });
    const goNext = async (title) => {
        ok(await next(title).isEnabled(), `Next: ${title} is enabled`);
        await next(title).click();
    };
    const stepper = (title) => page.getByLabel("Setup steps").getByRole("button", { name: new RegExp(title.replace(/[&]/g, "\\$&")) }).click();
    const Time = cap(t.time);
    const dialog = () => page.getByRole("dialog");

    try {
        // --- 1 -----------------------------------------------------------------
        STEP("1 create the league");
        await page.goto(BASE);
        await page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "New league" }).click();
        await page.waitForURL(/\/new$/);
        await page.locator("#league-name").fill(leagueName);
        await page.locator("#league-sport").selectOption(sport);
        await page.getByText("Guided setup", { exact: true }).click();
        await page.getByRole("button", { name: "Start guided setup" }).click();
        await page.waitForURL(/\/league\/.*setup=1/);
        await see("1. Name & sport");
        await see("Step 1 of 8");
        await see(t.name, { exact: true });
        ok((await page.locator("#setup-sport").inputValue()) === sport, "sport carried into the wizard");
        await see(`This league talks about ${t.units} (${u(0)}, ${u(1)}), ${t.time}, ${t.matches} and ${t.captains}.`, { exact: false });
        await goNext("Season");

        // --- 2 -----------------------------------------------------------------
        STEP("2 season dates");
        ok((await page.locator("#match-minutes").inputValue()) === String(t.minutes), `${t.match} length defaults to ${t.minutes} for ${t.name}`);
        await see("Set the season’s first and last day.");
        ok(await next("Brackets & pools").isDisabled(), "Next is disabled until the dates are set");
        ok((await page.locator("#league-sport-edit").count()) === 0, "no sport/name/backup on the setup Season step");
        await page.locator("#season-start").fill("2027-03-06");
        await page.locator("#season-end").fill("2027-05-16");
        await page.locator("#blackout-from").fill("2027-03-27");
        await page.locator("#blackout-to").fill("2027-03-28");
        await page.getByRole("button", { name: "Add dates" }).click();
        await page.locator("#club-limit").fill("2");
        await see("Sat, Mar 6, 2027 to Sun, May 16, 2027, about 11 weeks.");
        await see("Sat, Mar 27 – Sun, Mar 28");
        await see(`${cap(t.units)} used by one ${t.match}`);
        // Number fields show what's typed (Tester finds): typing 45 into the
        // min-15 length field isn't clamped at the "4", and clearing a field
        // whose blank falls back to 1 doesn't turn a typed 3 into 13.
        await page.locator("#match-minutes").click();
        await page.keyboard.type("45");
        ok((await page.locator("#match-minutes").inputValue()) === "45", `typed 45: ${await page.locator("#match-minutes").inputValue()}`);
        await page.locator("#max-per-day").click();
        await page.keyboard.press("Backspace");
        await page.keyboard.type("3");
        ok((await page.locator("#max-per-day").inputValue()) === "3", `typed 3: ${await page.locator("#max-per-day").inputValue()}`);
        await page.locator("#max-per-day").fill("");
        await page.locator("#season-start").click(); // blur: blank falls back to 1
        ok((await page.locator("#max-per-day").inputValue()) === "1", "blank max-per-day falls back to 1 on leaving it");
        await page.locator("#match-minutes").fill(String(t.minutes));
        await page.locator("#season-start").click();
        ok((await page.getByText("Set the season’s first and last day.").count()) === 0, "the Needed line is gone");
        await goNext("Brackets & pools");

        // --- 3 -----------------------------------------------------------------
        STEP("3 brackets");
        for (const [name, latest] of [["10U", "17:30"], ["12U", "18:30"], ["14U", ""]]) {
            await page.getByRole("button", { name: "Add bracket" }).click();
            await page.locator("#br-name").fill(name);
            ok((await page.locator("#br-matches").inputValue()) === "5", "matches default to 5");
            if (name === "10U") {
                // Clearing a number field and typing showed "015" (a reported bug).
                await page.locator("#br-matches").fill("");
                await page.keyboard.type("15");
                ok((await page.locator("#br-matches").inputValue()) === "15", `no leading zero: ${await page.locator("#br-matches").inputValue()}`);
                await page.locator("#br-matches").fill("5");
            }
            if (latest) await page.locator("#br-latest").fill(latest);
            await page.getByRole("button", { name: "Save bracket" }).click();
        }
        await see(`5 guaranteed ${t.matches} per team · starts until 5:30 PM`);
        ok((await page.getByText("No teams yet.").count()) === 3, "three empty bracket cards");
        await goNext("Facilities");

        // --- 4 -----------------------------------------------------------------
        STEP("4 facilities and units");
        ok((await page.getByRole("heading", { name: "Weekly" , exact: false }).count()) === 0, "the facilities step shows facilities only");
        for (const [name, n] of [[fac1, 3], [fac2, 2]]) {
            await page.getByRole("button", { name: "Add facility" }).click();
            await page.locator("#loc-name").fill(name);
            ok((await page.locator("#unit-seq-start").inputValue()) === u(0), `Starting from already says ${u(0)}`);
            await page.locator("#unit-seq-count").fill(String(n));
            await dialog().getByRole("button", { name: `Add ${Array.from({ length: n }, (_, i) => u(i)).join(", ")}` }).click();
            await page.getByRole("button", { name: "Save facility" }).click();
        }
        await see(`3 ${t.units}: ${u(0)}, ${u(1)}, ${u(2)}`);
        await see(`2 ${t.units}: ${u(0)}, ${u(1)}`);
        ok((await page.getByRole("link", { name: "Find on Google Maps" }).count()) === 2, "two map links");
        await goNext(Time);

        // --- 5 -----------------------------------------------------------------
        STEP("5 weekly time");
        // The By day planner: per-day "Add times" on one facility's board.
        ok((await page.getByRole("button", { name: "By day", exact: true }).getAttribute("aria-pressed")) === "true", "opens on the By day planner");
        ok((await page.getByRole("button", { name: fac1, exact: true }).getAttribute("aria-pressed")) === "true", `${fac1} is picked first`);
        const day = (name) => page.locator(`section[aria-label="${name}"]`);
        const addTimes = async (dayName, times, reads) => {
            await day(dayName).getByRole("button", { name: "Add times", exact: true }).click();
            await day(dayName).getByLabel("Start times").fill(times);
            await day(dayName).getByText(`Reads as: ${reads}`, { exact: true }).waitFor();
            checks++;
            await day(dayName).getByRole("button", { name: "Add", exact: true }).click();
        };
        const spots = async (dayName, n) => {
            const text = (await day(dayName).locator("p").first().innerText()).trim();
            ok(text === `${n} ${t.match} spots`, `${dayName}: ${n} ${t.match} spots (got "${text}")`);
        };
        await addTimes("Saturday", "9, 11, 1pm, 3pm", "9:00 AM, 11:00 AM, 1:00 PM, 3:00 PM");
        await addTimes("Sunday", "12pm, 2pm", "12:00 PM, 2:00 PM");
        await spots("Saturday", 12);
        await spots("Sunday", 6);
        ok((await day("Saturday").getByRole("button", { name: `Saturday 9:00 AM, ${u(0)}, ${u(1)}, ${u(2)}`, exact: true }).count()) === 1, "a slot button names its day, time and units");
        ok((await day("Saturday").getByText(`${u(0)}, ${u(1)}, ${u(2)}`, { exact: true }).count()) === 4, `Saturday's 4 times list all 3 ${t.units}`);
        // Adding a time the day already has is skipped, with a note.
        await day("Sunday").getByRole("button", { name: "Add times", exact: true }).click();
        await day("Sunday").getByLabel("Start times").fill("2pm");
        await day("Sunday").getByRole("button", { name: "Add", exact: true }).click();
        await see("Nothing added: 2:00 PM is already on Sunday, so skipped.");
        await day("Sunday").getByRole("button", { name: "Cancel", exact: true }).click();
        await spots("Sunday", 6);
        await page.getByRole("button", { name: fac2, exact: true }).click();
        ok((await page.getByRole("button", { name: fac2, exact: true }).getAttribute("aria-pressed")) === "true", `${fac2} picked`);
        await addTimes("Tuesday", "5pm, 7pm", "5:00 PM, 7:00 PM");
        await day("Tuesday").getByRole("button", { name: "Copy to…", exact: true }).click();
        await dialog().getByRole("button", { name: "Thu", exact: true }).click();
        ok(await dialog().getByLabel("Add to their times").isChecked(), "Add to their times is the default");
        await dialog().getByRole("button", { name: "Copy to 1 day", exact: true }).click();
        await spots("Tuesday", 4);
        await spots("Thursday", 4);
        ok((await day("Thursday").getByRole("button", { name: `Thursday 7:00 PM, ${u(0)}, ${u(1)}`, exact: true }).count()) === 1, "the copy keeps its units");
        const totals = async (name) => (await page.getByRole("group", { name: `${name} totals` }).innerText()).replace(/\s+/g, " ");
        let tot = await totals(fac2);
        ok(tot.includes(`8 ${t.match} spots a week`) && /Weekdays 8 Weekend 0/.test(tot), `${fac2} totals: ${tot}`);
        tot = await totals("All facilities");
        ok(tot.includes(`26 ${t.match} spots a week`) && /Weekdays 8 Weekend 18 Season \d+/.test(tot), `all-facility totals: ${tot}`);
        await page.getByRole("button", { name: fac1, exact: true }).click();
        tot = await totals(fac1);
        ok(tot.includes(`18 ${t.match} spots a week`) && /Weekdays 0 Weekend 18/.test(tot), `${fac1} totals: ${tot}`);
        // The List view still shows the same 10 slots.
        await page.getByRole("button", { name: "List", exact: true }).click();
        ok((await page.locator("table tbody tr").count()) === 10, "10 weekly slots in the List view");
        ok((await page.getByRole("cell", { name: `${u(0)}, ${u(1)}, ${u(2)}`, exact: true }).count()) === 6, `${short1} slots list their 3 units`);
        await page.getByRole("button", { name: "By day", exact: true }).click();

        // --- 6 -----------------------------------------------------------------
        STEP("6 facility sheet");
        await page.getByRole("button", { name: "Upload a facility spreadsheet" }).click();
        await dialog().locator('input[type="file"]').setInputFiles(new URL(`../../public/tutorial/${file}.xlsx`, import.meta.url).pathname);
        await see("What was read");
        ok((await page.locator("#imp-layout").inputValue()) === "rows", "layout: one row per time slot");
        ok((await page.locator("#imp-header").inputValue()) === "2", "heading row: Row 3");
        ok((await page.locator("#imp-courts").inputValue()) === "2", `${t.units} column: Column C`);
        ok((await page.locator("#imp-courts-mode").inputValue()) === "names", `each row is one ${t.unit}, by name`);
        await page.locator("#imp-location").selectOption({ label: fac1 });
        await see("12 time slots on 5 dates, Sat, Apr 3, 2027 to Sat, Apr 24, 2027.", { exact: false });
        ok((await dialog().getByRole("cell", { name: "Closed", exact: true }).count()) === 2, "Tournament and Reserved read as closed");
        ok((await dialog().getByRole("cell", { name: `${u(0)}, ${u(1)}, ${u(2)}`, exact: true }).count()) >= 1, "unit names shown per time");
        await page.getByRole("button", { name: "Import 12 time slots" }).click();
        await see(`Imported 12 ${t.time} slots on 5 dates from ${file}.xlsx.`);
        await page.getByRole("button", { name: "Show dates" }).click();
        await see(`11:00 AM · ${u(0)}, ${u(1)}`);
        await stepper("Facilities");
        await see(`3 ${t.units}: ${u(0)}, ${u(1)}, ${u(2)}`); // no new units added
        await goNext(Time);
        await goNext("Teams");

        // --- 7 -----------------------------------------------------------------
        STEP("7 teams");
        for (const [bracket, text, n] of [["10U", list("TEAMS_10U"), 4], ["12U", list("TEAMS_12U"), 8], ["14U", list("TEAMS_14U"), 6]]) {
            await page.getByRole("button", { name: "Paste a list instead" }).click();
            await page.locator("#bulk-bracket").selectOption({ label: bracket });
            await page.locator("#bulk-text").fill(text);
            await page.getByRole("button", { name: `Add ${n} teams` }).click();
        }
        await see("Teams (18)", { exact: false });
        await see("Pool A · 4 teams");
        await see("Pool B · 4 teams");
        await stepper("Brackets & pools");
        ok((await page.getByText(/Some opponents will be played twice \(only 3 to choose from\)/).count()) === 3, "10U + two 12U pools repeat opponents");
        await stepper("Teams");
        await goNext("Requests");

        // --- 8 -----------------------------------------------------------------
        STEP("8 requests");
        ok((await page.locator("#new-team-name").count()) === 0, "no add-team form on the Requests step");
        const editTeam = async (name) => {
            await page.locator("li").filter({ has: page.getByText(name, { exact: true }) }).getByRole("button", { name: "Add requests" }).click();
            await dialog().waitFor();
        };
        const addRule = async (type) => {
            await dialog().getByLabel("Rule to add").selectOption(type);
            await dialog().getByRole("button", { name: "Add rule" }).click();
        };
        const save = () => dialog().getByRole("button", { name: "Save team" }).click();
        await editTeam("Riverside Hawks 12U");
        await addRule("max_per_weekend");
        await dialog().locator('input[type="number"]').last().fill("1");
        await save();
        await editTeam("Lakeview Lightning 14U");
        await addRule("max_weekend_total");
        await dialog().locator('input[type="number"]').last().fill("3");
        await save();
        await editTeam("Oak Hill Thunder 12U");
        await addRule("not_same_time");
        await dialog().locator("select").filter({ hasText: "Add a team…" }).selectOption({ label: "Oak Hill Thunder 14U" });
        await save();
        await editTeam("Westfield Wolves 10U");
        await addRule("not_dates");
        await dialog().locator('input[type="date"]').nth(0).fill("2027-04-10");
        await dialog().locator('input[type="date"]').nth(1).fill("2027-04-11");
        await dialog().getByRole("button", { name: "Add dates" }).click();
        await save();
        await editTeam("Oak Hill Storm 12U");
        await addRule("no_days");
        await dialog().getByRole("button", { name: "Tue", exact: true }).click();
        await dialog().getByRole("button", { name: "Prefer", exact: true }).click();
        await save();
        await see(`At most 1 ${t.match} per weekend`);
        await see(`At most 3 ${t.matches} on Sat/Sun all season`);
        await see("Not at the same time as Oak Hill Thunder 14U");
        await see("Unavailable Sat, Apr 10 – Sun, Apr 11");
        await see("Prefers: Not on Tuesdays");
        await see("5 of 18 teams have requests.", { exact: false });
        await goNext("Review & schedule");

        // --- 9 -----------------------------------------------------------------
        STEP("9 generate");
        await see("Ready to schedule");
        ok((await page.getByText("Before you schedule").count()) === 0, "nothing blocking");
        await page.getByRole("button", { name: "Generate schedule" }).click();
        await see(`${cap(t.matches)} placed`);
        const stats = async () => (await page.locator("section.grid.grid-cols-2").innerText()).replace(/\s+/g, " ");
        let s = await stats();
        ok(new RegExp(`${t.matches} PLACED 45 of 45`, "i").test(s) && /NOT PLACED 0/i.test(s) && /BREAK A MUST-RULE 0/i.test(s) && /TEAMS SHORT 0/i.test(s), `stats: ${s}`);
        await see("everyone’s covered");
        ok((await page.getByText(new RegExp(`^ · (${u(0)}|${u(1)}|${u(2)})$`)).count()) > 0, `games name their ${t.unit}`);
        await page.getByRole("button", { name: "Finish setup" }).click();
        await page.getByRole("navigation", { name: "League sections" }).waitFor();
        ok(!page.url().includes("setup="), "finishing setup drops ?setup=1");
        ok((await page.getByRole("button", { name: "Schedule", exact: true }).getAttribute("aria-current")) === "page", "opens on the Schedule tab");
        for (const x of ["Teams", "Brackets & pools", facTab, "Season"]) ok((await page.getByRole("button", { name: x, exact: true }).count()) === 1, `${x} tab`);
        ok((await page.getByRole("button", { name: "Setup guide" }).count()) === 1, "Setup guide button");
        s = await stats();
        ok(new RegExp(`${t.matches} PLACED 45 of 45`, "i").test(s), `still 45 of 45 after finishing: ${s}`);
        await page.getByRole("button", { name: `${cap(t.unit)} use` }).click();
        const apr10 = await page.locator(".card", { hasText: "Sat, Apr 10" }).first().innerText();
        ok(!new RegExp(`(11:00 AM|1:00 PM|3:00 PM) · ${short1}`).test(apr10), `Apr 10 at ${short1}: only 9:00 (sheet)`);
        ok(new RegExp(`9:00 AM · ${short1} \\S+ · \\d/2`).test(apr10), `Apr 10 9am at ${short1} holds 2: ${apr10.replace(/\s+/g, " ")}`);

        // --- 10 ----------------------------------------------------------------
        STEP("10 move, pick a unit, lock");
        await page.getByRole("button", { name: "By date" }).click();
        const movable = page.locator("li").filter({ has: page.getByText(/^1[24]U$/) }).first();
        ok((await movable.count()) === 1, "found a 12U/14U row to move");
        await movable.getByRole("button", { name: "Move", exact: true }).click();
        let picked = null;
        const options = dialog().locator("button[aria-pressed]");
        for (let i = 0; i < Math.min(await options.count(), 40) && !picked; i++) {
            await options.nth(i).click();
            const sel = dialog().getByLabel(`${cap(t.unit)} to use`);
            if ((await sel.count()) && (await sel.locator("option").count()) >= 2) {
                picked = await sel.locator("option").nth(1).textContent();
                await sel.selectOption({ label: picked });
            }
        }
        ok(picked, `a time with 2+ free ${t.units} to choose from`);
        await dialog().getByRole("button", { name: "Move here and lock" }).click();
        const lockedRow = () => page.locator("li").filter({ has: page.getByText("Locked", { exact: true }) }).first();
        await see("Locked", { exact: true });
        ok((await lockedRow().innerText()).includes(`· ${picked}`), `moved ${t.match} is on ${picked}`);
        await page.getByRole("button", { name: "Regenerate schedule" }).click();
        await dialog().getByRole("button", { name: "Regenerate" }).click();
        await page.waitForTimeout(2500);
        ok((await lockedRow().innerText()).includes(`· ${picked}`), `still on ${picked} after regenerating`);
        s = await stats();
        ok(/45 of 45/.test(s) && /BREAK A MUST-RULE 0/i.test(s), `after regenerate: ${s}`);

        // --- 11 ----------------------------------------------------------------
        STEP("11 problems explained");
        const set10ULatest = async (time) => {
            await tab("Brackets & pools");
            await page.locator(".card").filter({ has: page.getByRole("heading", { name: "10U", exact: true }) }).getByRole("button", { name: "Edit" }).click();
            await page.locator("#br-latest").fill(time);
            await page.getByRole("button", { name: "Save bracket" }).click();
            await tab("Schedule");
            await page.locator("#gen-scope").selectOption({ label: "10U only" });
            await page.getByRole("button", { name: "Regenerate schedule" }).click();
            await dialog().getByRole("button", { name: "Regenerate" }).click();
            await page.waitForTimeout(2500);
        };
        await set10ULatest("08:00");
        await see("Couldn’t place (10)");
        await see(/^10U can’t start after 8:00 AM$/);
        await see(/Widen the bracket’s earliest\/latest start/);
        ok((await page.getByRole("button", { name: "Go to Brackets & pools" }).count()) >= 10, "every unplaced game links to the fix");
        await set10ULatest("17:30");
        s = await stats();
        ok(/45 of 45/.test(s) && /NOT PLACED 0/i.test(s), `back to full: ${s}`);

        // --- 12 ----------------------------------------------------------------
        STEP("12 export and backup");
        const [csvDl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download CSV" }).click()]);
        const lines = readFileSync(await csvDl.path(), "utf8").replace(/^\uFEFF/, "").trim().split(/\r?\n/);
        ok(lines[0].startsWith(`"Date","Day","Start","Bracket","Pool","Home","Away","Facility","${cap(t.unit)}"`), `CSV header: ${lines[0]}`);
        ok(lines.length === 46, `CSV has 45 rows (got ${lines.length - 1})`);
        ok(lines.slice(1).every((l) => new RegExp(`"(${u(0)}|${u(1)}|${u(2)})"`).test(l)), `every CSV row names its ${t.unit}`);
        await tab("Season");
        const [bkDl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download backup" }).click()]);
        ok(bkDl.suggestedFilename() === `${leagueName.replace(/\s+/g, "-")}-backup.json`, `backup name ${bkDl.suggestedFilename()}`);
        const backup = JSON.parse(readFileSync(await bkDl.path(), "utf8"));

        // --- the wizard at phone width ----------------------------------------
        // Its step list is ~960px wide and once pushed the whole page sideways
        // (Next half off-screen). Checked on the finished league, so every
        // step has its fullest content, and with a dialog open.
        STEP("wizard at 390px");
        await page.getByRole("button", { name: "Setup guide" }).click();
        await page.setViewportSize({ width: 390, height: 800 });
        const fits = async (what) => {
            const w = await page.evaluate(() => document.documentElement.scrollWidth);
            ok(w === 390, `${what}: no sideways scroll at 390px (scrollWidth ${w})`);
        };
        for (const title of ["Name & sport", "Season", "Brackets & pools", "Facilities", Time, "Teams", "Requests", "Review & schedule"]) {
            await stepper(title);
            await see(new RegExp(`^\\d\\. ${title.replace(/[&]/g, "\\$&")}$`));
            await fits(title);
            const box = await page.getByRole("navigation", { name: "Setup navigation" }).locator(".btn-primary").boundingBox();
            ok(box && box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 800, `${title}: the Next/Finish button is fully on screen`);
            if (title === Time) {
                // The day planner stacks its days on a phone; none may poke out sideways.
                ok((await page.getByRole("button", { name: "By day", exact: true }).getAttribute("aria-pressed")) === "true", "the time step opens on the planner");
                for (const d of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]) {
                    const b = await page.locator(`section[aria-label="${d}"]`).boundingBox();
                    ok(b && b.x >= 0 && b.x + b.width <= 390, `${d} column fits at 390px`);
                }
                await page.locator('section[aria-label="Saturday"]').getByRole("button", { name: "Add times", exact: true }).click();
                await fits("planner with Add times open");
                await page.locator('section[aria-label="Saturday"]').getByRole("button", { name: "Cancel", exact: true }).click();
                await page.locator('section[aria-label="Saturday"]').getByRole("button", { name: "Copy to…", exact: true }).click();
                await dialog().waitFor();
                await fits("Copy to dialog");
                await page.keyboard.press("Escape");
                ok((await dialog().count()) === 0, "Escape closes Copy to");
            }
            if (title === "Brackets & pools") {
                await page.getByRole("button", { name: "Add bracket" }).click();
                await dialog().waitFor();
                await fits("New bracket dialog");
                await page.keyboard.press("Escape");
                ok((await dialog().count()) === 0, "Escape closes the dialog");
            }
        }
        // Walking with Next (not by tapping chips, which Playwright scrolls to),
        // the current step's chip must stay in the step list's visible part.
        await stepper("Name & sport");
        for (const title of ["Season", "Brackets & pools", "Facilities", Time, "Teams", "Requests", "Review & schedule"]) {
            await goNext(title);
            const list = await page.getByLabel("Setup steps").locator("ol").boundingBox();
            const chip = await page.getByLabel("Setup steps").locator('[aria-current="step"]').boundingBox();
            ok(list && chip && chip.x >= list.x - 1 && chip.x + chip.width <= list.x + list.width + 1, `${title}: current step chip is in view on a phone`);
        }
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.getByRole("button", { name: "Exit setup" }).click();

        // --- independent re-check of the finished league -------------------------
        STEP("verify the finished schedule");
        const { data, schedule } = backup;
        ok(backup.format === "seasonsmith-league" && data.settings.sport === sport, "backup format and sport");
        const name = Object.fromEntries(data.teams.map((x) => [x.id, x.name]));
        const games = (team) => schedule.matches.filter((m) => name[m.home] === team || name[m.away] === team);
        ok(schedule.matches.length === 45 && schedule.matches.every((m) => m.date), "45 placed");
        const a = audit(data, schedule.matches);
        ok([...a.issues.values()].every((v) => v.hard.length === 0), "no must-rule broken (engine audit)");
        a.usage.forEach((n, i) => ok(n <= a.ctx.instances[i].capacity, "no time over capacity"));
        const seen = new Set();
        for (const m of schedule.matches) {
            ok(m.unitIds?.length === 1, `every ${t.match} has one ${t.unit}`);
            const key = `${m.date}|${m.time}|${m.unitIds[0]}`;
            ok(!seen.has(key), `no ${t.unit} double-booked`);
            seen.add(key);
        }
        for (const team of data.teams) ok(games(team.name).length === 5, `${team.name} has 5`);
        const wk = games("Riverside Hawks 12U").map((m) => weekendKey(isoToDay(m.date))).filter((w) => w !== null);
        ok(new Set(wk).size === wk.length, "Riverside Hawks 12U: at most 1 per weekend");
        ok(games("Lakeview Lightning 14U").filter((m) => isWeekend(isoToDay(m.date))).length <= 3, "Lakeview Lightning 14U: max 3 weekend");
        ok(games("Westfield Wolves 10U").every((m) => m.date !== "2027-04-10" && m.date !== "2027-04-11"), "Westfield Wolves 10U: not Apr 10-11");
        for (const x of games("Oak Hill Thunder 12U"))
            for (const y of games("Oak Hill Thunder 14U")) ok(!(x.date === y.date && Math.abs(toMinutes(x.time) - toMinutes(y.time)) < data.settings.matchMinutes), "Thunder 12U/14U never overlap");
        const tenU = data.brackets.find((b) => b.name === "10U").id;
        ok(schedule.matches.filter((m) => m.bracketId === tenU).every((m) => toMinutes(m.time) <= toMinutes("17:30")), "no 10U after 5:30 PM");
        ok(!schedule.matches.some((m) => m.date === "2027-03-27" || m.date === "2027-03-28"), "blackout weekend empty");

        STEP("tutorial page in this sport, sample files");
        await page.goto(BASE);
        const site = page.getByRole("navigation", { name: "Site" });
        await site.getByRole("link", { name: "Guide", exact: true }).click();
        await page.waitForURL(/\/guide$/);
        await see("How it works");
        ok((await page.locator("#t-create").count()) === 0, "the guide no longer holds the tutorial");
        await site.getByRole("link", { name: "Tutorial", exact: true }).click();
        await page.waitForURL(/\/tutorial$/);
        ok((await page.locator("#how-it-works").count()) === 0, "the tutorial is its own page");
        ok((await site.getByRole("link", { name: "Tutorial", exact: true }).getAttribute("aria-current")) === "page", "Tutorial is marked current");
        // A ?sport= link (a league's Help) is remembered for the other page.
        await page.goto(`${BASE}/guide?sport=${sport}`);
        await see("How it works");
        await site.getByRole("link", { name: "Tutorial", exact: true }).click();
        await page.waitForURL(/\/tutorial$/);
        await page.waitForFunction((s) => document.querySelector("#guide-sport-tutorial")?.value === s, sport);
        checks++;
        // Old bookmarks into the tutorial's former place on /guide.
        await page.goto(`${BASE}/guide#t-create`);
        await page.waitForURL(/\/tutorial#t-create$/);
        checks++;
        await page.goto(`${BASE}/tutorial?sport=${sport}`);
        await see(`Spring 2027 Youth ${t.name}`);
        await see(`Imported 12 ${t.time} slots on 5 dates from ${file}.xlsx.`, { exact: false });
        for (const ext of ["xlsx", "csv"]) ok((await page.request.get(`${BASE}/tutorial/${file}.${ext}`)).ok(), `${file}.${ext} is served`);
        ok(pageErrors.length === 0, `no page errors: ${pageErrors.join(" | ")}`);
        console.log(`[${sport}] ${checks} checks passed.`);
        await ctx.close();
        return checks;
    } catch (err) {
        console.error(`FAIL ${err.message}`);
        const shot = process.env.FAIL_SHOT ?? "tutorial-failure.png";
        try {
            await page.screenshot({ path: shot, fullPage: true });
            console.error(`screenshot: ${shot}`);
        } catch {
            // ignore
        }
        await browser.close();
        process.exit(1);
    }
}
