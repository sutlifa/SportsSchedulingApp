/**
 * Shown in browser mode. Plain words about where data is going, because the
 * person typing in 40 teams needs to know before they start, not after a
 * cache clear. Lists the missing setting NAMES (never values) so whoever
 * deploys can fix it without reading code.
 */
export default function ModeNotice({ missing }: { missing: string[] }) {
    return (
        <div className="border-b border-warn/30 bg-warn-soft">
            <div className="mx-auto max-w-6xl px-4 py-3 text-sm text-fg">
                <strong className="font-semibold">Saved in this browser only.</strong> This site isn’t connected to its database yet, so
                leagues stay on this computer. Use <em>Season → Download backup</em> to keep a copy, and import it once the site is
                connected.
                {missing.length > 0 && (
                    <span className="mt-1 block text-xs text-muted">
                        Setup still needed on the server: {missing.join(", ")}.
                    </span>
                )}
            </div>
        </div>
    );
}
