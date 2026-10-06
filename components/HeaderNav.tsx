"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Item = { href: string; label: string; primary?: boolean };

/** In the bar on wide screens. */
const BAR: Item[] = [
    { href: "/new", label: "New league", primary: true },
    { href: "/", label: "Your leagues" },
    { href: "/guide", label: "Guide" },
    { href: "/tutorial", label: "Tutorial" },
    { href: "/about", label: "About" },
];

/** In the menu on phones: everything, since the footer is a long scroll away. */
const MENU: { heading: string; items: Item[] }[] = [
    {
        heading: "Leagues & tournaments",
        items: [
            { href: "/new", label: "New league or tournament", primary: true },
            { href: "/", label: "Your leagues & tournaments" },
        ],
    },
    {
        heading: "Help",
        items: [
            { href: "/guide", label: "Guide" },
            { href: "/tutorial", label: "Step-by-step tutorial" },
            { href: "/guide#errors", label: "Errors and fixes" },
            { href: "/guide#faq", label: "Questions" },
        ],
    },
    {
        heading: "About",
        items: [
            { href: "/about", label: "About" },
            { href: "/privacy", label: "Privacy" },
        ],
    },
];

/**
 * The header's links: a title bar on wide screens, a menu button on phones.
 *
 * `account` is server-rendered (the email and the sign-out form, whose action
 * is a server action), passed through as a slot because a client component
 * can't define one. It's rendered twice, once per layout, and CSS shows one.
 */
export default function HeaderNav({ account, accountMenu }: { account: React.ReactNode; accountMenu: React.ReactNode }) {
    const path = usePathname();
    const [open, setOpen] = useState(false);
    const menu = useRef<HTMLDivElement>(null);
    const toggle = useRef<HTMLButtonElement>(null);

    // Escape, or a tap anywhere outside, closes the menu, as people expect of
    // anything that pops open. The Menu button is left out of "outside": its
    // own click toggles, and closing here too would reopen it at once.
    useEffect(() => {
        if (!open) return;
        const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
        const tap = (e: PointerEvent) => {
            const at = e.target as Node | null;
            if (at && !menu.current?.contains(at) && !toggle.current?.contains(at)) setOpen(false);
        };
        window.addEventListener("keydown", key);
        document.addEventListener("pointerdown", tap);
        return () => {
            window.removeEventListener("keydown", key);
            document.removeEventListener("pointerdown", tap);
        };
    }, [open]);

    // Hash links (Errors and fixes, Questions: sections of /guide) never
    // count as "here", so only Guide lights up on /guide.
    const here = (href: string) => !href.includes("#") && (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
    const close = () => setOpen(false);

    return (
        <>
            <nav aria-label="Site" className="hidden min-w-0 items-center gap-1 md:flex">
                {BAR.map((x) => (
                    <Link
                        key={x.href}
                        href={x.href}
                        aria-current={here(x.href) ? "page" : undefined}
                        className={
                            x.primary
                                ? "mr-1 rounded-md bg-ball px-3 py-1.5 text-sm font-bold text-[#142027] hover:brightness-95"
                                : `rounded-md px-2.5 py-1.5 text-sm font-semibold hover:bg-white/10 ${here(x.href) ? "bg-white/15" : ""}`
                        }
                    >
                        {x.label}
                    </Link>
                ))}
                <div className="ml-2 flex min-w-0 items-center">{account}</div>
            </nav>

            <button
                ref={toggle}
                className="rounded-md border border-white/40 px-3 py-1.5 text-sm font-semibold hover:bg-white/10 md:hidden"
                aria-expanded={open}
                aria-controls="site-menu"
                onClick={() => setOpen((o) => !o)}
            >
                <span aria-hidden className="mr-1.5 inline-block">
                    {open ? "✕" : "☰"}
                </span>
                Menu
            </button>

            {open && (
                <div ref={menu} id="site-menu" className="absolute inset-x-0 top-full z-50 border-b border-border bg-surface text-fg shadow-lg md:hidden">
                    <nav aria-label="Site menu" className="mx-auto grid max-w-6xl gap-4 px-4 py-4">
                        {MENU.map((g) => (
                            <div key={g.heading}>
                                <div className="label">{g.heading}</div>
                                <ul className="grid gap-1">
                                    {g.items.map((x) => (
                                        <li key={x.href}>
                                            <Link
                                                href={x.href}
                                                onClick={close}
                                                aria-current={here(x.href) ? "page" : undefined}
                                                className={`block rounded-md px-3 py-2 font-semibold ${x.primary ? "bg-accent text-accent-fg" : here(x.href) ? "bg-accent-soft" : "hover:bg-surface-2"}`}
                                            >
                                                {x.label}
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                        {accountMenu && <div className="border-t border-border pt-3">{accountMenu}</div>}
                    </nav>
                </div>
            )}
        </>
    );
}
