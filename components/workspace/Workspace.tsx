"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { downloadText, fileSafe, makeBackup } from "@/lib/client/backup";
import { storeFor, writeMirror, type LeagueRecord, type LeagueStore, type Mode } from "@/lib/client/store";
import { audit, makeLookup } from "@/lib/engine/engine";
import BracketsTab from "./BracketsTab";
import CourtsTab from "./CourtsTab";
import ScheduleTab from "./ScheduleTab";
import SeasonTab from "./SeasonTab";
import TeamsTab from "./TeamsTab";
import type { Doc, Tab, TabProps } from "./types";

/**
 * Loads a league, then hands it to the editor.
 *
 * In cloud mode the server already loaded it (`initial`). In browser mode
 * only the client can read localStorage, so it's loaded in an effect after
 * mount -- never during render, which would hydrate differently on the
 * server and the client.
 */
export default function Workspace({ mode, id, initial, userKey = "" }: { mode: Mode; id: string; initial: LeagueRecord | null; userKey?: string }) {
    const store = storeFor(mode);
    const [rec, setRec] = useState<LeagueRecord | null>(initial);
    const [missing, setMissing] = useState(false);

    useEffect(() => {
        if (initial) return;
        let live = true;
        store.load(id).then((r) => {
            if (!live) return;
            if (r) setRec(r);
            else setMissing(true);
        });
        return () => {
            live = false;
        };
    }, [initial, id, store]);

    if (missing) {
        return (
            <div className="mx-auto max-w-2xl px-4 py-16">
                <h1 className="font-display text-3xl font-bold uppercase">League not found</h1>
                <p className="mt-2 text-muted">It may have been deleted, or it was saved in a different browser.</p>
                <Link href="/" className="btn-primary mt-6">
                    Back to your leagues
                </Link>
            </div>
        );
    }
    if (!rec) return <div className="mx-auto max-w-6xl px-4 py-10 text-muted">Loading league…</div>;
    return <Editor store={store} mode={mode} rec={rec} userKey={userKey} />;
}

type Status =
    | { kind: "saved" }
    | { kind: "pending" }
    | { kind: "saving" }
    | { kind: "error"; message: string }
    | { kind: "conflict"; message: string; current: LeagueRecord };

const TABS: { id: Tab; label: string }[] = [
    { id: "schedule", label: "Schedule" },
    { id: "teams", label: "Teams" },
    { id: "brackets", label: "Brackets & pools" },
    { id: "courts", label: "Courts & times" },
    { id: "season", label: "Season" },
];

function Editor({ store, mode, rec, userKey }: { store: LeagueStore; mode: Mode; rec: LeagueRecord; userKey: string }) {
    const [doc, setDoc] = useState<Doc>({ name: rec.name, data: rec.data, schedule: rec.schedule });
    const [tab, setTab] = useState<Tab>(rec.data.teams.length ? "schedule" : "season");
    const [status, setStatus] = useState<Status>({ kind: "saved" });
    const [saveTick, setSaveTick] = useState(0);

    const versionRef = useRef(rec.version);
    const dirty = useRef(false);
    const saving = useRef(false);
    const blocked = useRef(false);
    /** The save request currently on the wire, if any. */
    const inflight = useRef<Promise<unknown> | null>(null);
    const latest = useRef(doc);
    useEffect(() => {
        latest.current = doc;
    }, [doc]);

    const change = useCallback((fn: (d: Doc) => Doc) => {
        dirty.current = true;
        setDoc((d) => fn(d));
        setStatus((s) => (s.kind === "conflict" ? s : { kind: "pending" }));
    }, []);

    const doSave = useCallback(async () => {
        if (saving.current || !dirty.current || blocked.current) return;
        saving.current = true;
        dirty.current = false;
        setStatus({ kind: "saving" });
        // Snapshot first: `latest` can move on while the request is in flight.
        const snap = latest.current;
        const p = store.save({ id: rec.id, name: snap.name, data: snap.data, schedule: snap.schedule, version: versionRef.current });
        inflight.current = p;
        const r = await p;
        inflight.current = null;
        saving.current = false;
        if (r.ok) {
            versionRef.current = r.version;
            if (dirty.current) setSaveTick((t) => t + 1);
            else setStatus({ kind: "saved" });
        } else if (r.kind === "conflict") {
            // Stop autosaving until the person chooses. Never overwrite a
            // newer copy without being asked.
            dirty.current = true;
            blocked.current = true;
            setStatus({ kind: "conflict", message: r.message, current: r.current });
        } else {
            dirty.current = true;
            setStatus({ kind: "error", message: r.message });
            if (r.retry) setTimeout(() => setSaveTick((t) => t + 1), 5000);
        }
    }, [store, rec.id]);

    // Debounced autosave: 700ms after the last change.
    useEffect(() => {
        if (!dirty.current) return;
        const t = setTimeout(() => void doSave(), 700);
        return () => clearTimeout(t);
    }, [doc, saveTick, doSave]);

    // Leaving the league inside the app (the "Leagues" link, the logo) unmounts
    // the editor without a beforeunload, and the debounce timer's cleanup
    // would drop the last <700ms of edits. Save them on the way out instead.
    // The request outlives the component: client-side navigation keeps the
    // page (and its fetch) alive.
    //
    // If a save is already on the wire, wait for it: its continuation (in
    // doSave, registered first) bumps versionRef, and only then is this save
    // sent at the right version. Sending it alongside would 409 against our
    // own previous save and lose the edit. The mirror is written right away
    // too, because its 400ms debounce is cancelled by the same unmount.
    useEffect(() => {
        const latestRef = latest;
        const dirtyRef = dirty;
        const blockedRef = blocked;
        const version = versionRef;
        const inflightRef = inflight;
        return () => {
            const snap = latestRef.current;
            if (mode === "cloud") writeMirror(userKey, { id: rec.id, name: snap.name, data: snap.data, schedule: snap.schedule });
            if (!dirtyRef.current || blockedRef.current) return;
            dirtyRef.current = false;
            const send = () => store.save({ id: rec.id, name: snap.name, data: snap.data, schedule: snap.schedule, version: version.current });
            void (inflightRef.current ?? Promise.resolve()).then(send, send);
        };
    }, [store, rec.id, mode, userKey]);

    // Cloud leagues are mirrored into this browser on every change (see
    // writeMirror), so a database outage never strands the person's work.
    useEffect(() => {
        if (mode !== "cloud") return;
        const t = setTimeout(() => writeMirror(userKey, { id: rec.id, name: doc.name, data: doc.data, schedule: doc.schedule }), 400);
        return () => clearTimeout(t);
    }, [doc, mode, rec.id, userKey]);

    const downloadBackup = () => downloadText(`${fileSafe(doc.name)}-backup.json`, makeBackup(doc.name, doc.data, doc.schedule), "application/json");

    useEffect(() => {
        const warn = (e: BeforeUnloadEvent) => {
            if (dirty.current || saving.current) e.preventDefault();
        };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, []);

    const resolveConflict = (keep: "theirs" | "mine") => {
        if (status.kind !== "conflict") return;
        const cur = status.current;
        versionRef.current = cur.version;
        blocked.current = false;
        if (keep === "theirs") {
            dirty.current = false;
            setDoc({ name: cur.name, data: cur.data, schedule: cur.schedule });
            setStatus({ kind: "saved" });
        } else {
            dirty.current = true;
            setStatus({ kind: "pending" });
            setSaveTick((t) => t + 1);
        }
    };

    const result = useMemo(() => audit(doc.data, doc.schedule.matches), [doc.data, doc.schedule.matches]);
    const lookup = useMemo(() => makeLookup(doc.data), [doc.data]);
    const props: TabProps = { doc, change, result, lookup, goTo: setTab, mode };

    return (
        <div>
            <div className="sticky top-0 z-30 border-b border-border bg-bg/95 backdrop-blur">
                <div className="mx-auto max-w-6xl px-4 pt-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                            <Link href="/" className="text-sm text-muted hover:text-fg">
                                Leagues
                            </Link>
                            <span className="text-muted">/</span>
                            <h1 className="truncate font-display text-2xl font-bold uppercase tracking-wide">{doc.name}</h1>
                        </div>
                        <SaveStatus status={status} mode={mode} />
                    </div>
                    <nav className="-mb-px mt-2 flex gap-1 overflow-x-auto" aria-label="League sections">
                        {TABS.map((t) => (
                            <button
                                key={t.id}
                                onClick={() => setTab(t.id)}
                                aria-current={tab === t.id ? "page" : undefined}
                                className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${tab === t.id ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`}
                            >
                                {t.label}
                            </button>
                        ))}
                    </nav>
                </div>
            </div>

            {status.kind === "conflict" && (
                <div className="border-b border-danger/30 bg-danger-soft">
                    <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                        <span>
                            <strong>{status.message}</strong>
                            {status.current.updatedBy ? ` Last saved by ${status.current.updatedBy}.` : ""} Your recent changes aren’t saved yet.
                        </span>
                        <span className="flex flex-wrap gap-2">
                            <button className="btn-secondary btn-sm" onClick={() => resolveConflict("theirs")}>
                                Load their version (drop mine)
                            </button>
                            <button className="btn-secondary btn-sm" onClick={downloadBackup}>
                                Download my version
                            </button>
                            <button className="btn-danger btn-sm" onClick={() => resolveConflict("mine")}>
                                Keep mine (replace theirs)
                            </button>
                        </span>
                    </div>
                </div>
            )}

            {status.kind === "error" && (
                <div className="border-b border-warn/30 bg-warn-soft">
                    <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                        <span>
                            <strong>Not saved yet:</strong> {status.message}
                            {mode === "cloud" && " Every change is also kept in this browser, so you can keep working."}
                        </span>
                        <button className="btn-secondary btn-sm" onClick={downloadBackup}>
                            Download backup
                        </button>
                    </div>
                </div>
            )}

            <div className="mx-auto max-w-6xl px-4 py-6">
                {tab === "schedule" && <ScheduleTab {...props} />}
                {tab === "teams" && <TeamsTab {...props} />}
                {tab === "brackets" && <BracketsTab {...props} />}
                {tab === "courts" && <CourtsTab {...props} />}
                {tab === "season" && <SeasonTab {...props} leagueId={rec.id} store={store} userKey={userKey} />}
            </div>
        </div>
    );
}

function SaveStatus({ status, mode }: { status: Status; mode: Mode }) {
    const where = mode === "cloud" ? "Saved" : "Saved in this browser";
    const map: Record<Status["kind"], [string, string]> = {
        saved: [where, "text-ok"],
        pending: ["Unsaved changes…", "text-muted"],
        saving: ["Saving…", "text-muted"],
        error: ["Not saved", "text-danger"],
        conflict: ["Not saved: changed elsewhere", "text-danger"],
    };
    const [text, cls] = map[status.kind];
    return (
        <span className={`text-sm font-semibold ${cls}`} role="status" title={status.kind === "error" ? status.message : undefined}>
            {text}
            {status.kind === "error" && <span className="ml-1 font-normal text-muted">({status.message})</span>}
        </span>
    );
}
