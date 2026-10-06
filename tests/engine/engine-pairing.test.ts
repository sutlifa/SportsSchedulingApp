import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mulberry32, pairPool } from "../../lib/engine/engine.ts";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);
const needAll = (teams: string[], n: number) => new Map(teams.map((t) => [t, n]));
const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function tally(pairs: [string, string][]) {
    const games = new Map<string, number>();
    const meets = new Map<string, number>();
    for (const [a, b] of pairs) {
        games.set(a, (games.get(a) ?? 0) + 1);
        games.set(b, (games.get(b) ?? 0) + 1);
        meets.set(key(a, b), (meets.get(key(a, b)) ?? 0) + 1);
    }
    return { games, meets };
}

/** The basic contract for any pairing: no self-games, only pool members, nobody over their need. */
function sane(pairs: [string, string][], teams: string[], need: Map<string, number>) {
    const { games } = tally(pairs);
    for (const [a, b] of pairs) {
        assert.notEqual(a, b, "a team never plays itself");
        assert.ok(teams.includes(a) && teams.includes(b), "only pool members");
    }
    for (const t of teams) assert.ok((games.get(t) ?? 0) <= (need.get(t) ?? 0), `${t} over its need`);
}

describe("pairPool", () => {
    test("every team gets exactly its need when the pool total is even", () => {
        for (const [n, need] of [[2, 5], [4, 5], [6, 5], [8, 3], [10, 7], [3, 2], [4, 1]] as const) {
            for (let seed = 0; seed < 20; seed++) {
                const teams = ids(n);
                const nm = needAll(teams, need);
                const pairs = pairPool(teams, nm, new Map(), mulberry32(seed));
                sane(pairs, teams, nm);
                const { games } = tally(pairs);
                for (const t of teams) assert.equal(games.get(t), need, `${n} teams x ${need}: ${t} (seed ${seed})`);
                assert.equal(pairs.length, (n * need) / 2);
            }
        }
    });

    test("repeats spread evenly: in a 4-team pool playing 5 each, every pair meets 1 or 2 times", () => {
        for (let seed = 0; seed < 50; seed++) {
            const teams = ids(4);
            const { meets } = tally(pairPool(teams, needAll(teams, 5), new Map(), mulberry32(seed)));
            const counts = [...meets.values()];
            assert.equal(meets.size, 6, "everyone meets everyone");
            assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `seed ${seed}: ${counts}`);
        }
    });

    test("no repeats when none are needed: 6 teams x 5 is a round robin", () => {
        for (let seed = 0; seed < 30; seed++) {
            const teams = ids(6);
            const { meets } = tally(pairPool(teams, needAll(teams, 5), new Map(), mulberry32(seed)));
            assert.equal(meets.size, 15);
            assert.ok([...meets.values()].every((c) => c === 1), `seed ${seed}`);
        }
    });

    test("a pool of 2 plays each other `need` times", () => {
        const pairs = pairPool(["a", "b"], needAll(["a", "b"], 4), new Map(), mulberry32(1));
        assert.equal(pairs.length, 4);
        assert.ok(pairs.every(([x, y]) => key(x, y) === "a|b"));
    });

    test("a pool of 3 playing 2 each is one round robin", () => {
        const { meets } = tally(pairPool(["a", "b", "c"], needAll(["a", "b", "c"], 2), new Map(), mulberry32(3)));
        assert.deepEqual([...meets.keys()].sort(), ["a|b", "a|c", "b|c"]);
    });

    test("an odd total leaves exactly one team one short", () => {
        for (const [n, need] of [[3, 1], [5, 5], [7, 3]] as const) {
            for (let seed = 0; seed < 20; seed++) {
                const teams = ids(n);
                const nm = needAll(teams, need);
                const pairs = pairPool(teams, nm, new Map(), mulberry32(seed));
                sane(pairs, teams, nm);
                const { games } = tally(pairs);
                const short = teams.filter((t) => (games.get(t) ?? 0) < need);
                assert.equal(short.length, 1, `${n}x${need} seed ${seed}`);
                assert.equal(games.get(short[0]) ?? 0, need - 1);
            }
        }
    });

    test("a pool of 1, need 0, and missing need entries give no pairs", () => {
        assert.deepEqual(pairPool(["a"], needAll(["a"], 5), new Map(), mulberry32(1)), []);
        assert.deepEqual(pairPool(["a", "b"], needAll(["a", "b"], 0), new Map(), mulberry32(1)), []);
        assert.deepEqual(pairPool(["a", "b"], new Map(), new Map(), mulberry32(1)), []);
        assert.deepEqual(pairPool([], new Map(), new Map(), mulberry32(1)), []);
        assert.deepEqual(pairPool(["a", "b"], new Map([["a", -3], ["b", 2]]), new Map(), mulberry32(1)), []);
    });

    test("uneven needs: a team can never get more than the rest of the pool plays", () => {
        const teams = ["a", "b", "c"];
        const nm = new Map([["a", 5], ["b", 1], ["c", 1]]);
        const pairs = pairPool(teams, nm, new Map(), mulberry32(2));
        sane(pairs, teams, nm);
        assert.equal(tally(pairs).games.get("a"), 2);
    });

    test("uneven needs that fit are met exactly", () => {
        const teams = ["a", "b", "c", "d", "e"];
        const nm = new Map([["a", 4], ["b", 1], ["c", 1], ["d", 1], ["e", 1]]);
        for (let seed = 0; seed < 20; seed++) {
            const { games, meets } = tally(pairPool(teams, nm, new Map(), mulberry32(seed)));
            for (const t of teams) assert.equal(games.get(t), nm.get(t), `seed ${seed}`);
            assert.ok([...meets.values()].every((c) => c === 1));
        }
    });

    test("earlier meetings (locked matches) are avoided first", () => {
        const teams = ["a", "b", "c", "d"];
        // a and b already met twice; a 1-game round should pair a with c or d.
        const meets = new Map([[key("a", "b"), 2], [key("c", "d"), 2]]);
        for (let seed = 0; seed < 20; seed++) {
            const pairs = pairPool(teams, needAll(teams, 1), meets, mulberry32(seed));
            assert.ok(pairs.every(([x, y]) => key(x, y) !== "a|b" && key(x, y) !== "c|d"), `seed ${seed}: ${JSON.stringify(pairs)}`);
        }
    });

    test("does not mutate the meets or need maps it is given", () => {
        const teams = ids(4);
        const nm = needAll(teams, 3);
        const meets = new Map([[key("t0", "t1"), 1]]);
        pairPool(teams, nm, meets, mulberry32(9));
        assert.deepEqual([...nm.values()], [3, 3, 3, 3]);
        assert.deepEqual([...meets], [[key("t0", "t1"), 1]]);
    });

    test("same rng seed, same pairs", () => {
        const teams = ids(7);
        assert.deepEqual(pairPool(teams, needAll(teams, 4), new Map(), mulberry32(5)), pairPool(teams, needAll(teams, 4), new Map(), mulberry32(5)));
    });
});
