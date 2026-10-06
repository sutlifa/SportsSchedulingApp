"use client";

import { sanitizeLeague, sanitizeSchedule } from "@/lib/engine/sanitize";
import { APP_NAME } from "@/lib/brand";
import type { League, Schedule } from "@/lib/engine/types";

/**
 * Backup file format. Versioned and tagged so an unrelated JSON file is
 * refused with a clear message instead of loading as an empty league.
 *
 * The app was first called Courtside; backups made then carry that tag and
 * must keep loading forever, so both tags are accepted. New backups use the
 * current one.
 */
const FORMAT = "seasonsmith-league";
const FORMATS_ACCEPTED = new Set([FORMAT, "courtside-league"]);

export type Backup = { format: string; version: 1; name: string; exportedAt: string; data: League; schedule: Schedule };

export function makeBackup(name: string, data: League, schedule: Schedule): string {
    const b: Backup = { format: FORMAT, version: 1, name, exportedAt: new Date().toISOString(), data, schedule };
    return JSON.stringify(b, null, 2);
}

export function parseBackup(text: string): { name: string; data: League; schedule: Schedule } {
    let j: Record<string, unknown>;
    try {
        j = JSON.parse(text) as Record<string, unknown>;
    } catch {
        throw new Error(`That file isn’t a ${APP_NAME} backup (it isn’t valid JSON).`);
    }
    if (!j || typeof j.format !== "string" || !FORMATS_ACCEPTED.has(j.format)) throw new Error(`That file isn’t a ${APP_NAME} backup.`);
    return {
        name: typeof j.name === "string" && j.name.trim() ? j.name.trim().slice(0, 120) : "Imported league",
        data: sanitizeLeague(j.data),
        schedule: sanitizeSchedule(j.schedule),
    };
}

/** Saves text as a file via a temporary link. */
export function downloadText(filename: string, text: string, type = "text/plain") {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
}

export function fileSafe(name: string): string {
    return name.replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "league";
}
