"use client";

import { useMemo, useState } from "react";
import { DAY_LONG, formatDate, formatTime, isTime, parseTimes, toMinutes } from "@/lib/engine/dates";
import { gamesInSlots, type Audit } from "@/lib/engine/engine";
import { readiness } from "@/lib/engine/readiness";
import { mapSearchUrl, safeMapUrl } from "@/lib/engine/sanitize";
import { cap, countOf, type Terms } from "@/lib/engine/sports";
import type { DayOfWeek, League, Location, Match, Rule, Slot, Unit } from "@/lib/engine/types";
import DayPlanner, { FacilityPills, SpotTotals } from "./DayPlanner";
import ImportDialog from "./ImportDialog";
import { locationLink } from "./ScheduleTab";
import { withData, type Doc, type TabProps } from "./types";
import { ConfirmButton, DaysPicker, Field, Modal, NumberInput, uid, useFocusLater } from "./ui";

/**
 * Games at once in a slot: from its named units when it has them, else its
 * number. Mirrors prepare() in the engine exactly -- including dropping a
 * slot whose stored number is 0 even if it names units, and one at a deleted
 * facility -- so the planner's spot counts are the spots Generate really has.
 */
export function slotCapacity(s: Slot, league: League): number {
    const loc = league.locations.find((l) => l.id === s.locationId);
    if (!loc || !isTime(s.time) || !(s.capacity > 0)) return 0;
    const units = s.unitIds.filter((id) => loc.units.some((u) => u.id === id));
    const cpm = Math.max(1, Math.floor(league.settings.courtsPerMatch || 1));
    return units.length ? Math.floor(units.length / cpm) : Math.floor(s.capacity);
}

/** Placed games the engine binds to any of these slots (see gamesInSlots). */
export function bookedIn(result: Audit, matches: Match[], ids: Iterable<string>): number {
    return gamesInSlots(result.ctx, matches, new Set(ids)).length;
}

export function unitNames(ids: string[] | undefined, league: League): string {
    if (!ids?.length) return "";
    const all = league.locations.flatMap((l) => l.units);
    return ids
        .map((id) => all.find((u) => u.id === id)?.name)
        .filter(Boolean)
        .join(", ");
}

/**
 * "Sheet A" x3 -> Sheet A, Sheet B, Sheet C; "Field 1" x4 -> Field 1..4;
 * "Court" x2 -> Court 1, Court 2. Counts on from a trailing number or letter.
 */
function sequence(start: string, n: number): string[] {
    const s = start.trim() || "Court 1";
    let m = /^(.*?)(\d+)$/.exec(s);
    if (m) return Array.from({ length: n }, (_, i) => `${m![1]}${Number(m![2]) + i}`);
    m = /^(.*\s)([A-Za-z])$/.exec(s);
    if (m) return Array.from({ length: n }, (_, i) => `${m![1]}${String.fromCharCode(m![2].charCodeAt(0) + i)}`);
    return Array.from({ length: n }, (_, i) => `${s} ${i + 1}`);
}

/**
 * `only` splits the tab in two for the setup wizard, which asks for the
 * facilities and their time on separate steps. The dialogs stay mounted
 * either way: the time step's import can still create a facility's units.
 */
export default function CourtsTab({ doc, change, result, t, only }: TabProps & { only?: "facilities" | "time" }) {
    const { data } = doc;
    const [editingLoc, setEditingLoc] = useState<Location | null>(null);
    const [editingSlot, setEditingSlot] = useState<Slot | null>(null);
    const [importing, setImporting] = useState(false);
    const [imported, setImported] = useState<string | null>(null);
    const [showAvail, setShowAvail] = useState<string | null>(null);
    const Units = cap(t.units);
    const Matches = cap(t.matches);

    // Quick-add form for weekly slots.
    const [qDays, setQDays] = useState<DayOfWeek[]>([6]);
    const [qTimes, setQTimes] = useState("9:00, 11:00, 1pm, 3pm");
    // One facility choice for the planner's board AND the quick-add form, so
    // whatever the form adds lands on the board in view.
    const [qLoc, setQLoc] = useState("");
    // "By day" (the planner) or "List" (every slot in one table). Not
    // remembered across visits on purpose: reading it back from storage
    // needs a post-mount effect that flips the view a moment after it
    // renders, which is worse than always opening on the planner.
    const [view, setView] = useState<"day" | "list">("day");
    const focusLater = useFocusLater();
    const [qCap, setQCap] = useState<number | null>(2);
    // null = every unit at the facility; a list = just those.
    const [qUnits, setQUnits] = useState<string[] | null>(null);
    const [qBrackets, setQBrackets] = useState<string[]>([]);
    const times = parseTimes(qTimes);
    // Falls back to the first facility when the chosen one was deleted, so
    // the board and the form never point at a facility that's gone.
    const locId = data.locations.some((l) => l.id === qLoc) ? qLoc : data.locations[0]?.id || "";
    const qLocation = data.locations.find((l) => l.id === locId);
    const qUnitIds = qLocation?.units.length ? (qUnits ?? qLocation.units.map((u) => u.id)).filter((id) => qLocation.units.some((u) => u.id === id)) : [];
    const cpm = Math.max(1, data.settings.courtsPerMatch || 1);
    const qAtOnce = qLocation?.units.length ? Math.floor(qUnitIds.length / cpm) : (qCap ?? 0);

    const addSlots = () => {
        if (!locId || !times.length || !qDays.length || qAtOnce < 1) return;
        const add: Slot[] = [];
        for (const day of qDays) for (const time of times) add.push({ id: uid("s"), day, time, locationId: locId, capacity: qAtOnce, unitIds: qUnitIds, bracketIds: qBrackets });
        change((d) => withData(d, { slots: [...d.data.slots, ...add] }));
    };

    const order = (d: DayOfWeek) => (d + 6) % 7; // Monday first
    const slots = [...data.slots].sort((a, b) => order(a.day) - order(b.day) || toMinutes(a.time) - toMinutes(b.time));
    const needed = Math.round(data.teams.reduce((s, team) => s + (team.matches ?? data.brackets.find((b) => b.id === team.bracketId)?.matches ?? 0), 0) / 2);

    // The time step's readiness checks: the totals' verdict leads with these
    // so it can't say "plenty of room" while a bracket has no usable time.
    // Memoised: CourtsTab re-renders on every keystroke in its own forms, and
    // readiness() costs ~200 ms on a 200-team league (a Tester find).
    const timeChecks = useMemo(() => (only === "facilities" ? [] : readiness(data, doc.name).filter((c) => c.step === "time" && c.level !== "info")), [only, data, doc.name]);

    const pickLocation = (id: string) => {
        setQLoc(id);
        setQUnits(null);
    };

    // Render functions, not components: a component defined in here would be
    // a new type every render and remount (losing focus) on each keystroke.
    const renderQuickAdd = () => (
        <div className="card grid gap-3 p-4">
            <h3 className="font-semibold">Add the same times to many days</h3>
            <div className="grid gap-3 lg:grid-cols-[auto_minmax(0,1fr)]">
                <Field label="Days">
                    <DaysPicker value={qDays} onChange={setQDays} />
                </Field>
                <Field
                    label="Start times"
                    htmlFor="q-times"
                    hint={times.length ? `Reads as: ${times.map(formatTime).join(", ")}` : "e.g. 9, 10:30, 1pm, 17:45"}
                >
                    <input id="q-times" className="input" value={qTimes} onChange={(e) => setQTimes(e.target.value)} />
                </Field>
            </div>
            <div className="flex flex-wrap items-end gap-3">
                <Field label="Facility" htmlFor="q-loc">
                    <select
                        id="q-loc"
                        className="input"
                        value={locId}
                        onChange={(e) => pickLocation(e.target.value)}
                    >
                        {data.locations.map((l) => (
                            <option key={l.id} value={l.id}>
                                {l.name}
                            </option>
                        ))}
                    </select>
                </Field>
                {qLocation?.units.length ? (
                    <Field
                        label={`${Units} free`}
                        hint={`${qAtOnce} ${qAtOnce === 1 ? t.match : t.matches} at once${cpm > 1 ? ` (${cpm} ${t.units} per ${t.match})` : ""}`}
                    >
                        <UnitToggles units={qLocation.units} value={qUnitIds} onChange={setQUnits} />
                    </Field>
                ) : (
                    <Field label={`${Matches} at once`} htmlFor="q-cap">
                        <NumberInput id="q-cap" value={qCap} min={1} max={100} onChange={setQCap} className="input w-24" />
                    </Field>
                )}
                {data.brackets.length > 0 && (
                    <Field label="Open to" hint="None selected = every bracket.">
                        <BracketToggles brackets={data.brackets} value={qBrackets} onChange={setQBrackets} />
                    </Field>
                )}
                <button className="btn-primary" onClick={addSlots} disabled={!times.length || !qDays.length || qAtOnce < 1}>
                    Add {qDays.length * times.length} slot{qDays.length * times.length === 1 ? "" : "s"}
                </button>
            </div>
        </div>
    );

    const renderList = () => (
        <div className="card overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b border-border bg-surface-2 text-left">
                        <th className="label px-4 py-2">Day</th>
                        <th className="label px-4 py-2">Start</th>
                        <th className="label px-4 py-2">Facility</th>
                        <th className="label px-4 py-2">{Units}</th>
                        <th className="label px-4 py-2">At once</th>
                        <th className="label px-4 py-2">Open to</th>
                        <th className="px-4 py-2" />
                    </tr>
                </thead>
                <tbody className="divide-y divide-border">
                    {slots.map((s) => (
                        <tr key={s.id}>
                            <td className="px-4 py-2">{DAY_LONG[s.day]}</td>
                            <td className="px-4 py-2 font-mono tabular">{formatTime(s.time)}</td>
                            <td className="px-4 py-2">
                                {data.locations.find((l) => l.id === s.locationId)?.name ?? <span className="text-danger">Deleted facility</span>}
                            </td>
                            <td className="px-4 py-2">{unitNames(s.unitIds, data) || <span className="text-muted">—</span>}</td>
                            <td className="px-4 py-2 tabular">{slotCapacity(s, data)}</td>
                            <td className="px-4 py-2">
                                {s.bracketIds.length
                                    ? s.bracketIds
                                          .map((id) => data.brackets.find((b) => b.id === id)?.name)
                                          .filter(Boolean)
                                          .join(", ")
                                    : "All"}
                            </td>
                            <td className="px-4 py-2 text-right">
                                <button className="btn-ghost btn-sm" onClick={() => setEditingSlot(s)}>
                                    Edit
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );

    return (
        <div className="grid gap-8">
            {only !== "time" && (
                <section className="grid gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h2 className="font-display text-2xl font-bold uppercase tracking-wide">Facilities</h2>
                            <p className="text-sm text-muted">
                                Where {t.matches} are played. One is fine if everything happens in one place. Name each facility’s {t.units} (e.g. {t.unitLabel(0)},{" "}
                                {t.unitLabel(1)}) so every {t.match} gets one.
                            </p>
                        </div>
                        <button className="btn-primary" onClick={() => setEditingLoc({ id: "", name: "", address: "", mapUrl: "", notes: "", units: [] })}>
                            Add facility
                        </button>
                    </div>
                    {data.locations.length === 0 && <div className="card p-5 text-muted">No facilities yet.</div>}
                    <div className="grid gap-3 md:grid-cols-2">
                        {data.locations.map((l) => {
                            const href = locationLink(l);
                            const n = data.slots.filter((s) => s.locationId === l.id).length;
                            return (
                                <div key={l.id} className="card flex items-start justify-between gap-3 p-4">
                                    <div className="min-w-0">
                                        <div className="font-semibold [overflow-wrap:anywhere]">{l.name}</div>
                                        {l.address && <div className="text-sm text-muted">{l.address}</div>}
                                        <div className="mt-1 text-sm">
                                            {l.units.length ? (
                                                <span>
                                                    {l.units.length} {l.units.length === 1 ? t.unit : t.units}: {l.units.map((u) => u.name).join(", ")}
                                                </span>
                                            ) : (
                                                <span className="text-muted">No named {t.units}</span>
                                            )}
                                        </div>
                                        <div className="mt-1 flex flex-wrap gap-3 text-sm">
                                            {href && (
                                                <a className="font-semibold text-accent underline" href={href} target="_blank" rel="noreferrer">
                                                    {l.mapUrl ? "Open pinned map" : "Find on Google Maps"}
                                                </a>
                                            )}
                                            <span className="text-muted">
                                                {n} weekly time slot{n === 1 ? "" : "s"}
                                            </span>
                                        </div>
                                    </div>
                                    <button className="btn-secondary btn-sm" onClick={() => setEditingLoc(l)}>
                                        Edit
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}

            {only !== "facilities" && (
                <>
                    <section className="grid gap-4">
                        <div className="flex flex-wrap items-end justify-between gap-3">
                            <div className="min-w-0">
                                <h2 className="font-display text-2xl font-bold uppercase tracking-wide">Weekly {t.time}</h2>
                                <p className="max-w-3xl text-sm text-muted">
                                    A start time that repeats every week, with which {t.units} are free (or how many {t.matches} can be on at once). Plan each facility a
                                    day at a time on the board, or add one pattern to many days with the form below it. Restrict a slot to certain brackets to give age
                                    groups different schedules.
                                </p>
                            </div>
                            {data.locations.length > 0 && (
                                <div className="inline-flex shrink-0 rounded-lg border border-border bg-surface p-0.5" role="group" aria-label="Show weekly time">
                                    {(
                                        [
                                            ["day", "By day"],
                                            ["list", "List"],
                                        ] as const
                                    ).map(([v, label]) => (
                                        <button
                                            key={v}
                                            type="button"
                                            aria-pressed={view === v}
                                            onClick={() => setView(v)}
                                            className={`rounded-md px-3 py-1 text-sm font-semibold ${view === v ? "bg-accent text-accent-fg" : "text-muted hover:text-fg"}`}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {data.locations.length === 0 ? (
                            <p className="text-sm text-muted">Add a facility first.</p>
                        ) : view === "day" ? (
                            <>
                                <FacilityPills league={data} t={t} locId={locId} onPick={pickLocation} />
                                <SpotTotals league={data} result={result} t={t} location={qLocation} needed={needed} checks={timeChecks} />
                                <DayPlanner
                                    doc={doc}
                                    change={change}
                                    result={result}
                                    t={t}
                                    locId={locId}
                                    onEditSlot={setEditingSlot}
                                    fallbackAtOnce={Math.max(1, qCap ?? 2)}
                                />
                            </>
                        ) : (
                            <>
                                <SpotTotals league={data} result={result} t={t} needed={needed} checks={timeChecks} />
                                {slots.length > 0 ? renderList() : <div className="card p-5 text-sm text-muted">No weekly {t.time} yet.</div>}
                            </>
                        )}
                        {data.locations.length > 0 && renderQuickAdd()}
                    </section>

                    <section className="grid gap-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0">
                                <h2 className="font-display text-2xl font-bold uppercase tracking-wide">Facility availability</h2>
                                <p className="max-w-3xl text-sm text-muted">
                                    Upload the spreadsheet a facility sends with its dates, times and {t.units}. For every date it covers, it replaces that facility’s weekly slots;
                                    other dates keep the weekly pattern. A time marked closed or 0 {t.units} blocks it. If the file names its {t.units} ({t.unitLabel(0)}…),
                                    they’re added to the facility.
                                </p>
                            </div>
                            <button className="btn-primary" onClick={() => setImporting(true)}>
                                Upload a facility spreadsheet
                            </button>
                        </div>
                        {imported && <p className="text-sm font-semibold text-ok">{imported}</p>}
                        {data.availability.length === 0 && (
                            <div className="card p-5 text-sm text-muted">No facility spreadsheets uploaded. The weekly time slots above are used for every date.</div>
                        )}
                        {data.locations
                            .map((l) => ({ l, rows: data.availability.filter((a) => a.locationId === l.id) }))
                            .filter((x) => x.rows.length > 0)
                            .map(({ l, rows }) => {
                                const byDate = new Map<string, typeof rows>();
                                for (const a of [...rows].sort((x, y) => x.date.localeCompare(y.date) || x.time.localeCompare(y.time))) {
                                    if (!byDate.has(a.date)) byDate.set(a.date, []);
                                    byDate.get(a.date)!.push(a);
                                }
                                const ds = [...byDate.keys()];
                                const total = rows.reduce((n, a) => n + (a.unitIds.length || a.courts), 0);
                                const open = showAvail === l.id;
                                return (
                                    <div key={l.id} className="card p-4">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div className="min-w-0">
                                                <div className="font-semibold">{l.name}</div>
                                                <div className="text-sm text-muted tabular">
                                                    {rows.length} time slots on {ds.length} dates, {formatDate(ds[0])} to {formatDate(ds[ds.length - 1])} · {total} {t.unit}-slots
                                                    in total
                                                </div>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                <button className="btn-secondary btn-sm" onClick={() => setShowAvail(open ? null : l.id)}>
                                                    {open ? "Hide dates" : "Show dates"}
                                                </button>
                                                <ConfirmButton
                                                    className="btn-danger btn-sm"
                                                    label="Remove upload"
                                                    confirmLabel="Remove and go back to weekly slots?"
                                                    onConfirm={() => change((d) => withData(d, { availability: d.data.availability.filter((a) => a.locationId !== l.id) }))}
                                                />
                                            </div>
                                        </div>
                                        {open && (
                                            <div className="mt-3 grid max-h-80 gap-1.5 overflow-y-auto text-sm">
                                                {ds.map((date) => (
                                                    <div key={date} className="flex flex-wrap items-center gap-1.5">
                                                        <span className="w-28 shrink-0 font-semibold">{formatDate(date)}</span>
                                                        {byDate.get(date)!.map((a) => (
                                                            <span key={a.id} className={`chip tabular ${a.courts ? "bg-surface-2" : "bg-danger-soft text-danger"}`}>
                                                                {formatTime(a.time)} ·{" "}
                                                                {a.courts
                                                                    ? a.unitIds.length
                                                                        ? unitNames(a.unitIds, data)
                                                                        : `${a.courts} ${a.courts === 1 ? t.unit : t.units}`
                                                                    : "closed"}
                                                            </span>
                                                        ))}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                    </section>
                </>
            )}

            {importing && (
                <ImportDialog
                    league={data}
                    t={t}
                    onClose={() => setImporting(false)}
                    onImport={(patch, summary) => {
                        change((d) => withData(d, patch));
                        setImporting(false);
                        setImported(summary);
                    }}
                />
            )}
            {editingLoc && (
                <LocationDialog
                    key={editingLoc.id || "new"}
                    loc={editingLoc}
                    t={t}
                    slotCount={data.slots.filter((s) => s.locationId === editingLoc.id).length + data.availability.filter((a) => a.locationId === editingLoc.id).length}
                    matchCount={doc.schedule.matches.filter((m) => m.date && m.locationId === editingLoc.id).length}
                    onClose={() => setEditingLoc(null)}
                    onSave={(l) => {
                        change((d) => saveLocation(d, l));
                        setEditingLoc(null);
                    }}
                    onDelete={() => {
                        const id = editingLoc.id;
                        const strip = <T extends { rules: Rule[] }>(x: T): T => ({
                            ...x,
                            rules: x.rules.map((r) => ("locationIds" in r ? { ...r, locationIds: r.locationIds.filter((l) => l !== id) } : r)),
                        });
                        change((d) => ({
                            ...d,
                            data: {
                                ...d.data,
                                locations: d.data.locations.filter((x) => x.id !== id),
                                slots: d.data.slots.filter((s) => s.locationId !== id),
                                availability: d.data.availability.filter((a) => a.locationId !== id),
                                teams: d.data.teams.map(strip),
                                brackets: d.data.brackets.map(strip),
                            },
                            // Games booked there go back to "not placed" (with a
                            // reason) instead of pointing at a facility that's gone.
                            schedule: {
                                ...d.schedule,
                                matches: d.schedule.matches.map((m) => {
                                    if (m.locationId !== id) return m;
                                    const rest = { ...m, date: null, time: null, locationId: null, slotId: null, locked: false, note: "Its facility was deleted." };
                                    delete rest.unitIds;
                                    return rest;
                                }),
                            },
                        }));
                        setEditingLoc(null);
                    }}
                />
            )}
            {editingSlot && (
                <SlotDialog
                    key={editingSlot.id}
                    slot={editingSlot}
                    props={{ doc, change, result, t } as TabProps}
                    onClose={() => setEditingSlot(null)}
                    onSave={(s) => {
                        change((d) => withData(d, { slots: d.data.slots.map((x) => (x.id === s.id ? s : x)) }));
                        setEditingSlot(null);
                        // A slot saved onto another day (or facility) is a new
                        // button somewhere else, and the dialog's own "focus
                        // what opened me" finds the old one gone. Follow it.
                        if (s.locationId !== locId) pickLocation(s.locationId);
                        focusLater(`slot-btn-${s.id}`, `planner-day-${s.day}`);
                    }}
                    onDelete={() => {
                        change((d) => withData(d, { slots: d.data.slots.filter((x) => x.id !== editingSlot.id) }));
                        setEditingSlot(null);
                        focusLater(`planner-day-${editingSlot.day}`);
                    }}
                />
            )}
        </div>
    );
}

/**
 * Saves a facility. Units removed from it are also removed from every slot,
 * uploaded time and booked game that named them -- a game can't stay on a
 * sheet that no longer exists. Workspace's `change` then re-runs assignUnits,
 * which moves those games to a free unit at the same time where there is one
 * (and the audit flags any left without). A slot that loses its last named
 * unit keeps its "at once" number, which was kept in step with its units.
 */
function saveLocation(d: Doc, l: Location): Doc {
    const old = d.data.locations.find((x) => x.id === l.id);
    if (!old) return withData(d, { locations: [...d.data.locations, { ...l, id: l.id || uid("l") }] });
    const gone = new Set(old.units.filter((u) => !l.units.some((n) => n.id === u.id)).map((u) => u.id));
    const keep = (ids: string[]) => ids.filter((x) => !gone.has(x));
    return {
        ...d,
        data: {
            ...d.data,
            locations: d.data.locations.map((x) => (x.id === l.id ? l : x)),
            slots: d.data.slots.map((s) => (s.locationId === l.id ? { ...s, unitIds: keep(s.unitIds) } : s)),
            availability: d.data.availability.map((a) => (a.locationId === l.id ? { ...a, unitIds: keep(a.unitIds) } : a)),
        },
        schedule: gone.size
            ? {
                  ...d.schedule,
                  matches: d.schedule.matches.map((m) => {
                      if (!m.unitIds?.some((u) => gone.has(u))) return m;
                      const rest = { ...m };
                      delete rest.unitIds;
                      return rest;
                  }),
              }
            : d.schedule,
    };
}

function BracketToggles({ brackets, value, onChange }: { brackets: { id: string; name: string }[]; value: string[]; onChange: (v: string[]) => void }) {
    return (
        <div className="flex flex-wrap gap-1">
            {brackets.map((b) => {
                const on = value.includes(b.id);
                return (
                    <button
                        key={b.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => onChange(on ? value.filter((x) => x !== b.id) : [...value, b.id])}
                        className={`rounded-md border px-2.5 py-1 text-sm font-semibold ${on ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface text-muted"}`}
                    >
                        {b.name}
                    </button>
                );
            })}
        </div>
    );
}

function UnitToggles({ units, value, onChange }: { units: Unit[]; value: string[]; onChange: (v: string[]) => void }) {
    return (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Units free">
            {units.map((u) => {
                const on = value.includes(u.id);
                return (
                    <button
                        key={u.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => onChange(on ? value.filter((x) => x !== u.id) : units.map((x) => x.id).filter((x) => x === u.id || value.includes(x)))}
                        className={`rounded-md border px-2.5 py-1 text-sm font-semibold ${on ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface text-muted"}`}
                    >
                        {u.name}
                    </button>
                );
            })}
        </div>
    );
}

function LocationDialog({
    loc,
    t,
    slotCount,
    matchCount,
    onClose,
    onSave,
    onDelete,
}: {
    loc: Location;
    t: Terms;
    slotCount: number;
    matchCount: number;
    onClose: () => void;
    onSave: (l: Location) => void;
    onDelete: () => void;
}) {
    const [l, setL] = useState<Location>(loc);
    const [seqStart, setSeqStart] = useState(t.unitLabel(loc.units.length));
    const [seqCount, setSeqCount] = useState<number | null>(loc.units.length ? 1 : 2);
    const [one, setOne] = useState("");
    const pinOk = !l.mapUrl.trim() || safeMapUrl(l.mapUrl) !== "";
    const Units = cap(t.units);
    const addNames = (names: string[]) => {
        const units = [...l.units];
        for (const raw of names) {
            const name = raw.trim().slice(0, 60);
            if (name && !units.some((u) => u.name.toLowerCase() === name.toLowerCase())) units.push({ id: uid("u"), name });
        }
        setL({ ...l, units });
    };
    return (
        <Modal title={loc.id ? "Edit facility" : "New facility"} onClose={onClose} wide>
            <div className="grid gap-4">
                <Field label="Facility name" htmlFor="loc-name">
                    <input id="loc-name" className="input" value={l.name} onChange={(e) => setL({ ...l, name: e.target.value })} placeholder={t.facility[0]} />
                </Field>
                <Field label="Address" htmlFor="loc-address" hint="Shown on exported schedules so families can find it.">
                    <input id="loc-address" className="input" value={l.address} onChange={(e) => setL({ ...l, address: e.target.value })} placeholder="123 Main St, Springfield" />
                </Field>

                <div className="rounded-lg border border-border p-3">
                    <p className="font-semibold">{Units} at this facility</p>
                    <p className="text-sm text-muted">
                        Name or number each {t.unit} ({t.unitLabel(0)}, {t.unitLabel(1)}…). Every {t.match} here is then given one, and schedules say which. Optional: without
                        names, time slots just say how many {t.matches} fit at once.
                    </p>
                    {l.units.length > 0 && (
                        <ul className="mt-2 flex flex-wrap gap-1.5">
                            {l.units.map((u, i) => (
                                <li key={u.id} className="flex items-center gap-1 rounded-md border border-border bg-surface-2 pl-1">
                                    <input
                                        aria-label={`${cap(t.unit)} ${i + 1} name`}
                                        className="w-28 bg-transparent px-1 py-0.5 text-sm"
                                        value={u.name}
                                        onChange={(e) => setL({ ...l, units: l.units.map((x) => (x.id === u.id ? { ...x, name: e.target.value } : x)) })}
                                    />
                                    <button
                                        type="button"
                                        className="px-1.5 text-muted hover:text-danger"
                                        aria-label={`Remove ${u.name}`}
                                        onClick={() => setL({ ...l, units: l.units.filter((x) => x.id !== u.id) })}
                                    >
                                        ✕
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                        <Field label="Starting from" htmlFor="unit-seq-start">
                            <input id="unit-seq-start" className="input w-32" value={seqStart} onChange={(e) => setSeqStart(e.target.value)} />
                        </Field>
                        <Field label="How many" htmlFor="unit-seq-count">
                            <NumberInput id="unit-seq-count" value={seqCount} min={1} max={40} onChange={setSeqCount} className="input w-20" />
                        </Field>
                        <button
                            type="button"
                            className="btn-secondary"
                            disabled={!seqCount}
                            onClick={() => {
                                addNames(sequence(seqStart, seqCount ?? 1));
                                setSeqStart(t.unitLabel(l.units.length + (seqCount ?? 1)));
                            }}
                        >
                            Add {seqCount ? sequence(seqStart, seqCount).join(", ").slice(0, 60) : t.units}
                        </button>
                        <span className="text-sm text-muted">or</span>
                        <input
                            aria-label={`Add one ${t.unit} by name`}
                            className="input w-40"
                            value={one}
                            onChange={(e) => setOne(e.target.value)}
                            placeholder={`e.g. Center ${t.unit}`}
                        />
                        <button
                            type="button"
                            className="btn-ghost"
                            disabled={!one.trim()}
                            onClick={() => {
                                addNames([one]);
                                setOne("");
                            }}
                        >
                            Add
                        </button>
                    </div>
                </div>

                <div className="rounded-lg bg-surface-2 p-3 text-sm">
                    <p className="font-semibold">Map pin</p>
                    <ol className="mt-1 list-decimal pl-5 text-muted">
                        <li>
                            <a className="font-semibold text-accent underline" href={mapSearchUrl(l.name, l.address)} target="_blank" rel="noreferrer">
                                Search Google Maps for “{[l.name, l.address].filter(Boolean).join(", ") || "this facility"}”
                            </a>
                        </li>
                        <li>Find the right pin, press Share, then Copy link.</li>
                        <li>Paste it below. Without one, schedules link to the search instead.</li>
                    </ol>
                    <input
                        id="loc-map"
                        className="input mt-2"
                        value={l.mapUrl}
                        onChange={(e) => setL({ ...l, mapUrl: e.target.value })}
                        placeholder="https://maps.app.goo.gl/…"
                        aria-label="Google Maps link"
                    />
                    {!pinOk && (
                        <p className="mt-1 text-xs text-danger">That isn’t a Google Maps link. It should start with https://maps.app.goo.gl/ or https://www.google.com/maps/.</p>
                    )}
                </div>
                <Field label="Notes" htmlFor="loc-notes">
                    <textarea
                        id="loc-notes"
                        className="input"
                        rows={2}
                        value={l.notes}
                        onChange={(e) => setL({ ...l, notes: e.target.value })}
                        placeholder="Parking, entrance, gate code…"
                    />
                </Field>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                    {loc.id ? (
                        <ConfirmButton
                            label="Delete facility"
                            confirmLabel={
                                slotCount || matchCount
                                    ? `Delete it${slotCount ? `, its ${slotCount} time slots` : ""}${matchCount ? ` and unschedule ${matchCount} ${t.matches}` : ""}?`
                                    : "Really delete?"
                            }
                            onConfirm={onDelete}
                        />
                    ) : (
                        <span />
                    )}
                    <div className="flex gap-2">
                        <button className="btn-ghost" onClick={onClose}>
                            Cancel
                        </button>
                        <button
                            className="btn-primary"
                            disabled={!l.name.trim() || !pinOk}
                            onClick={() =>
                                onSave({
                                    ...l,
                                    name: l.name.trim(),
                                    address: l.address.trim(),
                                    mapUrl: safeMapUrl(l.mapUrl),
                                    units: l.units.map((u) => ({ ...u, name: u.name.trim() })).filter((u) => u.name),
                                })
                            }
                        >
                            Save facility
                        </button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}

function SlotDialog({ slot, props, onClose, onSave, onDelete }: { slot: Slot; props: TabProps; onClose: () => void; onSave: (s: Slot) => void; onDelete: () => void }) {
    const { data } = props.doc;
    const t = props.t;
    const [s, setS] = useState<Slot>(slot);
    const booked = bookedIn(props.result, props.doc.schedule.matches, [slot.id]);
    const loc = data.locations.find((l) => l.id === s.locationId);
    const cpm = Math.max(1, data.settings.courtsPerMatch || 1);
    return (
        <Modal title="Edit time slot" onClose={onClose}>
            <div className="grid gap-4">
                <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Day" htmlFor="slot-day">
                        <select id="slot-day" className="input" value={s.day} onChange={(e) => setS({ ...s, day: Number(e.target.value) as DayOfWeek })}>
                            {DAY_LONG.map((d, i) => (
                                <option key={d} value={i}>
                                    {d}
                                </option>
                            ))}
                        </select>
                    </Field>
                    <Field label="Start" htmlFor="slot-time">
                        <input id="slot-time" type="time" step={900} className="input" value={s.time} onChange={(e) => e.target.value && setS({ ...s, time: e.target.value })} />
                    </Field>
                    <Field label="Facility" htmlFor="slot-loc">
                        <select
                            id="slot-loc"
                            className="input"
                            value={s.locationId}
                            onChange={(e) => {
                                const next = data.locations.find((l) => l.id === e.target.value);
                                setS({ ...s, locationId: e.target.value, unitIds: next?.units.map((u) => u.id) ?? [] });
                            }}
                        >
                            {data.locations.map((l) => (
                                <option key={l.id} value={l.id}>
                                    {l.name}
                                </option>
                            ))}
                        </select>
                    </Field>
                    {loc?.units.length ? (
                        <Field label={`${cap(t.units)} free`} hint={`${countOf(Math.floor(s.unitIds.length / cpm), t)} at once`}>
                            <UnitToggles
                                units={loc.units}
                                value={s.unitIds}
                                onChange={(unitIds) => setS({ ...s, unitIds, capacity: Math.max(1, Math.floor(unitIds.length / cpm)) })}
                            />
                        </Field>
                    ) : (
                        <Field label={`${cap(t.matches)} at once`} htmlFor="slot-cap">
                            <NumberInput id="slot-cap" value={s.capacity} min={1} max={100} onChange={(v) => setS({ ...s, capacity: v ?? 1 })} />
                        </Field>
                    )}
                </div>
                <Field label="Open to" hint="None selected = every bracket.">
                    <BracketToggles brackets={data.brackets} value={s.bracketIds} onChange={(bracketIds) => setS({ ...s, bracketIds })} />
                </Field>
                {booked > 0 && (
                    <p className="text-sm text-muted">
                        {booked === 1 ? `1 scheduled ${t.match} uses` : `${booked} scheduled ${t.matches} use`} this slot. Changing it flags any that no longer fit;
                        they keep their time, though their {t.units} may be reassigned.
                    </p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                    <ConfirmButton
                        label="Delete slot"
                        confirmLabel={booked ? `Delete? ${countOf(booked, t)} will be flagged` : "Really delete?"}
                        onConfirm={onDelete}
                    />
                    <div className="flex gap-2">
                        <button className="btn-ghost" onClick={onClose}>
                            Cancel
                        </button>
                        <button className="btn-primary" disabled={loc?.units.length ? s.unitIds.length < cpm : false} onClick={() => onSave(s)}>
                            Save slot
                        </button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}
