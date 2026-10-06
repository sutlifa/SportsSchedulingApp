"use client";

import { useState } from "react";
import { DAY_SHORT, formatTime } from "@/lib/engine/dates";
import { teamTarget } from "@/lib/engine/engine";
import { describeRule } from "@/lib/engine/rules";
import type { Bracket } from "@/lib/engine/types";
import RuleEditor from "./RuleEditor";
import { withData, type TabProps } from "./types";
import { BRACKET_COLORS, ConfirmButton, DaysPicker, Field, Modal, NumberInput, uid } from "./ui";

export default function BracketsTab({ doc, change, lookup, goTo }: TabProps) {
    const { data } = doc;
    const [editing, setEditing] = useState<Bracket | null>(null);

    const newBracket = (): Bracket => ({
        id: "",
        name: "",
        matches: 5,
        earliest: "",
        latest: "",
        days: [],
        color: BRACKET_COLORS[data.brackets.length % BRACKET_COLORS.length],
        rules: [],
    });

    const save = (b: Bracket) =>
        change((d) => {
            const exists = d.data.brackets.some((x) => x.id === b.id);
            const bracket = exists ? b : { ...b, id: uid("b") };
            return withData(d, { brackets: exists ? d.data.brackets.map((x) => (x.id === b.id ? bracket : x)) : [...d.data.brackets, bracket] });
        });

    return (
        <div className="grid gap-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="font-display text-2xl font-bold uppercase tracking-wide">Brackets &amp; pools</h2>
                    <p className="text-sm text-muted">
                        Each team plays its guaranteed matches against teams in its own bracket and pool. Teams don’t have to play every week.
                    </p>
                </div>
                <button className="btn-primary" onClick={() => setEditing(newBracket())}>
                    Add bracket
                </button>
            </div>

            {data.brackets.length === 0 && (
                <div className="card p-6 text-muted">
                    No brackets yet. Add one per age group, for example <strong className="text-fg">10U</strong> with a 5:30 PM latest start, and{" "}
                    <strong className="text-fg">18U</strong> with no limit.
                </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
                {data.brackets.map((b) => {
                    const teams = data.teams.filter((t) => t.bracketId === b.id);
                    const pools = new Map<string, typeof teams>();
                    for (const t of teams) {
                        const k = t.pool.trim();
                        if (!pools.has(k)) pools.set(k, []);
                        pools.get(k)!.push(t);
                    }
                    return (
                        <div key={b.id} className="card p-4" style={{ borderTopColor: b.color, borderTopWidth: 4 }}>
                            <div className="flex items-start justify-between gap-2">
                                <div>
                                    <h3 className="font-display text-2xl font-bold uppercase">{b.name}</h3>
                                    <p className="text-sm text-muted">
                                        {b.matches} guaranteed matches per team ·{" "}
                                        {b.earliest || b.latest ? `starts ${b.earliest ? `from ${formatTime(b.earliest)}` : ""}${b.earliest && b.latest ? " " : ""}${b.latest ? `until ${formatTime(b.latest)}` : ""}` : "any start time"}
                                        {b.days.length ? ` · ${b.days.map((d) => DAY_SHORT[d]).join(", ")} only` : ""}
                                    </p>
                                </div>
                                <button className="btn-secondary btn-sm" onClick={() => setEditing(b)}>
                                    Edit
                                </button>
                            </div>
                            {b.rules.length > 0 && (
                                <ul className="mt-2 flex flex-wrap gap-1">
                                    {b.rules.map((r) => (
                                        <li key={r.id} className="chip bg-accent-soft text-fg">
                                            {describeRule(r, lookup)}
                                        </li>
                                    ))}
                                </ul>
                            )}
                            <div className="mt-3 grid gap-1.5 text-sm">
                                {teams.length === 0 && (
                                    <p className="text-muted">
                                        No teams yet.{" "}
                                        <button className="font-semibold text-accent underline" onClick={() => goTo("teams")}>
                                            Add teams
                                        </button>
                                    </p>
                                )}
                                {[...pools.entries()]
                                    .sort(([x], [y]) => x.localeCompare(y))
                                    .map(([pool, pt]) => {
                                        const total = pt.reduce((s, t) => s + teamTarget(t, b), 0);
                                        const maxOpp = pt.length - 1;
                                        const note =
                                            pt.length < 2
                                                ? { tone: "text-danger", text: "Only one team: nobody to play" }
                                                : total % 2 === 1
                                                  ? { tone: "text-warn", text: "Odd total: one team will be a match short" }
                                                  : b.matches > maxOpp
                                                    ? { tone: "text-muted", text: `Some opponents will be played twice (only ${maxOpp} to choose from)` }
                                                    : null;
                                        return (
                                            <div key={pool} className="flex flex-wrap items-baseline justify-between gap-2 rounded-md bg-surface-2 px-3 py-1.5">
                                                <span>
                                                    <strong>{pool ? `Pool ${pool}` : pools.size > 1 ? "No pool" : "One pool"}</strong> · {pt.length} teams
                                                </span>
                                                {note && <span className={`text-xs ${note.tone}`}>{note.text}</span>}
                                            </div>
                                        );
                                    })}
                            </div>
                        </div>
                    );
                })}
            </div>

            {editing && (
                <BracketDialog
                    key={editing.id || "new"}
                    bracket={editing}
                    props={{ doc, change, lookup, goTo } as TabProps}
                    onClose={() => setEditing(null)}
                    onSave={(b) => {
                        save(b);
                        setEditing(null);
                    }}
                    onDelete={() => {
                        change((d) => withData(d, { brackets: d.data.brackets.filter((x) => x.id !== editing.id), slots: d.data.slots.map((s) => ({ ...s, bracketIds: s.bracketIds.filter((x) => x !== editing.id) })) }));
                        setEditing(null);
                    }}
                />
            )}
        </div>
    );
}

function BracketDialog({ bracket, props, onClose, onSave, onDelete }: { bracket: Bracket; props: TabProps; onClose: () => void; onSave: (b: Bracket) => void; onDelete: () => void }) {
    const { data } = props.doc;
    const [b, setB] = useState<Bracket>(bracket);
    const teamCount = data.teams.filter((t) => t.bracketId === bracket.id).length;
    return (
        <Modal title={bracket.id ? `Edit ${bracket.name}` : "New bracket"} onClose={onClose} wide>
            <div className="grid gap-4">
                <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Name" htmlFor="br-name">
                        <input id="br-name" className="input" value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} placeholder="12U" />
                    </Field>
                    <Field label="Guaranteed matches per team" htmlFor="br-matches" hint="Each team can override this.">
                        <NumberInput id="br-matches" value={b.matches} onChange={(v) => setB({ ...b, matches: v ?? 0 })} />
                    </Field>
                    <Field label="Earliest start" htmlFor="br-earliest" hint="Blank = no limit.">
                        <input id="br-earliest" type="time" step={900} className="input" value={b.earliest} onChange={(e) => setB({ ...b, earliest: e.target.value })} />
                    </Field>
                    <Field label="Latest start" htmlFor="br-latest" hint="Keeps younger teams from playing too late.">
                        <input id="br-latest" type="time" step={900} className="input" value={b.latest} onChange={(e) => setB({ ...b, latest: e.target.value })} />
                    </Field>
                </div>
                <Field label="Plays on" hint="None selected = any day with a time slot.">
                    <DaysPicker value={b.days} onChange={(days) => setB({ ...b, days })} />
                </Field>
                <Field label="Color">
                    <div className="flex flex-wrap gap-2">
                        {BRACKET_COLORS.map((c) => (
                            <button key={c} type="button" aria-label={`Color ${c}`} aria-pressed={b.color === c} onClick={() => setB({ ...b, color: c })} className={`h-7 w-7 rounded-full border-2 ${b.color === c ? "border-fg" : "border-transparent"}`} style={{ background: c }} />
                        ))}
                    </div>
                </Field>
                <div>
                    <h3 className="label">Rules for every team in this bracket</h3>
                    <RuleEditor rules={b.rules} onChange={(rules) => setB({ ...b, rules })} teams={data.teams} locations={data.locations} lookup={props.lookup} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                    {bracket.id ? (
                        teamCount ? (
                            <span className="text-sm text-muted">Move or delete its {teamCount} teams to delete this bracket.</span>
                        ) : (
                            <ConfirmButton label="Delete bracket" confirmLabel="Really delete?" onConfirm={onDelete} />
                        )
                    ) : (
                        <span />
                    )}
                    <div className="flex gap-2">
                        <button className="btn-ghost" onClick={onClose}>
                            Cancel
                        </button>
                        <button className="btn-primary" disabled={!b.name.trim()} onClick={() => onSave({ ...b, name: b.name.trim() })}>
                            Save bracket
                        </button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}
