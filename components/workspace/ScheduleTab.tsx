"use client";

import { useMemo, useState } from "react";
import { downloadText, copyText, fileSafe } from "@/lib/client/backup";
import { DAY_SHORT, dowOf, formatDate, formatTime, isIsoDate, isoToDay, weekKey } from "@/lib/engine/dates";
import { adviceFor } from "@/lib/engine/advice";
import { readiness, type StepId } from "@/lib/engine/readiness";
import { generate, type Verdict } from "@/lib/engine/engine";
import { mapSearchUrl } from "@/lib/engine/sanitize";
import { cap, sportText } from "@/lib/engine/sports";
import { unitNames } from "./CourtsTab";
import type { League, Location, Match } from "@/lib/engine/types";
import MoveDialog from "./MoveDialog";
import type { Tab, TabProps } from "./types";
import { BracketChip, Modal } from "./ui";

type View = "dates" | "teams" | "courts";

export function locationLink(l: Location | undefined): string | null {
    if (!l) return null;
    if (l.mapUrl) return l.mapUrl;
    return l.address || l.name ? mapSearchUrl(l.name, l.address) : null;
}

/** Where each readiness step is edited outside the wizard. */
const TAB_FOR_STEP: Record<StepId, Tab> = { basics: "season", season: "season", brackets: "brackets", facilities: "courts", time: "courts", teams: "teams", requests: "teams", review: "schedule" };

export default function ScheduleTab({ doc, change, result, lookup, goTo, t: terms, setup = false }: TabProps & { setup?: boolean }) {
    const w = (text: string) => sportText(text, terms);
    const { data, schedule } = doc;
    const [scope, setScope] = useState("all");
    const [confirming, setConfirming] = useState(false);
    const [running, setRunning] = useState(false);
    const [lastRun, setLastRun] = useState<{ placed: number; needed: number; attempts: number; seconds: number } | null>(null);
    const [view, setView] = useState<View>("dates");
    const [fBracket, setFBracket] = useState("");
    const [fTeam, setFTeam] = useState("");
    const [fLoc, setFLoc] = useState("");
    const [onlyProblems, setOnlyProblems] = useState(false);
    const [moving, setMoving] = useState<string | null>(null);
    const [flash, setFlash] = useState<string | null>(null);

    const brackets = useMemo(() => new Map(data.brackets.map((b) => [b.id, b])), [data.brackets]);
    const locations = useMemo(() => new Map(data.locations.map((l) => [l.id, l])), [data.locations]);
    const teamName = (id: string) => lookup.team(id) ?? "Deleted team";

    // --- setup checklist ---------------------------------------------------
    // The same checks the setup wizard runs (lib/engine/readiness.ts), so the
    // two can't disagree about what's missing. Only the blocking ones here:
    // the warnings are about how well it will schedule, not whether it can.
    const todo = readiness(data, doc.name)
        .filter((c) => c.level === "block")
        .map((c) => ({ text: c.text, tab: TAB_FOR_STEP[c.step] }));

    // --- generation --------------------------------------------------------
    const inScope = (m: Match) => scope === "all" || m.bracketId === scope;
    const replaceable = schedule.matches.filter((m) => !m.locked && inScope(m)).length;
    const lockedInScope = schedule.matches.filter((m) => m.locked && inScope(m)).length;

    const run = () => {
        setConfirming(false);
        setRunning(true);
        // Yield one frame so "Scheduling…" paints before the work blocks.
        setTimeout(() => {
            const t0 = performance.now();
            const r = generate(data, schedule.matches, { scope, seed: Math.floor(Math.random() * 2 ** 31), timeBudgetMs: 1500 });
            change((d) => ({ ...d, schedule: { matches: r.matches, generatedAt: new Date().toISOString(), warnings: r.warnings } }));
            setLastRun({ placed: r.placed, needed: r.needed, attempts: r.attempts, seconds: (performance.now() - t0) / 1000 });
            setRunning(false);
        }, 30);
    };

    const setMatch = (id: string, patch: Partial<Match> | null) =>
        change((d) => ({
            ...d,
            schedule: {
                ...d.schedule,
                matches: patch === null ? d.schedule.matches.filter((m) => m.id !== id) : d.schedule.matches.map((m) => (m.id === id ? { ...m, ...patch } : m)),
            },
        }));

    // --- stats -------------------------------------------------------------
    const placed = schedule.matches.filter((m) => m.date);
    const unplaced = schedule.matches.filter((m) => !m.date);
    let mustIssues = 0;
    let preferIssues = 0;
    for (const m of placed) {
        const v = result.issues.get(m.id);
        if (v?.hard.length) mustIssues++;
        else if (v?.soft.length) preferIssues++;
    }
    const short = [...result.teams.values()].filter((t) => t.placed < t.target);

    // --- filtering ---------------------------------------------------------
    const visible = schedule.matches.filter(
        (m) =>
            (!fBracket || m.bracketId === fBracket) &&
            (!fTeam || m.home === fTeam || m.away === fTeam) &&
            (!fLoc || m.locationId === fLoc) &&
            (!onlyProblems || !m.date || result.issues.has(m.id))
    );

    const startWeek = isIsoDate(data.settings.seasonStart) ? weekKey(isoToDay(data.settings.seasonStart)) : null;
    const weekNo = (date: string) => (startWeek === null ? null : Math.floor((weekKey(isoToDay(date)) - startWeek) / 7) + 1);

    // --- exports ------------------------------------------------------------
    const line = (m: Match, forTeam?: string) => {
        const l = m.locationId ? locations.get(m.locationId) : undefined;
        const units = unitNames(m.unitIds, data);
        const where = l ? `${l.name}${units ? ` (${units})` : ""}${l.address ? `, ${l.address}` : ""}` : "";
        const who = forTeam
            ? `vs ${teamName(forTeam === m.home ? m.away : m.home)} (${forTeam === m.home ? "home" : "away"})`
            : `${teamName(m.home)} vs ${teamName(m.away)}`;
        return m.date ? `${formatDate(m.date)} · ${formatTime(m.time)} · ${who}${where ? ` · ${where}` : ""}` : `Not scheduled yet · ${who}`;
    };
    const teamText = (teamId: string) => {
        const ms = schedule.matches.filter((m) => m.home === teamId || m.away === teamId);
        return [`${teamName(teamId)} · ${doc.name}`, ...ms.map((m) => line(m, teamId))].join("\n");
    };
    const notify = (msg: string) => {
        setFlash(msg);
        setTimeout(() => setFlash(null), 2500);
    };
    const csv = () => {
        // Quote every cell; prefix cells starting with = + - @ so Excel shows a
        // team called "=Bolts" as text instead of running it as a formula.
        const q = (s: string | number | null | undefined) => {
            const t = String(s ?? "");
            return `"${(/^[=+\-@]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`;
        };
        const rows = [["Date", "Day", "Start", "Bracket", "Pool", "Home", "Away", "Facility", cap(terms.unit), "Address", "Map", "Locked", "Status"]];
        for (const m of schedule.matches) {
            const l = m.locationId ? locations.get(m.locationId) : undefined;
            rows.push([
                m.date ?? "",
                m.date ? DAY_SHORT[dowOf(isoToDay(m.date))] : "",
                formatTime(m.time),
                brackets.get(m.bracketId)?.name ?? "",
                m.pool,
                teamName(m.home),
                teamName(m.away),
                l?.name ?? "",
                unitNames(m.unitIds, data),
                l?.address ?? "",
                locationLink(l) ?? "",
                m.locked ? "yes" : "",
                m.date ? "scheduled" : "not placed",
            ]);
        }
        // The BOM tells Excel the file is UTF-8, so accented names survive.
        downloadText(`${fileSafe(doc.name)}-schedule.csv`, "\uFEFF" + rows.map((r) => r.map(q).join(",")).join("\r\n"), "text/csv");
    };

    return (
        <div className="grid gap-6">
            {todo.length > 0 && !setup && (
                <section className="card p-5">
                    <h2 className="font-display text-2xl font-bold uppercase tracking-wide">Before you schedule</h2>
                    <ol className="mt-3 grid gap-2">
                        {todo.map((t) => (
                            <li key={t.text} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2">
                                <span>{t.text}</span>
                                <button className="btn-secondary btn-sm" onClick={() => goTo(t.tab)}>
                                    Go there
                                </button>
                            </li>
                        ))}
                    </ol>
                </section>
            )}

            <section className="card flex flex-wrap items-end gap-3 p-4">
                <div className="min-w-0">
                    <label className="label" htmlFor="gen-scope">
                        Schedule
                    </label>
                    <select id="gen-scope" className="input w-56" value={scope} onChange={(e) => setScope(e.target.value)}>
                        <option value="all">All brackets</option>
                        {data.brackets.map((b) => (
                            <option key={b.id} value={b.id}>
                                {b.name} only
                            </option>
                        ))}
                    </select>
                </div>
                <button className="btn-primary" disabled={running || data.teams.length < 2} onClick={() => (replaceable > 0 ? setConfirming(true) : run())}>
                    {running ? "Scheduling…" : schedule.matches.length ? "Regenerate schedule" : "Generate schedule"}
                </button>
                <div className="ml-auto flex flex-wrap gap-2">
                    <button className="btn-secondary" disabled={!schedule.matches.length} onClick={csv}>
                        Download CSV
                    </button>
                    <button
                        className="btn-secondary"
                        disabled={!schedule.matches.length}
                        onClick={async () => notify((await copyText(data.teams.map((t) => teamText(t.id)).join("\n\n"))) ? "Copied every team’s schedule" : "Copy was blocked by the browser")}
                    >
                        Copy all team schedules
                    </button>
                </div>
                {lastRun && (
                    <p className="w-full text-sm text-muted">
                        Placed {lastRun.placed} of {lastRun.needed} new {terms.matches} (best of {lastRun.attempts} tries, {lastRun.seconds.toFixed(1)}s). Locked {terms.matches} were kept as they were.
                        {lastRun.placed < lastRun.needed && (
                            <strong className="text-warn"> {lastRun.needed - lastRun.placed} couldn’t be placed: the reasons and fixes are listed below.</strong>
                        )}
                    </p>
                )}
                {flash && <p className="w-full text-sm font-semibold text-ok">{flash}</p>}
            </section>

            {schedule.matches.length > 0 && (
                <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Stat label={`${cap(terms.matches)} placed`} value={`${placed.length}`} sub={`of ${schedule.matches.length}`} />
                    <Stat label="Not placed" value={`${unplaced.length}`} tone={unplaced.length ? "warn" : "ok"} />
                    <Stat label="Break a must-rule" value={`${mustIssues}`} tone={mustIssues ? "danger" : "ok"} sub={preferIssues ? `${preferIssues} miss a preference` : undefined} />
                    <Stat label="Teams short" value={`${short.length}`} tone={short.length ? "warn" : "ok"} sub={short.length ? "fewer than guaranteed" : "everyone’s covered"} />
                </section>
            )}

            {schedule.warnings.length > 0 && (
                <section className="rounded-lg border border-warn/30 bg-warn-soft p-4 text-sm">
                    <h3 className="font-semibold">From the last run</h3>
                    <ul className="mt-1 list-disc pl-5">
                        {schedule.warnings.map((w) => (
                            <li key={w}>{w}</li>
                        ))}
                    </ul>
                </section>
            )}

            {unplaced.length > 0 && (
                <section className="grid gap-2">
                    <h3 className="font-display text-xl font-bold uppercase tracking-wide text-warn">Couldn’t place ({unplaced.length})</h3>
                    <p className="text-sm text-muted">
                        Every open time was checked for each of these. Below are the reasons that ruled out the most times, and what to change. After a fix, press
                        Regenerate. Or place a {terms.match} by hand, which locks it.
                    </p>
                    {unplaced.map((m) => (
                        <div key={m.id} className="card flex flex-wrap items-start justify-between gap-3 border-warn/40 p-3">
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <BracketChip bracket={brackets.get(m.bracketId)} />
                                    <span className="font-semibold">
                                        {teamName(m.home)} vs {teamName(m.away)}
                                    </span>
                                </div>
                                {m.blockers?.length ? (
                                    <ul className="mt-2 grid gap-2 text-sm">
                                        {m.blockers.map((b) => {
                                            const a = adviceFor(b.reason, data);
                                            return (
                                                <li key={b.reason} className="rounded-md bg-surface-2 px-3 py-2">
                                                    <div>
                                                        <strong>{b.reason}</strong>{" "}
                                                        <span className="text-muted tabular">
                                                            (ruled out {b.count} {b.count === 1 ? "time" : "times"})
                                                        </span>
                                                    </div>
                                                    <div className="mt-0.5 text-muted">
                                                        Fix: {a.tip}{" "}
                                                        {a.tab && (
                                                            <button className="font-semibold text-accent underline" onClick={() => goTo(a.tab!)}>
                                                                Go to {a.tabLabel}
                                                            </button>
                                                        )}
                                                    </div>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                ) : (
                                    m.note && <p className="mt-1 text-sm text-muted">{m.note}</p>
                                )}
                            </div>
                            <button className="btn-secondary btn-sm" onClick={() => setMoving(m.id)}>
                                Place by hand
                            </button>
                        </div>
                    ))}
                </section>
            )}

            {schedule.matches.length > 0 && (
                <section className="grid gap-3">
                    <div className="flex flex-wrap items-end gap-2">
                        <div className="flex overflow-hidden rounded-lg border border-border" role="group" aria-label="View">
                            {(
                                [
                                    ["dates", "By date"],
                                    ["teams", "By team"],
                                    ["courts", `${cap(terms.unit)} use`],
                                ] as const
                            ).map(([v, label]) => (
                                <button key={v} aria-pressed={view === v} onClick={() => setView(v)} className={`px-3 py-1.5 text-sm font-semibold ${view === v ? "bg-accent text-accent-fg" : "bg-surface text-muted hover:text-fg"}`}>
                                    {label}
                                </button>
                            ))}
                        </div>
                        <select aria-label="Filter by bracket" className="input w-auto" value={fBracket} onChange={(e) => setFBracket(e.target.value)}>
                            <option value="">All brackets</option>
                            {data.brackets.map((b) => (
                                <option key={b.id} value={b.id}>
                                    {b.name}
                                </option>
                            ))}
                        </select>
                        <select aria-label="Filter by team" className="input w-auto max-w-[14rem]" value={fTeam} onChange={(e) => setFTeam(e.target.value)}>
                            <option value="">All teams</option>
                            {[...data.teams]
                                .filter((t) => !fBracket || t.bracketId === fBracket)
                                .sort((a, b) => a.name.localeCompare(b.name))
                                .map((t) => (
                                    <option key={t.id} value={t.id}>
                                        {t.name}
                                    </option>
                                ))}
                        </select>
                        <select aria-label="Filter by location" className="input w-auto max-w-[14rem]" value={fLoc} onChange={(e) => setFLoc(e.target.value)}>
                            <option value="">All locations</option>
                            {data.locations.map((l) => (
                                <option key={l.id} value={l.id}>
                                    {l.name}
                                </option>
                            ))}
                        </select>
                        <label className="flex items-center gap-1.5 text-sm">
                            <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Only problems
                        </label>
                    </div>

                    {view === "dates" && renderDates(visible.filter((m) => m.date))}
                    {view === "teams" && renderTeams()}
                    {view === "courts" && renderCourts()}
                </section>
            )}

            {confirming && (
                <Modal title="Regenerate?" onClose={() => setConfirming(false)}>
                    <p>
                        This replaces <strong>{replaceable}</strong> unlocked {replaceable === 1 ? terms.match : terms.matches} in {scope === "all" ? "all brackets" : brackets.get(scope)?.name}.
                        {lockedInScope > 0 && ` ${lockedInScope} locked ${lockedInScope === 1 ? `${terms.match} stays` : `${terms.matches} stay`} exactly where ${lockedInScope === 1 ? "it is" : "they are"}.`}
                    </p>
                    <p className="mt-2 text-sm text-muted">{w("Moving a match by hand locks it, so hand-placed matches are never lost to a regenerate.")}</p>
                    <div className="mt-5 flex justify-end gap-2">
                        <button className="btn-ghost" onClick={() => setConfirming(false)}>
                            Cancel
                        </button>
                        <button className="btn-primary" onClick={run}>
                            Regenerate
                        </button>
                    </div>
                </Modal>
            )}

            {moving && (
                <MoveDialog
                    data={data}
                    matches={schedule.matches}
                    matchId={moving}
                    lookup={lookup}
                    onClose={() => setMoving(null)}
                    onApply={(patch) => {
                        setMatch(moving, patch);
                        setMoving(null);
                    }}
                />
            )}
        </div>
    );

    // --- views: plain render functions (not components) so they can close over
    // the tab's state without being re-created as a new component type each
    // render, which would remount them and drop focus/open <details>.

    function renderDates(matches: Match[]) {
        if (!matches.length) return <p className="text-muted">No {terms.matches} fit these filters.</p>;
        const byDate = new Map<string, Match[]>();
        for (const m of matches) {
            if (!byDate.has(m.date!)) byDate.set(m.date!, []);
            byDate.get(m.date!)!.push(m);
        }
        return (
            <div className="grid gap-4">
                {[...byDate.entries()].map(([date, ms]) => (
                    <div key={date} className="card overflow-hidden">
                        <div className="flex items-baseline justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2">
                            <h4 className="font-display text-lg font-bold uppercase tracking-wide">{formatDate(date, true)}</h4>
                            <span className="text-xs font-semibold uppercase tracking-wide text-muted tabular">
                                {weekNo(date) !== null && `Week ${weekNo(date)} · `}
                                {ms.length} {ms.length === 1 ? terms.match : terms.matches}
                            </span>
                        </div>
                        <ul className="divide-y divide-border">
                            {ms.map((m) => (
                                renderRow(m)
                            ))}
                        </ul>
                    </div>
                ))}
            </div>
        );
    }

    function renderRow(m: Match) {
        const l = m.locationId ? locations.get(m.locationId) : undefined;
        const href = locationLink(l);
        const v = result.issues.get(m.id);
        return (
            <li key={m.id} className="grid gap-2 px-4 py-2.5 sm:grid-cols-[5.5rem_minmax(0,1fr)_auto] sm:items-center">
                <span className="font-mono text-sm tabular">{formatTime(m.time)}</span>
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <BracketChip bracket={brackets.get(m.bracketId)} />
                        {m.pool && <span className="text-xs text-muted">Pool {m.pool}</span>}
                        <span className="min-w-0 font-semibold">
                            {teamName(m.home)} <span className="font-normal text-muted">vs</span> {teamName(m.away)}
                        </span>
                        {m.locked && <span className="chip bg-accent-soft text-accent">Locked</span>}
                    </div>
                    <div className="mt-0.5 truncate text-sm text-muted">
                        {href ? (
                            <a href={href} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-fg">
                                {l?.name ?? "Unknown facility"}
                            </a>
                        ) : (
                            (l?.name ?? "Unknown facility")
                        )}
                        {m.unitIds?.length ? <span className="font-semibold text-fg"> · {unitNames(m.unitIds, data)}</span> : null}
                    </div>
                    <Issues v={v} />
                    {v?.hard.length ? <FixHint reason={v.hard[0]} league={data} /> : null}
                </div>
                <div className="flex flex-wrap gap-1">
                    <button className="btn-ghost btn-sm" onClick={() => setMatch(m.id, { locked: !m.locked })} title={w(m.locked ? "Let regenerate move this match" : "Keep this match when regenerating")}>
                        {m.locked ? "Unlock" : "Lock"}
                    </button>
                    <button className="btn-secondary btn-sm" onClick={() => setMoving(m.id)}>
                        Move
                    </button>
                </div>
            </li>
        );
    }

    function renderTeams() {
        const teams = data.teams
            .filter((t) => (!fBracket || t.bracketId === fBracket) && (!fTeam || t.id === fTeam))
            .sort((a, b) => (brackets.get(a.bracketId)?.name ?? "").localeCompare(brackets.get(b.bracketId)?.name ?? "") || a.name.localeCompare(b.name));
        return (
            <div className="grid gap-3">
                {teams.map((t) => {
                    const s = result.teams.get(t.id);
                    const ms = schedule.matches.filter((m) => (m.home === t.id || m.away === t.id) && (!fLoc || m.locationId === fLoc));
                    const problems = ms.filter((m) => !m.date || result.issues.has(m.id)).length;
                    if (onlyProblems && !problems && (s?.placed ?? 0) >= (s?.target ?? 0)) return null;
                    return (
                        <details key={t.id} className="card group">
                            <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3">
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                    <BracketChip bracket={brackets.get(t.bracketId)} />
                                    <span className="font-semibold">{t.name}</span>
                                    {t.pool && <span className="text-xs text-muted">Pool {t.pool}</span>}
                                </div>
                                <div className="flex flex-wrap items-center gap-2 text-sm tabular">
                                    <span className={`chip ${s && s.placed < s.target ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok"}`}>
                                        {s?.placed ?? 0}/{s?.target ?? 0} {terms.matches}
                                    </span>
                                    <span className="chip bg-surface-2">{s?.weekendMatches ?? 0} on weekends</span>
                                    <span className="chip bg-surface-2">{s?.homeMatches ?? 0} home</span>
                                    {problems > 0 && <span className="chip bg-danger-soft text-danger">{problems} to check</span>}
                                </div>
                            </summary>
                            <div className="border-t border-border px-4 py-3">
                                <ul className="grid gap-1.5 text-sm">
                                    {ms.map((m) => (
                                        <li key={m.id} className={!m.date ? "text-warn" : ""}>
                                            {line(m, t.id)}
                                            <Issues v={result.issues.get(m.id)} />
                                        </li>
                                    ))}
                                </ul>
                                <button className="btn-secondary btn-sm mt-3" onClick={async () => notify((await copyText(teamText(t.id))) ? `Copied ${t.name}’s schedule` : "Copy was blocked by the browser")}>
                                    Copy for the {terms.captain}
                                </button>
                            </div>
                        </details>
                    );
                })}
            </div>
        );
    }

    function renderCourts() {
        const { instances } = result.ctx;
        const byDate = new Map<string, number[]>();
        for (const inst of instances) {
            if (fLoc && inst.locationId !== fLoc) continue;
            if (!byDate.has(inst.date)) byDate.set(inst.date, []);
            byDate.get(inst.date)!.push(inst.idx);
        }
        if (!byDate.size) return <p className="text-muted">No time slots in the season.</p>;
        return (
            <div className="grid gap-2">
                {[...byDate.entries()].map(([date, idxs]) => (
                    <div key={date} className="card flex flex-wrap items-center gap-2 p-3">
                        <span className="w-32 shrink-0 text-sm font-semibold">{formatDate(date)}</span>
                        {idxs.map((i) => {
                            const inst = instances[i];
                            const used = result.usage[i];
                            const full = used >= inst.capacity;
                            return (
                                <span key={i} className={`chip tabular ${used > inst.capacity ? "bg-danger-soft text-danger" : full ? "bg-accent text-accent-fg" : used ? "bg-accent-soft text-fg" : "bg-surface-2 text-muted"}`} title={locations.get(inst.locationId)?.name}>
                                    {formatTime(inst.time)} · {locations.get(inst.locationId)?.name.split(" ").slice(0, 2).join(" ")} · {used}/{inst.capacity}
                                </span>
                            );
                        })}
                    </div>
                ))}
            </div>
        );
    }
}

/** A must-rule problem on a placed match: say how to fix it, not just what's wrong. */
function FixHint({ reason, league }: { reason: string; league: League }) {
    return (
        <p className="mt-0.5 text-xs text-muted">
            Fix: press Move (it lists the times that fit every rule), or: {adviceFor(reason, league).tip}
        </p>
    );
}

function Issues({ v }: { v: Verdict | undefined }) {
    if (!v || (!v.hard.length && !v.soft.length)) return null;
    return (
        <ul className="mt-1 grid gap-0.5 text-xs">
            {v.hard.map((h) => (
                <li key={h} className="text-danger">
                    Breaks: {h}
                </li>
            ))}
            {v.soft.map((s) => (
                <li key={s} className="text-warn">
                    Misses preference: {s}
                </li>
            ))}
        </ul>
    );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "warn" | "danger" }) {
    const color = tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "text-fg";
    return (
        <div className="card p-3">
            <div className="label">{label}</div>
            <div className={`font-display text-3xl font-bold tabular ${color}`}>{value}</div>
            {sub && <div className="text-xs text-muted">{sub}</div>}
        </div>
    );
}
