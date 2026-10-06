/**
 * The example league behind "Start from an example" on a new season, and the
 * main fixture for scripts/verify-engine.ts.
 *
 * Every name is clearly made up ("Example Tennis Center") so nobody mistakes
 * it for real data after loading it. Ids are fixed strings so the verify
 * script can point at specific teams.
 */
import type { League, Rule, Team } from "./types.ts";

function team(id: string, name: string, bracketId: string, pool: string, club: string, rules: Rule[] = [], notes = ""): Team {
    return { id, name, bracketId, pool, club, captain: "", contact: "", matches: null, rules, notes };
}

export function sampleLeague(): League {
    return {
        settings: {
            seasonStart: "2027-03-06",
            seasonEnd: "2027-05-16",
            blackouts: [{ from: "2027-03-27", to: "2027-03-28" }],
            maxPerDay: 1,
            matchMinutes: 90,
            clubLimit: 2,
            clubLimitMode: "prefer",
        },
        brackets: [
            { id: "b10", name: "10U", matches: 5, earliest: "09:00", latest: "17:30", days: [], color: "#2f7fb8", rules: [] },
            { id: "b12", name: "12U", matches: 5, earliest: "", latest: "18:30", days: [], color: "#c2571a", rules: [] },
            { id: "b14", name: "14U", matches: 5, earliest: "", latest: "", days: [], color: "#3e8e5a", rules: [] },
            { id: "b18", name: "18U", matches: 5, earliest: "", latest: "", days: [], color: "#8a4fb0", rules: [] },
        ],
        locations: [
            { id: "loc-center", name: "Example Tennis Center", address: "", mapUrl: "", notes: "Example location: replace with a real facility." },
            { id: "loc-park", name: "Example Park Courts", address: "", mapUrl: "", notes: "Example location: replace with a real facility." },
        ],
        slots: [
            ...["09:00", "11:00", "13:00", "15:00"].map((time, i) => ({
                id: `s-sat-${i}`,
                day: 6 as const,
                time,
                locationId: "loc-center",
                capacity: 3,
                bracketIds: [],
            })),
            ...["12:00", "14:00"].map((time, i) => ({ id: `s-sun-${i}`, day: 0 as const, time, locationId: "loc-center", capacity: 3, bracketIds: [] })),
            ...([2, 4] as const).flatMap((day) =>
                ["17:00", "19:00"].map((time, i) => ({ id: `s-${day}-${i}`, day, time, locationId: "loc-park", capacity: 2, bracketIds: [] }))
            ),
        ],
        teams: [
            team("t10a", "Example Aces 10U", "b10", "", "Northside", [{ id: "r1", mode: "must", type: "max_per_weekend", n: 1 }]),
            team("t10b", "Example Lobs 10U", "b10", "", "Eastgate"),
            team("t10c", "Example Volleys 10U", "b10", "", "Westfield", [{ id: "r2", mode: "must", type: "not_dates", ranges: [{ from: "2027-04-10", to: "2027-04-11" }] }]),
            team("t10d", "Example Rally 10U", "b10", "", "Northside"),

            team("t12a", "Example Aces 12U", "b12", "A", "Northside", [{ id: "r3", mode: "must", type: "max_weekend_total", n: 3 }]),
            team("t12b", "Example Smash 12U", "b12", "A", "Eastgate"),
            team("t12c", "Example Spin 12U", "b12", "A", "Westfield", [{ id: "r4", mode: "prefer", type: "no_days", days: [2] }]),
            team("t12d", "Example Drop Shot 12U", "b12", "A", "Lakeside"),
            team("t12e", "Example Baseline 12U", "b12", "B", "Northside"),
            team("t12f", "Example Deuce 12U", "b12", "B", "Eastgate"),
            team("t12g", "Example Topspin 12U", "b12", "B", "Westfield", [{ id: "r5", mode: "must", type: "not_same_time", teamIds: ["t14c"] }], "Shares a coach with Topspin 14U."),
            team("t12h", "Example Love 12U", "b12", "B", "Lakeside"),

            team("t14a", "Example Aces 14U", "b14", "", "Northside", [{ id: "r6", mode: "must", type: "max_per_weekend", n: 1 }]),
            team("t14b", "Example Smash 14U", "b14", "", "Eastgate"),
            team("t14c", "Example Topspin 14U", "b14", "", "Westfield"),
            team("t14d", "Example Ad In 14U", "b14", "", "Lakeside", [{ id: "r7", mode: "must", type: "only_locations", locationIds: ["loc-center"] }]),
            team("t14e", "Example Slice 14U", "b14", "", "Northside"),
            team("t14f", "Example Net Rush 14U", "b14", "", "Eastgate", [{ id: "r8", mode: "must", type: "note", text: "Captain asked for early Saturday matches when possible." }]),

            team("t18a", "Example Aces 18U", "b18", "", "Northside"),
            team("t18b", "Example Smash 18U", "b18", "", "Eastgate", [{ id: "r9", mode: "must", type: "no_start_before", time: "11:00" }]),
            team("t18c", "Example Spin 18U", "b18", "", "Westfield"),
            team("t18d", "Example Overhead 18U", "b18", "", "Lakeside"),
            team("t18e", "Example Let 18U", "b18", "", "Northside", [{ id: "r10", mode: "must", type: "min_days_between", n: 6 }]),
            team("t18f", "Example Match Point 18U", "b18", "", "Westfield"),
        ],
    };
}
