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
    // The server sends a readable `error`; these cover responses that didn't
    // come from our code (a proxy, a timeout, Vercel itself).
    if (res.status === 401) return SIGNED_OUT;
    if (res.status === 413) return "This league is too large to save.";
    if (res.status === 404) return "This league wasn’t found. It may have been deleted.";
    if (res.status === 502 || res.status === 503 || res.status === 504) return `The server is busy or restarting (error ${res.status}). We’ll keep trying.`;
    return `Something went wrong (error ${res.status}). Try again in a moment.`;
}

/** Quoted word for word in /guide's "Saving" table; keep the two identical. */
const SIGNED_OUT = "You’ve been signed out. Sign in again in another tab; your changes stay on this page.";

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
        if (res.status === 401) {
            // Our own text, not the server's: the guide quotes this sentence
            // word for word, and a session can lapse in ways whose response
            // body we don't write (Auth.js, a proxy). It retries because the
            // fix happens elsewhere: once the person signs in again in another
            // tab, the cookie is shared and the next attempt (on the 5s timer,
            // or at once when this tab regains focus) just works. Not retrying
            // left the page saying "not saved" forever after they'd fixed it.
            return { ok: false, kind: "error", message: SIGNED_OUT, retry: true };
        }
        // 429 and 5xx are the server's problem and pass on their own; any
        // other 4xx is something about this request, and resending the same
        // body would only fail the same way.
        return { ok: false, kind: "error", message: await errorText(res), retry: res.status === 429 || res.status >= 500 };
    },
    async remove(id) {
        const res = await fetch(`/api/leagues/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!res.ok && res.status !== 404) throw new Error(await errorText(res));
    },
};

// ---------------------------------------------------------------------------

// Kept from the app's first name on purpose: renaming the product must never
// make someone's browser-saved leagues disappear. Don't "tidy" these keys.
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

// ---------------------------------------------------------------------------
// Local mirror of cloud leagues.
//
// Every change to a cloud league is also written here, so that if the
// database is unreachable (an outage, or the Neon plan's usage running out)
// nothing typed is lost: the home page lists these copies with "Download
// backup", and a backup file opens in any copy of the app -- including one
// run locally with `npm run dev` and no setup at all (browser mode).
//
// A mirror is a convenience copy, never the source of truth: it is never
// uploaded automatically, so it can't overwrite newer cloud work.
// ---------------------------------------------------------------------------

// Keyed per signed-in account: on a shared computer, one person's leagues
// (captain phone numbers included) must never show up for the next person.
// Signing out clears every mirror in this browser (clearAllMirrors).
const MIRROR_PREFIX = "courtside.mirror."; // first-name key, kept on purpose (see KEY above)
const mirrorKey = (userKey: string) => `${MIRROR_PREFIX}v2.${userKey}`;
const MIRROR_MAX = 15;

export type Mirror = { id: string; name: string; data: League; schedule: Schedule; savedAt: string };

function readMirrorMap(userKey: string): Record<string, Mirror> {
    try {
        const raw = window.localStorage.getItem(mirrorKey(userKey));
        return raw ? (JSON.parse(raw) as Record<string, Mirror>) : {};
    } catch {
        return {};
    }
}

export function writeMirror(userKey: string, m: Omit<Mirror, "savedAt">): void {
    if (!userKey) return;
    try {
        const all = readMirrorMap(userKey);
        all[m.id] = { ...m, savedAt: new Date().toISOString() };
        // Keep the most recently edited leagues; localStorage is ~5MB.
        const keep = Object.values(all)
            .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
            .slice(0, MIRROR_MAX);
        window.localStorage.setItem(mirrorKey(userKey), JSON.stringify(Object.fromEntries(keep.map((x) => [x.id, x]))));
    } catch {
        // Storage full or blocked: the cloud copy is still the real one.
    }
}

export function readMirrors(userKey: string): Mirror[] {
    if (!userKey) return [];
    return Object.values(readMirrorMap(userKey))
        .filter((m) => m && typeof m.id === "string")
        .map((m) => ({ ...m, name: typeof m.name === "string" ? m.name : "Untitled league", data: sanitizeLeague(m.data), schedule: sanitizeSchedule(m.schedule) }))
        .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function removeMirror(userKey: string, id: string): void {
    try {
        const all = readMirrorMap(userKey);
        delete all[id];
        window.localStorage.setItem(mirrorKey(userKey), JSON.stringify(all));
    } catch {
        // ignore
    }
}

/** On sign-out: remove every account's mirrors from this browser. */
export function clearAllMirrors(): void {
    try {
        for (let i = window.localStorage.length - 1; i >= 0; i--) {
            const k = window.localStorage.key(i);
            if (k?.startsWith(MIRROR_PREFIX)) window.localStorage.removeItem(k);
        }
    } catch {
        // ignore
    }
}
