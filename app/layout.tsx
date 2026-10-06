import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import { Barlow_Condensed, IBM_Plex_Mono, Source_Sans_3 } from "next/font/google";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";

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
    title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
    description: `${APP_TAGLINE}: brackets, pools, facilities, ice/court/field time and every team’s requests.`,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" className={`${barlow.variable} ${source.variable} ${plex.variable}`}>
            <body className="flex min-h-screen flex-col">
                <SiteHeader />
                <main className="flex-1">{children}</main>
                <SiteFooter />
                <Analytics />
            </body>
        </html>
    );
}
