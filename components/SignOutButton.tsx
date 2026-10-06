"use client";

import { clearAllMirrors } from "@/lib/client/store";

/**
 * Submits the header's sign-out form, clearing this browser's backup copies
 * of cloud leagues first: on a shared computer the next person must not find
 * the last person's leagues (and captain contacts) in local storage.
 * `menu` is the phone menu's styling (dark text on a light panel).
 */
export default function SignOutButton({ menu = false }: { menu?: boolean }) {
    return (
        <button
            onClick={() => clearAllMirrors()}
            className={menu ? "btn-secondary btn-sm shrink-0" : "rounded-md border border-white/40 px-2.5 py-1 font-semibold hover:bg-white/10"}
        >
            Sign out
        </button>
    );
}
