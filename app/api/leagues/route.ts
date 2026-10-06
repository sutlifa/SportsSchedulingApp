import { NextResponse } from "next/server";
import { cleanName, isGuardFailure, readJson, requireUser } from "@/lib/guard";
import { createLeague, listLeagues } from "@/lib/leagues";
import { emptyLeague, emptySchedule, sanitizeLeague, sanitizeSchedule } from "@/lib/engine/sanitize";

export async function GET() {
    const g = await requireUser();
    if (isGuardFailure(g)) return g.response;
    try {
        return NextResponse.json({ leagues: await listLeagues(g.userId) });
    } catch (err) {
        console.error("LIST LEAGUES ERROR:", err);
        return NextResponse.json({ error: "Couldn’t load your leagues. Try again in a moment." }, { status: 500 });
    }
}

/** Creates a league. `data` / `schedule` are optional (an import or example). */
export async function POST(req: Request) {
    const g = await requireUser();
    if (isGuardFailure(g)) return g.response;
    const parsed = await readJson(req);
    if ("response" in parsed) return parsed.response;
    const body = (parsed.body ?? {}) as Record<string, unknown>;
    const name = cleanName(body.name);
    if (!name) return NextResponse.json({ error: "Give the league a name." }, { status: 400 });
    try {
        const data = body.data ? sanitizeLeague(body.data) : emptyLeague();
        const schedule = body.schedule ? sanitizeSchedule(body.schedule) : emptySchedule();
        const rec = await createLeague(g.userId, name, data, schedule);
        return NextResponse.json({ league: rec }, { status: 201 });
    } catch (err) {
        console.error("CREATE LEAGUE ERROR:", err);
        return NextResponse.json({ error: "Couldn’t create the league. Try again in a moment." }, { status: 500 });
    }
}
