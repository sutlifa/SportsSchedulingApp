import Link from "next/link";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";

/*
 * The copyright year is written out, not computed: `new Date()` would bake
 * one year in at build time on the server and read another in the browser
 * around New Year, which React reports as a hydration mismatch.
 */
const YEAR = 2026;

export default function SiteFooter() {
    return (
        <footer className="mt-10 border-t border-border bg-surface">
            <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 text-sm sm:grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))]">
                <div className="min-w-0">
                    <div className="font-display text-xl font-bold uppercase tracking-wide">{APP_NAME}</div>
                    <p className="mt-1 text-muted">{APP_TAGLINE}. Brackets, pools, facilities and every team’s requests, turned into a full season.</p>
                </div>
                <nav aria-label="Help">
                    <div className="label">Help</div>
                    <ul className="grid gap-1">
                        <li>
                            <Link href="/guide" className="hover:underline">
                                Guide
                            </Link>
                        </li>
                        <li>
                            <Link href="/tutorial" className="hover:underline">
                                Tutorial
                            </Link>
                        </li>
                        <li>
                            <Link href="/guide#errors" className="hover:underline">
                                Errors and fixes
                            </Link>
                        </li>
                        <li>
                            <Link href="/guide#faq" className="hover:underline">
                                Questions
                            </Link>
                        </li>
                    </ul>
                </nav>
                <nav aria-label="About">
                    <div className="label">About</div>
                    <ul className="grid gap-1">
                        <li>
                            <Link href="/about" className="hover:underline">
                                About {APP_NAME}
                            </Link>
                        </li>
                        <li>
                            <Link href="/privacy" className="hover:underline">
                                Privacy
                            </Link>
                        </li>
                        <li>
                            <Link href="/" className="hover:underline">
                                Your leagues
                            </Link>
                        </li>
                        <li>
                            <Link href="/new" className="hover:underline">
                                New league or tournament
                            </Link>
                        </li>
                    </ul>
                </nav>
            </div>
            <div className="border-t border-border px-4 py-3 text-center text-xs text-muted">
                © {YEAR} {APP_NAME}. Scheduling help only: always confirm times with your facility.
            </div>
        </footer>
    );
}
