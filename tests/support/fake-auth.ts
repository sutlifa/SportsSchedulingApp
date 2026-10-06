/**
 * Stand-in for the repo's auth.ts (NextAuth + Google), swapped in for "@/auth"
 * by tests/support/resolve.mjs. Tests set who is signed in with setSession().
 *
 * Only `auth()` is used by lib/guard.ts; the other exports exist so a module
 * that imports them still links.
 */
type FakeSession = { user?: { id?: number; email?: string; name?: string } } | null;

declare global {
    var __TEST_SESSION__: FakeSession | undefined;
}

export function setSession(s: FakeSession): void {
    globalThis.__TEST_SESSION__ = s;
}

export async function auth(): Promise<FakeSession> {
    return globalThis.__TEST_SESSION__ ?? null;
}

export const handlers = {
    GET: async () => new Response(null, { status: 404 }),
    POST: async () => new Response(null, { status: 404 }),
};
export async function signIn(): Promise<void> {}
export async function signOut(): Promise<void> {}
