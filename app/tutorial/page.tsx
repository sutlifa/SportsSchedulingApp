import TutorialContent from "@/components/guide/TutorialContent";
import { APP_NAME } from "@/lib/brand";

export const metadata = {
    title: "Tutorial",
    description: `Build a complete league or tournament in ${APP_NAME}, step by step, in your sport, with a sample facility spreadsheet.`,
};

/*
 * Follows a sport picker (shared with /guide), so it's a client component.
 * The sample files it links to live in public/tutorial/ and are served at
 * /tutorial/<sport>-april-2027.xlsx alongside this page.
 * scripts/e2e/tutorial.mjs walks it word for word in every sport.
 */
export default function TutorialPage() {
    return <TutorialContent />;
}
