"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { parseBackup } from "@/lib/client/backup";
import { browserLeagues, storeFor, type LeagueSummary, type Mode } from "@/lib/client/store";
import { sampleLeague } from "@/lib/engine/sample";

type Start = "blank" | "example" | "file";

export default function LeagueList({ mode, initial, loadError }: { mode: Mode; initial: LeagueSummary[] | null; loadError: string | null }) {
    const router = useRouter();
    const store = storeFor(mode);
    const [leagues, setLeagues] = useState<LeagueSummary[] | null>(initial);
    const [name, setName] = useState("");
    const [start, setStart] = useState<Start>("blank");
    const [file, setFile] = useState<File | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(loadError);
    const [localCount, setLocalCount] = useState(0);

    // Browser mode can only read its list after mount (localStorage). In cloud
    // mode, count leagues left in this browser so they can be uploaded.
    useEffect(() => {
        let live = true;
        (async () => {
            if (mode === "browser") {
                const l = await store.list();
                if (live) setLeagues(l);
            } else {
                const local = await browserLeagues();
                if (live) setLocalCount(local.length);
            }
        })();
        return () => {
            live = false;
        };
    }, [mode, store]);

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
            } else if (start === "example") {
                rec = await store.create(name.trim() || "Example league", sampleLeague());
            } else {
                if (!name.trim()) throw new Error("Give the league a name, like “Spring 2027 Junior Team Tennis”.");
                rec = await store.create(name.trim());
            }
            router.push(`/league/${rec.id}`);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn’t create the league.");
            setBusy(false);
        }
    }

    async function uploadLocal() {
        setBusy(true);
        setError(null);
        try {
            const local = await browserLeagues();
            for (const r of local) await store.create(r.name, r.data, r.schedule);
            setLeagues(await store.list());
            setLocalCount(0);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Upload failed.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 md:grid-cols-[minmax(0,1fr)_22rem]">
            <section className="min-w-0">
                <h1 className="font-display text-4xl font-bold uppercase tracking-wide">Your leagues</h1>
                <p className="mt-1 text-muted">One league per season. Each holds its brackets, pools, courts, teams, rules and schedule.</p>

                {mode === "cloud" && localCount > 0 && (
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent-soft p-3 text-sm">
                        <span>
                            This browser has {localCount} league{localCount === 1 ? "" : "s"} from before the site was connected.
                        </span>
                        <button className="btn-primary btn-sm" disabled={busy} onClick={uploadLocal}>
                            Upload {localCount === 1 ? "it" : "them"}
                        </button>
                    </div>
                )}

                <div className="mt-6 grid gap-3">
                    {leagues === null && !error && <p className="text-muted">Loading…</p>}
                    {leagues?.length === 0 && (
                        <div className="card p-6 text-muted">
                            No leagues yet. Create one on the right. <strong className="text-fg">Start from the example</strong> to see a finished
                            schedule straight away, then swap in your real teams.
                        </div>
                    )}
                    {leagues?.map((l) => (
                        <Link key={l.id} href={`/league/${l.id}`} className="card flex flex-wrap items-center justify-between gap-3 p-4 hover:border-accent">
                            <div className="min-w-0">
                                <div className="truncate text-lg font-semibold">{l.name}</div>
                                <div className="text-sm text-muted">Updated {new Date(l.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</div>
                            </div>
                            <div className="flex flex-wrap gap-2 text-sm tabular">
                                <span className="chip bg-surface-2">{l.teamCount} teams</span>
                                <span className="chip bg-surface-2">{l.matchCount} matches</span>
                                {l.unplacedCount > 0 && <span className="chip bg-warn-soft text-warn">{l.unplacedCount} not placed</span>}
                            </div>
                        </Link>
                    ))}
                </div>
            </section>

            <aside>
                <form onSubmit={create} className="card grid gap-4 p-5">
                    <h2 className="font-display text-2xl font-bold uppercase tracking-wide">New league</h2>
                    <div>
                        <label className="label" htmlFor="league-name">Name</label>
                        <input id="league-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Spring 2027 Junior Team Tennis" />
                    </div>
                    <fieldset className="grid gap-2 text-sm">
                        <legend className="label">Start from</legend>
                        {(
                            [
                                ["blank", "A blank league", "Set up season dates, brackets, courts and teams yourself."],
                                ["example", "The example league", "24 made-up teams in 4 brackets, ready to schedule."],
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
                    {start === "file" && <input id="backup-file" type="file" accept="application/json,.json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />}
                    {error && <p className="rounded-lg bg-danger-soft p-2.5 text-sm text-danger">{error}</p>}
                    <button className="btn-primary" disabled={busy}>
                        {busy ? "Creating…" : "Create league"}
                    </button>
                </form>
            </aside>
        </div>
    );
}
