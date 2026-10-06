/**
 * The example league behind "Start from an example" on a new season, and the
 * main fixture for scripts/verify-engine.ts. Built in any sport's words
 * (facility and unit names); the ids and numbers are identical for every
 * sport, so the verify script's expectations hold whichever sport it uses.
 *
 * Every name is clearly made up ("Example Tennis Center") so nobody mistakes
 * it for real data after loading it. Ids are fixed strings so the verify
 * script can point at specific teams.
 */
import { SPORTS, type SportId } from "./sports.ts";
import type { League, Rule, Team } from "./types.ts";

function team(id: string, name: string, bracketId: string, pool: string, club: string, rules: Rule[] = [], notes = ""): Team {
    return { id, name, bracketId, pool, club, captain: "", contact: "", matches: null, rules, notes };
}

export function sampleLeague(sport: SportId = "tennis"): League {
    const t = SPORTS[sport];
    // "Riverside Ice Arena" -> "Example Ice Arena"
    const place = (i: 0 | 1) => `Example ${t.facility[i].split(" ").slice(1).join(" ")}`;
    const units = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}-u${i + 1}`, name: t.unitLabel(i) }));
    const centerUnits = units("center", 3);
    const parkUnits = units("park", 2);
    return {
        settings: {
            sport,
            seasonStart: "2027-03-06",
            seasonEnd: "2027-05-16",
            blackouts: [{ from: "2027-03-27", to: "2027-03-28" }],
            maxPerDay: 1,
            matchMinutes: 90,
            clubLimit: 2,
            clubLimitMode: "prefer",
            courtsPerMatch: 1,
        },
        brackets: [
            { id: "b10", name: "10U", matches: 5, earliest: "09:00", latest: "17:30", days: [], color: "#2f7fb8", rules: [] },
            { id: "b12", name: "12U", matches: 5, earliest: "", latest: "18:30", days: [], color: "#c2571a", rules: [] },
            { id: "b14", name: "14U", matches: 5, earliest: "", latest: "", days: [], color: "#3e8e5a", rules: [] },
            { id: "b18", name: "18U", matches: 5, earliest: "", latest: "", days: [], color: "#8a4fb0", rules: [] },
        ],
        locations: [
            { id: "loc-center", name: place(0), address: "", mapUrl: "", notes: "Example location: replace with a real facility.", units: centerUnits },
            { id: "loc-park", name: place(1), address: "", mapUrl: "", notes: "Example location: replace with a real facility.", units: parkUnits },
        ],
        slots: [
            ...["09:00", "11:00", "13:00", "15:00"].map((time, i) => ({
                id: `s-sat-${i}`,
                day: 6 as const,
                time,
                locationId: "loc-center",
                capacity: 3,
                unitIds: centerUnits.map((u) => u.id),
                bracketIds: [],
            })),
            ...["12:00", "14:00"].map((time, i) => ({ id: `s-sun-${i}`, day: 0 as const, time, locationId: "loc-center", capacity: 3, unitIds: centerUnits.map((u) => u.id), bracketIds: [] })),
            ...([2, 4] as const).flatMap((day) =>
                ["17:00", "19:00"].map((time, i) => ({ id: `s-${day}-${i}`, day, time, locationId: "loc-park", capacity: 2, unitIds: parkUnits.map((u) => u.id), bracketIds: [] }))
            ),
        ],
        availability: [],
        teams: [
            team("t10a", "Example Hawks 10U", "b10", "", "Northside", [{ id: "r1", mode: "must", type: "max_per_weekend", n: 1 }]),
            team("t10b", "Example Lightning 10U", "b10", "", "Eastgate"),
            team("t10c", "Example Storm 10U", "b10", "", "Westfield", [{ id: "r2", mode: "must", type: "not_dates", ranges: [{ from: "2027-04-10", to: "2027-04-11" }] }]),
            team("t10d", "Example Wolves 10U", "b10", "", "Northside"),

            team("t12a", "Example Hawks 12U", "b12", "A", "Northside", [{ id: "r3", mode: "must", type: "max_weekend_total", n: 3 }]),
            team("t12b", "Example Lightning 12U", "b12", "A", "Eastgate"),
            team("t12c", "Example Storm 12U", "b12", "A", "Westfield", [{ id: "r4", mode: "prefer", type: "no_days", days: [2] }]),
            team("t12d", "Example Wolves 12U", "b12", "A", "Lakeside"),
            team("t12e", "Example Rockets 12U", "b12", "B", "Northside"),
            team("t12f", "Example Bears 12U", "b12", "B", "Eastgate"),
            team("t12g", "Example Thunder 12U", "b12", "B", "Westfield", [{ id: "r5", mode: "must", type: "not_same_time", teamIds: ["t14c"] }], "Shares a coach with Thunder 14U."),
            team("t12h", "Example Kings 12U", "b12", "B", "Lakeside"),

            team("t14a", "Example Hawks 14U", "b14", "", "Northside", [{ id: "r6", mode: "must", type: "max_per_weekend", n: 1 }]),
            team("t14b", "Example Lightning 14U", "b14", "", "Eastgate"),
            team("t14c", "Example Thunder 14U", "b14", "", "Westfield"),
            team("t14d", "Example Wolves 14U", "b14", "", "Lakeside", [{ id: "r7", mode: "must", type: "only_locations", locationIds: ["loc-center"] }]),
            team("t14e", "Example Rockets 14U", "b14", "", "Northside"),
            team("t14f", "Example Bears 14U", "b14", "", "Eastgate", [{ id: "r8", mode: "must", type: "note", text: "Asked for early Saturday games when possible." }]),

            team("t18a", "Example Hawks 18U", "b18", "", "Northside"),
            team("t18b", "Example Lightning 18U", "b18", "", "Eastgate", [{ id: "r9", mode: "must", type: "no_start_before", time: "11:00" }]),
            team("t18c", "Example Storm 18U", "b18", "", "Westfield"),
            team("t18d", "Example Bears 18U", "b18", "", "Lakeside"),
            team("t18e", "Example Kings 18U", "b18", "", "Northside", [{ id: "r10", mode: "must", type: "min_days_between", n: 6 }]),
            team("t18f", "Example Comets 18U", "b18", "", "Westfield"),
        ],
    };
}
