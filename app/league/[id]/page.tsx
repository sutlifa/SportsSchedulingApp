import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import ModeNotice from "@/components/ModeNotice";
import Workspace from "@/components/workspace/Workspace";
import { isCloudConfigured, missingCloudConfig } from "@/lib/authConfig";
import { errorRef } from "@/lib/guard";
import { getLeague, type LeagueRecord } from "@/lib/leagues";

export const metadata = { title: "League" };

export default async function LeaguePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ setup?: string }> }) {
    const { id } = await params;
    // ?setup=1 is where "New league" sends a blank league: the setup wizard.
    const setup = (await searchParams).setup === "1";

    if (!isCloudConfigured()) {
        // Browser mode: the league lives in localStorage, which only the
        // client can read -- Workspace loads it in an effect.
        return (
            <>
                <ModeNotice missing={missingCloudConfig()} />
                <Workspace mode="browser" id={id} initial={null} setup={setup} />
            </>
        );
    }

    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) redirect("/signin");

    let rec: LeagueRecord | null;
    try {
        rec = await getLeague(userId, id);
    } catch (err) {
        const ref = errorRef();
        console.error(`LEAGUE PAGE LOAD ERROR [ref ${ref}]:`, err);
        return (
            <div className="mx-auto max-w-2xl px-4 py-16">
                <h1 className="font-display text-3xl font-bold uppercase">Couldn’t load this league</h1>
                <p className="mt-2 text-muted">
                    The database didn’t answer. Reload the page in a minute. If it keeps happening, the database may be paused or over its usage limit:
                    go back to your leagues, where the backup copies saved in this browser can be downloaded.
                </p>
                <p className="mt-2 text-sm text-muted">Reference {ref}</p>
                <Link href="/" className="btn-primary mt-6">
                    Back to your leagues
                </Link>
            </div>
        );
    }
    if (!rec) notFound();
    return <Workspace mode="cloud" id={id} initial={rec} userKey={String(userId)} setup={setup} />;
}
