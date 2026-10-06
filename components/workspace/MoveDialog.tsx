"use client";

import { useMemo, useState } from "react";
import { formatDate, formatTime } from "@/lib/engine/dates";
import { moveOptions, type SpotOption } from "@/lib/engine/engine";
import type { NameLookup } from "@/lib/engine/rules";
import type { League, Match } from "@/lib/engine/types";
import { Modal } from "./ui";

/**
 * Move one match by hand. Every slot in the season is judged against every
 * rule with all OTHER matches in place, so what this lists as fitting is
 * exactly what the audit will accept afterwards (scripts/verify-engine.ts
 * checks that agreement).
 *
 * Placing somewhere that breaks a must-rule is allowed -- the person
 * scheduling knows things the rules don't (a captain who said "just this
 * once is fine") -- but the button says so and the match keeps showing the
 * broken rule afterwards. Every move locks the match so a regenerate can't
 * undo hand work.
 */
export default function MoveDialog({
    data,
    matches,
    matchId,
    lookup,
    onClose,
    onApply,
}: {
    data: League;
    matches: Match[];
    matchId: string;
    lookup: NameLookup;
    onClose: () => void;
    onApply: (patch: Partial<Match> | null) => void;
}) {
    const match = matches.find((m) => m.id === matchId);
    const options = useMemo(() => moveOptions(data, matches, matchId), [data, matches, matchId]);
    const [showAll, setShowAll] = useState(false);
    const [picked, setPicked] = useState<SpotOption | null>(null);
    const locName = (id: string) => data.locations.find((l) => l.id === id)?.name ?? "Unknown location";

    if (!match) return null;
    const name = (id: string) => lookup.team(id) ?? "Deleted team";

    const shown = options.filter((o) => showAll || (o.verdict.hard.length === 0 && !(o.inst.date === match.date && o.inst.slotId === match.slotId)));
    const clean = shown.filter((o) => !o.verdict.hard.length && !o.verdict.soft.length).length;
    const byDate = new Map<string, SpotOption[]>();
    for (const o of shown) {
        if (!byDate.has(o.inst.date)) byDate.set(o.inst.date, []);
        byDate.get(o.inst.date)!.push(o);
    }

    return (
        <Modal title={match.date ? "Move match" : "Place match"} onClose={onClose} wide>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div className="text-lg font-semibold">
                        {name(match.home)} <span className="font-normal text-muted">vs</span> {name(match.away)}
                    </div>
                    <div className="text-sm text-muted">{match.date ? `Now: ${formatDate(match.date)} · ${formatTime(match.time)} · ${locName(match.locationId ?? "")}` : "Not placed yet"}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button className="btn-secondary btn-sm" onClick={() => onApply({ home: match.away, away: match.home })}>
                        Swap home/away
                    </button>
                    {match.date && (
                        <button className="btn-secondary btn-sm" onClick={() => onApply({ date: null, time: null, locationId: null, slotId: null, locked: false, note: "Taken off the schedule by hand." })}>
                            Take off the schedule
                        </button>
                    )}
                </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-muted">
                    {shown.length} {showAll ? "time slots" : "open spots that fit every must-rule"}
                    {!showAll && ` (${clean} fit every preference too)`}
                </span>
                <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show every slot, even ones that break a rule
                </label>
            </div>

            <div className="mt-3 max-h-[50vh] overflow-y-auto rounded-lg border border-border">
                {shown.length === 0 && <p className="p-4 text-sm text-muted">Nothing fits. Tick “Show every slot” to see why each one is blocked.</p>}
                {[...byDate.entries()].map(([date, opts]) => (
                    <div key={date}>
                        <div className="sticky top-0 bg-surface-2 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted">{formatDate(date, true)}</div>
                        {opts.map((o) => {
                            const sel = picked?.inst.idx === o.inst.idx;
                            const bad = o.verdict.hard.length > 0;
                            return (
                                <button
                                    key={o.inst.idx}
                                    onClick={() => setPicked(o)}
                                    aria-pressed={sel}
                                    className={`block w-full border-t border-border px-3 py-2 text-left text-sm ${sel ? "bg-accent-soft" : "hover:bg-surface-2"}`}
                                >
                                    <span className="font-mono tabular">{formatTime(o.inst.time)}</span> · {locName(o.inst.locationId)}{" "}
                                    <span className="text-muted tabular">
                                        ({o.used}/{o.inst.capacity} courts used)
                                    </span>
                                    {bad && <span className="block text-xs text-danger">Breaks: {o.verdict.hard.join("; ")}</span>}
                                    {o.verdict.soft.length > 0 && <span className="block text-xs text-warn">Misses: {o.verdict.soft.join("; ")}</span>}
                                </button>
                            );
                        })}
                    </div>
                ))}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                <button className="btn-ghost" onClick={onClose}>
                    Cancel
                </button>
                <button
                    className={picked?.verdict.hard.length ? "btn-danger" : "btn-primary"}
                    disabled={!picked}
                    onClick={() => picked && onApply({ date: picked.inst.date, time: picked.inst.time, locationId: picked.inst.locationId, slotId: picked.inst.slotId, locked: true, note: undefined })}
                >
                    {picked?.verdict.hard.length ? "Move anyway (breaks a rule)" : "Move here and lock"}
                </button>
            </div>
        </Modal>
    );
}
