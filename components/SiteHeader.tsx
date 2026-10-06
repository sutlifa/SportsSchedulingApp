import Link from "next/link";
import { auth, signOut } from "@/auth";
import { isCloudConfigured } from "@/lib/authConfig";
import SignOutButton from "./SignOutButton";

/**
 * Court-blue bar with an optic-yellow baseline under it.
 *
 * Reads the session only when cloud mode is configured: calling auth()
 * without AUTH_SECRET throws, and an unconfigured deployment has no
 * sessions to show anyway.
 */
export default async function SiteHeader() {
    const cloud = isCloudConfigured();
    const session = cloud ? await auth() : null;
    const email = session?.user?.email ?? null;

    return (
        <header className="bg-accent text-accent-fg">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
                <Link href="/" className="flex items-baseline gap-2">
                    <span className="font-display text-2xl font-bold uppercase tracking-wide">Courtside</span>
                    <span className="hidden text-sm opacity-80 sm:inline">League scheduling</span>
                </Link>
                <div className="flex min-w-0 items-center gap-3">
                <Link href="/guide" className="rounded-md px-2 py-1 text-sm font-semibold hover:bg-white/10">
                    Guide
                </Link>
                {email && (
                    <form
                        action={async () => {
                            "use server";
                            await signOut({ redirectTo: "/" });
                        }}
                        className="flex min-w-0 items-center gap-3 text-sm"
                    >
                        <span className="hidden truncate opacity-85 sm:inline">{email}</span>
                        <SignOutButton />
                    </form>
                )}
                </div>
            </div>
            {/* The baseline: a court line, in ball yellow. */}
            <div className="h-1 bg-ball" />
        </header>
    );
}
