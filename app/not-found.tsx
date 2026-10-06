import Link from "next/link";

export const metadata = { title: "Not found" };

export default function NotFound() {
    return (
        <div className="mx-auto max-w-2xl px-4 py-16">
            <h1 className="font-display text-4xl font-bold uppercase tracking-wide">Not found</h1>
            <p className="mt-3 text-muted">
                There’s nothing at this address. If you followed a link to a league, it may have been deleted, or it belongs to a different Google account than
                the one you’re signed in with. Leagues are private to the account that made them.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
                <Link href="/" className="btn-primary">
                    Your leagues
                </Link>
                <Link href="/guide" className="btn-secondary">
                    Guide
                </Link>
            </div>
        </div>
    );
}
