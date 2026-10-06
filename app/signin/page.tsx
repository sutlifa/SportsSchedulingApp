import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { isCloudConfigured } from "@/lib/authConfig";

export const metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
    // While the Google consent screen is in "Testing", only its listed test
    // users can sign in; everyone else lands here with AccessDenied.
    AccessDenied: "That Google account can’t sign in to this site yet. Ask the site owner to add it as a tester.",
    Configuration: "Sign-in isn’t fully set up on the server yet.",
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

    return (
        <div className="mx-auto max-w-md px-4 py-16">
            <h1 className="font-display text-4xl font-bold uppercase tracking-wide">Sign in</h1>
            <p className="mt-2 text-muted">Sign in to save your leagues and open them from any device. Your leagues are private to your account.</p>
            {message && <p className="mt-4 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm">{message}</p>}
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
