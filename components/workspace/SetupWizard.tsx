"use client";

import { readiness, SETUP_STEPS, stepTitle, type Check, type StepId } from "@/lib/engine/readiness";
import { cap, isSportId, SPORT_IDS, SPORTS } from "@/lib/engine/sports";
import type { LeagueStore } from "@/lib/client/store";
import BracketsTab from "./BracketsTab";
import CourtsTab from "./CourtsTab";
import ScheduleTab from "./ScheduleTab";
import SeasonTab from "./SeasonTab";
import TeamsTab from "./TeamsTab";
import type { Tab, TabProps } from "./types";
import { Field } from "./ui";

/** Where a tab's "Go there" link lands while the wizard is open. */
export const STEP_FOR_TAB: Record<Tab, StepId> = { schedule: "review", teams: "teams", brackets: "brackets", courts: "time", season: "season" };

/**
 * Step-by-step setup for a new league. Each step is the matching editor tab
 * (so nothing here can drift from what the tabs do), with the league's
 * readiness checks for that step above it.
 *
 * "Needed" items disable Next, because each one guarantees unplaced games
 * or an empty schedule later -- the point of the wizard is that Generate
 * works the first time. The step list above stays clickable, though: a
 * person who'd rather fill things in another order (or come back to the
 * facility sheet once it arrives) is never trapped.
 */
export default function SetupWizard({
    props,
    step,
    setStep,
    onFinish,
    leagueId,
    store,
    userKey,
}: {
    props: TabProps;
    step: StepId;
    setStep: (s: StepId) => void;
    onFinish: () => void;
    leagueId: string;
    store: LeagueStore;
    userKey: string;
}) {
    const { doc, change, t } = props;
    const checks = readiness(doc.data, doc.name);
    const index = SETUP_STEPS.indexOf(step);
    const here = checks.filter((c) => c.step === step);
    const blocked = here.some((c) => c.level === "block");
    const blocksAnywhere = checks.filter((c) => c.level === "block");
    const go = (s: StepId) => {
        setStep(s);
        window.scrollTo({ top: 0 });
    };
    // Links inside a tab ("Add brackets", an unplaced game's "Go there") move
    // between steps instead of tabs while the wizard is open.
    const inner: TabProps = { ...props, goTo: (tab) => go(STEP_FOR_TAB[tab]) };
    const next = SETUP_STEPS[index + 1];
    const prev = SETUP_STEPS[index - 1];

    const intro: Record<StepId, string> = {
        basics: `What you’re scheduling. The sport sets the words used everywhere: ${t.units}, ${t.time}, ${t.matches} and ${t.captains}.`,
        season: `The first and last day ${t.matches} can be played, the days nobody plays, and a few rules for the whole league.`,
        brackets: `Age groups or divisions (10U, 12U, Open…). Each has its own number of guaranteed ${t.matches}, start-time window and days. Teams only play teams in their own bracket and pool.`,
        facilities: `Where ${t.matches} are played, and the ${t.units} inside each one (${t.unitLabel(0)}, ${t.unitLabel(1)}…), so every ${t.match} is given its own.`,
        time: `When each facility is yours. Add the weekly pattern, upload the spreadsheet a facility sends, or both: an upload replaces the weekly pattern on the dates it covers.`,
        teams: `Every team, its bracket, and optionally its pool and club. Paste a whole list at once if you have one.`,
        requests: `What each ${t.captain} has asked for: days they can’t play, latest start, at most one ${t.match} a weekend… “Must” is never broken; “Prefer” is kept where possible.`,
        review: `Everything is checked below. Generate the schedule, look it over, then finish setup to get the full editor.`,
    };

    return (
        <div className="grid gap-6">
            <section className="card p-4" aria-label="Setup steps">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="font-display text-2xl font-bold uppercase tracking-wide">Set up your league</h2>
                    <span className="text-sm text-muted">
                        Step {index + 1} of {SETUP_STEPS.length}
                    </span>
                </div>
                <ol className="mt-3 flex gap-1 overflow-x-auto pb-1">
                    {SETUP_STEPS.map((s, i) => {
                        // Ticked only when this step AND every one before it is
                        // clear: "Requests ✓" next to an empty league read as done.
                        const open = checks.some((c) => SETUP_STEPS.indexOf(c.step) <= i && c.level === "block");
                        const current = s === step;
                        return (
                            <li key={s} className="shrink-0">
                                <button
                                    onClick={() => go(s)}
                                    aria-current={current ? "step" : undefined}
                                    className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm font-semibold ${current ? "border-accent bg-accent-soft text-fg" : "border-border text-muted hover:text-fg"}`}
                                >
                                    <span
                                        aria-hidden
                                        className={`grid h-5 w-5 place-items-center rounded-full text-xs tabular ${open ? "bg-surface-2 text-muted" : "bg-ok-soft text-ok"}`}
                                    >
                                        {open ? i + 1 : "✓"}
                                    </span>
                                    {stepTitle(s, doc.data)}
                                    <span className="sr-only">{open ? " (needs something)" : " (ready)"}</span>
                                </button>
                            </li>
                        );
                    })}
                </ol>
            </section>

            <section>
                <h2 className="font-display text-3xl font-bold uppercase tracking-wide">
                    {index + 1}. {stepTitle(step, doc.data)}
                </h2>
                <p className="mt-1 max-w-3xl text-muted">{intro[step]}</p>
                {step !== "review" && <Checklist checks={here} />}
            </section>

            {step === "basics" && (
                <section className="card grid max-w-3xl gap-4 p-5">
                    <Field label="League or tournament name" htmlFor="setup-name">
                        <input id="setup-name" className="input" value={doc.name} onChange={(e) => change((d) => ({ ...d, name: e.target.value }))} />
                    </Field>
                    <Field label="Sport" htmlFor="setup-sport">
                        <select
                            id="setup-sport"
                            className="input max-w-xs"
                            value={doc.data.settings.sport}
                            onChange={(e) => {
                                if (!isSportId(e.target.value)) return;
                                const nextSport = SPORTS[e.target.value];
                                const s = doc.data.settings;
                                // Same as the Season tab: only move the game
                                // length along if it was still the old sport's default.
                                change((d) => ({
                                    ...d,
                                    data: {
                                        ...d.data,
                                        settings: { ...s, sport: nextSport.id, ...(s.matchMinutes === SPORTS[s.sport].minutes ? { matchMinutes: nextSport.minutes } : {}) },
                                    },
                                }));
                            }}
                        >
                            {SPORT_IDS.map((id) => (
                                <option key={id} value={id}>
                                    {SPORTS[id].name}
                                </option>
                            ))}
                        </select>
                    </Field>
                    <p className="rounded-lg bg-surface-2 p-3 text-sm">
                        This league talks about <strong>{t.units}</strong> ({t.unitLabel(0)}, {t.unitLabel(1)}), <strong>{t.time}</strong>, <strong>{t.matches}</strong> and{" "}
                        <strong>{t.captains}</strong>. A {t.match} lasts {doc.data.settings.matchMinutes} minutes unless you change it on the next step.
                    </p>
                    <div className="text-sm text-muted">
                        <div className="font-semibold text-fg">Have these to hand (you can add any of them later):</div>
                        <ul className="mt-1 list-disc pl-5">
                            <li>The season’s first and last day, and any holidays or closures</li>
                            <li>Your brackets and how many {t.matches} each team is guaranteed</li>
                            <li>
                                Each facility’s address and its {t.units}, and when you have {t.time} there (or the facility’s spreadsheet)
                            </li>
                            <li>The team list, with brackets, pools and clubs</li>
                            <li>Any requests from {t.captains}</li>
                        </ul>
                    </div>
                </section>
            )}
            {step === "season" && <SeasonTab {...inner} leagueId={leagueId} store={store} userKey={userKey} setup />}
            {step === "brackets" && <BracketsTab {...inner} />}
            {step === "facilities" && <CourtsTab {...inner} only="facilities" />}
            {step === "time" && <CourtsTab {...inner} only="time" />}
            {step === "teams" && <TeamsTab {...inner} />}
            {step === "requests" && <TeamsTab {...inner} requests />}
            {step === "review" && (
                <>
                    <section className="card p-5" aria-label="Setup check">
                        {blocksAnywhere.length ? (
                            <h3 className="font-display text-xl font-bold uppercase tracking-wide text-danger">Still needed before scheduling</h3>
                        ) : (
                            <h3 className="font-display text-xl font-bold uppercase tracking-wide text-ok">Ready to schedule</h3>
                        )}
                        <ul className="mt-3 grid gap-2">
                            {SETUP_STEPS.filter((s) => s !== "review").map((s) => {
                                const list = checks.filter((c) => c.step === s && c.level !== "info");
                                if (!list.length) return null;
                                return (
                                    <li key={s} className="grid gap-1">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <span className="font-semibold">{stepTitle(s, doc.data)}</span>
                                            <button className="btn-ghost btn-sm" onClick={() => go(s)}>
                                                Go to {stepTitle(s, doc.data)}
                                            </button>
                                        </div>
                                        <Checklist checks={list} />
                                    </li>
                                );
                            })}
                        </ul>
                        {!checks.some((c) => c.level !== "info") && (
                            <p className="mt-2 text-sm text-muted">
                                Every step is complete. {cap(t.matches)} that still can’t be placed after Generate are listed with the reason and how to fix it.
                            </p>
                        )}
                    </section>
                    <ScheduleTab {...inner} />
                </>
            )}

            <nav className="sticky bottom-2 z-20 rounded-xl border border-border bg-surface/95 px-4 py-3 shadow-lg backdrop-blur" aria-label="Setup navigation">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        {prev && (
                            <button className="btn-secondary" onClick={() => go(prev)}>
                                Back
                            </button>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-3">
                        {blocked && next && <span className="text-sm text-muted">Finish the items marked Needed to continue.</span>}
                        {next ? (
                            <button className="btn-primary" disabled={blocked} onClick={() => go(next)}>
                                Next: {stepTitle(next, doc.data)}
                            </button>
                        ) : (
                            <button className="btn-primary" onClick={onFinish}>
                                Finish setup
                            </button>
                        )}
                    </div>
                </div>
            </nav>
        </div>
    );
}

const LEVEL: Record<Check["level"], [string, string]> = {
    block: ["Needed", "bg-danger-soft text-danger"],
    warn: ["Check", "bg-warn-soft text-warn"],
    info: ["Note", "bg-surface-2 text-muted"],
};

function Checklist({ checks }: { checks: Check[] }) {
    if (!checks.length) return null;
    return (
        <ul className="mt-3 grid max-w-3xl gap-1.5" aria-label="Checklist">
            {checks.map((c) => (
                <li key={c.level + c.text} className="flex items-start gap-2 text-sm">
                    <span className={`chip shrink-0 ${LEVEL[c.level][1]}`}>{LEVEL[c.level][0]}</span>
                    <span>{c.text}</span>
                </li>
            ))}
        </ul>
    );
}
