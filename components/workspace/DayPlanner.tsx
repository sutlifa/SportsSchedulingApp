"use client";

import { useState } from "react";
import type { Audit } from "@/lib/engine/engine";
import { DAY_LONG, DAY_SHORT, formatTime, parseTimes, toMinutes } from "@/lib/engine/dates";
import { countOf, type Terms } from "@/lib/engine/sports";
import type { DayOfWeek, League, Location, Slot } from "@/lib/engine/types";
import { slotCapacity, unitNames } from "./CourtsTab";
import { withData, type Doc } from "./types";
import { ConfirmButton, Modal, uid } from "./ui";

/*
 * The weekly day planner: one facility's week as a Mon -> Sun board, so an
 * organiser can see (and fill) each day on its own -- "Saturday has 12 spots,
 * Tuesday has none" -- instead of reading a flat list of slots. It edits the
 * same `League.slots` the quick-add form and the List view do; there is no
 * planner-only state to save, so the three can never disagree.
 */

/** Monday first, the way a league calendar reads (DaysPicker uses the same order). */
const WEEK: DayOfWeek[] = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAYS: DayOfWeek[] = [1, 2, 3, 4, 5];
const WEEKEND: DayOfWeek[] = [6, 0];
const isWeekendDay = (d: DayOfWeek) => d === 0 || d === 6;

const spotWord = (n: number, t: Terms) => `${n} ${t.match} spot${n === 1 ? "" : "s"}`;

/** Sum of games-at-once over some slots: one week's worth of game spots. */
function spotsOf(slots: Slot[], league: League): number {
    return slots.reduce((n, s) => n + slotCapacity(s, league), 0);
}

/** "Sheet A, Sheet B" when the slot names its units, else "2 games at once". */
function slotWhere(s: Slot, league: League, t: Terms): string {
    return unitNames(s.unitIds, league) || `${countOf(slotCapacity(s, league), t)} at once`;
}

function bracketNames(s: Slot, league: League): string[] {
    return s.bracketIds.map((id) => league.brackets.find((b) => b.id === id)?.name).filter((x): x is string => Boolean(x));
}

type Props = {
    doc: Doc;
    change: (fn: (d: Doc) => Doc) => void;
    t: Terms;
    /** The facility on the board. Shared with the quick-add form so what it adds lands on the board in view. */
    locId: string;
    onEditSlot: (s: Slot) => void;
    /** Games at once for a facility with no named units: the quick-add form's number, so both agree. */
    fallbackAtOnce: number;
};

type Note = { locId: string; day: DayOfWeek; text: string; warn?: boolean };

export default function DayPlanner({ doc, change, t, locId, onEditSlot, fallbackAtOnce }: Props) {
    const data = doc.data;
    const loc = data.locations.find((l) => l.id === locId);
    // Which day's "Add times" box is open. Keyed by facility too, so
    // switching facility doesn't leave a box open on a day you didn't pick.
    const [adding, setAdding] = useState<{ locId: string; day: DayOfWeek } | null>(null);
    const [addText, setAddText] = useState("");
    const [note, setNote] = useState<Note | null>(null);
    const [copyFrom, setCopyFrom] = useState<DayOfWeek | null>(null);
    if (!loc) return null;

    const cpm = Math.max(1, data.settings.courtsPerMatch || 1);
    const atLoc = data.slots.filter((s) => s.locationId === loc.id);
    const dayOf = (day: DayOfWeek) => atLoc.filter((s) => s.day === day).sort((a, b) => toMinutes(a.time) - toMinutes(b.time));
    // New times get every unit at the facility: the common case is "the whole
    // rink is ours at 9", and un-ticking one later is a single click in the
    // slot's dialog. A facility without named units uses the quick-add's
    // number instead, as it would there.
    const newUnits = loc.units.map((u) => u.id);
    const newAtOnce = loc.units.length ? Math.floor(newUnits.length / cpm) : fallbackAtOnce;
    const parsed = parseTimes(addText);

    const addTimes = (day: DayOfWeek) => {
        if (!parsed.length) return;
        if (newAtOnce < 1) {
            setNote({ locId: loc.id, day, warn: true, text: `Each ${t.match} uses ${cpm} ${t.units}, but ${loc.name} has ${loc.units.length}.` });
            return;
        }
        const have = new Set(dayOf(day).map((s) => s.time));
        const fresh = parsed.filter((x) => !have.has(x));
        const dup = parsed.filter((x) => have.has(x));
        // Slots are built here, not inside the updater: `change` may run its
        // updater twice (React strict mode), and uid() would mint new ids.
        const add: Slot[] = fresh.map((time) => ({ id: uid("s"), day, time, locationId: loc.id, capacity: newAtOnce, unitIds: newUnits, bracketIds: [] }));
        if (add.length) change((d) => withData(d, { slots: [...d.data.slots, ...add] }));
        const skipped = dup.length ? `${dup.map(formatTime).join(", ")} ${dup.length === 1 ? "is" : "are"} already on ${DAY_LONG[day]}, so skipped.` : "";
        setNote({
            locId: loc.id,
            day,
            warn: !add.length,
            text: add.length ? `Added ${add.length} time${add.length === 1 ? "" : "s"}.${skipped ? ` ${skipped}` : ""}` : `Nothing added: ${skipped}`,
        });
        if (add.length) {
            setAdding(null);
            setAddText("");
        }
    };

    const copyDay = (from: DayOfWeek, to: DayOfWeek[], replace: boolean) => {
        const src = dayOf(from);
        const targets = new Set(to.filter((d) => d !== from));
        const removeIds = new Set(replace ? atLoc.filter((s) => targets.has(s.day)).map((s) => s.id) : []);
        const add: Slot[] = [];
        let skipped = 0;
        for (const day of WEEK.filter((d) => targets.has(d))) {
            const have = new Set(replace ? [] : dayOf(day).map((s) => s.time));
            for (const s of src) {
                if (have.has(s.time)) skipped++;
                // Same units, at-once number and "Open to": a copy of the day,
                // not a fresh default, so a 12U-only 5pm stays 12U-only.
                else add.push({ ...s, id: uid("s"), day, unitIds: [...s.unitIds], bracketIds: [...s.bracketIds] });
            }
        }
        // Removing a slot leaves games booked into it where they are (with a
        // flag), exactly as Delete slot in the slot's dialog does: the
        // organiser decides whether to move them or regenerate.
        change((d) => withData(d, { slots: [...d.data.slots.filter((s) => !removeIds.has(s.id)), ...add] }));
        const names = WEEK.filter((d) => targets.has(d)).map((d) => DAY_SHORT[d]).join(", ");
        setNote({ locId: loc.id, day: from, text: `Copied to ${names}.${skipped ? ` Skipped ${skipped} time${skipped === 1 ? "" : "s"} already there.` : ""}` });
        setCopyFrom(null);
    };

    const clearDay = (day: DayOfWeek) => {
        const ids = new Set(dayOf(day).map((s) => s.id));
        change((d) => withData(d, { slots: d.data.slots.filter((s) => !ids.has(s.id)) }));
        setNote({ locId: loc.id, day, text: `Cleared ${DAY_LONG[day]}.` });
    };

    const renderSlot = (s: Slot) => {
        const where = slotWhere(s, data, t);
        const open = bracketNames(s, data);
        return (
            <li key={s.id} className="min-w-0">
                <button
                    type="button"
                    onClick={() => onEditSlot(s)}
                    aria-label={`${DAY_LONG[s.day]} ${formatTime(s.time)}, ${where}${open.length ? `, open to ${open.join(", ")}` : ""}`}
                    className="block w-full min-w-0 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-left hover:border-accent"
                >
                    <span className="block font-mono text-sm font-semibold tabular">{formatTime(s.time)}</span>
                    <span className="block break-words text-xs text-muted">{where}</span>
                    {open.length > 0 && (
                        <span className="mt-1 flex flex-wrap gap-1">
                            {s.bracketIds.map((id) => {
                                const b = data.brackets.find((x) => x.id === id);
                                return b ? (
                                    <span key={id} className="chip border border-border bg-surface px-1.5 text-[0.7rem] text-fg">
                                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: b.color }} aria-hidden />
                                        {b.name}
                                    </span>
                                ) : null;
                            })}
                        </span>
                    )}
                </button>
            </li>
        );
    };

    const renderDay = (day: DayOfWeek) => {
        const list = dayOf(day);
        const spots = spotsOf(list, data);
        const isAdding = adding?.locId === loc.id && adding.day === day;
        const dayNote = note?.locId === loc.id && note.day === day ? note : null;
        const inputId = `add-times-${day}`;
        return (
            <section key={day} aria-label={DAY_LONG[day]} className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-surface p-2.5">
                <div className="min-w-0">
                    <h3 className="font-display text-lg font-bold uppercase tracking-wide">{DAY_LONG[day]}</h3>
                    <p className={`text-xs tabular ${spots ? "font-semibold text-fg" : "text-muted"}`}>{spotWord(spots, t)}</p>
                </div>
                {list.length > 0 && <ul className="grid gap-1.5">{list.map(renderSlot)}</ul>}
                {isAdding && (
                    <form
                        className="grid gap-1.5"
                        onSubmit={(e) => {
                            e.preventDefault();
                            addTimes(day);
                        }}
                    >
                        <label className="label mb-0" htmlFor={inputId}>
                            Start times
                        </label>
                        <input
                            id={inputId}
                            className="input"
                            value={addText}
                            placeholder="9, 11, 1pm"
                            // Opened on purpose by "Add times", so typing can start straight away.
                            autoFocus
                            onChange={(e) => setAddText(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Escape") setAdding(null);
                            }}
                        />
                        <p className="text-xs text-muted">{parsed.length ? `Reads as: ${parsed.map(formatTime).join(", ")}` : "e.g. 9, 10:30, 1pm"}</p>
                        <div className="flex flex-wrap gap-1">
                            <button type="submit" className="btn-primary btn-sm" disabled={!parsed.length}>
                                Add
                            </button>
                            <button type="button" className="btn-ghost btn-sm" onClick={() => setAdding(null)}>
                                Cancel
                            </button>
                        </div>
                    </form>
                )}
                {dayNote && (
                    <p className={`text-xs ${dayNote.warn ? "text-warn" : "text-ok"}`} role="status">
                        {dayNote.text}
                    </p>
                )}
                <div className="mt-auto flex flex-wrap gap-1">
                    {!isAdding && (
                        <button
                            type="button"
                            className="btn-ghost btn-sm px-1.5 text-accent"
                            onClick={() => {
                                setAdding({ locId: loc.id, day });
                                setAddText("");
                                setNote(null);
                            }}
                        >
                            <span aria-hidden>+ </span>Add times
                        </button>
                    )}
                    {list.length > 0 && (
                        <>
                            <button type="button" className="btn-ghost btn-sm px-1.5" onClick={() => setCopyFrom(day)}>
                                Copy to…
                            </button>
                            <ConfirmButton className="btn-ghost btn-sm px-1.5 hover:text-danger" label="Clear" confirmLabel={`Clear ${list.length}?`} onConfirm={() => clearDay(day)} />
                        </>
                    )}
                </div>
            </section>
        );
    };

    const groupSpots = (days: DayOfWeek[]) => spotsOf(atLoc.filter((s) => days.includes(s.day)), data);

    return (
        <div className="grid gap-3">
            <div className="grid gap-3 lg:grid-cols-7">
                <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-surface-2 p-2 lg:col-span-5">
                    <p className="label mb-0 flex flex-wrap justify-between gap-2 px-1">
                        <span>Weekdays</span>
                        <span className="tabular">{spotWord(groupSpots(WEEKDAYS), t)}</span>
                    </p>
                    <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">{WEEKDAYS.map(renderDay)}</div>
                </div>
                <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-accent/30 bg-accent-soft p-2 lg:col-span-2">
                    <p className="label mb-0 flex flex-wrap justify-between gap-2 px-1 text-accent">
                        <span>Weekend</span>
                        <span className="tabular">{spotWord(groupSpots(WEEKEND), t)}</span>
                    </p>
                    <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">{WEEKEND.map(renderDay)}</div>
                </div>
            </div>
            <p className="text-xs text-muted">
                Press a time to change its {t.units}, its day or who it’s open to. New times get all of {loc.name}’s {t.units}
                {loc.units.length ? "" : ` (${countOf(newAtOnce, t)} at once)`} and are open to every bracket.
            </p>
            {copyFrom !== null && (
                <CopyDialog
                    from={copyFrom}
                    loc={loc}
                    slots={dayOf(copyFrom)}
                    atLoc={atLoc}
                    booked={(ids) => doc.schedule.matches.filter((m) => m.slotId && ids.has(m.slotId)).length}
                    t={t}
                    onClose={() => setCopyFrom(null)}
                    onCopy={(to, replace) => copyDay(copyFrom, to, replace)}
                />
            )}
        </div>
    );
}

/** One facility pill per facility, with its weekly game spots. */
export function FacilityPills({ league, t, locId, onPick }: { league: League; t: Terms; locId: string; onPick: (id: string) => void }) {
    return (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Facility on the board">
            {league.locations.map((l) => {
                const on = l.id === locId;
                const n = spotsOf(
                    league.slots.filter((s) => s.locationId === l.id),
                    league,
                );
                return (
                    <button
                        key={l.id}
                        type="button"
                        aria-pressed={on}
                        // Named after the facility alone; the count is read as its description.
                        aria-label={l.name}
                        aria-describedby={`pill-spots-${l.id}`}
                        onClick={() => onPick(l.id)}
                        className={`inline-flex max-w-full min-w-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold ${
                            on ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface text-fg hover:bg-surface-2"
                        }`}
                    >
                        <span className="truncate">{l.name}</span>
                        <span id={`pill-spots-${l.id}`} className={`shrink-0 rounded-full px-2 text-xs tabular ${on ? "bg-surface/20" : "bg-surface-2 text-muted"}`}>
                            {spotWord(n, t)} a week
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

/**
 * Weekday / weekend / week / season spots, for one facility and for all.
 * The season number comes from the derived instances (`result.ctx`), which
 * already drop blackouts and swap in uploaded facility sheets, so it is the
 * real count rather than "per week x weeks".
 */
export function SpotTotals({ league, result, t, location, needed }: { league: League; result: Audit; t: Terms; location?: Location; needed: number }) {
    const scopes: { key: string; name: string; slots: Slot[]; season: number }[] = [];
    if (location)
        scopes.push({
            key: location.id,
            name: location.name,
            slots: league.slots.filter((s) => s.locationId === location.id),
            season: result.ctx.instances.filter((i) => i.locationId === location.id).reduce((n, i) => n + i.capacity, 0),
        });
    const seasonAll = result.ctx.instances.reduce((n, i) => n + i.capacity, 0);
    scopes.push({ key: "all", name: "All facilities", slots: league.slots, season: seasonAll });
    const tone = !needed ? "none" : seasonAll < needed ? "short" : seasonAll < needed * 1.5 ? "tight" : "ok";
    return (
        <div className="grid gap-2">
            <div className={`grid gap-2 ${scopes.length > 1 ? "md:grid-cols-2" : ""}`}>
                {scopes.map((sc) => {
                    const weekday = spotsOf(
                        sc.slots.filter((s) => !isWeekendDay(s.day)),
                        league,
                    );
                    const weekend = spotsOf(
                        sc.slots.filter((s) => isWeekendDay(s.day)),
                        league,
                    );
                    return (
                        <div key={sc.key} className="card min-w-0 p-3" aria-label={`${sc.name} totals`} role="group">
                            <p className="label mb-0 truncate">{sc.name}</p>
                            <p className="font-semibold tabular">
                                {spotWord(weekday + weekend, t)} a week
                            </p>
                            <dl className="mt-1 grid grid-cols-3 gap-2 text-sm">
                                <div className="min-w-0">
                                    <dt className="text-xs text-muted">Weekdays</dt>
                                    <dd className="font-semibold tabular">{weekday}</dd>
                                </div>
                                <div className="min-w-0">
                                    <dt className="text-xs text-muted">Weekend</dt>
                                    <dd className="font-semibold tabular">{weekend}</dd>
                                </div>
                                <div className="min-w-0">
                                    <dt className="text-xs text-muted">Season</dt>
                                    <dd className="font-semibold tabular">{sc.season}</dd>
                                </div>
                            </dl>
                        </div>
                    );
                })}
            </div>
            <p className="text-sm tabular">
                {tone === "none" ? (
                    <span className="text-muted">No teams yet, so no {t.matches} needed yet. Add teams to compare.</span>
                ) : (
                    <>
                        {countOf(needed, t)} needed, {spotWord(seasonAll, t)} across the season:{" "}
                        {tone === "short" ? (
                            <strong className="text-danger">not enough {t.time} for every {t.match}.</strong>
                        ) : tone === "tight" ? (
                            <strong className="text-warn">enough, but tight. Some requests may not be met.</strong>
                        ) : (
                            <strong className="text-ok">plenty of room.</strong>
                        )}
                    </>
                )}
            </p>
            <p className="text-xs text-muted">
                Season totals skip blackout dates. On dates a facility spreadsheet covers, that facility uses the spreadsheet’s times instead of these weekly
                ones (see Facility availability below).
            </p>
        </div>
    );
}

function CopyDialog({
    from,
    loc,
    slots,
    atLoc,
    booked,
    t,
    onClose,
    onCopy,
}: {
    from: DayOfWeek;
    loc: Location;
    slots: Slot[];
    atLoc: Slot[];
    booked: (ids: Set<string>) => number;
    t: Terms;
    onClose: () => void;
    onCopy: (to: DayOfWeek[], replace: boolean) => void;
}) {
    const [to, setTo] = useState<DayOfWeek[]>([]);
    const [replace, setReplace] = useState(false);
    const others = WEEK.filter((d) => d !== from);
    const pick = (days: DayOfWeek[]) => setTo(days.filter((d) => d !== from));
    const replacing = replace ? atLoc.filter((s) => to.includes(s.day)) : [];
    const bookedThere = booked(new Set(replacing.map((s) => s.id)));
    return (
        <Modal title={`Copy ${DAY_LONG[from]}`} onClose={onClose}>
            <div className="grid gap-4">
                <p className="text-sm">
                    Copies {DAY_LONG[from]}’s {slots.length} time{slots.length === 1 ? "" : "s"} at {loc.name} ({slots.map((s) => formatTime(s.time)).join(", ")}), with
                    their {t.units} and “Open to”, to:
                </p>
                <div className="grid gap-2">
                    <div className="flex flex-wrap gap-1" role="group" aria-label="Copy to these days">
                        {WEEK.map((d) => {
                            const on = to.includes(d);
                            return (
                                <button
                                    key={d}
                                    type="button"
                                    aria-pressed={on}
                                    disabled={d === from}
                                    onClick={() => setTo(on ? to.filter((x) => x !== d) : [...to, d])}
                                    className={`rounded-md border px-2.5 py-1 text-sm font-semibold disabled:opacity-40 ${
                                        on ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface text-muted hover:text-fg"
                                    }`}
                                >
                                    {DAY_SHORT[d]}
                                </button>
                            );
                        })}
                    </div>
                    <div className="flex flex-wrap gap-1 text-sm">
                        <span className="text-muted">Quick picks:</span>
                        <button type="button" className="btn-ghost btn-sm" onClick={() => pick(WEEKDAYS)}>
                            Weekdays
                        </button>
                        <button type="button" className="btn-ghost btn-sm" onClick={() => pick(WEEKEND)}>
                            Weekend
                        </button>
                        <button type="button" className="btn-ghost btn-sm" onClick={() => pick(others)}>
                            Every day
                        </button>
                    </div>
                </div>
                <fieldset className="grid gap-1.5">
                    <legend className="label">Their own times</legend>
                    <label className="flex items-center gap-2 text-sm">
                        <input type="radio" name="copy-mode" checked={!replace} onChange={() => setReplace(false)} />
                        Add to their times <span className="text-muted">(a time they already have is skipped)</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                        <input type="radio" name="copy-mode" checked={replace} onChange={() => setReplace(true)} />
                        Replace their times
                    </label>
                </fieldset>
                {replace && replacing.length > 0 && (
                    <p className="text-sm text-warn">
                        This removes {replacing.length} time{replacing.length === 1 ? "" : "s"} at {loc.name}.
                        {bookedThere > 0 &&
                            ` ${bookedThere === 1 ? `1 scheduled ${t.match} uses` : `${bookedThere} scheduled ${t.matches} use`} them; they keep their time and are flagged until you move them or regenerate.`}
                    </p>
                )}
                <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
                    <button type="button" className="btn-ghost" onClick={onClose}>
                        Cancel
                    </button>
                    <button type="button" className="btn-primary" disabled={!to.length} onClick={() => onCopy(to, replace)}>
                        {to.length ? `Copy to ${to.length} day${to.length === 1 ? "" : "s"}` : "Copy"}
                    </button>
                </div>
            </div>
        </Modal>
    );
}
