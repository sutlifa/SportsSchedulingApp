import { NextResponse } from "next/server";
import { cleanName, isGuardFailure, readJson, requireUser, serverError } from "@/lib/guard";
import { deleteLeague, getLeague, saveLeague } from "@/lib/leagues";
import { sanitizeLeague, sanitizeSchedule } from "@/lib/engine/sanitize";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, context: Ctx) {
    const g = await requireUser();
    if (isGuardFailure(g)) return g.response;
    const { id } = await context.params;
    try {
        const rec = await getLeague(g.userId, id);
        if (!rec) return NextResponse.json({ error: "That league doesn’t exist or was deleted." }, { status: 404 });
        return NextResponse.json({ league: rec });
    } catch (err) {
        return serverError("GET LEAGUE ERROR", err, "Couldn’t load the league. Try again in a moment.");
    }
}

/**
 * Saves the whole league. The body must carry the `version` it was loaded
 * at; a stale copy gets 409 with the current one attached, never a silent
 * overwrite. See saveLeague in lib/leagues.ts.
 */
export async function PUT(req: Request, context: Ctx) {
    const g = await requireUser();
    if (isGuardFailure(g)) return g.response;
    const { id } = await context.params;
    const parsed = await readJson(req);
    if ("response" in parsed) return parsed.response;
    const body = (parsed.body ?? {}) as Record<string, unknown>;
    const name = cleanName(body.name);
    const version = typeof body.version === "number" && Number.isInteger(body.version) ? body.version : null;
    if (!name || version === null || !body.data || !body.schedule) {
        return NextResponse.json({ error: "That save was missing information. Reload the page and try again." }, { status: 400 });
    }
    try {
        const out = await saveLeague(g.userId, id, version, name, sanitizeLeague(body.data), sanitizeSchedule(body.schedule));
        if (out.ok) return NextResponse.json({ version: out.version, updatedAt: out.updatedAt });
        if (out.reason === "missing") return NextResponse.json({ error: "This league was deleted." }, { status: 404 });
        return NextResponse.json(
            { error: "This league was changed somewhere else since you opened it.", current: out.current },
            { status: 409 }
        );
    } catch (err) {
        return serverError("SAVE LEAGUE ERROR", err, "Couldn’t save. Your changes are still on screen; we’ll keep trying.");
    }
}

export async function DELETE(_req: Request, context: Ctx) {
    const g = await requireUser();
    if (isGuardFailure(g)) return g.response;
    const { id } = await context.params;
    try {
        const ok = await deleteLeague(g.userId, id);
        if (!ok) return NextResponse.json({ error: "That league doesn’t exist or was already deleted." }, { status: 404 });
        return NextResponse.json({ ok: true });
    } catch (err) {
        return serverError("DELETE LEAGUE ERROR", err, "Couldn’t delete the league. Try again in a moment.");
    }
}
