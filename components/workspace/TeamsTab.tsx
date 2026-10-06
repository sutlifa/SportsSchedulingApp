"use client";

import { useState } from "react";
import { formatTime } from "@/lib/engine/dates";
import { describeRule } from "@/lib/engine/rules";
import type { Team } from "@/lib/engine/types";
import RuleEditor from "./RuleEditor";
import { withData, type TabProps } from "./types";
import { BracketChip, ConfirmButton, Field, Modal, NumberInput, uid } from "./ui";

const blankTeam = (bracketId: string): Team => ({ id: "", name: "", bracketId, pool: "", club: "", captain: "", contact: "", matches: null, rules: [], notes: "" });

export default function TeamsTab({ doc, change, lookup, goTo, result }: TabProps) {
    const { data } = doc;
    const [draft, setDraft] = useState<Team>(() => blankTeam(data.brackets[0]?.id ?? ""));
    const [bulk, setBulk] = useState(false);
    const [bulkText, setBulkText] = useState("");
    const [bulkBracket, setBulkBracket] = useState(data.brackets[0]?.id ?? "");
    const [editing, setEditing] = useState<Team | null>(null);
    const [search, setSearch] = useState("");
    const [added, setAdded] = useState<string | null>(null);

    if (!data.brackets.length) {
        return (
            <div className="card p-6">
                <p>Teams belong to an age bracket, so add your brackets first (10U, 12U…).</p>
                <button className="btn-primary mt-4" onClick={() => goTo("brackets")}>
                    Add brackets
                </button>
            </div>
        );
    }

    const pools = (bracketId: string) => [...new Set(data.teams.filter((t) => t.bracketId === bracketId && t.pool.trim()).map((t) => t.pool.trim()))].sort();
    const clubs = [...new Set(data.teams.map((t) => t.club.trim()).filter(Boolean))].sort();
    const bracketOf = (id: string) => data.brackets.find((b) => b.id === id);

    const saveTeam = (t: Team) =>
        change((d) => withData(d, { teams: d.data.teams.some((x) => x.id === t.id) ? d.data.teams.map((x) => (x.id === t.id ? t : x)) : [...d.data.teams, t] }));

    const addOne = (e: React.FormEvent) => {
        e.preventDefault();
        if (!draft.name.trim() || !draft.bracketId) return;
        const t = { ...draft, id: uid("t"), name: draft.name.trim(), pool: draft.pool.trim(), club: draft.club.trim() };
        saveTeam(t);
        setAdded(t.id);
        setDraft({ ...blankTeam(draft.bracketId), pool: draft.pool, club: "" });
    };

    const addBulk = () => {
        // One team per line: "Name, Pool, Club" -- pool and club optional.
        const rows = bulkText
            .split("\n")
            .map((l) => l.split(/\t|,/).map((s) => s.trim()))
            .filter((r) => r[0]);
        if (!rows.length) return;
        const teams = rows.map(([name, pool = "", club = ""]) => ({ ...blankTeam(bulkBracket), id: uid("t"), name: name.slice(0, 120), pool, club }));
        change((d) => withData(d, { teams: [...d.data.teams, ...teams] }));
        setBulkText("");
        setBulk(false);
    };

    const removeTeam = (id: string) =>
        change((d) => ({
            ...d,
            data: {
                ...d.data,
                // Also drop the team from other teams' "not with" rules.
                teams: d.data.teams
                    .filter((t) => t.id !== id)
                    .map((t) => ({ ...t, rules: t.rules.map((r) => ("teamIds" in r ? { ...r, teamIds: r.teamIds.filter((x) => x !== id) } : r)) })),
            },
            schedule: { ...d.schedule, matches: d.schedule.matches.filter((m) => m.home !== id && m.away !== id) },
        }));

    const q = search.trim().toLowerCase();
    const shown = data.teams.filter((t) => !q || `${t.name} ${t.club} ${t.captain} ${t.pool}`.toLowerCase().includes(q));
    const addedTeam = added ? data.teams.find((t) => t.id === added) : null;

    return (
        <div className="grid gap-6">
            <section className="card p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-display text-2xl font-bold uppercase tracking-wide">Add a team</h2>
                    <button className="btn-ghost btn-sm" onClick={() => setBulk((b) => !b)}>
                        {bulk ? "Add one at a time" : "Paste a list instead"}
                    </button>
                </div>
                {!bulk ? (
                    <form onSubmit={addOne} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1.3fr_auto_auto] lg:items-end">
                        <Field label="Team name" htmlFor="new-team-name">
                            <input id="new-team-name" className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Riverside Aces 12U" />
                        </Field>
                        <Field label="Age bracket" htmlFor="new-team-bracket">
                            <select id="new-team-bracket" className="input" value={draft.bracketId} onChange={(e) => setDraft({ ...draft, bracketId: e.target.value })}>
                                {data.brackets.map((b) => (
                                    <option key={b.id} value={b.id}>
                                        {b.name}
                                    </option>
                                ))}
                            </select>
                        </Field>
                        <Field label="Pool" htmlFor="new-team-pool">
                            <input id="new-team-pool" className="input" list="pool-options" value={draft.pool} onChange={(e) => setDraft({ ...draft, pool: e.target.value })} placeholder="Optional" />
                            <datalist id="pool-options">
                                {pools(draft.bracketId).map((p) => (
                                    <option key={p} value={p} />
                                ))}
                            </datalist>
                        </Field>
                        <Field label="Club" htmlFor="new-team-club">
                            <input id="new-team-club" className="input" list="club-options" value={draft.club} onChange={(e) => setDraft({ ...draft, club: e.target.value })} placeholder="Optional" />
                            <datalist id="club-options">
                                {clubs.map((c) => (
                                    <option key={c} value={c} />
                                ))}
                            </datalist>
                        </Field>
                        <Field label="Matches" htmlFor="new-team-matches">
                            <NumberInput id="new-team-matches" value={draft.matches} onChange={(v) => setDraft({ ...draft, matches: v })} placeholder={String(bracketOf(draft.bracketId)?.matches ?? "")} className="input w-20" />
                        </Field>
                        <button className="btn-primary" disabled={!draft.name.trim()}>
                            Add team
                        </button>
                    </form>
                ) : (
                    <div className="mt-3 grid gap-3">
                        <Field label="Bracket for all of these" htmlFor="bulk-bracket">
                            <select id="bulk-bracket" className="input max-w-xs" value={bulkBracket} onChange={(e) => setBulkBracket(e.target.value)}>
                                {data.brackets.map((b) => (
                                    <option key={b.id} value={b.id}>
                                        {b.name}
                                    </option>
                                ))}
                            </select>
                        </Field>
                        <Field label="One team per line" htmlFor="bulk-text" hint="Name, then optionally pool and club, separated by commas or tabs (so you can paste straight from a spreadsheet).">
                            <textarea id="bulk-text" className="input font-mono" rows={6} value={bulkText} onChange={(e) => setBulkText(e.target.value)} placeholder={"Riverside Aces 12U, A, Riverside\nLakeview Smash 12U, A, Lakeview\nOakwood Volley 12U, B"} />
                        </Field>
                        <div>
                            <button className="btn-primary" onClick={addBulk} disabled={!bulkText.trim()}>
                                Add {bulkText.split("\n").filter((l) => l.trim()).length || ""} teams
                            </button>
                        </div>
                    </div>
                )}
                {addedTeam && !bulk && (
                    <p className="mt-3 text-sm">
                        Added <strong>{addedTeam.name}</strong>.{" "}
                        <button className="font-semibold text-accent underline" onClick={() => setEditing(addedTeam)}>
                            Add their scheduling requests
                        </button>
                    </p>
                )}
            </section>

            <section className="grid gap-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-display text-2xl font-bold uppercase tracking-wide">
                        Teams <span className="text-muted tabular">({data.teams.length})</span>
                    </h2>
                    <input aria-label="Search teams" className="input max-w-xs" placeholder="Search name, club, captain" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                {data.brackets.map((b) => {
                    const bt = shown.filter((t) => t.bracketId === b.id);
                    if (!bt.length) return null;
                    const groups = new Map<string, Team[]>();
                    for (const t of bt) {
                        const k = t.pool.trim();
                        if (!groups.has(k)) groups.set(k, []);
                        groups.get(k)!.push(t);
                    }
                    return (
                        <div key={b.id} className="card overflow-hidden">
                            <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-4 py-2">
                                <BracketChip bracket={b} />
                                <span className="text-sm text-muted">
                                    {b.matches} matches each{b.latest ? `, no starts after ${formatTime(b.latest)}` : ""}
                                </span>
                            </div>
                            {[...groups.entries()]
                                .sort(([x], [y]) => x.localeCompare(y))
                                .map(([pool, teams]) => (
                                    <div key={pool}>
                                        {(groups.size > 1 || pool) && <div className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-muted">{pool ? `Pool ${pool}` : "No pool"} · {teams.length} teams</div>}
                                        <ul className="divide-y divide-border">
                                            {teams
                                                .sort((x, y) => x.name.localeCompare(y.name))
                                                .map((t) => {
                                                    const s = result.teams.get(t.id);
                                                    return (
                                                        <li key={t.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                                                            <div className="min-w-0 flex-1">
                                                                <div className="flex flex-wrap items-baseline gap-x-2">
                                                                    <span className="font-semibold">{t.name}</span>
                                                                    {t.club && <span className="text-sm text-muted">{t.club}</span>}
                                                                    {t.captain && <span className="text-sm text-muted">· Captain {t.captain}</span>}
                                                                </div>
                                                                {t.rules.length > 0 && (
                                                                    <ul className="mt-1 flex flex-wrap gap-1">
                                                                        {t.rules.map((r) => (
                                                                            <li key={r.id} className={`chip ${r.type === "note" ? "bg-surface-2 text-muted" : r.mode === "must" ? "bg-accent-soft text-fg" : "bg-warn-soft text-warn"}`}>
                                                                                {r.type !== "note" && r.mode === "prefer" ? "Prefers: " : ""}
                                                                                {describeRule(r, lookup)}
                                                                            </li>
                                                                        ))}
                                                                    </ul>
                                                                )}
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-sm text-muted tabular" title="Scheduled / guaranteed">
                                                                    {s ? `${s.placed}/${s.target}` : ""}
                                                                </span>
                                                                <button className="btn-secondary btn-sm" onClick={() => setEditing(t)}>
                                                                    Edit
                                                                </button>
                                                            </div>
                                                        </li>
                                                    );
                                                })}
                                        </ul>
                                    </div>
                                ))}
                        </div>
                    );
                })}
                {data.teams.length > 0 && !shown.length && <p className="text-muted">No teams match “{search}”.</p>}
                {data.teams.some((t) => !bracketOf(t.bracketId)) && (
                    <p className="rounded-lg bg-warn-soft p-3 text-sm text-warn">Some teams’ bracket was deleted. Edit them to choose a new one: {data.teams.filter((t) => !bracketOf(t.bracketId)).map((t) => t.name).join(", ")}.</p>
                )}
            </section>

            {editing && (
                <TeamDialog
                    key={editing.id}
                    team={editing}
                    props={{ doc, change, lookup, goTo, result } as TabProps}
                    pools={pools}
                    clubs={clubs}
                    onClose={() => setEditing(null)}
                    onSave={(t) => {
                        saveTeam(t);
                        setEditing(null);
                    }}
                    onDelete={() => {
                        removeTeam(editing.id);
                        setEditing(null);
                    }}
                />
            )}
        </div>
    );
}

function TeamDialog({
    team,
    props,
    pools,
    clubs,
    onClose,
    onSave,
    onDelete,
}: {
    team: Team;
    props: TabProps;
    pools: (bracketId: string) => string[];
    clubs: string[];
    onClose: () => void;
    onSave: (t: Team) => void;
    onDelete: () => void;
}) {
    const { data } = props.doc;
    const [t, setT] = useState<Team>(team);
    const matchCount = props.doc.schedule.matches.filter((m) => m.home === team.id || m.away === team.id).length;
    const bracket = data.brackets.find((b) => b.id === t.bracketId);
    return (
        <Modal title="Edit team" onClose={onClose} wide>
            <div className="grid gap-4">
                <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Team name" htmlFor="team-name">
                        <input id="team-name" className="input" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} />
                    </Field>
                    <Field label="Age bracket" htmlFor="team-bracket">
                        <select id="team-bracket" className="input" value={t.bracketId} onChange={(e) => setT({ ...t, bracketId: e.target.value })}>
                            {!bracket && <option value="">Choose a bracket</option>}
                            {data.brackets.map((b) => (
                                <option key={b.id} value={b.id}>
                                    {b.name}
                                </option>
                            ))}
                        </select>
                    </Field>
                    <Field label="Pool" htmlFor="team-pool" hint="Teams only play others in the same bracket and pool.">
                        <input id="team-pool" className="input" list="team-pool-options" value={t.pool} onChange={(e) => setT({ ...t, pool: e.target.value })} />
                        <datalist id="team-pool-options">
                            {pools(t.bracketId).map((p) => (
                                <option key={p} value={p} />
                            ))}
                        </datalist>
                    </Field>
                    <Field label="Club" htmlFor="team-club" hint="Used to avoid stacking one club’s teams at the same time.">
                        <input id="team-club" className="input" list="team-club-options" value={t.club} onChange={(e) => setT({ ...t, club: e.target.value })} />
                        <datalist id="team-club-options">
                            {clubs.map((c) => (
                                <option key={c} value={c} />
                            ))}
                        </datalist>
                    </Field>
                    <Field label="Captain" htmlFor="team-captain">
                        <input id="team-captain" className="input" value={t.captain} onChange={(e) => setT({ ...t, captain: e.target.value })} />
                    </Field>
                    <Field label="Captain contact" htmlFor="team-contact">
                        <input id="team-contact" className="input" value={t.contact} onChange={(e) => setT({ ...t, contact: e.target.value })} placeholder="Phone or email" />
                    </Field>
                    <Field label="Guaranteed matches" htmlFor="team-matches" hint={`Leave blank to use the bracket’s ${bracket?.matches ?? "default"}.`}>
                        <NumberInput id="team-matches" value={t.matches} onChange={(v) => setT({ ...t, matches: v })} placeholder={String(bracket?.matches ?? "")} />
                    </Field>
                </div>
                <div>
                    <h3 className="label">Scheduling rules & captain requests</h3>
                    {bracket && bracket.rules.length > 0 && (
                        <p className="mb-2 text-xs text-muted">Also applies from {bracket.name}: {bracket.rules.map((r) => describeRule(r, props.lookup)).join("; ")}.</p>
                    )}
                    <RuleEditor rules={t.rules} onChange={(rules) => setT({ ...t, rules })} teams={data.teams} locations={data.locations} selfId={t.id} lookup={props.lookup} />
                </div>
                <Field label="Notes" htmlFor="team-notes">
                    <textarea id="team-notes" className="input" rows={2} value={t.notes} onChange={(e) => setT({ ...t, notes: e.target.value })} />
                </Field>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                    <ConfirmButton label="Delete team" confirmLabel={`Delete team${matchCount ? ` and its ${matchCount} matches` : ""}?`} onConfirm={onDelete} />
                    <div className="flex gap-2">
                        <button className="btn-ghost" onClick={onClose}>
                            Cancel
                        </button>
                        <button className="btn-primary" disabled={!t.name.trim() || !t.bracketId} onClick={() => onSave({ ...t, name: t.name.trim(), pool: t.pool.trim(), club: t.club.trim() })}>
                            Save team
                        </button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}
