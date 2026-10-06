"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { downloadText, fileSafe, makeBackup, parseBackup } from "@/lib/client/backup";
import type { LeagueStore } from "@/lib/client/store";
import { formatDate, isIsoDate, isoToDay } from "@/lib/engine/dates";
import { withData, type TabProps } from "./types";
import { ConfirmButton, Field, NumberInput, RangesInput } from "./ui";

export default function SeasonTab({ doc, change, leagueId, store }: TabProps & { leagueId: string; store: LeagueStore }) {
    const router = useRouter();
    const { data } = doc;
    const s = data.settings;
    const [importMsg, setImportMsg] = useState<string | null>(null);
    const set = (patch: Partial<typeof s>) => change((d) => withData(d, { settings: { ...d.data.settings, ...patch } }));

    const weeks =
        isIsoDate(s.seasonStart) && isIsoDate(s.seasonEnd) && s.seasonEnd >= s.seasonStart ? Math.ceil((isoToDay(s.seasonEnd) - isoToDay(s.seasonStart) + 1) / 7) : null;
    const exampleTeams = data.teams.filter((t) => t.name.startsWith("Example ")).length;

    return (
        <div className="grid max-w-3xl gap-8">
            <section className="card grid gap-4 p-5">
                <h2 className="font-display text-2xl font-bold uppercase tracking-wide">Season</h2>
                <Field label="League name" htmlFor="league-name-edit">
                    <input id="league-name-edit" className="input" value={doc.name} onChange={(e) => change((d) => ({ ...d, name: e.target.value }))} onBlur={(e) => !e.target.value.trim() && change((d) => ({ ...d, name: "Untitled league" }))} />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="First day" htmlFor="season-start">
                        <input id="season-start" type="date" className="input" value={s.seasonStart} onChange={(e) => set({ seasonStart: e.target.value })} />
                    </Field>
                    <Field label="Last day" htmlFor="season-end">
                        <input id="season-end" type="date" className="input" value={s.seasonEnd} min={s.seasonStart || undefined} onChange={(e) => set({ seasonEnd: e.target.value })} />
                    </Field>
                </div>
                {weeks !== null && (
                    <p className="text-sm text-muted">
                        {formatDate(s.seasonStart, true)} to {formatDate(s.seasonEnd, true)}, about {weeks} weeks.
                    </p>
                )}
                {isIsoDate(s.seasonStart) && isIsoDate(s.seasonEnd) && s.seasonEnd < s.seasonStart && <p className="text-sm text-danger">The last day is before the first day.</p>}
                <Field label="Blackout dates" hint="Holidays and closures. No matches are scheduled on these days for anyone.">
                    <RangesInput idPrefix="blackout" value={s.blackouts} onChange={(blackouts) => set({ blackouts })} />
                </Field>
            </section>

            <section className="card grid gap-4 p-5">
                <h2 className="font-display text-2xl font-bold uppercase tracking-wide">League-wide rules</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Max matches per team per day" htmlFor="max-per-day">
                        <NumberInput id="max-per-day" value={s.maxPerDay} min={1} max={5} onChange={(v) => set({ maxPerDay: v ?? 1 })} />
                    </Field>
                    <Field label="Match length (minutes)" htmlFor="match-minutes" hint="Starts closer together than this count as the same time.">
                        <NumberInput id="match-minutes" value={s.matchMinutes} min={15} max={600} onChange={(v) => set({ matchMinutes: v ?? 90 })} />
                    </Field>
                </div>
                <Field label="Same club at the same time" htmlFor="club-limit" hint="Spreads each club’s teams out so one club isn’t on every court at once. Blank = no limit.">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm">At most</span>
                        <NumberInput id="club-limit" value={s.clubLimit} min={1} max={50} onChange={(v) => set({ clubLimit: v })} placeholder="—" className="input w-20" />
                        <span className="text-sm">matches per club at one start time,</span>
                        <select aria-label="Club limit strictness" className="input w-auto" value={s.clubLimitMode} onChange={(e) => set({ clubLimitMode: e.target.value === "must" ? "must" : "prefer" })}>
                            <option value="prefer">where possible</option>
                            <option value="must">always</option>
                        </select>
                    </div>
                </Field>
            </section>

            <section className="card grid gap-3 p-5">
                <h2 className="font-display text-2xl font-bold uppercase tracking-wide">Backup</h2>
                <p className="text-sm text-muted">A backup file holds everything in this league: brackets, courts, teams, rules and the schedule.</p>
                <div className="flex flex-wrap gap-2">
                    <button className="btn-secondary" onClick={() => downloadText(`${fileSafe(doc.name)}-backup.json`, makeBackup(doc.name, doc.data, doc.schedule), "application/json")}>
                        Download backup
                    </button>
                    <label className="btn-secondary">
                        Replace from a backup…
                        <input
                            type="file"
                            accept="application/json,.json"
                            className="sr-only"
                            onChange={async (e) => {
                                const f = e.target.files?.[0];
                                e.target.value = "";
                                if (!f) return;
                                try {
                                    const b = parseBackup(await f.text());
                                    change((d) => ({ ...d, data: b.data, schedule: b.schedule }));
                                    setImportMsg(`Loaded “${b.name}”: ${b.data.teams.length} teams, ${b.schedule.matches.length} matches.`);
                                } catch (err) {
                                    setImportMsg(err instanceof Error ? err.message : "That file couldn’t be read.");
                                }
                            }}
                        />
                    </label>
                </div>
                {importMsg && <p className="text-sm">{importMsg}</p>}
                {exampleTeams > 0 && (
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 p-3 text-sm">
                        <span>
                            {exampleTeams} example teams are still in this league.
                        </span>
                        <ConfirmButton
                            className="btn-secondary btn-sm"
                            label="Remove example teams"
                            confirmLabel="Remove them and their matches?"
                            onConfirm={() =>
                                change((d) => {
                                    const gone = new Set(d.data.teams.filter((t) => t.name.startsWith("Example ")).map((t) => t.id));
                                    return {
                                        ...d,
                                        data: { ...d.data, teams: d.data.teams.filter((t) => !gone.has(t.id)) },
                                        schedule: { ...d.schedule, matches: d.schedule.matches.filter((m) => !gone.has(m.home) && !gone.has(m.away)), warnings: [] },
                                    };
                                })
                            }
                        />
                    </div>
                )}
            </section>

            <section className="card grid gap-3 border-danger/30 p-5">
                <h2 className="font-display text-2xl font-bold uppercase tracking-wide text-danger">Delete league</h2>
                <p className="text-sm text-muted">Removes this league and its schedule from your list. Download a backup first if you might want it again.</p>
                <div>
                    <ConfirmButton
                        label="Delete this league"
                        confirmLabel="Yes, delete it"
                        onConfirm={async () => {
                            await store.remove(leagueId);
                            router.push("/");
                        }}
                    />
                </div>
            </section>
        </div>
    );
}
