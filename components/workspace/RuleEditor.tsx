"use client";

import { useState } from "react";
import { DAY_LONG } from "@/lib/engine/dates";
import { describeRule, newRule, RULE_DEFS, RULE_ORDER, type NameLookup } from "@/lib/engine/rules";
import { sportText, termsFor } from "@/lib/engine/sports";
import type { DayOfWeek, Location, Rule, RuleType, Team } from "@/lib/engine/types";
import { DaysPicker, NumberInput, RangesInput, uid } from "./ui";

/**
 * Edits a list of rules for a team or a whole bracket.
 *
 * Every rule shows its own sentence ("At most 1 match per weekend") above
 * its fields, so what was entered reads back the way the captain said it.
 * That same sentence is what the scheduler quotes when it can't place a
 * match, which is how a rule in here gets connected to a problem there.
 */
export default function RuleEditor({
    rules,
    onChange,
    teams,
    locations,
    selfId,
    lookup,
}: {
    rules: Rule[];
    onChange: (r: Rule[]) => void;
    teams: Team[];
    locations: Location[];
    selfId?: string;
    lookup: NameLookup;
}) {
    const [adding, setAdding] = useState<RuleType | "">("");
    const terms = lookup.terms ?? termsFor(undefined);
    const w = (text: string) => sportText(text, terms);
    const set = (i: number, patch: Partial<Rule>) => onChange(rules.map((r, j) => (j === i ? ({ ...r, ...patch } as Rule) : r)));

    return (
        <div className="grid gap-3">
            {rules.length === 0 && <p className="text-sm text-muted">No rules yet.</p>}
            {rules.map((rule, i) => {
                const def = RULE_DEFS[rule.type];
                return (
                    <div key={rule.id} className="rounded-lg border border-border bg-surface-2/50 p-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                                <div className="text-xs font-semibold uppercase tracking-wide text-muted">{w(def.label)}</div>
                                <div className="font-semibold">{describeRule(rule, lookup)}</div>
                            </div>
                            <div className="flex items-center gap-1">
                                {!def.noteOnly && (
                                    <div className="flex overflow-hidden rounded-md border border-border text-xs font-semibold" role="group" aria-label="How strict">
                                        {(["must", "prefer"] as const).map((m) => (
                                            <button
                                                key={m}
                                                type="button"
                                                aria-pressed={rule.mode === m}
                                                onClick={() => set(i, { mode: m })}
                                                className={`px-2 py-1 ${rule.mode === m ? (m === "must" ? "bg-accent text-accent-fg" : "bg-warn-soft text-warn") : "bg-surface text-muted"}`}
                                                title={w(m === "must" ? "Never broken. The match stays unplaced instead." : "Avoided, but broken if that’s the only way to fit the match.")}
                                            >
                                                {m === "must" ? "Must" : "Prefer"}
                                            </button>
                                        ))}
                                    </div>
                                )}
                                <button type="button" className="btn-ghost btn-sm" onClick={() => onChange(rules.filter((_, j) => j !== i))} aria-label="Remove rule">
                                    Remove
                                </button>
                            </div>
                        </div>
                        <div className="mt-2 grid gap-2">
                            {def.fields.map((f) => {
                                const fid = `rule-${rule.id}-${f.key}`;
                                const v = (rule as Record<string, unknown>)[f.key];
                                switch (f.kind) {
                                    case "count":
                                        return (
                                            <label key={f.key} className="flex items-center gap-2 text-sm" htmlFor={fid}>
                                                <span className="text-muted">{w(f.label)}</span>
                                                <NumberInput id={fid} value={v as number} onChange={(x) => set(i, { [f.key]: x ?? 0 } as Partial<Rule>)} className="input w-20" />
                                            </label>
                                        );
                                    case "day":
                                        return (
                                            <label key={f.key} className="flex items-center gap-2 text-sm" htmlFor={fid}>
                                                <span className="text-muted">{w(f.label)}</span>
                                                <select id={fid} className="input w-40" value={v as number} onChange={(e) => set(i, { [f.key]: Number(e.target.value) as DayOfWeek } as Partial<Rule>)}>
                                                    {DAY_LONG.map((d, k) => (
                                                        <option key={d} value={k}>
                                                            {d}
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>
                                        );
                                    case "days":
                                        return <DaysPicker key={f.key} id={fid} value={v as DayOfWeek[]} onChange={(d) => set(i, { [f.key]: d } as Partial<Rule>)} />;
                                    case "ranges":
                                        return <RangesInput key={f.key} idPrefix={fid} value={v as never} onChange={(r) => set(i, { [f.key]: r } as Partial<Rule>)} />;
                                    case "time":
                                        return (
                                            <label key={f.key} className="flex items-center gap-2 text-sm" htmlFor={fid}>
                                                <span className="text-muted">{w(f.label)}</span>
                                                <input id={fid} type="time" step={900} className="input w-36" value={v as string} onChange={(e) => e.target.value && set(i, { [f.key]: e.target.value } as Partial<Rule>)} />
                                            </label>
                                        );
                                    case "locations":
                                        return (
                                            <div key={f.key} className="flex flex-wrap gap-1.5">
                                                {locations.length === 0 && <span className="text-sm text-muted">Add facilities on the Facilities &amp; {terms.time} tab first.</span>}
                                                {locations.map((l) => {
                                                    const ids = v as string[];
                                                    const on = ids.includes(l.id);
                                                    return (
                                                        <button
                                                            key={l.id}
                                                            type="button"
                                                            aria-pressed={on}
                                                            onClick={() => set(i, { [f.key]: on ? ids.filter((x) => x !== l.id) : [...ids, l.id] } as Partial<Rule>)}
                                                            className={`rounded-md border px-2.5 py-1 text-sm ${on ? "border-accent bg-accent-soft font-semibold text-fg" : "border-border bg-surface text-muted"}`}
                                                        >
                                                            {l.name}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        );
                                    case "teams": {
                                        const ids = v as string[];
                                        const others = teams.filter((t) => t.id !== selfId && !ids.includes(t.id)).sort((a, b) => a.name.localeCompare(b.name));
                                        return (
                                            <div key={f.key} className="grid gap-1.5">
                                                <div className="flex flex-wrap gap-1.5">
                                                    {ids.map((tid) => (
                                                        <span key={tid} className="chip bg-surface text-fg">
                                                            {lookup.team(tid) ?? "Deleted team"}
                                                            <button type="button" aria-label="Remove team" className="text-muted hover:text-danger" onClick={() => set(i, { [f.key]: ids.filter((x) => x !== tid) } as Partial<Rule>)}>
                                                                ✕
                                                            </button>
                                                        </span>
                                                    ))}
                                                </div>
                                                <select
                                                    id={fid}
                                                    className="input"
                                                    value=""
                                                    onChange={(e) => e.target.value && set(i, { [f.key]: [...ids, e.target.value] } as Partial<Rule>)}
                                                >
                                                    <option value="">Add a team…</option>
                                                    {others.map((t) => (
                                                        <option key={t.id} value={t.id}>
                                                            {t.name}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        );
                                    }
                                    case "text":
                                        return (
                                            <textarea
                                                key={f.key}
                                                id={fid}
                                                className="input"
                                                rows={2}
                                                value={v as string}
                                                placeholder={w("e.g. Prefers home matches on Saturday mornings")}
                                                onChange={(e) => set(i, { [f.key]: e.target.value } as Partial<Rule>)}
                                            />
                                        );
                                }
                            })}
                        </div>
                    </div>
                );
            })}
            <div className="flex flex-wrap items-center gap-2">
                <select aria-label="Rule to add" className="input max-w-sm" value={adding} onChange={(e) => setAdding(e.target.value as RuleType)}>
                    <option value="">Add a rule…</option>
                    {RULE_ORDER.map((t) => (
                        <option key={t} value={t}>
                            {w(RULE_DEFS[t].label)}
                        </option>
                    ))}
                </select>
                <button
                    type="button"
                    className="btn-secondary"
                    disabled={!adding}
                    onClick={() => {
                        if (!adding) return;
                        onChange([...rules, newRule(adding, uid("r"))]);
                        setAdding("");
                    }}
                >
                    Add rule
                </button>
                {adding && RULE_DEFS[adding].hint && <span className="text-xs text-muted">{w(RULE_DEFS[adding].hint)}</span>}
            </div>
        </div>
    );
}
