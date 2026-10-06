"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { downloadText, fileSafe, makeBackup, parseBackup } from "@/lib/client/backup";
import { browserLeagues, browserStore, readMirrors, storeFor, type LeagueSummary, type Mirror, type Mode } from "@/lib/client/store";
import { sampleLeague } from "@/lib/engine/sample";
import { emptyLeague } from "@/lib/engine/sanitize";
import { SPORT_IDS, SPORTS, isSportId, type SportId } from "@/lib/engine/sports";

type Start = "blank" | "example" | "file";

export default function LeagueList({ mode, initial, loadError, userKey = "" }: { mode: Mode; initial: LeagueSummary[] | null; loadError: string | null; userKey?: string }) {
    const router = useRouter();
    const store = storeFor(mode);
    const [leagues, setLeagues] = useState<LeagueSummary[] | null>(initial);
    const [name, setName] = useState("");
    const [start, setStart] = useState<Start>("blank");
    // No default sport on purpose: it sets every word the league uses (ice
    // time vs court time, game vs match), so it should be a choice, not an
    // accident. A backup file brings its own sport.
    const [sport, setSport] = useState<SportId | "">("");
    const [file, setFile] = useState<File | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(loadError);
    const [localCount, setLocalCount] = useState(0);
    const [mirrors, setMirrors] = useState<Mirror[]>([]);

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
                if (live) {
                    setLocalCount(local.length);
                    setMirrors(readMirrors(userKey));
                }
            }
        })();
        return () => {
            live = false;
        };
    }, [mode, store, userKey]);

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
            // MOVE, not copy: each local league is removed the moment its cloud
            // copy exists. Removing per league (not after the loop) means a
            // failure halfway through can be retried without re-uploading the
            // ones that already went up.
            const local = await browserLeagues();
            for (const r of local) {
                await store.create(r.name, r.data, r.schedule);
                await browserStore.remove(r.id);
                setLocalCount((n) => Math.max(0, n - 1));
            }
            setLeagues(await store.list());
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
                <p className="mt-1 text-muted">One league (or tournament) per season, in any sport. Each holds its brackets, pools, facilities, teams, rules and schedule.</p>

                {mode === "cloud" && localCount > 0 && (
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent-soft p-3 text-sm">
                        <span>
                            This browser has {localCount} league{localCount === 1 ? "" : "s"} from before the site was connected. Uploading moves{" "}
                            {localCount === 1 ? "it" : "them"} into your account.
                        </span>
                        <button className="btn-primary btn-sm" disabled={busy} onClick={uploadLocal}>
                            Upload {localCount === 1 ? "it" : "them"}
                        </button>
                    </div>
                )}

                {mode === "cloud" && mirrors.length > 0 && (
                    <details className="card mt-4 p-4" open={Boolean(loadError)}>
                        <summary className="cursor-pointer font-semibold">
                            Backup copies in this browser ({mirrors.length})
                            <span className="block text-sm font-normal text-muted">
                                Every change you make is also saved here. If the site can’t reach its database, download a backup and keep working.
                            </span>
                        </summary>
                        <ul className="mt-3 divide-y divide-border">
                            {mirrors.map((m) => (
                                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                                    <span className="min-w-0">
                                        <span className="font-semibold">{m.name}</span>
                                        <span className="block text-xs text-muted">
                                            Copied {new Date(m.savedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {m.data.teams.length} teams ·{" "}
                                            {m.schedule.matches.length} matches
                                        </span>
                                    </span>
                                    <span className="flex flex-wrap gap-2">
                                        <button className="btn-secondary btn-sm" onClick={() => downloadText(`${fileSafe(m.name)}-backup.json`, makeBackup(m.name, m.data, m.schedule), "application/json")}>
                                            Download backup
                                        </button>
                                        <button
                                            className="btn-ghost btn-sm"
                                            disabled={busy}
                                            onClick={async () => {
                                                setBusy(true);
                                                setError(null);
                                                try {
                                                    const rec = await store.create(`${m.name} (restored)`, m.data, m.schedule);
                                                    router.push(`/league/${rec.id}`);
                                                } catch (err) {
                                                    setError(err instanceof Error ? err.message : "Couldn’t restore that copy. Download it instead.");
                                                    setBusy(false);
                                                }
                                            }}
                                        >
                                            Restore as a new league
                                        </button>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </details>
                )}

                <div className="mt-6 grid gap-3">
                    {leagues === null && !error && <p className="text-muted">Loading…</p>}
                    {leagues?.length === 0 && (
                        <div className="card p-6 text-muted">
                            No leagues yet. Create one with the form. <strong className="text-fg">Start from the example</strong> to see a finished
                            schedule straight away, or follow the{" "}
                            <Link href="/guide#tutorial" className="font-semibold text-accent underline">
                                step-by-step tutorial
                            </Link>{" "}
                            to build one from scratch.
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

            <aside className="grid content-start gap-4">
                <Link href="/guide#tutorial" className="card block border-accent/40 bg-accent-soft p-4 hover:border-accent">
                    <div className="font-display text-xl font-bold uppercase tracking-wide">New here?</div>
                    <p className="mt-1 text-sm">
                        Follow the step-by-step tutorial: build a full league in your sport with brackets, facilities, a facility spreadsheet and coach or captain requests in about 20
                        minutes. <span className="font-semibold text-accent underline">Open the guide</span>
                    </p>
                </Link>
                <form onSubmit={create} className="card grid gap-4 p-5">
                    <h2 className="font-display text-2xl font-bold uppercase tracking-wide">New league</h2>
                    <div>
                        <label className="label" htmlFor="league-name">Name</label>
                        <input id="league-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Spring 2027 Youth League" />
                    </div>
                    {start !== "file" && (
                        <div>
                            <label className="label" htmlFor="league-sport">Sport</label>
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
                                ["blank", "A blank league", "Set up season dates, brackets, facilities and teams yourself."],
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
                    {start === "file" && <input id="backup-file" type="file" accept="application/json,.json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />}
                    {error && <p className="rounded-lg bg-danger-soft p-2.5 text-sm text-danger">{error}</p>}
                    {/* Said here, not in the server's loadError: only this
                        browser knows whether it holds any backup copies, and
                        promising ones that don't exist sent people looking. */}
                    {loadError && mirrors.length > 0 && (
                        <p className="text-sm text-muted">Backup copies of your leagues are saved in this browser and still work: see “Backup copies in this browser”.</p>
                    )}
                    <button className="btn-primary" disabled={busy}>
                        {busy ? "Creating…" : "Create league"}
                    </button>
                </form>
            </aside>
        </div>
    );
}
