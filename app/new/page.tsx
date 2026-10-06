import { redirect } from "next/navigation";
import { auth } from "@/auth";
import ModeNotice from "@/components/ModeNotice";
import NewLeague from "@/components/NewLeague";
import { isCloudConfigured, missingCloudConfig } from "@/lib/authConfig";

export const metadata = { title: "New league or tournament" };

export default async function NewLeaguePage() {
    if (!isCloudConfigured()) {
        return (
            <>
                <ModeNotice missing={missingCloudConfig()} />
                <NewLeague mode="browser" />
            </>
        );
    }
    // Same guard as the home page: in cloud mode a league belongs to an
    // account, so creating one needs a session first.
    const session = await auth();
    if (!session?.user?.id) redirect("/signin");
    return <NewLeague mode="cloud" />;
}
