/**
 * Each sport's own words: where it's played (court, sheet of ice, field), what
 * a booking is called (court time, ice time, field time), match vs game,
 * captain vs coach -- so a hockey league reads "Every sheet is already
 * booked" and a tennis league "Every court is already booked".
 *
 * Pure data. The engine, rule sentences, importer, UI, guide and sample
 * league all take their wording from here, so one sport never leaks another
 * sport's words. Leagues saved before sports existed have no `sport` and are
 * read as tennis (what they were built for).
 */
export const SPORT_IDS = ["tennis", "pickleball", "hockey", "soccer", "basketball", "volleyball", "baseball", "softball", "lacrosse", "football", "other"] as const;
export type SportId = (typeof SPORT_IDS)[number];

export type Terms = {
    id: SportId;
    name: string;
    /** One playing area inside a facility: "court", "sheet", "field". */
    unit: string;
    units: string;
    /** A booking of that area: "court time", "ice time". */
    time: string;
    match: string;
    matches: string;
    /** Who sends the requests: "captain" or "coach". */
    captain: string;
    captains: string;
    /** How units are numbered in examples: "Sheet A" vs "Court 1". */
    unitLabel: (i: number) => string;
    /** The heading a facility's spreadsheet uses for its units column. */
    unitHeading: string;
    /** Example facility names for the sample league and the guide. */
    facility: [string, string];
    /** Sensible default game length in minutes. */
    minutes: number;
};

const num = (word: string) => (i: number) => `${word} ${i + 1}`;
const letter = (word: string) => (i: number) => `${word} ${String.fromCharCode(65 + (i % 26))}`;

const T = (
    id: SportId,
    name: string,
    unit: string,
    time: string,
    match: "match" | "game",
    captain: "captain" | "coach",
    unitLabel: (i: number) => string,
    unitHeading: string,
    facility: [string, string],
    minutes: number,
    units = `${unit}s`
): Terms => ({ id, name, unit, units, time, match, matches: `${match}${match === "match" ? "es" : "s"}`, captain, captains: captain === "coach" ? "coaches" : "captains", unitLabel, unitHeading, facility, minutes });

export const SPORTS: Record<SportId, Terms> = {
    tennis: T("tennis", "Tennis", "court", "court time", "match", "captain", num("Court"), "Court", ["Riverside Tennis Center", "Lakeview Park Courts"], 90),
    pickleball: T("pickleball", "Pickleball", "court", "court time", "match", "captain", num("Court"), "Court", ["Riverside Pickleball Club", "Lakeview Park Courts"], 60),
    hockey: T("hockey", "Hockey", "sheet", "ice time", "game", "coach", letter("Sheet"), "Sheet", ["Riverside Ice Arena", "Lakeview Rink"], 75),
    soccer: T("soccer", "Soccer", "field", "field time", "game", "coach", num("Field"), "Field", ["Riverside Soccer Complex", "Lakeview Park Fields"], 90),
    basketball: T("basketball", "Basketball", "court", "gym time", "game", "coach", num("Court"), "Court", ["Riverside Community Gym", "Lakeview Rec Center"], 60),
    volleyball: T("volleyball", "Volleyball", "court", "court time", "match", "coach", num("Court"), "Court", ["Riverside Sports Center", "Lakeview Rec Center"], 75),
    baseball: T("baseball", "Baseball", "field", "field time", "game", "coach", num("Field"), "Field", ["Riverside Ballpark", "Lakeview Park Fields"], 120),
    softball: T("softball", "Softball", "field", "field time", "game", "coach", num("Field"), "Field", ["Riverside Softball Complex", "Lakeview Park Fields"], 90),
    lacrosse: T("lacrosse", "Lacrosse", "field", "field time", "game", "coach", num("Field"), "Field", ["Riverside Sports Complex", "Lakeview Park Fields"], 90),
    football: T("football", "Football", "field", "field time", "game", "coach", num("Field"), "Field", ["Riverside Stadium", "Lakeview Park Fields"], 120),
    other: T("other", "Other sport", "space", "facility time", "game", "coach", num("Space"), "Space", ["Riverside Sports Center", "Lakeview Rec Center"], 60),
};

export function isSportId(v: unknown): v is SportId {
    return typeof v === "string" && (SPORT_IDS as readonly string[]).includes(v);
}

/** Terms for a league's sport. Missing or unknown = tennis (pre-sport leagues). */
export function termsFor(sport: unknown): Terms {
    return SPORTS[isSportId(sport) ? sport : "tennis"];
}

/** "court" -> "Court", "ice time" -> "Ice time". */
export function cap(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "1 match" / "2 matches" in the sport's word. */
export function countOf(n: number, t: Terms): string {
    return `${n} ${n === 1 ? t.match : t.matches}`;
}

/**
 * Rewrites static copy written in tennis words ("Max matches in one
 * weekend", "the captain asked") into the sport's words. Only whole words,
 * keeping capitalisation, so "Matches at once" becomes "Games at once".
 */
export function sportText(text: string, t: Terms): string {
    const swap = (word: string, to: string) => (m: string) => (m[0] === m[0].toUpperCase() ? cap(to) : to);
    return text
        .replace(/\bmatches\b/gi, swap("matches", t.matches))
        .replace(/\bmatch\b/gi, swap("match", t.match))
        .replace(/\bcaptains\b/gi, swap("captains", t.captains))
        .replace(/\bcaptain(?=s?’|\b)/gi, swap("captain", t.captain));
}
