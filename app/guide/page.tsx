import GuideContent from "@/components/guide/GuideContent";
import { APP_NAME } from "@/lib/brand";

export const metadata = {
    title: "Guide",
    description: `How ${APP_NAME} works, a step-by-step tutorial for building a league or tournament in your sport, and what every error means.`,
};

/*
 * The guide follows a sport picker (ice time and sheets for hockey, field
 * time for soccer...), so it's a client component. scripts/e2e/tutorial.mjs
 * walks the tutorial word for word in several sports.
 */
export default function GuidePage() {
    return <GuideContent />;
}
