"use client";

import { useEffect, useRef, useState } from "react";
import { DAY_SHORT, formatRange, isIsoDate } from "@/lib/engine/dates";
import type { Bracket, DateRange, DayOfWeek } from "@/lib/engine/types";

let n = 0;
/** Short, URL- and path-safe id. */
export function uid(prefix: string): string {
    n = (n + 1) % 1296;
    return `${prefix}${Date.now().toString(36)}${n.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export const BRACKET_COLORS = ["#2f7fb8", "#c2571a", "#3e8e5a", "#8a4fb0", "#b8326b", "#6b7a1f", "#1f8a8a", "#7a5a2f"];

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const prev = document.activeElement as HTMLElement | null;
        ref.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", onKey);
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", onKey);
            document.body.style.overflow = "";
            prev?.focus?.();
        };
    }, [onClose]);
    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:p-8" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
            <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`card w-full ${wide ? "max-w-3xl" : "max-w-xl"} shadow-xl`}>
                <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
                    <h2 className="font-display text-2xl font-bold uppercase tracking-wide">{title}</h2>
                    <button className="btn-ghost btn-sm" onClick={onClose} aria-label="Close">
                        ✕
                    </button>
                </div>
                <div className="p-5">{children}</div>
            </div>
        </div>
    );
}

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: string; children: React.ReactNode }) {
    return (
        <div className="min-w-0">
            <label className="label" htmlFor={htmlFor}>
                {label}
            </label>
            {children}
            {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
        </div>
    );
}

export function DaysPicker({ value, onChange, id }: { value: DayOfWeek[]; onChange: (d: DayOfWeek[]) => void; id?: string }) {
    // Monday-first, the way a league calendar reads.
    const order: DayOfWeek[] = [1, 2, 3, 4, 5, 6, 0];
    return (
        <div id={id} className="flex flex-wrap gap-1" role="group">
            {order.map((d) => {
                const on = value.includes(d);
                return (
                    <button
                        key={d}
                        type="button"
                        aria-pressed={on}
                        onClick={() => onChange(on ? value.filter((x) => x !== d) : [...value, d].sort())}
                        className={`rounded-md border px-2.5 py-1 text-sm font-semibold ${on ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface text-muted hover:text-fg"}`}
                    >
                        {DAY_SHORT[d]}
                    </button>
                );
            })}
        </div>
    );
}

export function RangesInput({ value, onChange, idPrefix }: { value: DateRange[]; onChange: (r: DateRange[]) => void; idPrefix: string }) {
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");
    const add = () => {
        if (!isIsoDate(from)) return;
        const r: DateRange = isIsoDate(to) && to !== from ? (to < from ? { from: to, to: from } : { from, to }) : { from };
        onChange([...value, r].sort((a, b) => a.from.localeCompare(b.from)));
        setFrom("");
        setTo("");
    };
    return (
        <div className="grid gap-2">
            {value.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {value.map((r, i) => (
                        <span key={`${r.from}-${i}`} className="chip bg-surface-2 text-fg">
                            {formatRange(r)}
                            <button type="button" className="text-muted hover:text-danger" aria-label={`Remove ${formatRange(r)}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
                                ✕
                            </button>
                        </span>
                    ))}
                </div>
            )}
            <div className="flex flex-wrap items-end gap-2">
                <div>
                    <label className="text-xs text-muted" htmlFor={`${idPrefix}-from`}>
                        From
                    </label>
                    <input id={`${idPrefix}-from`} type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
                </div>
                <div>
                    <label className="text-xs text-muted" htmlFor={`${idPrefix}-to`}>
                        To (optional)
                    </label>
                    <input id={`${idPrefix}-to`} type="date" className="input" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
                </div>
                <button type="button" className="btn-secondary" onClick={add} disabled={!isIsoDate(from)}>
                    Add dates
                </button>
            </div>
        </div>
    );
}

/** Two-step destructive button: the first click arms it, the second acts. */
export function ConfirmButton({ label, confirmLabel, onConfirm, className = "btn-danger" }: { label: string; confirmLabel: string; onConfirm: () => void; className?: string }) {
    const [armed, setArmed] = useState(false);
    useEffect(() => {
        if (!armed) return;
        const t = setTimeout(() => setArmed(false), 5000);
        return () => clearTimeout(t);
    }, [armed]);
    return (
        <button type="button" className={className} onClick={() => (armed ? onConfirm() : setArmed(true))}>
            {armed ? confirmLabel : label}
        </button>
    );
}

export function BracketChip({ bracket }: { bracket: Bracket | undefined }) {
    if (!bracket) return <span className="chip bg-surface-2 text-muted">No bracket</span>;
    return (
        <span className="chip border border-border bg-surface text-fg">
            <span className="h-2 w-2 rounded-full" style={{ background: bracket.color }} aria-hidden />
            {bracket.name}
        </span>
    );
}

export function NumberInput({ id, value, onChange, min = 0, max = 99, placeholder, className = "input w-24" }: { id?: string; value: number | null; onChange: (v: number | null) => void; min?: number; max?: number; placeholder?: string; className?: string }) {
    return (
        <input
            id={id}
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            className={className}
            placeholder={placeholder}
            value={value ?? ""}
            onChange={(e) => {
                const v = e.target.value;
                if (v === "") return onChange(null);
                const num = Math.round(Number(v));
                if (Number.isFinite(num)) onChange(Math.min(max, Math.max(min, num)));
            }}
        />
    );
}
