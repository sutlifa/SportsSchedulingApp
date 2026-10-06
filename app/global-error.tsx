"use client";

import { APP_NAME } from "@/lib/brand";

/**
 * Last-resort screen when the root layout itself fails, so it can't use the
 * app's stylesheet or fonts: plain inline styles that read in either theme.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    return (
        <html lang="en">
            <body style={{ fontFamily: "system-ui, sans-serif", padding: "48px 16px", maxWidth: 640, margin: "0 auto", background: "#f2f5f3", color: "#142027" }}>
                <h1 style={{ fontSize: 28 }}>{APP_NAME} hit an error</h1>
                <p>The site couldn’t load. Your saved leagues are safe. Try again, or come back in a few minutes.</p>
                <button onClick={() => reset()} style={{ padding: "8px 14px", fontWeight: 600, background: "#1d5a8a", color: "#fff", border: 0, borderRadius: 8 }}>
                    Try again
                </button>
                <p style={{ marginTop: 24, fontFamily: "monospace", fontSize: 12, color: "#56656d" }}>
                    {error.message || "Unknown error"}
                    {error.digest ? ` · Reference ${error.digest}` : ""}
                </p>
            </body>
        </html>
    );
}
