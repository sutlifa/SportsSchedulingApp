"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseBackup } from "@/lib/client/backup";
import { storeFor, type Mode } from "@/lib/client/store";
import { sampleLeague } from "@/lib/engine/sample";
import { emptyLeague } from "@/lib/engine/sanitize";
import { SPORT_IDS, SPORTS, isSportId, type SportId } from "@/lib/engine/sports";

type Start = "blank" | "example" | "file";

/**
 * Creating a league. "Guided setup" (a blank league) opens the setup wizard
 * (?setup=1), which walks through every step Generate needs and checks each
 * one; the example and a backup open straight into the editor, since they
 * arrive complete.
 */
export default function NewLeague({ mode }: { mode: Mode }) {
    const router = useRouter();
    const store = storeFor(mode);
    const [name, setName] = useState("");
    const [start, setStart] = useState<Start>("blank");
    // No default sport on purpose: it sets every word the league uses (ice
    // time vs court time, game vs match), so it should be a choice, not an
    // accident. A backup file brings its own sport.
    const [sport, setSport] = useState<SportId | "">("");
    const [file, setFile] = useState<File | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function create(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
            let rec;
            if (start === "file") {
                if (!file) throw new Error("Choose a backup file first.");
                const b = parseBackup(await file.text());
                rec = await store.create(name.trim() || b.name, b.data, b.schedule);
            } else {
                if (!sport) throw new Error("Choose the sport you’re scheduling. It sets the words the whole league uses.");
                if (start === "example") rec = await store.create(name.trim() || `Example ${SPORTS[sport].name.toLowerCase()} league`, sampleLeague(sport));
                else {
                    if (!name.trim()) throw new Error("Give the league or tournament a name, like “Spring 2027 Youth Hockey”.");
                    rec = await store.create(name.trim(), emptyLeague(sport));
                }
            }
            // replace, not push: /new has done its job once the league exists.
            // With push, Back from the new league landed on /new again, and
            // pressing Start there made a duplicate league.
            router.replace(start === "blank" ? `/league/${rec.id}?setup=1` : `/league/${rec.id}`);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn’t create the league.");
            setBusy(false);
        }
    }

    return (
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 md:grid-cols-[minmax(0,1fr)_20rem]">
            <section className="min-w-0 max-w-2xl">
                <h1 className="font-display text-4xl font-bold uppercase tracking-wide">New league or tournament</h1>
                <p className="mt-1 text-muted">
                    One league per season or tournament, in any sport. Guided setup takes you through it step by step and checks that everything needed to schedule every team is
                    there.
                </p>
                <form onSubmit={create} className="card mt-6 grid gap-4 p-5">
                    <div>
                        <label className="label" htmlFor="league-name">
                            Name
                        </label>
                        <input id="league-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Spring 2027 Youth League" />
                    </div>
                    {start !== "file" && (
                        <div>
                            <label className="label" htmlFor="league-sport">
                                Sport
                            </label>
                            <select id="league-sport" className="input" value={sport} onChange={(e) => setSport(isSportId(e.target.value) ? e.target.value : "")}>
                                <option value="">Choose a sport…</option>
                                {SPORT_IDS.map((id) => (
                                    <option key={id} value={id}>
                                        {SPORTS[id].name}
                                    </option>
                                ))}
                            </select>
                            {sport && (
                                <p className="mt-1 text-xs text-muted">
                                    The league will talk about {SPORTS[sport].units}, {SPORTS[sport].time} and {SPORTS[sport].matches}.
                                </p>
                            )}
                        </div>
                    )}
                    <fieldset className="grid gap-2 text-sm">
                        <legend className="label">Start from</legend>
                        {(
                            [
                                ["blank", "Guided setup", "Step by step: season, brackets, facilities, their time, teams and requests, checked as you go."],
                                ["example", "The example league", "24 made-up teams in 4 brackets, ready to schedule, in your sport."],
                                ["file", "A backup file", "A .json file downloaded from Season → Download backup."],
                            ] as const
                        ).map(([v, title, hint]) => (
                            <label key={v} className="flex cursor-pointer gap-2 rounded-lg border border-border p-2.5 has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                                <input type="radio" name="start" value={v} checked={start === v} onChange={() => setStart(v)} className="mt-1" />
                                <span>
                                    <span className="font-semibold">{title}</span>
                                    <span className="block text-muted">{hint}</span>
                                </span>
                            </label>
                        ))}
                    </fieldset>
                    {start === "file" && (
                        <input id="backup-file" type="file" accept="application/json,.json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
                    )}
                    {error && <p className="rounded-lg bg-danger-soft p-2.5 text-sm text-danger">{error}</p>}
                    <button className="btn-primary" disabled={busy}>
                        {busy ? "Creating…" : start === "blank" ? "Start guided setup" : "Create league"}
                    </button>
                </form>
            </section>
            <aside className="grid content-start gap-4 text-sm">
                <div className="card p-4">
                    <div className="font-display text-xl font-bold uppercase tracking-wide">What guided setup asks for</div>
                    <ol className="mt-2 list-decimal pl-5 text-muted">
                        <li>Name and sport</li>
                        <li>Season dates and blackout days</li>
                        <li>Brackets and pools</li>
                        <li>Facilities and their sheets, fields or courts</li>
                        <li>Ice, field or court time (or the facility’s spreadsheet)</li>
                        <li>Teams</li>
                        <li>Coach or captain requests</li>
                        <li>Review and generate</li>
                    </ol>
                    <p className="mt-2 text-muted">Everything saves as you go, so you can stop and come back.</p>
                </div>
                <Link href="/guide#tutorial" className="card block border-accent/40 bg-accent-soft p-4 hover:border-accent">
                    <div className="font-display text-xl font-bold uppercase tracking-wide">Want a practice run?</div>
                    <p className="mt-1">
                        The tutorial builds a full league in your sport, with sample teams and a facility spreadsheet, in about 20 minutes.{" "}
                        <span className="font-semibold text-accent underline">Open the tutorial</span>
                    </p>
                </Link>
            </aside>
        </div>
    );
}
