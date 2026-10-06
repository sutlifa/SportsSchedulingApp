import Link from "next/link";
import { auth, signOut } from "@/auth";
import { isCloudConfigured } from "@/lib/authConfig";
import { APP_NAME } from "@/lib/brand";
import HeaderNav from "./HeaderNav";
import SignOutButton from "./SignOutButton";

/**
 * Brand-blue bar with a scoreboard-yellow line under it. Its links (and the
 * phone menu) live in HeaderNav, a client component, since the menu toggles
 * and the current page is highlighted.
 *
 * Reads the session only when cloud mode is configured: calling auth()
 * without AUTH_SECRET throws, and an unconfigured deployment has no
 * sessions to show anyway.
 */
export default async function SiteHeader() {
    const cloud = isCloudConfigured();
    const session = cloud ? await auth() : null;
    const email = session?.user?.email ?? null;

    // Rendered here (not in HeaderNav) because its action is a server action.
    const signOutForm = (menu: boolean) => (
        <form
            action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
            }}
            className={`flex min-w-0 items-center gap-3 text-sm ${menu ? "justify-between" : ""}`}
        >
            <span className={menu ? "truncate text-muted" : "hidden max-w-48 truncate opacity-85 lg:inline"}>{email}</span>
            <SignOutButton menu={menu} />
        </form>
    );
    const signIn = (menu: boolean) => (
        <Link href="/signin" className={menu ? "block rounded-md px-3 py-2 font-semibold hover:bg-surface-2" : "rounded-md border border-white/40 px-2.5 py-1 text-sm font-semibold hover:bg-white/10"}>
            Sign in
        </Link>
    );
    const account = (menu: boolean) => (email ? signOutForm(menu) : cloud ? signIn(menu) : null);

    return (
        <header className="relative z-40 bg-accent text-accent-fg">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
                <Link href="/" className="flex min-w-0 items-baseline gap-2">
                    <span className="font-display text-2xl font-bold uppercase tracking-wide">{APP_NAME}</span>
                    <span className="hidden text-sm opacity-80 xl:inline">League & tournament scheduling</span>
                </Link>
                <HeaderNav account={account(false)} accountMenu={account(true)} />
            </div>
            {/* The accent line under the header. */}
            <div className="h-1 bg-ball" />
        </header>
    );
}
