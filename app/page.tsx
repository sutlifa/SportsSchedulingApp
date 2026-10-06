import { redirect } from "next/navigation";
import { auth } from "@/auth";
import LeagueList from "@/components/LeagueList";
import ModeNotice from "@/components/ModeNotice";
import { isCloudConfigured, missingCloudConfig } from "@/lib/authConfig";
import { errorRef } from "@/lib/guard";
import { listLeagues, type LeagueSummary } from "@/lib/leagues";

export default async function Home() {
    if (!isCloudConfigured()) {
        return (
            <>
                <ModeNotice missing={missingCloudConfig()} />
                <LeagueList mode="browser" initial={null} loadError={null} />
            </>
        );
    }

    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) redirect("/signin");

    let leagues: LeagueSummary[] | null = null;
    let loadError: string | null = null;
    try {
        leagues = await listLeagues(userId);
    } catch (err) {
        const ref = errorRef();
        console.error(`HOME LIST LEAGUES ERROR [ref ${ref}]:`, err);
        loadError = `Couldn’t reach the database just now, so your leagues can’t be listed. Reload in a minute. If it keeps happening, the database may be paused or over its usage limit; your backup copies below still work. (Reference ${ref})`;
    }
    return <LeagueList mode="cloud" initial={leagues} loadError={loadError} userKey={String(userId)} />;
}
