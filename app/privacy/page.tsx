import Link from "next/link";
import { APP_NAME } from "@/lib/brand";

export const metadata = { title: "Privacy" };

/*
 * Every statement here must stay true of the code. Check it when changing
 * auth.ts (what's kept from Google), lib/db/schema.ts (what's stored),
 * lib/client/store.ts (what's kept in the browser), the import dialog (files
 * are read in the browser) or the analytics in app/layout.tsx.
 */
function S({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="grid gap-2">
            <h2 className="font-display text-2xl font-bold uppercase tracking-wide">{title}</h2>
            {children}
        </section>
    );
}

export default function PrivacyPage() {
    return (
        <div className="mx-auto grid max-w-3xl gap-8 px-4 py-10 leading-relaxed [&_ul]:list-disc [&_ul]:pl-6">
            <header>
                <h1 className="font-display text-5xl font-bold uppercase tracking-wide">Privacy</h1>
                <p className="mt-2 text-muted">What {APP_NAME} keeps, where, and why, in plain words. Last updated October 2026.</p>
            </header>

            <S title="Signing in">
                <p>
                    Sign-in uses your Google account. From Google, {APP_NAME} keeps only your account’s ID number, email address and name, to know which
                    leagues are yours. It never sees your Google password and asks for no other Google data (no contacts, calendar or files).
                </p>
                <p>
                    A sign-in cookie keeps you signed in on that browser. Signing out removes it, along with this browser’s backup copies of your leagues
                    (see below).
                </p>
            </S>

            <S title="Your leagues">
                <ul>
                    <li>
                        Leagues you create while signed in are saved in the site’s database. Each league belongs to one account, and only that account can open
                        it.
                    </li>
                    <li>
                        A league holds what you type in: brackets, facilities and addresses, time slots, teams, clubs, coach or captain names and contact
                        details, rules and the schedule. Only add people’s contact details if you have their permission to keep them for scheduling.
                    </li>
                    <li>
                        <strong>Deleting a league</strong> removes it from your list and from every page, but the copy in the database isn’t erased straight
                        away. To have a deleted league or your account removed completely, ask the person who runs this site.
                    </li>
                </ul>
            </S>

            <S title="Kept in your browser">
                <ul>
                    <li>
                        To protect your work if the site can’t reach its database, every change to a league is also kept in your browser’s local storage, for
                        your account only. Signing out clears these copies.
                    </li>
                    <li>If the site isn’t connected to a database, leagues are saved only in your browser and never leave your computer.</li>
                    <li>Backups you download are ordinary files on your computer. {APP_NAME} keeps no copy of them.</li>
                </ul>
            </S>

            <S title="Spreadsheets you upload">
                <p>
                    Facility spreadsheets (.xlsx, .csv or pasted cells) are read inside your browser. The file itself is never sent anywhere. Only the dates,
                    times and courts, sheets or fields you choose to import are saved, as part of the league.
                </p>
            </S>

            <S title="Other services">
                <ul>
                    <li>
                        The site is hosted on Vercel, which keeps standard server logs (such as IP addresses and the pages requested) to run and protect the
                        service. Vercel Web Analytics counts page visits without cookies and without identifying you.
                    </li>
                    <li>The database is hosted by Neon.</li>
                    <li>
                        “Find on Google Maps” and map pins are plain links. Nothing is sent to Google Maps unless you click one, and then Google’s own privacy
                        policy applies.
                    </li>
                    <li>{APP_NAME} shows no ads and does not sell or share your data.</li>
                </ul>
            </S>

            <p className="text-sm text-muted">
                Questions about how the app works? See the{" "}
                <Link href="/guide" className="underline">
                    guide
                </Link>{" "}
                or{" "}
                <Link href="/about" className="underline">
                    About
                </Link>
                .
            </p>
        </div>
    );
}
