import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { isCloudConfigured } from "@/lib/authConfig";

export const metadata = { title: "Sign in" };

/**
 * Auth.js sends people here with ?error=<code>. Say what happened and what
 * to do, and show the code so it can be looked up in the guide. Errors shown
 * on Google's own pages (invalid_client, redirect_uri_mismatch, "app not
 * verified") never reach here -- the guide's troubleshooting covers those.
 */
const ERRORS: Record<string, string> = {
    // While the Google consent screen is in "Testing", only its listed test
    // users can sign in; everyone else lands here with AccessDenied.
    AccessDenied: "That Google account isn’t allowed to sign in yet. While the app is in testing, the site owner adds each account as a test user in Google Cloud.",
    Configuration: "Sign-in isn’t set up correctly on the server: the Google client ID/secret or AUTH_SECRET is wrong, or the database couldn’t save your account. Try again in a minute; if it keeps happening, the site owner should check the server settings.",
    Verification: "That sign-in link expired or was already used. Start again below.",
    OAuthSignin: "Couldn’t start sign-in with Google. Try again; if it keeps happening, the Google client ID may be wrong.",
    OAuthCallback: "Google sent you back, but the sign-in couldn’t be completed. Try again.",
    OAuthCallbackError: "Google sent you back with an error, often because the sign-in was cancelled. Try again.",
    OAuthAccountNotLinked: "That email is linked to a different sign-in. Use the same Google account as before.",
    Callback: "Sign-in couldn’t be completed. Try again.",
    SessionRequired: "Please sign in to see that page.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    if (!isCloudConfigured()) {
        // Not an error: this deployment simply runs in browser mode.
        redirect("/");
    }
    const session = await auth();
    if (session?.user?.id) redirect("/");

    const params = await searchParams;
    const code = typeof params.error === "string" ? params.error : null;
    const message = code ? (ERRORS[code] ?? "Sign-in didn’t work. Try again.") : null;
    const guideLink = (
        <Link href="/guide#errors-sign-in" className="underline">
            sign-in troubleshooting
        </Link>
    );

    return (
        <div className="mx-auto max-w-md px-4 py-16">
            <h1 className="font-display text-4xl font-bold uppercase tracking-wide">Sign in</h1>
            <p className="mt-2 text-muted">Sign in to save your leagues and open them from any device. Your leagues are private to your account.</p>
            <p className="mt-2 text-sm text-muted">
                New to Courtside?{" "}
                <Link href="/guide" className="font-semibold text-accent underline">
                    Read the guide and tutorial
                </Link>{" "}
                first. It works without signing in.
            </p>
            {message && (
                <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm">
                    <p>{message}</p>
                    <p className="mt-1 text-xs text-muted">
                        Error code: {code}. See {guideLink} in the guide.
                    </p>
                </div>
            )}
            <form
                className="mt-6"
                action={async () => {
                    "use server";
                    await signIn("google", { redirectTo: "/" });
                }}
            >
                <button className="btn-primary w-full">Continue with Google</button>
            </form>
        </div>
    );
}
