// scripts/e2e/tutorial.mjs
//
// Walks the /guide tutorial in a real browser, word for word -- same league
// name, dates, brackets, facilities, times, sample sheet, team lists and
// captain requests -- and checks every "You should see" in the guide. If the
// guide or the UI changes, this is what notices that they no longer agree.
//
// Run against a server in browser mode (no env vars), e.g.:
//
//   npm run build && npx next start -p 3004 &
//   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.mjs \
//     node --experimental-strip-types --no-warnings scripts/e2e/tutorial.mjs
//
// Playwright is deliberately NOT a dependency of this repo; install it in a
// scratch directory and point PLAYWRIGHT_MODULE at it. Chromium is taken
// from CHROMIUM_PATH (default /opt/pw-browsers/chromium) if it exists.
import { existsSync, readFileSync } from "node:fs";
import { audit } from "../../lib/engine/engine.ts";
import { isoToDay, toMinutes, weekendKey, isWeekend } from "../../lib/engine/dates.ts";

const BASE = process.env.BASE_URL ?? "http://localhost:3004";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const exe = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";
const browser = await chromium.launch(existsSync(exe) ? { executablePath: exe } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
page.setDefaultTimeout(15_000);
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

let step = "";
let checks = 0;
const STEP = (s) => {
    step = s;
    console.log(`STEP ${s}`);
};
function ok(cond, msg) {
    checks++;
    if (!cond) throw new Error(`[${step}] ${msg}`);
}
const see = async (text, opts = {}) => {
    await page.getByText(text, opts).first().waitFor({ state: "visible" });
    checks++;
};
const tab = (name) => page.getByRole("button", { name, exact: true }).click();
const dialog = () => page.getByRole("dialog");

try {
    // --- 1 -------------------------------------------------------------------
    STEP("1 create the league");
    await page.goto(BASE);
    await page.locator("#league-name").fill("Spring 2027 Junior Team Tennis");
    await page.getByText("A blank league").click();
    await page.getByRole("button", { name: "Create league" }).click();
    await page.waitForURL(/\/league\//);
    ok(await page.locator("#season-start").isVisible(), "opens on the Season tab");
    await tab("Schedule");
    await see("Before you schedule");

    // --- 2 -------------------------------------------------------------------
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

    // --- 3 -------------------------------------------------------------------
    STEP("3 brackets");
    await tab("Brackets & pools");
    for (const [name, latest] of [["10U", "17:30"], ["12U", "18:30"], ["14U", ""]]) {
        await page.getByRole("button", { name: "Add bracket" }).click();
        await page.locator("#br-name").fill(name);
        ok((await page.locator("#br-matches").inputValue()) === "5", "matches default to 5");
        if (latest) await page.locator("#br-latest").fill(latest);
        await page.getByRole("button", { name: "Save bracket" }).click();
    }
    await see("5 guaranteed matches per team · starts until 5:30 PM");
    ok((await page.getByText("No teams yet.").count()) === 3, "three empty bracket cards");

    // --- 4 -------------------------------------------------------------------
    STEP("4 locations");
    await tab("Courts & times");
    for (const name of ["Riverside Tennis Center", "Lakeview Park Courts"]) {
        await page.getByRole("button", { name: "Add location" }).click();
        await page.locator("#loc-name").fill(name);
        await page.getByRole("button", { name: "Save location" }).click();
    }
    ok((await page.getByRole("link", { name: "Find on Google Maps" }).count()) === 2, "two map links");
    ok((await page.getByText("0 weekly time slots").count()) === 2, "no slots yet");

    // --- 5 -------------------------------------------------------------------
    STEP("5 weekly slots");
    const setDays = async (want) => {
        for (const d of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
            const b = page.getByRole("group").filter({ has: page.getByRole("button", { name: "Mon", exact: true }) }).first().getByRole("button", { name: d, exact: true });
            const on = (await b.getAttribute("aria-pressed")) === "true";
            if (on !== want.includes(d)) await b.click();
        }
    };
    for (const [days, times, loc, cap, n] of [
        [["Sat"], "9, 11, 1pm, 3pm", "Riverside Tennis Center", "3", 4],
        [["Sun"], "12pm, 2pm", "Riverside Tennis Center", "3", 2],
        [["Tue", "Thu"], "5pm, 7pm", "Lakeview Park Courts", "2", 4],
    ]) {
        await setDays(days);
        await page.locator("#q-times").fill(times);
        await page.locator("#q-loc").selectOption({ label: loc });
        await page.locator("#q-cap").fill(cap);
        await page.getByRole("button", { name: `Add ${n} slots` }).click();
    }
    ok((await page.locator("table tbody tr").count()) === 10, "10 weekly slots");
    await see(/^26 match spots a week · \d+ across the season/);

    // --- 6 -------------------------------------------------------------------
    STEP("6 facility sheet");
    await page.getByRole("button", { name: "Upload a facility sheet" }).click();
    await dialog().locator('input[type="file"]').setInputFiles(new URL("../../public/tutorial/riverside-april-2027.xlsx", import.meta.url).pathname);
    await see("What was read");
    ok((await page.locator("#imp-layout").inputValue()) === "dates-down", "layout guessed as dates-down grid");
    ok((await page.locator("#imp-header").inputValue()) === "2", "heading row guessed as Row 3");
    await page.locator("#imp-location").selectOption({ label: "Riverside Tennis Center" });
    await see("20 time slots on 5 dates, Sat, Apr 3, 2027 to Sat, Apr 24, 2027.", { exact: false });
    ok((await dialog().getByRole("cell", { name: "Closed", exact: true }).count()) === 5, "5 closed cells: 2 Tournament, 2 dashes, 1 Reserved");
    await page.getByRole("button", { name: "Import 20 time slots" }).click();
    await see("Imported 20 time slots on 5 dates from riverside-april-2027.xlsx.");
    await page.getByRole("button", { name: "Show dates" }).click();
    await see(/^11:00 AM · 4 courts$/);

    // --- 7 -------------------------------------------------------------------
    STEP("7 teams");
    await tab("Teams");
    const guide = readFileSync(new URL("../../app/guide/page.tsx", import.meta.url), "utf8");
    const list = (name) => new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`).exec(guide)[1];
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

    // --- 8 -------------------------------------------------------------------
    STEP("8 captains' requests");
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

    await editTeam("Riverside Aces 12U");
    await addRule("max_per_weekend");
    await dialog().locator('input[type="number"]').last().fill("1");
    await save();
    await editTeam("Lakeview Smash 14U");
    await addRule("max_weekend_total");
    await dialog().locator('input[type="number"]').last().fill("3");
    await save();
    await editTeam("Oak Hill Topspin 12U");
    await addRule("not_same_time");
    await dialog().locator("select").filter({ hasText: "Add a team…" }).selectOption({ label: "Oak Hill Topspin 14U" });
    await save();
    await editTeam("Westfield Rally 10U");
    await addRule("not_dates");
    await dialog().locator('input[type="date"]').nth(0).fill("2027-04-10");
    await dialog().locator('input[type="date"]').nth(1).fill("2027-04-11");
    await dialog().getByRole("button", { name: "Add dates" }).click();
    await save();
    await editTeam("Oak Hill Spin 12U");
    await addRule("no_days");
    await dialog().getByRole("button", { name: "Tue", exact: true }).click();
    await dialog().getByRole("button", { name: "Prefer", exact: true }).click();
    await save();
    await see("At most 1 match per weekend");
    await see("At most 3 matches on Sat/Sun all season");
    await see("Not at the same time as Oak Hill Topspin 14U");
    await see("Unavailable Sat, Apr 10 – Sun, Apr 11");
    await see("Prefers: Not on Tuesdays");

    // --- 9 -------------------------------------------------------------------
    STEP("9 generate");
    await tab("Schedule");
    await page.getByRole("button", { name: "Generate schedule" }).click();
    await see("Matches placed");
    const stats = async () => (await page.locator("section.grid.grid-cols-2").innerText()).replace(/\s+/g, " ");
    let s = await stats();
    ok(/MATCHES PLACED 45 of 45/i.test(s) && /NOT PLACED 0/i.test(s) && /BREAK A MUST-RULE 0/i.test(s) && /TEAMS SHORT 0/i.test(s), `stats: ${s}`);
    await see("everyone’s covered");
    await page.getByRole("button", { name: "Court use" }).click();
    const apr10 = await page.locator(".card", { hasText: "Sat, Apr 10" }).first().innerText();
    ok(!/1:00 PM · Riverside/.test(apr10) && !/3:00 PM · Riverside/.test(apr10), "no Riverside 1pm/3pm on Apr 10 (tournament)");
    ok(/9:00 AM · Riverside Tennis · \d\/2/.test(apr10), "Apr 10 9am at Riverside holds 2 (from the sheet)");

    // --- 10 ------------------------------------------------------------------
    STEP("10 move and lock");
    await page.getByRole("button", { name: "By date" }).click();
    await page.getByRole("button", { name: "Move", exact: true }).first().click();
    await dialog().locator("button[aria-pressed]").first().click();
    await dialog().getByRole("button", { name: "Move here and lock" }).click();
    await see("Locked", { exact: true });
    await page.getByRole("button", { name: "Regenerate schedule" }).click();
    await dialog().getByRole("button", { name: "Regenerate" }).click();
    await page.waitForTimeout(2500);
    await see("Locked", { exact: true });
    s = await stats();
    ok(/45 of 45/.test(s) && /BREAK A MUST-RULE 0/i.test(s), `after regenerate: ${s}`);

    // --- 11 ------------------------------------------------------------------
    STEP("11 problems explained");
    const set10ULatest = async (t) => {
        await tab("Brackets & pools");
        await page.locator(".card").filter({ has: page.getByRole("heading", { name: "10U", exact: true }) }).getByRole("button", { name: "Edit" }).click();
        await page.locator("#br-latest").fill(t);
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
    ok((await page.getByRole("button", { name: "Go to Brackets & pools" }).count()) >= 10, "every unplaced match links to the fix");
    await set10ULatest("17:30");
    s = await stats();
    ok(/45 of 45/.test(s) && /NOT PLACED 0/i.test(s), `back to full: ${s}`);

    // --- 12 ------------------------------------------------------------------
    STEP("12 export and backup");
    const [csvDl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download CSV" }).click()]);
    const csv = readFileSync(await csvDl.path(), "utf8");
    const lines = csv.replace(/^﻿/, "").trim().split(/\r?\n/);
    ok(lines[0].startsWith('"Date","Day","Start","Bracket","Pool","Home","Away","Location"'), "CSV header");
    ok(lines.length === 46, `CSV has 45 match rows (got ${lines.length - 1})`);
    await tab("Season");
    const [bkDl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download backup" }).click()]);
    ok(bkDl.suggestedFilename() === "Spring-2027-Junior-Team-Tennis-backup.json", `backup name ${bkDl.suggestedFilename()}`);
    const backup = JSON.parse(readFileSync(await bkDl.path(), "utf8"));

    // --- independent re-check of the finished league ---------------------------
    STEP("verify the finished schedule");
    const { data, schedule } = backup;
    const name = Object.fromEntries(data.teams.map((t) => [t.id, t.name]));
    const games = (team) => schedule.matches.filter((m) => name[m.home] === team || name[m.away] === team);
    ok(schedule.matches.length === 45 && schedule.matches.every((m) => m.date), "45 placed matches");
    const a = audit(data, schedule.matches);
    ok([...a.issues.values()].every((v) => v.hard.length === 0), "no must-rule broken (engine audit)");
    a.usage.forEach((u, i) => ok(u <= a.ctx.instances[i].capacity, "no time over capacity"));
    for (const t of data.teams) ok(games(t.name).length === 5, `${t.name} has 5 matches`);
    const wk = games("Riverside Aces 12U").map((m) => weekendKey(isoToDay(m.date))).filter((w) => w !== null);
    ok(new Set(wk).size === wk.length, "Riverside Aces 12U: at most 1 per weekend");
    ok(games("Lakeview Smash 14U").filter((m) => isWeekend(isoToDay(m.date))).length <= 3, "Lakeview Smash 14U: max 3 weekend matches");
    ok(games("Westfield Rally 10U").every((m) => m.date !== "2027-04-10" && m.date !== "2027-04-11"), "Westfield Rally 10U: not Apr 10-11");
    for (const x of games("Oak Hill Topspin 12U"))
        for (const y of games("Oak Hill Topspin 14U")) ok(!(x.date === y.date && Math.abs(toMinutes(x.time) - toMinutes(y.time)) < 90), "Topspin 12U/14U never overlap");
    const tenU = data.brackets.find((b) => b.name === "10U").id;
    ok(schedule.matches.filter((m) => m.bracketId === tenU).every((m) => toMinutes(m.time) <= toMinutes("17:30")), "no 10U after 5:30 PM");
    ok(!schedule.matches.some((m) => m.date === "2027-03-27" || m.date === "2027-03-28"), "blackout weekend empty");

    STEP("guide page and sample files");
    await page.goto(`${BASE}/guide`);
    await see("Tutorial: build a league start to finish");
    for (const f of ["riverside-april-2027.xlsx", "riverside-april-2027.csv"]) {
        const r = await page.request.get(`${BASE}/tutorial/${f}`);
        ok(r.ok(), `${f} is served`);
    }

    ok(pageErrors.length === 0, `no page errors: ${pageErrors.join(" | ")}`);
    console.log(`tutorial e2e: all ${checks} checks passed.`);
    await browser.close();
} catch (err) {
    console.error(`FAIL ${err.message}`);
    try {
        await page.screenshot({ path: process.env.FAIL_SHOT ?? "tutorial-failure.png", fullPage: true });
        console.error(`screenshot: ${process.env.FAIL_SHOT ?? "tutorial-failure.png"}`);
    } catch {
        // ignore
    }
    await browser.close();
    process.exit(1);
}
