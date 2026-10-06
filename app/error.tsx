"use client";

import Link from "next/link";
/**
 * Shown when a page crashes in the browser. Says what happened in plain
 * words, offers the two things that usually fix it, and shows Next's error
 * digest -- the same id printed in the server log for server-side errors --
 * so a screenshot is enough to find the cause.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    return (
        <div className="mx-auto max-w-2xl px-4 py-16">
            <h1 className="font-display text-4xl font-bold uppercase tracking-wide">Something went wrong</h1>
            <p className="mt-3">This page hit an error it couldn’t recover from. Your saved leagues are safe.</p>
            <ul className="mt-3 list-disc pl-5 text-muted">
                <li>Press “Try again”. Most errors are a dropped connection.</li>
                <li>If you were editing a league in the cloud, a copy of every change is also kept in this browser (see “Backup copies” on the home page).</li>
                <li>If it keeps happening, send the details below to whoever runs the site.</li>
            </ul>
            <div className="mt-6 flex flex-wrap gap-2">
                <button className="btn-primary" onClick={() => reset()}>
                    Try again
                </button>
                <Link className="btn-secondary" href="/">
                    Back to your leagues
                </Link>
                <Link className="btn-ghost" href="/guide#errors">
                    Error guide
                </Link>
            </div>
            <p className="mt-6 rounded-lg bg-surface-2 p-3 font-mono text-xs text-muted">
                {error.message || "Unknown error"}
                {error.digest ? ` · Reference ${error.digest}` : ""}
            </p>
        </div>
    );
}
