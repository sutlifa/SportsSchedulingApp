import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import ModeNotice from "@/components/ModeNotice";
import Workspace from "@/components/workspace/Workspace";
import { isCloudConfigured, missingCloudConfig } from "@/lib/authConfig";
import { getLeague, type LeagueRecord } from "@/lib/leagues";

export const metadata = { title: "League" };

export default async function LeaguePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    if (!isCloudConfigured()) {
        // Browser mode: the league lives in localStorage, which only the
        // client can read -- Workspace loads it in an effect.
        return (
            <>
                <ModeNotice missing={missingCloudConfig()} />
                <Workspace mode="browser" id={id} initial={null} />
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
        console.error("LEAGUE PAGE LOAD ERROR:", err);
        return (
            <div className="mx-auto max-w-2xl px-4 py-16">
                <h1 className="font-display text-3xl font-bold uppercase">Couldn’t load this league</h1>
                <p className="mt-2 text-muted">The database didn’t answer. Reload the page in a moment.</p>
            </div>
        );
    }
    if (!rec) notFound();
    return <Workspace mode="cloud" id={id} initial={rec} userKey={String(userId)} />;
}
