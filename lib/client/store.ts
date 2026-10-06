"use client";

/**
 * One interface over the two places a league can live:
 *
 *  - cloud: the /api/leagues routes (Neon), when the deployment is fully
 *    configured -- see lib/authConfig.ts.
 *  - browser: localStorage, when it isn't. Same shapes, same version
 *    numbers, same conflict behaviour, so the workspace doesn't know or
 *    care which one it is talking to.
 *
 * localStorage is only ever touched from event handlers and effects, never
 * during render: reading it in a render (or a useState initializer) returns
 * nothing on the server and real data in the browser, and React reports a
 * hydration mismatch on every load.
 */
import { sanitizeLeague, sanitizeSchedule, emptyLeague, emptySchedule } from "@/lib/engine/sanitize";
import type { League, Schedule } from "@/lib/engine/types";

export type Mode = "cloud" | "browser";

export type LeagueSummary = { id: string; name: string; updatedAt: string; teamCount: number; matchCount: number; unplacedCount: number };
export type LeagueRecord = { id: string; name: string; data: League; schedule: Schedule; version: number; updatedAt: string; updatedBy: string | null };

export type SaveResult =
    | { ok: true; version: number; updatedAt: string }
    | { ok: false; kind: "conflict"; current: LeagueRecord; message: string }
    | { ok: false; kind: "error"; message: string; retry: boolean };

export interface LeagueStore {
    list(): Promise<LeagueSummary[]>;
    create(name: string, data?: League, schedule?: Schedule): Promise<LeagueRecord>;
    load(id: string): Promise<LeagueRecord | null>;
    save(rec: { id: string; name: string; data: League; schedule: Schedule; version: number }): Promise<SaveResult>;
    remove(id: string): Promise<void>;
}

async function errorText(res: Response): Promise<string> {
    try {
        const j = (await res.json()) as { error?: string };
        if (j.error) return j.error;
    } catch {
        // fall through
    }
    return res.status === 401 ? "Please sign in again." : "Something went wrong. Try again in a moment.";
}

export const cloudStore: LeagueStore = {
    async list() {
        const res = await fetch("/api/leagues", { cache: "no-store" });
        if (!res.ok) throw new Error(await errorText(res));
        return ((await res.json()) as { leagues: LeagueSummary[] }).leagues;
    },
    async create(name, data, schedule) {
        const res = await fetch("/api/leagues", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name, data, schedule }),
        });
        if (!res.ok) throw new Error(await errorText(res));
        return ((await res.json()) as { league: LeagueRecord }).league;
    },
    async load(id) {
        const res = await fetch(`/api/leagues/${encodeURIComponent(id)}`, { cache: "no-store" });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(await errorText(res));
        return ((await res.json()) as { league: LeagueRecord }).league;
    },
    async save(rec) {
        let res: Response;
        try {
            res = await fetch(`/api/leagues/${encodeURIComponent(rec.id)}`, {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(rec),
            });
        } catch {
            return { ok: false, kind: "error", message: "You seem to be offline. Your changes are still on screen; we’ll keep trying.", retry: true };
        }
        if (res.ok) {
            const j = (await res.json()) as { version: number; updatedAt: string };
            return { ok: true, version: j.version, updatedAt: j.updatedAt };
        }
        if (res.status === 409) {
            const j = (await res.json()) as { error: string; current: LeagueRecord };
            return { ok: false, kind: "conflict", current: j.current, message: j.error };
        }
        return { ok: false, kind: "error", message: await errorText(res), retry: res.status >= 500 };
    },
    async remove(id) {
        const res = await fetch(`/api/leagues/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!res.ok && res.status !== 404) throw new Error(await errorText(res));
    },
};

// ---------------------------------------------------------------------------

const KEY = "tennis-scheduler.leagues.v1";

type LocalDb = Record<string, LeagueRecord>;

function readLocal(): LocalDb {
    try {
        const raw = window.localStorage.getItem(KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as LocalDb;
        const out: LocalDb = {};
        for (const [id, r] of Object.entries(parsed ?? {})) {
            if (!r || typeof r !== "object") continue;
            out[id] = {
                id,
                name: typeof r.name === "string" ? r.name : "Untitled league",
                data: sanitizeLeague(r.data),
                schedule: sanitizeSchedule(r.schedule),
                version: typeof r.version === "number" ? r.version : 1,
                updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : new Date(0).toISOString(),
                updatedBy: null,
            };
        }
        return out;
    } catch {
        return {};
    }
}

function writeLocal(db: LocalDb): string | null {
    try {
        window.localStorage.setItem(KEY, JSON.stringify(db));
        return null;
    } catch {
        return "This browser wouldn’t store the league (storage may be full or blocked). Export a backup from Season settings so nothing is lost.";
    }
}

function summarize(r: LeagueRecord): LeagueSummary {
    return {
        id: r.id,
        name: r.name,
        updatedAt: r.updatedAt,
        teamCount: r.data.teams.length,
        matchCount: r.schedule.matches.length,
        unplacedCount: r.schedule.matches.filter((m) => !m.date).length,
    };
}

export const browserStore: LeagueStore = {
    async list() {
        return Object.values(readLocal())
            .map(summarize)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async create(name, data, schedule) {
        const db = readLocal();
        const id = crypto.randomUUID();
        const rec: LeagueRecord = { id, name, data: data ?? emptyLeague(), schedule: schedule ?? emptySchedule(), version: 1, updatedAt: new Date().toISOString(), updatedBy: null };
        db[id] = rec;
        const err = writeLocal(db);
        if (err) throw new Error(err);
        return rec;
    },
    async load(id) {
        return readLocal()[id] ?? null;
    },
    async save(rec) {
        // Same version rule as the server: another tab of this browser that
        // saved in the meantime wins, and this one is told, not overwritten.
        const db = readLocal();
        const cur = db[rec.id];
        if (!cur) return { ok: false, kind: "error", message: "This league was deleted in another tab.", retry: false };
        if (cur.version !== rec.version) return { ok: false, kind: "conflict", current: cur, message: "This league was changed in another tab since you opened it." };
        const next: LeagueRecord = { ...rec, version: rec.version + 1, updatedAt: new Date().toISOString(), updatedBy: null };
        db[rec.id] = next;
        const err = writeLocal(db);
        if (err) return { ok: false, kind: "error", message: err, retry: false };
        return { ok: true, version: next.version, updatedAt: next.updatedAt };
    },
    async remove(id) {
        const db = readLocal();
        delete db[id];
        writeLocal(db);
    },
};

export function storeFor(mode: Mode): LeagueStore {
    return mode === "cloud" ? cloudStore : browserStore;
}

/** Leagues sitting in this browser -- offered for upload once cloud mode is on. */
export async function browserLeagues(): Promise<LeagueRecord[]> {
    return Object.values(readLocal());
}
