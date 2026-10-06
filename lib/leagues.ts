import { randomUUID } from "node:crypto";
import { sql } from "./db";
import { ensureSchema } from "./db/ensure";
import type { League, Schedule } from "./engine/types";

/**
 * Every query against the leagues table. Server-only (imports postgres).
 *
 * Ownership is enforced IN the SQL: every statement filters on user_id, so
 * a caller can't forget it, and someone else's league reads as not-found
 * (never "forbidden", which would confirm the id exists).
 *
 * Every read also filters `deleted_at IS NULL`, including the UPDATE in
 * saveLeague -- otherwise a tab left open on a deleted league would
 * resurrect it on its next autosave.
 */

export type LeagueSummary = { id: string; name: string; updatedAt: string; teamCount: number; matchCount: number; unplacedCount: number };
export type LeagueRecord = { id: string; name: string; data: League; schedule: Schedule; version: number; updatedAt: string; updatedBy: string | null };

type Row = { id: string; name: string; data: League; schedule: Schedule; version: number; updated_at: Date };

const toRecord = (r: Row): LeagueRecord => ({
    id: r.id,
    name: r.name,
    data: r.data,
    schedule: r.schedule,
    version: r.version,
    updatedAt: r.updated_at.toISOString(),
    updatedBy: null,
});

export async function listLeagues(userId: number): Promise<LeagueSummary[]> {
    await ensureSchema();
    // Counts via jsonb functions so the list never ships whole leagues.
    const rows = await sql<{ id: string; name: string; updated_at: Date; team_count: number; match_count: number; unplaced_count: number }[]>`
        SELECT id, name, updated_at,
               jsonb_array_length(COALESCE(data->'teams', '[]'::jsonb)) AS team_count,
               jsonb_array_length(COALESCE(schedule->'matches', '[]'::jsonb)) AS match_count,
               (SELECT count(*)::int FROM jsonb_array_elements(COALESCE(schedule->'matches', '[]'::jsonb)) m
                 WHERE m->>'date' IS NULL) AS unplaced_count
        FROM leagues
        WHERE user_id = ${userId} AND deleted_at IS NULL
        ORDER BY updated_at DESC
        LIMIT 200
    `;
    return rows.map((r) => ({ id: r.id, name: r.name, updatedAt: r.updated_at.toISOString(), teamCount: r.team_count, matchCount: r.match_count, unplacedCount: r.unplaced_count }));
}

export async function getLeague(userId: number, id: string): Promise<LeagueRecord | null> {
    await ensureSchema();
    const rows = await sql<Row[]>`
        SELECT id, name, data, schedule, version, updated_at
        FROM leagues WHERE id = ${id} AND user_id = ${userId} AND deleted_at IS NULL
    `;
    return rows[0] ? toRecord(rows[0]) : null;
}

export async function createLeague(userId: number, name: string, data: League, schedule: Schedule): Promise<LeagueRecord> {
    await ensureSchema();
    const rows = await sql<Row[]>`
        INSERT INTO leagues (id, user_id, name, data, schedule)
        VALUES (${randomUUID()}, ${userId}, ${name}, ${sql.json(data as never)}, ${sql.json(schedule as never)})
        RETURNING id, name, data, schedule, version, updated_at
    `;
    return toRecord(rows[0]);
}

export type SaveOutcome = { ok: true; version: number; updatedAt: string } | { ok: false; reason: "conflict"; current: LeagueRecord } | { ok: false; reason: "missing" };

/**
 * Saves only if the stored version is the one the client started from.
 *
 * The version check lives in the UPDATE's WHERE clause, not in a SELECT
 * beforehand, so two saves racing each other can't both pass it. On a
 * mismatch the current copy is returned so the client can show it rather
 * than guess.
 */
export async function saveLeague(userId: number, id: string, baseVersion: number, name: string, data: League, schedule: Schedule): Promise<SaveOutcome> {
    await ensureSchema();
    const rows = await sql<{ version: number; updated_at: Date }[]>`
        UPDATE leagues
        SET name = ${name}, data = ${sql.json(data as never)}, schedule = ${sql.json(schedule as never)},
            version = version + 1, updated_at = now()
        WHERE id = ${id} AND user_id = ${userId} AND version = ${baseVersion} AND deleted_at IS NULL
        RETURNING version, updated_at
    `;
    if (rows[0]) return { ok: true, version: rows[0].version, updatedAt: rows[0].updated_at.toISOString() };
    const current = await getLeague(userId, id);
    return current ? { ok: false, reason: "conflict", current } : { ok: false, reason: "missing" };
}

export async function deleteLeague(userId: number, id: string): Promise<boolean> {
    await ensureSchema();
    const rows = await sql`UPDATE leagues SET deleted_at = now() WHERE id = ${id} AND user_id = ${userId} AND deleted_at IS NULL RETURNING id`;
    return rows.length > 0;
}
