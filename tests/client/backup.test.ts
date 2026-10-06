import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { copyText, downloadText, fileSafe, makeBackup, parseBackup } from "../../lib/client/backup.ts";
import { APP_NAME } from "../../lib/brand.ts";
import { sampleLeague } from "../../lib/engine/sample.ts";
import { emptyLeague, emptySchedule } from "../../lib/engine/sanitize.ts";
import { SPORT_IDS } from "../../lib/engine/sports.ts";
import type { Schedule } from "../../lib/engine/types.ts";
import { run } from "../support/fixtures.ts";

describe("makeBackup / parseBackup", () => {
    test("round trip: name, league and schedule come back exactly, in every sport", () => {
        for (const sport of SPORT_IDS) {
            const data = sampleLeague(sport);
            const schedule: Schedule = { matches: run(data, [], { maxAttempts: 1 }).matches, generatedAt: "2027-01-01T00:00:00.000Z", warnings: ["w"] };
            const back = parseBackup(makeBackup("Spring 2027", data, schedule));
            assert.deepEqual(back, { name: "Spring 2027", data, schedule }, sport);
        }
    });

    test("the file is tagged, versioned, dated and readable", () => {
        const before = Date.now();
        const text = makeBackup("X", emptyLeague(), emptySchedule());
        const j = JSON.parse(text);
        assert.equal(j.format, "seasonsmith-league");
        assert.equal(j.version, 1);
        assert.ok(Date.parse(j.exportedAt) >= before - 1000);
        assert.ok(text.includes("\n  "), "pretty-printed");
    });

    test("backups from when the app was called Courtside still load", () => {
        const old = JSON.stringify({ format: "courtside-league", version: 1, name: "Old season", data: sampleLeague(), schedule: emptySchedule() });
        assert.equal(parseBackup(old).name, "Old season");
        assert.equal(parseBackup(old).data.teams.length, 24);
    });

    test("an old backup missing newer fields is coerced, not refused", () => {
        const data = structuredClone(sampleLeague()) as unknown as { settings: Record<string, unknown>; locations: Record<string, unknown>[] };
        delete data.settings.sport;
        for (const l of data.locations) delete l.units;
        const back = parseBackup(JSON.stringify({ format: "courtside-league", name: "Old", data }));
        assert.equal(back.data.settings.sport, "tennis");
        assert.ok(back.data.locations.every((l) => Array.isArray(l.units)));
        assert.deepEqual(back.schedule, emptySchedule());
    });

    test("names: trimmed, cut to 120, and a blank or missing name becomes 'Imported league'", () => {
        const make = (name: unknown) => parseBackup(JSON.stringify({ format: "seasonsmith-league", name, data: {} })).name;
        assert.equal(make("  Spring  "), "Spring");
        assert.equal(make("x".repeat(500)).length, 120);
        for (const n of ["", "   ", undefined, 5, null]) assert.equal(make(n), "Imported league");
    });

    test("not JSON: refused with a human message naming the app", () => {
        for (const bad of ["", "{", "not json", "<html>"]) assert.throws(() => parseBackup(bad), { message: `That file isn’t a ${APP_NAME} backup (it isn’t valid JSON).` });
    });

    test("JSON that isn't a backup: refused, not loaded as an empty league", () => {
        for (const bad of ["null", "[]", "5", '"x"', "{}", '{"format":"other"}', '{"format":5}', '{"data":{"teams":[]}}', JSON.stringify({ format: "Seasonsmith-League" })])
            assert.throws(() => parseBackup(bad), { message: `That file isn’t a ${APP_NAME} backup.` }, bad);
    });

    test("hostile contents are sanitized (javascript: map links, bad ids)", () => {
        const data = sampleLeague();
        data.locations[0].mapUrl = "javascript:alert(1)";
        const back = parseBackup(makeBackup("x", data, emptySchedule()));
        assert.equal(back.data.locations[0].mapUrl, "");
    });
});

describe("fileSafe", () => {
    test("keeps letters, digits, spaces (as dashes), _ and -", () => {
        assert.equal(fileSafe("Spring 2027 League"), "Spring-2027-League");
        assert.equal(fileSafe("U-10_Boys"), "U-10_Boys");
    });
    test("drops everything else, collapses whitespace, trims", () => {
        assert.equal(fileSafe("  ../../etc/passwd  "), "etcpasswd");
        assert.equal(fileSafe("Riverside: 10U / 12U!"), "Riverside-10U-12U");
        assert.equal(fileSafe("a\t\n b"), "a-b");
        assert.equal(fileSafe("Café Ünïcode"), "Caf-ncode");
    });
    test("at most 60 characters; nothing usable becomes 'league'", () => {
        assert.equal(fileSafe("x".repeat(100)).length, 60);
        for (const s of ["", "   ", "!!!", "日本語"]) assert.equal(fileSafe(s), "league");
    });
});

describe("downloadText / copyText (browser shims)", () => {
    test("downloadText clicks a temporary link carrying the file name and content, then frees it", async (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        const blobs: Blob[] = [];
        const create = t.mock.method(URL, "createObjectURL", (b: Blob) => (blobs.push(b), "blob:test/1"));
        const revoke = t.mock.method(URL, "revokeObjectURL", () => {});
        const clicked: { href: string; download: string }[] = [];
        const appended: unknown[] = [];
        const link = { href: "", download: "", click() { clicked.push({ href: this.href, download: this.download }); }, remove() { appended.pop(); } };
        Object.defineProperty(globalThis, "document", { value: { createElement: () => link, body: { appendChild: (x: unknown) => appended.push(x) } }, configurable: true });
        downloadText("league.json", '{"a":1}', "application/json");
        assert.deepEqual(clicked, [{ href: "blob:test/1", download: "league.json" }]);
        assert.equal(appended.length, 0, "the link is removed again");
        assert.equal(create.mock.callCount(), 1);
        assert.equal(blobs[0].type, "application/json");
        assert.equal(await blobs[0].text(), '{"a":1}');
        assert.equal(revoke.mock.callCount(), 0, "not revoked before the download starts");
        t.mock.timers.tick(1000);
        assert.deepEqual(revoke.mock.calls[0].arguments, ["blob:test/1"]);
    });

    test("copyText: true when the clipboard accepts, false when it refuses", async () => {
        let copied = "";
        Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async (s: string) => void (copied = s) } }, configurable: true });
        assert.equal(await copyText("hello"), true);
        assert.equal(copied, "hello");
        Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async () => { throw new Error("denied"); } } }, configurable: true });
        assert.equal(await copyText("x"), false);
        Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
        assert.equal(await copyText("x"), false, "no clipboard API at all");
    });
});
