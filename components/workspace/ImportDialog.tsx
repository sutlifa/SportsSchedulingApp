"use client";

import { useMemo, useState } from "react";
import { formatDate, formatTime, isIsoDate } from "@/lib/engine/dates";
import type { Availability, League, Location } from "@/lib/engine/types";
import { cellText, guessMapping, parseDelimited, parseWith, type Cell, type Ctx, type Layout, type Mapping } from "@/lib/import/sheet";
import { readXlsx, type Sheet } from "@/lib/import/xlsx";
import { Field, Modal, NumberInput, uid } from "./ui";

/**
 * Upload a facility's court-availability sheet.
 *
 * Facilities all send something different, so the importer guesses the
 * layout and columns (lib/import/sheet.ts), shows the guess next to the raw
 * cells, and lets the person correct any of it before anything is saved.
 *
 * Importing only replaces availability for the (location, date) pairs in the
 * file, so a facility's monthly sheets can be imported one after another.
 */
export default function ImportDialog({
    league,
    onClose,
    onImport,
}: {
    league: League;
    onClose: () => void;
    onImport: (patch: { locations: Location[]; availability: Availability[] }, summary: string) => void;
}) {
    const [sheets, setSheets] = useState<Sheet[] | null>(null);
    const [source, setSource] = useState("");
    const [sheetIdx, setSheetIdx] = useState(0);
    const [mapping, setMapping] = useState<Mapping | null>(null);
    const [paste, setPaste] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [locationId, setLocationId] = useState(league.locations[0]?.id ?? "");
    const [newLocName, setNewLocName] = useState("");
    const [defaultCourts, setDefaultCourts] = useState<number | null>(1);
    const [bracketIds, setBracketIds] = useState<string[]>([]);

    const ctx: Ctx = useMemo(
        () => ({ seasonStart: league.settings.seasonStart, seasonEnd: league.settings.seasonEnd, fallbackYear: new Date().getFullYear() }),
        [league.settings.seasonStart, league.settings.seasonEnd]
    );
    const grid: Cell[][] = useMemo(() => sheets?.[sheetIdx]?.rows ?? [], [sheets, sheetIdx]);

    const load = (s: Sheet[], name: string) => {
        const usable = s.filter((x) => x.rows.length > 0);
        if (!usable.length) {
            setError("That file has no rows to read.");
            return;
        }
        setSheets(usable);
        setSource(name);
        setSheetIdx(0);
        setMapping(guessMapping(usable[0].rows, ctx));
        setError(null);
    };

    const onFile = async (f: File) => {
        setBusy(true);
        setError(null);
        try {
            if (/\.xlsx$/i.test(f.name)) load(await readXlsx(await f.arrayBuffer()), f.name);
            else if (/\.xls$/i.test(f.name)) setError("That’s the old .xls format. In Excel, choose File → Save As → Excel Workbook (.xlsx) or CSV, then upload that.");
            else load([{ name: f.name, rows: parseDelimited(await f.text()) }], f.name);
        } catch (err) {
            setError(err instanceof Error ? err.message : "That file couldn’t be read.");
        } finally {
            setBusy(false);
        }
    };

    const parsed = useMemo(() => (mapping && grid.length ? parseWith(grid, mapping, ctx, { defaultCourts: defaultCourts ?? 1 }) : null), [grid, mapping, ctx, defaultCourts]);

    // Location handling: a Location column wins per row; otherwise the chosen location.
    const locByName = new Map(league.locations.map((l) => [l.name.trim().toLowerCase(), l]));
    const sheetLocNames = [...new Map((parsed?.rows ?? []).filter((r) => r.location).map((r) => [r.location!.trim().toLowerCase(), r.location!.trim()])).values()];
    const unknownLocs = sheetLocNames.filter((n) => !locByName.has(n.trim().toLowerCase()));
    const needsFallback = !parsed || parsed.rows.some((r) => !r.location);
    const fallbackOk = !needsFallback || locationId !== "" || newLocName.trim() !== "";

    const inSeason = (date: string) =>
        !isIsoDate(league.settings.seasonStart) || !isIsoDate(league.settings.seasonEnd) || (date >= league.settings.seasonStart && date <= league.settings.seasonEnd);
    const outside = parsed ? parsed.rows.filter((r) => !inSeason(r.date)).length : 0;
    const dates = parsed ? [...new Set(parsed.rows.map((r) => r.date))] : [];
    const cpm = Math.max(1, league.settings.courtsPerMatch || 1);

    const apply = () => {
        if (!parsed || !parsed.rows.length || !fallbackOk) return;
        const newLocations: Location[] = [];
        const nameToId = new Map([...locByName.entries()].map(([k, l]) => [k, l.id]));
        const ensure = (name: string) => {
            const k = name.trim().toLowerCase();
            let id = nameToId.get(k);
            if (!id) {
                id = uid("l");
                nameToId.set(k, id);
                newLocations.push({ id, name: name.trim(), address: "", mapUrl: "", notes: "Added from a facility availability sheet." });
            }
            return id;
        };
        const fallbackId = locationId || (newLocName.trim() ? ensure(newLocName) : "");
        // Re-importing a sheet keeps the id of every (location, date, time)
        // that already existed, so matches booked into those times stay
        // attached to them. (The engine also falls back to matching by time
        // and place, but stable ids keep the saved data honest.)
        const existing = new Map(league.availability.map((a) => [`${a.locationId}|${a.date}|${a.time}`, a.id]));
        const rows: Availability[] = parsed.rows.map((r) => {
            const loc = r.location ? ensure(r.location) : fallbackId;
            return { id: existing.get(`${loc}|${r.date}|${r.time}`) ?? uid("a"), date: r.date, time: r.time, locationId: loc, courts: r.courts, bracketIds };
        });
        const covered = new Set(rows.map((r) => `${r.locationId}|${r.date}`));
        const kept = league.availability.filter((a) => !covered.has(`${a.locationId}|${a.date}`));
        onImport(
            { locations: [...league.locations, ...newLocations], availability: [...kept, ...rows] },
            `Imported ${rows.length} time slots on ${dates.length} dates from ${source}.`
        );
    };

    const colName = (c: number) => {
        let s = "";
        let n = c + 1;
        while (n > 0) {
            s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
            n = Math.floor((n - 1) / 26);
        }
        return s;
    };
    const width = Math.max(0, ...grid.slice(0, 40).map((r) => r.length));
    const colOptions = Array.from({ length: Math.min(width, 60) }, (_, c) => ({
        c,
        label: `Column ${colName(c)}${mapping && mapping.header >= 0 && cellText(grid[mapping.header]?.[c] ?? null) ? `: ${cellText(grid[mapping.header][c]).slice(0, 30)}` : ""}`,
    }));
    const setM = (patch: Partial<Mapping>) => mapping && setMapping({ ...mapping, ...patch });
    const colSelect = (id: string, label: string, key: "date" | "time" | "courts" | "location", optional: string) => (
        <Field label={label} htmlFor={id}>
            <select id={id} className="input" value={mapping?.[key] ?? ""} onChange={(e) => setM({ [key]: e.target.value === "" ? null : Number(e.target.value) })}>
                <option value="">{optional}</option>
                {colOptions.map((o) => (
                    <option key={o.c} value={o.c}>
                        {o.label}
                    </option>
                ))}
            </select>
        </Field>
    );

    return (
        <Modal title="Upload facility availability" onClose={onClose} wide>
            {!sheets ? (
                <div className="grid gap-4">
                    <p className="text-sm text-muted">
                        Upload the spreadsheet the facility sent (.xlsx or .csv), or copy the cells in Excel or Google Sheets and paste them below. Any layout works: one row
                        per time slot, or a grid of dates and times. You’ll see what was read before anything is saved.
                    </p>
                    <label className="btn-primary w-fit cursor-pointer">
                        {busy ? "Reading…" : "Choose a file"}
                        <input type="file" className="sr-only" accept=".xlsx,.csv,.tsv,.txt,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
                    </label>
                    <Field label="Or paste cells" htmlFor="paste-cells">
                        <textarea id="paste-cells" className="input font-mono text-xs" rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"Date\t9:00 AM\t11:00 AM\nSat 3/6\t4\t4\nSun 3/7\t6\t6"} />
                    </Field>
                    <div>
                        <button className="btn-secondary" disabled={!paste.trim()} onClick={() => load([{ name: "Pasted cells", rows: parseDelimited(paste) }], "pasted cells")}>
                            Read pasted cells
                        </button>
                    </div>
                    {error && <p className="rounded-lg bg-danger-soft p-3 text-sm text-danger">{error}</p>}
                </div>
            ) : (
                mapping && (
                    <div className="grid gap-5">
                        <div className="flex flex-wrap items-end justify-between gap-3">
                            <div className="min-w-0">
                                <div className="text-sm text-muted">Reading</div>
                                <div className="truncate font-semibold">{source}</div>
                            </div>
                            <div className="flex flex-wrap items-end gap-2">
                                {sheets.length > 1 && (
                                    <Field label="Sheet" htmlFor="imp-sheet">
                                        <select
                                            id="imp-sheet"
                                            className="input"
                                            value={sheetIdx}
                                            onChange={(e) => {
                                                const i = Number(e.target.value);
                                                setSheetIdx(i);
                                                setMapping(guessMapping(sheets[i].rows, ctx));
                                            }}
                                        >
                                            {sheets.map((s, i) => (
                                                <option key={i} value={i}>
                                                    {s.name}
                                                </option>
                                            ))}
                                        </select>
                                    </Field>
                                )}
                                <button className="btn-ghost btn-sm" onClick={() => setSheets(null)}>
                                    Use a different file
                                </button>
                            </div>
                        </div>
                        {sheets.length > 1 && <p className="-mt-3 text-xs text-muted">Import each sheet in turn. Each import only replaces the dates it contains.</p>}

                        <section className="grid gap-3 rounded-lg bg-surface-2 p-3">
                            <h3 className="font-semibold">How the sheet is laid out (our best guess, change anything that’s wrong)</h3>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <Field label="Layout" htmlFor="imp-layout">
                                    <select id="imp-layout" className="input" value={mapping.layout} onChange={(e) => setM({ layout: e.target.value as Layout })}>
                                        <option value="rows">One row per time slot</option>
                                        <option value="dates-down">Grid: dates down the side, times across the top</option>
                                        <option value="times-down">Grid: times down the side, dates across the top</option>
                                    </select>
                                </Field>
                                <Field label="Heading row" htmlFor="imp-header">
                                    <select id="imp-header" className="input" value={mapping.header} onChange={(e) => setM({ header: Number(e.target.value) })}>
                                        <option value={-1}>No heading row</option>
                                        {grid.slice(0, 25).map((r, i) => (
                                            <option key={i} value={i}>
                                                Row {i + 1}: {r.filter((c) => c !== null).slice(0, 4).map(cellText).join(" · ").slice(0, 50) || "(empty)"}
                                            </option>
                                        ))}
                                    </select>
                                </Field>
                                {mapping.layout === "rows" ? (
                                    <>
                                        {colSelect("imp-date", "Date column", "date", "Choose…")}
                                        {colSelect("imp-time", "Start time column", "time", "In the date column")}
                                        {colSelect("imp-courts", "Courts column", "courts", "Not in this sheet")}
                                        {colSelect("imp-loc", "Location column", "location", "Not in this sheet")}
                                    </>
                                ) : (
                                    <Field label={mapping.layout === "dates-down" ? "Column with the dates" : "Column with the times"} htmlFor="imp-label">
                                        <select id="imp-label" className="input" value={mapping.label} onChange={(e) => setM({ label: Number(e.target.value) })}>
                                            {colOptions.map((o) => (
                                                <option key={o.c} value={o.c}>
                                                    {o.label}
                                                </option>
                                            ))}
                                        </select>
                                    </Field>
                                )}
                                {mapping.layout === "rows" && (
                                    <Field label="Each row is" htmlFor="imp-courts-mode">
                                        <select id="imp-courts-mode" className="input" value={mapping.courtsMode} onChange={(e) => setM({ courtsMode: e.target.value === "names" ? "names" : "count" })}>
                                            <option value="count">{mapping.courts === null ? "A time slot" : "A time slot with a number of courts"}</option>
                                            <option value="names">{mapping.courts === null ? "One court (rows at the same time are added up)" : "One court, by name (courts at the same time are counted)"}</option>
                                        </select>
                                    </Field>
                                )}
                                {mapping.layout === "rows" && mapping.courtsMode === "names" && (
                                    <p className="rounded-md bg-warn-soft p-2 text-sm text-warn sm:col-span-2">
                                        Reading each row as one court: rows at the same date and time are added up as separate courts. If the courts column is a number of
                                        courts, change “Each row is” above.
                                    </p>
                                )}
                                {mapping.layout === "rows" && mapping.courts === null && mapping.courtsMode === "count" && (
                                    <Field label="Courts for every slot" htmlFor="imp-default-courts" hint="The sheet has no courts column.">
                                        <NumberInput id="imp-default-courts" value={defaultCourts} min={1} max={200} onChange={setDefaultCourts} />
                                    </Field>
                                )}
                            </div>

                            <div className="overflow-x-auto rounded-md border border-border bg-surface">
                                <table className="text-xs">
                                    <thead>
                                        <tr>
                                            <th className="px-2 py-1 text-muted" />
                                            {colOptions.slice(0, 14).map((o) => {
                                                const role =
                                                    mapping.layout === "rows"
                                                        ? (["date", "time", "courts", "location"] as const).find((k) => mapping[k] === o.c)
                                                        : mapping.label === o.c
                                                          ? "labels"
                                                          : undefined;
                                                return (
                                                    <th key={o.c} className={`whitespace-nowrap px-2 py-1 text-left ${role ? "bg-accent-soft text-fg" : "text-muted"}`}>
                                                        {colName(o.c)}
                                                        {role && <span className="ml-1 font-normal">({role})</span>}
                                                    </th>
                                                );
                                            })}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {grid.slice(0, 14).map((r, i) => (
                                            <tr key={i} className={i === mapping.header ? "bg-accent-soft font-semibold" : i < mapping.header ? "text-muted" : ""}>
                                                <td className="px-2 py-1 text-muted tabular">{i + 1}</td>
                                                {colOptions.slice(0, 14).map((o) => {
                                                    const c = r[o.c] ?? null;
                                                    return (
                                                        <td key={o.c} className="max-w-[10rem] truncate whitespace-nowrap px-2 py-1">
                                                            {c !== null && typeof c === "object" ? <em className="text-muted">date/time</em> : cellText(c)}
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </section>

                        <section className="grid gap-3">
                            <div className="grid gap-3 sm:grid-cols-2">
                                <Field label={sheetLocNames.length ? "Location for rows without one" : "Location"} htmlFor="imp-location">
                                    <select id="imp-location" className="input" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                                        <option value="">{league.locations.length ? "Choose…" : "New location (name it →)"}</option>
                                        {league.locations.map((l) => (
                                            <option key={l.id} value={l.id}>
                                                {l.name}
                                            </option>
                                        ))}
                                    </select>
                                </Field>
                                {!locationId && (
                                    <Field label="New location name" htmlFor="imp-new-loc">
                                        <input id="imp-new-loc" className="input" value={newLocName} onChange={(e) => setNewLocName(e.target.value)} placeholder="Riverside Tennis Center" />
                                    </Field>
                                )}
                            </div>
                            {unknownLocs.length > 0 && <p className="text-sm text-muted">New locations will be added for: {unknownLocs.join(", ")}.</p>}
                            {league.brackets.length > 0 && (
                                <Field label="Open to" hint="Leave all off to let every bracket use these times.">
                                    <div className="flex flex-wrap gap-1">
                                        {league.brackets.map((b) => {
                                            const on = bracketIds.includes(b.id);
                                            return (
                                                <button
                                                    key={b.id}
                                                    type="button"
                                                    aria-pressed={on}
                                                    onClick={() => setBracketIds(on ? bracketIds.filter((x) => x !== b.id) : [...bracketIds, b.id])}
                                                    className={`rounded-md border px-2.5 py-1 text-sm font-semibold ${on ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface text-muted"}`}
                                                >
                                                    {b.name}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </Field>
                            )}
                        </section>

                        {parsed && (
                            <section className="grid gap-2">
                                <h3 className="font-display text-xl font-bold uppercase tracking-wide">What was read</h3>
                                {parsed.rows.length ? (
                                    <p className="text-sm">
                                        <strong>{parsed.rows.length}</strong> time slots on <strong>{dates.length}</strong> dates, {formatDate(dates[0], true)} to {formatDate(dates[dates.length - 1], true)}.
                                        {cpm > 1 && ` At ${cpm} courts per match (Season settings), 6 courts means 3 matches at once.`}
                                        {parsed.duplicates > 0 && ` ${parsed.duplicates} repeated date/time rows: the last one wins.`}
                                    </p>
                                ) : (
                                    <p className="rounded-lg bg-warn-soft p-3 text-sm text-warn">Nothing could be read with these settings. Check the layout and columns above.</p>
                                )}
                                {outside > 0 && <p className="text-sm text-warn">{outside} of these fall outside the season dates and won’t be used unless the season changes.</p>}
                                {parsed.problems.length > 0 && (
                                    <details className="text-sm">
                                        <summary className="cursor-pointer text-warn">{parsed.problems.length} rows skipped. See why</summary>
                                        <ul className="mt-1 max-h-32 overflow-y-auto pl-4 text-muted">
                                            {parsed.problems.slice(0, 100).map((p, i) => (
                                                <li key={i}>
                                                    Row {p.line}: {p.message}
                                                </li>
                                            ))}
                                        </ul>
                                    </details>
                                )}
                                {parsed.rows.length > 0 && (
                                    <div className="max-h-56 overflow-auto rounded-md border border-border">
                                        <table className="w-full text-sm">
                                            <thead className="sticky top-0 bg-surface-2 text-left">
                                                <tr>
                                                    <th className="label px-3 py-1">Date</th>
                                                    <th className="label px-3 py-1">Start</th>
                                                    <th className="label px-3 py-1">Courts</th>
                                                    <th className="label px-3 py-1">Matches at once</th>
                                                    {sheetLocNames.length > 0 && <th className="label px-3 py-1">Location</th>}
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-border">
                                                {parsed.rows.slice(0, 200).map((r) => (
                                                    <tr key={`${r.date}|${r.time}|${r.location}`} className={inSeason(r.date) ? "" : "text-muted"}>
                                                        <td className="px-3 py-1">{formatDate(r.date)}</td>
                                                        <td className="px-3 py-1 font-mono tabular">{formatTime(r.time)}</td>
                                                        <td className="px-3 py-1 tabular">{r.courts === 0 ? "Closed" : r.courts}</td>
                                                        <td className="px-3 py-1 tabular">{Math.floor(r.courts / cpm)}</td>
                                                        {sheetLocNames.length > 0 && <td className="px-3 py-1">{r.location ?? "—"}</td>}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </section>
                        )}

                        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                            <p className="text-xs text-muted">For each location and date in this file, these times replace the weekly slots and any earlier upload.</p>
                            <div className="flex gap-2">
                                <button className="btn-ghost" onClick={onClose}>
                                    Cancel
                                </button>
                                <button className="btn-primary" disabled={!parsed?.rows.length || !fallbackOk} onClick={apply}>
                                    Import {parsed?.rows.length ?? 0} time slots
                                </button>
                            </div>
                        </div>
                    </div>
                )
            )}
        </Modal>
    );
}
