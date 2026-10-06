import Link from "next/link";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { SPORT_IDS, SPORTS } from "@/lib/engine/sports";

export const metadata = { title: "About" };

export default function AboutPage() {
    return (
        <div className="mx-auto grid max-w-3xl gap-6 px-4 py-10 leading-relaxed">
            <h1 className="font-display text-5xl font-bold uppercase tracking-wide">About {APP_NAME}</h1>
            <p className="text-lg text-muted">{APP_TAGLINE}.</p>
            <p>
                {APP_NAME} builds a whole season’s schedule for a youth or adult league, or a tournament’s pool play, from the things a scheduler actually has
                to juggle: age brackets and pools, several facilities with their own sheets, fields or courts, weekly time slots and the exact availability a
                facility sends over, and every team’s requests (“never more than once a weekend”, “not at the same time as our other team”, “no games
                over spring break”).
            </p>
            <p>
                It guarantees each team its number of games against its own pool, never breaks a rule you mark as a must, spreads each team’s games across the
                season, and keeps one club’s teams from all being on at once. Anything it can’t fit is listed with the reason and what to change. You can then
                move and lock games by hand and export the schedule for coaches and captains.
            </p>
            <h2 className="font-display text-2xl font-bold uppercase tracking-wide">Any sport</h2>
            <p>Each league picks its sport, and the app uses that sport’s words throughout:</p>
            <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[30rem] text-sm">
                    <thead className="bg-surface-2 text-left">
                        <tr>
                            <th className="label px-3 py-2">Sport</th>
                            <th className="label px-3 py-2">Booked time</th>
                            <th className="label px-3 py-2">Playing areas</th>
                            <th className="label px-3 py-2">Plays</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {SPORT_IDS.map((id) => {
                            const t = SPORTS[id];
                            return (
                                <tr key={id}>
                                    <td className="px-3 py-1.5 font-semibold">{t.name}</td>
                                    <td className="px-3 py-1.5">{t.time}</td>
                                    <td className="px-3 py-1.5">
                                        {t.units} ({t.unitLabel(0)}, {t.unitLabel(1)}…)
                                    </td>
                                    <td className="px-3 py-1.5">{t.matches}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <h2 className="font-display text-2xl font-bold uppercase tracking-wide">Get started</h2>
            <p>
                The{" "}
                <Link href="/guide" className="font-semibold text-accent underline">
                    guide
                </Link>{" "}
                walks through building a complete league step by step in the sport you choose, with a sample facility spreadsheet. Or go to{" "}
                <Link href="/" className="font-semibold text-accent underline">
                    your leagues
                </Link>{" "}
                and start from the example league.
            </p>
            <p className="text-sm text-muted">
                Questions about your data? See{" "}
                <Link href="/privacy" className="underline">
                    Privacy
                </Link>
                .
            </p>
        </div>
    );
}
