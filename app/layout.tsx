import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import { Barlow_Condensed, IBM_Plex_Mono, Source_Sans_3 } from "next/font/google";
import SiteHeader from "@/components/SiteHeader";

const barlow = Barlow_Condensed({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-barlow", display: "swap" });
const source = Source_Sans_3({ subsets: ["latin"], weight: ["400", "600", "700"], variable: "--font-source", display: "swap" });
const plex = IBM_Plex_Mono({ subsets: ["latin"], weight: ["500"], variable: "--font-plex", display: "swap" });

export const viewport = {
    themeColor: [
        { media: "(prefers-color-scheme: light)", color: "#1d5a8a" },
        { media: "(prefers-color-scheme: dark)", color: "#0e161d" },
    ],
};

export const metadata = {
    title: { default: "Courtside", template: "%s · Courtside" },
    description: "Tennis league scheduling: brackets, pools, courts, time slots and every team’s custom rules.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" className={`${barlow.variable} ${source.variable} ${plex.variable}`}>
            <body className="flex min-h-screen flex-col">
                <SiteHeader />
                <main className="flex-1">{children}</main>
                <footer className="px-4 py-6 text-center text-xs text-muted">Courtside · tennis league scheduling</footer>
                <Analytics />
            </body>
        </html>
    );
}
