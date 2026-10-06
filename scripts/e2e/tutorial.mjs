// scripts/e2e/tutorial.mjs
//
// Walks the /guide tutorial in a real browser, word for word -- same league
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
const guideSrc = readFileSync(new URL("../../components/guide/GuideContent.tsx", import.meta.url), "utf8");
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
    const dialog = () => page.getByRole("dialog");

    try {
        // --- 1 -----------------------------------------------------------------
        STEP("1 create the league");
        await page.goto(BASE);
        await page.locator("#league-name").fill(leagueName);
        await page.locator("#league-sport").selectOption(sport);
        await page.getByText("A blank league").click();
        await page.getByRole("button", { name: "Create league" }).click();
        await page.waitForURL(/\/league\//);
        await page.locator("#season-start").waitFor();
        ok(await page.locator("#season-start").isVisible(), "opens on the Season tab");
        ok((await page.locator("#match-minutes").inputValue()) === String(t.minutes), `${t.match} length defaults to ${t.minutes} for ${t.name}`);
        await see(t.name, { exact: true });
        await tab("Schedule");
        await see("Before you schedule");

        // --- 2 -----------------------------------------------------------------
        STEP("2 season dates");
        await tab("Season");
        await page.locator("#season-start").fill("2027-03-06");
        await page.locator("#season-end").fill("2027-05-16");
        await page.locator("#blackout-from").fill("2027-03-27");
        await page.locator("#blackout-to").fill("2027-03-28");
        await page.getByRole("button", { name: "Add dates" }).click();
        await page.locator("#club-limit").fill("2");
        await see("Sat, Mar 6, 2027 to Sun, May 16, 2027, about 11 weeks.");
        await see("Sat, Mar 27 – Sun, Mar 28");
        await see(`${cap(t.units)} used by one ${t.match}`);

        // --- 3 -----------------------------------------------------------------
        STEP("3 brackets");
        await tab("Brackets & pools");
        for (const [name, latest] of [["10U", "17:30"], ["12U", "18:30"], ["14U", ""]]) {
            await page.getByRole("button", { name: "Add bracket" }).click();
            await page.locator("#br-name").fill(name);
            ok((await page.locator("#br-matches").inputValue()) === "5", "matches default to 5");
            if (latest) await page.locator("#br-latest").fill(latest);
            await page.getByRole("button", { name: "Save bracket" }).click();
        }
        await see(`5 guaranteed ${t.matches} per team · starts until 5:30 PM`);
        ok((await page.getByText("No teams yet.").count()) === 3, "three empty bracket cards");

        // --- 4 -----------------------------------------------------------------
        STEP("4 facilities and units");
        await tab(facTab);
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

        // --- 5 -----------------------------------------------------------------
        STEP("5 weekly time");
        const setDays = async (want) => {
            const group = page.getByRole("group").filter({ has: page.getByRole("button", { name: "Mon", exact: true }) }).first();
            for (const d of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
                const b = group.getByRole("button", { name: d, exact: true });
                if (((await b.getAttribute("aria-pressed")) === "true") !== want.includes(d)) await b.click();
            }
        };
        for (const [days, times, loc, atOnce, n] of [
            [["Sat"], "9, 11, 1pm, 3pm", fac1, 3, 4],
            [["Sun"], "12pm, 2pm", fac1, 3, 2],
            [["Tue", "Thu"], "5pm, 7pm", fac2, 2, 4],
        ]) {
            await setDays(days);
            await page.locator("#q-times").fill(times);
            await page.locator("#q-loc").selectOption({ label: loc });
            await see(`${atOnce} ${t.matches} at once`);
            await page.getByRole("button", { name: `Add ${n} slots` }).click();
        }
        ok((await page.locator("table tbody tr").count()) === 10, "10 weekly slots");
        ok((await page.getByRole("cell", { name: `${u(0)}, ${u(1)}, ${u(2)}`, exact: true }).count()) === 6, "Riverside slots list their 3 units");
        await see(new RegExp(`^26 ${t.match} spots a week · \\d+ across the season`));

        // --- 6 -----------------------------------------------------------------
        STEP("6 facility sheet");
        await page.getByRole("button", { name: "Upload a facility sheet" }).click();
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
        await see(`3 ${t.units}: ${u(0)}, ${u(1)}, ${u(2)}`); // no new units added
        await page.getByRole("button", { name: "Show dates" }).click();
        await see(`11:00 AM · ${u(0)}, ${u(1)}`);

        // --- 7 -----------------------------------------------------------------
        STEP("7 teams");
        await tab("Teams");
        for (const [bracket, text, n] of [["10U", list("TEAMS_10U"), 4], ["12U", list("TEAMS_12U"), 8], ["14U", list("TEAMS_14U"), 6]]) {
            await page.getByRole("button", { name: "Paste a list instead" }).click();
            await page.locator("#bulk-bracket").selectOption({ label: bracket });
            await page.locator("#bulk-text").fill(text);
            await page.getByRole("button", { name: `Add ${n} teams` }).click();
        }
        await see("Teams (18)", { exact: false });
        await see("Pool A · 4 teams");
        await see("Pool B · 4 teams");
        await tab("Brackets & pools");
        ok((await page.getByText(/Some opponents will be played twice \(only 3 to choose from\)/).count()) === 3, "10U + two 12U pools repeat opponents");

        // --- 8 -----------------------------------------------------------------
        STEP("8 requests");
        await tab("Teams");
        const editTeam = async (name) => {
            await page.locator("li").filter({ has: page.getByText(name, { exact: true }) }).getByRole("button", { name: "Edit" }).click();
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

        // --- 9 -----------------------------------------------------------------
        STEP("9 generate");
        await tab("Schedule");
        await page.getByRole("button", { name: "Generate schedule" }).click();
        await see(`${cap(t.matches)} placed`);
        const stats = async () => (await page.locator("section.grid.grid-cols-2").innerText()).replace(/\s+/g, " ");
        let s = await stats();
        ok(new RegExp(`${t.matches} PLACED 45 of 45`, "i").test(s) && /NOT PLACED 0/i.test(s) && /BREAK A MUST-RULE 0/i.test(s) && /TEAMS SHORT 0/i.test(s), `stats: ${s}`);
        await see("everyone’s covered");
        ok((await page.getByText(new RegExp(`^ · (${u(0)}|${u(1)}|${u(2)})$`)).count()) > 0, `games name their ${t.unit}`);
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

        STEP("guide in this sport, sample files");
        await page.goto(`${BASE}/guide?sport=${sport}`);
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
