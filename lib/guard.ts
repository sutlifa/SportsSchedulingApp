import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isCloudConfigured } from "./authConfig";

/** League JSON is capped well above any real league (1000 teams, 10k matches). */
export const MAX_BODY_BYTES = 3_000_000;

export type Guarded = { userId: number } | { response: NextResponse };

/** Every /api/leagues route starts here. Each user only ever reaches their own leagues. */
export async function requireUser(): Promise<Guarded> {
    if (!isCloudConfigured()) {
        return { response: NextResponse.json({ error: "Saving to the cloud isn’t set up on this site yet." }, { status: 503 }) };
    }
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return { response: NextResponse.json({ error: "Please sign in again." }, { status: 401 }) };
    return { userId };
}

export function isGuardFailure(g: Guarded): g is { response: NextResponse } {
    return "response" in g;
}

/** Reads a JSON body with a size cap. Returns a ready response on failure. */
export async function readJson(req: Request): Promise<{ body: unknown } | { response: NextResponse }> {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) {
        return { response: NextResponse.json({ error: "This league is too large to save." }, { status: 413 }) };
    }
    try {
        return { body: JSON.parse(text) };
    } catch {
        return { response: NextResponse.json({ error: "That request wasn’t valid." }, { status: 400 }) };
    }
}

export function cleanName(v: unknown): string | null {
    if (typeof v !== "string") return null;
    const s = v.trim().slice(0, 120);
    return s || null;
}

/**
 * A short code shown to the person AND written next to the server log line,
 * so "it said Reference K7Q2XD" finds the exact error in Vercel's logs
 * without ever showing a stack trace or a column name to the user.
 */
export function errorRef(): string {
    return Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, "0");
}

/** Logs `err` under an UPPERCASE label with a reference code, returns a 500 the person can read. */
export function serverError(label: string, err: unknown, message: string): NextResponse {
    const ref = errorRef();
    console.error(`${label} [ref ${ref}]:`, err);
    return NextResponse.json({ error: `${message} (Reference ${ref})`, ref }, { status: 500 });
}
