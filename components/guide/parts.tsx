"use client";

/*
 * Pieces shared by the guide (/guide) and the tutorial (/tutorial): the
 * sport both follow, and their heading/step/label styles. One sport choice
 * for both, so a sport picked on one page is already picked on the other.
 */
import { useEffect, useState } from "react";
import { isSportId, SPORT_IDS, SPORTS, type SportId } from "@/lib/engine/sports";

const STORE_KEY = "seasonsmith.guide.sport";

/**
 * The reader's sport: ?sport=…, else the last one picked on either page.
 * Starts at soccer (the server can't know the choice) and switches after
 * mount -- reading it in the initializer would render differently on the
 * server and in the browser, which React reports as a hydration error.
 */
export function useGuideSport(): [SportId, (s: SportId) => void] {
    const [sport, setSport] = useState<SportId>("soccer");
    useEffect(() => {
        const fromUrl = new URLSearchParams(window.location.search).get("sport");
        let stored: string | null = null;
        try {
            stored = window.localStorage.getItem(STORE_KEY);
        } catch {
            // storage blocked: the URL or the default
        }
        // A bad ?sport= (a typo, an old link) falls through to the stored
        // choice; `??` would have stopped at it because it isn't null.
        if (isSportId(fromUrl)) {
            const next = fromUrl;
            // Remember a ?sport= link too (a league's Help link), so the
            // other page -- reached from the header, without ?sport= --
            // opens in the same sport.
            try {
                window.localStorage.setItem(STORE_KEY, next);
            } catch {
                // ignore
            }
            void Promise.resolve().then(() => setSport(next));
        } else if (isSportId(stored)) {
            const next = stored;
            void Promise.resolve().then(() => setSport(next));
        }
    }, []);
    const choose = (s: SportId) => {
        setSport(s);
        try {
            window.localStorage.setItem(STORE_KEY, s);
        } catch {
            // ignore
        }
    };
    return [sport, choose];
}

export function H2({ id, children }: { id: string; children: React.ReactNode }) {
    return (
        <h2 id={id} className="scroll-mt-24 border-b-4 border-ball pb-1 font-display text-3xl font-bold uppercase tracking-wide">
            {children}
        </h2>
    );
}

export function H3({ id, children }: { id?: string; children: React.ReactNode }) {
    return (
        <h3 id={id} className="mt-8 scroll-mt-24 font-display text-2xl font-bold uppercase tracking-wide">
            {children}
        </h3>
    );
}

export function Step({ n, title, id, children }: { n: number; title: string; id: string; children: React.ReactNode }) {
    return (
        <section id={id} className="card scroll-mt-24 p-5">
            <div className="flex items-baseline gap-3">
                <span className="font-display text-3xl font-bold text-accent tabular">{String(n).padStart(2, "0")}</span>
                <h3 className="font-display text-2xl font-bold uppercase tracking-wide">{title}</h3>
            </div>
            <div className="mt-3 grid gap-3 leading-relaxed [&_li]:mt-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6">{children}</div>
        </section>
    );
}

export function Expect({ children }: { children: React.ReactNode }) {
    return (
        <div className="rounded-lg border border-ok/40 bg-ok-soft p-3 text-sm">
            <strong className="text-ok">You should see:</strong> {children}
        </div>
    );
}

export function Tip({ children }: { children: React.ReactNode }) {
    return <div className="rounded-lg bg-surface-2 p-3 text-sm text-muted">{children}</div>;
}

/** A UI label, styled like the control it names. */
export function B({ children }: { children: React.ReactNode }) {
    return <strong className="rounded bg-accent-soft px-1.5 py-0.5 font-semibold text-fg">{children}</strong>;
}

export function SportPicker({ sport, onChange, id, label = "Show this guide for" }: { sport: SportId; onChange: (s: SportId) => void; id: string; label?: string }) {
    return (
        <label className="flex flex-wrap items-center gap-2 text-sm font-semibold" htmlFor={id}>
            {label}
            <select id={id} className="input w-auto" value={sport} onChange={(e) => isSportId(e.target.value) && onChange(e.target.value)}>
                {SPORT_IDS.map((s) => (
                    <option key={s} value={s}>
                        {SPORTS[s].name}
                    </option>
                ))}
            </select>
        </label>
    );
}
