"use client";

import { useState } from "react";

/** A block of text to paste into the app, with a Copy button. */
export default function CopyBlock({ text, label = "Copy" }: { text: string; label?: string }) {
    const [copied, setCopied] = useState<"yes" | "no" | null>(null);
    return (
        <div className="relative my-3 min-w-0">
            <pre className="overflow-x-auto rounded-lg border border-border bg-surface-2 p-3 pr-20 font-mono text-[13px] leading-relaxed">{text}</pre>
            <button
                type="button"
                className="btn-secondary btn-sm absolute right-2 top-2"
                onClick={async () => {
                    try {
                        await navigator.clipboard.writeText(text);
                        setCopied("yes");
                    } catch {
                        setCopied("no");
                    }
                    setTimeout(() => setCopied(null), 2000);
                }}
            >
                {copied === "yes" ? "Copied" : copied === "no" ? "Select & copy" : label}
            </button>
        </div>
    );
}
