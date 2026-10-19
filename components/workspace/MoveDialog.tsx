"use client";

import { useMemo, useState } from "react";
import { formatDate, formatTime } from "@/lib/engine/dates";
import { moveOptions, type SpotOption } from "@/lib/engine/engine";
import type { NameLookup } from "@/lib/engine/rules";
import { cap, termsFor } from "@/lib/engine/sports";
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
    // The unit (sheet / field / court) to put it on at the picked time.
    const [unit, setUnit] = useState<string>("");
    // "Set the date and time by hand": for a game moved to a time that isn't
    // one of the slots (a rain-out the facility fitted in on a Tuesday).
    const start = matches.find((m) => m.id === matchId);
    const [hDate, setHDate] = useState(start?.date ?? data.settings.seasonStart ?? "");
    const [hTime, setHTime] = useState(start?.time ?? "");
    const [hLoc, setHLoc] = useState(start?.locationId ?? data.locations[0]?.id ?? "");
    const [hUnit, setHUnit] = useState(start?.unitIds?.[0] ?? "");
    const [hNote, setHNote] = useState("");
    const t = termsFor(data.settings.sport);
    const cpm = Math.max(1, data.settings.courtsPerMatch || 1);
    const locName = (id: string) => data.locations.find((l) => l.id === id)?.name ?? "Unknown facility";
    const unitName = (id: string) => lookup.unit?.(id) ?? id;
    /** `cpm` free units, starting with the chosen one. */
    const unitsFrom = (free: string[], first: string) => (free.includes(first) ? [first, ...free.filter((u) => u !== first)] : free).slice(0, cpm);

    if (!match) return null;
    // Free units at the game's CURRENT time (its own included), for "change sheet".
    const here = options.find((o) => o.inst.date === match.date && o.inst.slotId === match.slotId);
    const hereFree = here ? [...new Set([...(match.unitIds ?? []), ...here.freeUnits])].filter((u) => here.inst.unitIds.includes(u)) : [];
    const name = (id: string) => lookup.team(id) ?? "Deleted team";

    const shown = options.filter((o) => showAll || (o.verdict.hard.length === 0 && !(o.inst.date === match.date && o.inst.slotId === match.slotId)));
    const clean = shown.filter((o) => !o.verdict.hard.length && !o.verdict.soft.length).length;
    const byDate = new Map<string, SpotOption[]>();
    for (const o of shown) {
        if (!byDate.has(o.inst.date)) byDate.set(o.inst.date, []);
        byDate.get(o.inst.date)!.push(o);
    }

    const hLocation = data.locations.find((l) => l.id === hLoc);
    const handOk = /^\d{4}-\d{2}-\d{2}$/.test(hDate) && /^\d{2}:\d{2}$/.test(hTime) && !!hLocation;
    const renderHand = () => (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm" htmlFor="hand-date">
                <span className="label">Date</span>
                <input id="hand-date" type="date" className="input" value={hDate} onChange={(e) => setHDate(e.target.value)} />
            </label>
            <label className="grid gap-1 text-sm" htmlFor="hand-time">
                <span className="label">Start time</span>
                <input id="hand-time" type="time" step={300} className="input" value={hTime} onChange={(e) => setHTime(e.target.value)} />
            </label>
            <label className="grid gap-1 text-sm" htmlFor="hand-loc">
                <span className="label">Facility</span>
                <select
                    id="hand-loc"
                    className="input"
                    value={hLoc}
                    onChange={(e) => {
                        setHLoc(e.target.value);
                        setHUnit("");
                    }}
                >
                    {data.locations.map((l) => (
                        <option key={l.id} value={l.id}>
                            {l.name}
                        </option>
                    ))}
                </select>
            </label>
            {hLocation && hLocation.units.length > 0 && (
                <label className="grid gap-1 text-sm" htmlFor="hand-unit">
                    <span className="label">{cap(t.unit)}</span>
                    <select id="hand-unit" className="input" value={hUnit} onChange={(e) => setHUnit(e.target.value)}>
                        <option value="">Not set</option>
                        {hLocation.units.map((u) => (
                            <option key={u.id} value={u.id}>
                                {u.name}
                            </option>
                        ))}
                    </select>
                </label>
            )}
            <label className="grid gap-1 text-sm sm:col-span-2" htmlFor="hand-note">
                <span className="label">Note (optional)</span>
                <input id="hand-note" className="input" maxLength={200} placeholder="Moved for rain" value={hNote} onChange={(e) => setHNote(e.target.value)} />
            </label>
            <div className="sm:col-span-2">
                <button
                    className="btn-primary"
                    disabled={!handOk}
                    onClick={() =>
                        onApply({
                            date: hDate,
                            time: hTime,
                            locationId: hLoc,
                            // No slot: the engine finds one at that date, time and
                            // facility if there is one, and otherwise flags it softly.
                            slotId: null,
                            unitIds: hUnit && hLocation ? unitsFrom(hLocation.units.map((u) => u.id), hUnit) : undefined,
                            locked: true,
                            manual: true,
                            note: hNote.trim() || undefined,
                        })
                    }
                >
                    Save this date and time
                </button>
            </div>
        </div>
    );

    return (
        <Modal title={match.date ? `Move ${t.match}` : `Place ${t.match}`} onClose={onClose} wide>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div className="text-lg font-semibold">
                        {name(match.home)} <span className="font-normal text-muted">vs</span> {name(match.away)}
                    </div>
                    <div className="text-sm text-muted">{match.date
                            ? `Now: ${formatDate(match.date)} · ${formatTime(match.time)} · ${locName(match.locationId ?? "")}${match.unitIds?.length ? ` · ${match.unitIds.map(unitName).join(", ")}` : ""}`
                            : "Not placed yet"}
                    </div>
                    {hereFree.length > cpm - 1 && here && hereFree.length > (match.unitIds?.length ?? 0) && (
                        <label className="mt-2 flex items-center gap-2 text-sm">
                            Change {t.unit}:
                            <select
                                aria-label={`Change ${t.unit}`}
                                className="input w-auto"
                                value={match.unitIds?.[0] ?? ""}
                                onChange={(e) => e.target.value && onApply({ unitIds: unitsFrom(hereFree, e.target.value), locked: true })}
                            >
                                {!match.unitIds?.length && <option value="">Choose…</option>}
                                {hereFree.map((u) => (
                                    <option key={u} value={u}>
                                        {unitName(u)}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}
                </div>
                <div className="flex flex-wrap gap-2">
                    <button className="btn-secondary btn-sm" onClick={() => onApply({ home: match.away, away: match.home, locked: true })}>
                        Swap home/away
                    </button>
                    {match.date && (
                        <button
                            className="btn-secondary btn-sm"
                            onClick={() => onApply({ date: null, time: null, locationId: null, slotId: null, unitIds: undefined, locked: false, manual: undefined, note: "Taken off the schedule by hand." })}
                        >
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
                                    onClick={() => {
                                        setPicked(o);
                                        setUnit(o.freeUnits[0] ?? "");
                                    }}
                                    aria-pressed={sel}
                                    className={`block w-full border-t border-border px-3 py-2 text-left text-sm ${sel ? "bg-accent-soft" : "hover:bg-surface-2"}`}
                                >
                                    <span className="font-mono tabular">{formatTime(o.inst.time)}</span> · {locName(o.inst.locationId)}{" "}
                                    <span className="text-muted tabular">
                                        ({o.used}/{o.inst.capacity} {o.inst.capacity === 1 ? t.match : t.matches} booked
                                        {o.freeUnits.length ? `; free: ${o.freeUnits.map(unitName).join(", ")}` : ""})
                                    </span>
                                    {bad && <span className="block text-xs text-danger">Breaks: {o.verdict.hard.join("; ")}</span>}
                                    {o.verdict.soft.length > 0 && <span className="block text-xs text-warn">Misses: {o.verdict.soft.join("; ")}</span>}
                                </button>
                            );
                        })}
                    </div>
                ))}
            </div>

            <details className="mt-4 rounded-lg border border-border p-3">
                <summary className="cursor-pointer text-sm font-semibold">Set the date and time by hand</summary>
                <p className="mt-2 text-sm text-muted">
                    For a {t.match} moved to a time that isn’t one of the slots above, like a rain-out the facility fitted in. It’s locked so regenerating keeps it,
                    and noted as set by hand. Team rules and double bookings are still checked.
                </p>
                {renderHand()}
            </details>

            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                {picked && picked.freeUnits.length >= cpm && (
                    <label className="mr-auto flex items-center gap-2 text-sm">
                        {cap(t.unit)}:
                        <select aria-label={`${cap(t.unit)} to use`} className="input w-auto" value={unit} onChange={(e) => setUnit(e.target.value)}>
                            {picked.freeUnits.map((u) => (
                                <option key={u} value={u}>
                                    {unitName(u)}
                                </option>
                            ))}
                        </select>
                    </label>
                )}
                <button className="btn-ghost" onClick={onClose}>
                    Cancel
                </button>
                <button
                    className={picked?.verdict.hard.length ? "btn-danger" : "btn-primary"}
                    disabled={!picked}
                    onClick={() =>
                        picked &&
                        onApply({
                            date: picked.inst.date,
                            time: picked.inst.time,
                            locationId: picked.inst.locationId,
                            slotId: picked.inst.slotId,
                            unitIds: picked.freeUnits.length >= cpm ? unitsFrom(picked.freeUnits, unit) : undefined,
                            locked: true,
                            manual: undefined,
                            note: undefined,
                        })
                    }
                >
                    {picked?.verdict.hard.length ? "Move anyway (breaks a rule)" : "Move here and lock"}
                </button>
            </div>
        </Modal>
    );
}
