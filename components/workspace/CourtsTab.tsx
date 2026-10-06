"use client";

import { useState } from "react";
import { DAY_LONG, formatDate, formatTime, parseTimes, toMinutes } from "@/lib/engine/dates";
import { mapSearchUrl, safeMapUrl } from "@/lib/engine/sanitize";
import type { DayOfWeek, Location, Rule, Slot } from "@/lib/engine/types";
import ImportDialog from "./ImportDialog";
import { locationLink } from "./ScheduleTab";
import { withData, type TabProps } from "./types";
import { ConfirmButton, DaysPicker, Field, Modal, NumberInput, uid } from "./ui";

export default function CourtsTab({ doc, change, result }: TabProps) {
    const { data } = doc;
    const [editingLoc, setEditingLoc] = useState<Location | null>(null);
    const [editingSlot, setEditingSlot] = useState<Slot | null>(null);
    const [importing, setImporting] = useState(false);
    const [imported, setImported] = useState<string | null>(null);
    const [showAvail, setShowAvail] = useState<string | null>(null);

    // Quick-add form for weekly slots.
    const [qDays, setQDays] = useState<DayOfWeek[]>([6]);
    const [qTimes, setQTimes] = useState("9:00, 11:00, 1pm, 3pm");
    const [qLoc, setQLoc] = useState("");
    const [qCap, setQCap] = useState<number | null>(2);
    const [qBrackets, setQBrackets] = useState<string[]>([]);
    const times = parseTimes(qTimes);
    const locId = qLoc || data.locations[0]?.id || "";

    const addSlots = () => {
        if (!locId || !times.length || !qDays.length || !qCap) return;
        const add: Slot[] = [];
        for (const day of qDays)
            for (const time of times) add.push({ id: uid("s"), day, time, locationId: locId, capacity: qCap, bracketIds: qBrackets });
        change((d) => withData(d, { slots: [...d.data.slots, ...add] }));
    };

    const order = (d: DayOfWeek) => (d + 6) % 7; // Monday first
    const slots = [...data.slots].sort((a, b) => order(a.day) - order(b.day) || toMinutes(a.time) - toMinutes(b.time));
    const weeklySpots = data.slots.reduce((s, x) => s + x.capacity, 0);
    const seasonSpots = result.ctx.instances.reduce((s, i) => s + i.capacity, 0);
    const needed = Math.round(data.teams.reduce((s, t) => s + (t.matches ?? data.brackets.find((b) => b.id === t.bracketId)?.matches ?? 0), 0) / 2);

    return (
        <div className="grid gap-8">
            <section className="grid gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2 className="font-display text-2xl font-bold uppercase tracking-wide">Locations</h2>
                        <p className="text-sm text-muted">Facilities where matches are played. One is fine if everything happens in one place.</p>
                    </div>
                    <button className="btn-primary" onClick={() => setEditingLoc({ id: "", name: "", address: "", mapUrl: "", notes: "" })}>
                        Add location
                    </button>
                </div>
                {data.locations.length === 0 && <div className="card p-5 text-muted">No locations yet.</div>}
                <div className="grid gap-3 md:grid-cols-2">
                    {data.locations.map((l) => {
                        const href = locationLink(l);
                        const n = data.slots.filter((s) => s.locationId === l.id).length;
                        return (
                            <div key={l.id} className="card flex items-start justify-between gap-3 p-4">
                                <div className="min-w-0">
                                    <div className="font-semibold">{l.name}</div>
                                    {l.address && <div className="text-sm text-muted">{l.address}</div>}
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

            <section className="grid gap-3">
                <div>
                    <h2 className="font-display text-2xl font-bold uppercase tracking-wide">Weekly time slots</h2>
                    <p className="text-sm text-muted">
                        A start time that repeats every week, with how many matches can be on at once. Restrict a slot to certain brackets to give age groups different schedules.
                    </p>
                </div>

                {data.locations.length > 0 ? (
                    <div className="card grid gap-3 p-4">
                        <h3 className="font-semibold">Add time slots</h3>
                        <div className="grid gap-3 lg:grid-cols-[auto_minmax(0,1fr)]">
                            <Field label="Days">
                                <DaysPicker value={qDays} onChange={setQDays} />
                            </Field>
                            <Field label="Start times" htmlFor="q-times" hint={times.length ? `Reads as: ${times.map(formatTime).join(", ")}` : "e.g. 9, 10:30, 1pm, 17:45"}>
                                <input id="q-times" className="input" value={qTimes} onChange={(e) => setQTimes(e.target.value)} />
                            </Field>
                        </div>
                        <div className="flex flex-wrap items-end gap-3">
                            <Field label="Location" htmlFor="q-loc">
                                <select id="q-loc" className="input" value={locId} onChange={(e) => setQLoc(e.target.value)}>
                                    {data.locations.map((l) => (
                                        <option key={l.id} value={l.id}>
                                            {l.name}
                                        </option>
                                    ))}
                                </select>
                            </Field>
                            <Field label="Matches at once" htmlFor="q-cap">
                                <NumberInput id="q-cap" value={qCap} min={1} max={100} onChange={setQCap} className="input w-24" />
                            </Field>
                            {data.brackets.length > 0 && (
                                <Field label="Open to" hint="None selected = every bracket.">
                                    <BracketToggles brackets={data.brackets} value={qBrackets} onChange={setQBrackets} />
                                </Field>
                            )}
                            <button className="btn-primary" onClick={addSlots} disabled={!times.length || !qDays.length || !qCap}>
                                Add {qDays.length * times.length} slot{qDays.length * times.length === 1 ? "" : "s"}
                            </button>
                        </div>
                    </div>
                ) : (
                    <p className="text-sm text-muted">Add a location first.</p>
                )}

                {slots.length > 0 && (
                    <>
                        <p className="text-sm text-muted tabular">
                            {weeklySpots} match spots a week · {seasonSpots} across the season (after blackouts and facility uploads) · {needed} matches needed.
                            {seasonSpots > 0 && needed > seasonSpots && <strong className="text-danger"> Not enough court time for every match.</strong>}
                        </p>
                        <div className="card overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-border bg-surface-2 text-left">
                                        <th className="label px-4 py-2">Day</th>
                                        <th className="label px-4 py-2">Start</th>
                                        <th className="label px-4 py-2">Location</th>
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
                                            <td className="px-4 py-2">{data.locations.find((l) => l.id === s.locationId)?.name ?? <span className="text-danger">Deleted location</span>}</td>
                                            <td className="px-4 py-2 tabular">{s.capacity}</td>
                                            <td className="px-4 py-2">{s.bracketIds.length ? s.bracketIds.map((id) => data.brackets.find((b) => b.id === id)?.name).filter(Boolean).join(", ") : "All"}</td>
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
                    </>
                )}
            </section>

            <section className="grid gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                        <h2 className="font-display text-2xl font-bold uppercase tracking-wide">Facility availability</h2>
                        <p className="max-w-3xl text-sm text-muted">
                            Upload the spreadsheet a facility sends with its dates, times and courts. For every date it covers, it replaces that location’s weekly slots;
                            other dates keep the weekly pattern. A time marked closed or 0 courts blocks it.
                        </p>
                    </div>
                    <button className="btn-primary" onClick={() => setImporting(true)}>
                        Upload a facility sheet
                    </button>
                </div>
                {imported && <p className="text-sm font-semibold text-ok">{imported}</p>}
                {data.availability.length === 0 && <div className="card p-5 text-sm text-muted">No facility sheets uploaded. The weekly time slots above are used for every date.</div>}
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
                        const courts = rows.reduce((n, a) => n + a.courts, 0);
                        const open = showAvail === l.id;
                        return (
                            <div key={l.id} className="card p-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="font-semibold">{l.name}</div>
                                        <div className="text-sm text-muted tabular">
                                            {rows.length} time slots on {ds.length} dates, {formatDate(ds[0])} to {formatDate(ds[ds.length - 1])} · {courts} court-slots in total
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
                                                        {formatTime(a.time)} · {a.courts ? `${a.courts} courts` : "closed"}
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

            {importing && (
                <ImportDialog
                    league={data}
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
                    slotCount={data.slots.filter((s) => s.locationId === editingLoc.id).length + data.availability.filter((a) => a.locationId === editingLoc.id).length}
                    matchCount={doc.schedule.matches.filter((m) => m.date && m.locationId === editingLoc.id).length}
                    onClose={() => setEditingLoc(null)}
                    onSave={(l) => {
                        change((d) => {
                            const exists = d.data.locations.some((x) => x.id === l.id);
                            return withData(d, { locations: exists ? d.data.locations.map((x) => (x.id === l.id ? l : x)) : [...d.data.locations, { ...l, id: uid("l") }] });
                        });
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
                            // Matches booked there go back to "not placed" (with a
                            // reason) instead of pointing at a facility that's gone.
                            schedule: {
                                ...d.schedule,
                                matches: d.schedule.matches.map((m) =>
                                    m.locationId === id ? { ...m, date: null, time: null, locationId: null, slotId: null, locked: false, note: "Its location was deleted." } : m
                                ),
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
                    props={{ doc, change, result } as TabProps}
                    onClose={() => setEditingSlot(null)}
                    onSave={(s) => {
                        change((d) => withData(d, { slots: d.data.slots.map((x) => (x.id === s.id ? s : x)) }));
                        setEditingSlot(null);
                    }}
                    onDelete={() => {
                        change((d) => withData(d, { slots: d.data.slots.filter((x) => x.id !== editingSlot.id) }));
                        setEditingSlot(null);
                    }}
                />
            )}
        </div>
    );
}

function BracketToggles({ brackets, value, onChange }: { brackets: { id: string; name: string }[]; value: string[]; onChange: (v: string[]) => void }) {
    return (
        <div className="flex flex-wrap gap-1">
            {brackets.map((b) => {
                const on = value.includes(b.id);
                return (
                    <button key={b.id} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== b.id) : [...value, b.id])} className={`rounded-md border px-2.5 py-1 text-sm font-semibold ${on ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface text-muted"}`}>
                        {b.name}
                    </button>
                );
            })}
        </div>
    );
}

function LocationDialog({ loc, slotCount, matchCount, onClose, onSave, onDelete }: { loc: Location; slotCount: number; matchCount: number; onClose: () => void; onSave: (l: Location) => void; onDelete: () => void }) {
    const [l, setL] = useState<Location>(loc);
    const pinOk = !l.mapUrl.trim() || safeMapUrl(l.mapUrl) !== "";
    return (
        <Modal title={loc.id ? "Edit location" : "New location"} onClose={onClose}>
            <div className="grid gap-4">
                <Field label="Facility name" htmlFor="loc-name">
                    <input id="loc-name" className="input" value={l.name} onChange={(e) => setL({ ...l, name: e.target.value })} placeholder="Riverside Tennis Center" />
                </Field>
                <Field label="Address" htmlFor="loc-address" hint="Shown on exported schedules so families can find it.">
                    <input id="loc-address" className="input" value={l.address} onChange={(e) => setL({ ...l, address: e.target.value })} placeholder="123 Main St, Springfield" />
                </Field>
                <div className="rounded-lg bg-surface-2 p-3 text-sm">
                    <p className="font-semibold">Map pin</p>
                    <ol className="mt-1 list-decimal pl-5 text-muted">
                        <li>
                            <a className="font-semibold text-accent underline" href={mapSearchUrl(l.name, l.address)} target="_blank" rel="noreferrer">
                                Search Google Maps for “{[l.name, l.address].filter(Boolean).join(", ") || "this location"}”
                            </a>
                        </li>
                        <li>Find the right pin, press Share, then Copy link.</li>
                        <li>Paste it below. Without one, schedules link to the search instead.</li>
                    </ol>
                    <input id="loc-map" className="input mt-2" value={l.mapUrl} onChange={(e) => setL({ ...l, mapUrl: e.target.value })} placeholder="https://maps.app.goo.gl/…" aria-label="Google Maps link" />
                    {!pinOk && <p className="mt-1 text-xs text-danger">That isn’t a Google Maps link. It should start with https://maps.app.goo.gl/ or https://www.google.com/maps/.</p>}
                </div>
                <Field label="Notes" htmlFor="loc-notes">
                    <textarea id="loc-notes" className="input" rows={2} value={l.notes} onChange={(e) => setL({ ...l, notes: e.target.value })} placeholder="Parking, which courts, gate code…" />
                </Field>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                    {loc.id ? <ConfirmButton label="Delete location" confirmLabel={
                                slotCount || matchCount
                                    ? `Delete it${slotCount ? `, its ${slotCount} time slots` : ""}${matchCount ? ` and unschedule ${matchCount} matches` : ""}?`
                                    : "Really delete?"
                            } onConfirm={onDelete} /> : <span />}
                    <div className="flex gap-2">
                        <button className="btn-ghost" onClick={onClose}>
                            Cancel
                        </button>
                        <button className="btn-primary" disabled={!l.name.trim() || !pinOk} onClick={() => onSave({ ...l, name: l.name.trim(), address: l.address.trim(), mapUrl: safeMapUrl(l.mapUrl) })}>
                            Save location
                        </button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}

function SlotDialog({ slot, props, onClose, onSave, onDelete }: { slot: Slot; props: TabProps; onClose: () => void; onSave: (s: Slot) => void; onDelete: () => void }) {
    const { data } = props.doc;
    const [s, setS] = useState<Slot>(slot);
    const booked = props.doc.schedule.matches.filter((m) => m.slotId === slot.id).length;
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
                    <Field label="Location" htmlFor="slot-loc">
                        <select id="slot-loc" className="input" value={s.locationId} onChange={(e) => setS({ ...s, locationId: e.target.value })}>
                            {data.locations.map((l) => (
                                <option key={l.id} value={l.id}>
                                    {l.name}
                                </option>
                            ))}
                        </select>
                    </Field>
                    <Field label="Matches at once" htmlFor="slot-cap">
                        <NumberInput id="slot-cap" value={s.capacity} min={1} max={100} onChange={(v) => setS({ ...s, capacity: v ?? 1 })} />
                    </Field>
                </div>
                <Field label="Open to" hint="None selected = every bracket.">
                    <BracketToggles brackets={data.brackets} value={s.bracketIds} onChange={(bracketIds) => setS({ ...s, bracketIds })} />
                </Field>
                {booked > 0 && <p className="text-sm text-muted">{booked} scheduled matches use this slot. Changing it flags any that no longer fit; they aren’t moved automatically.</p>}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                    <ConfirmButton label="Delete slot" confirmLabel="Really delete?" onConfirm={onDelete} />
                    <div className="flex gap-2">
                        <button className="btn-ghost" onClick={onClose}>
                            Cancel
                        </button>
                        <button className="btn-primary" onClick={() => onSave(s)}>
                            Save slot
                        </button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}
