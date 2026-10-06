import NextAuth, { type Session } from "next-auth";
import Google from "next-auth/providers/google";
import { upsertUser } from "./lib/users";

/**
 * Google sign-in, JWT sessions, no Auth.js database adapter. Anyone with a
 * Google account can sign in and gets their own private leagues; during
 * testing, Google's consent-screen test-user list decides who that is.
 */
/**
 * Env values pasted into a dashboard often pick up a trailing space, a line
 * break or surrounding quotes. Google then rejects the client id as unknown
 * ("Error 401: invalid_client -- The OAuth client was not found"), which
 * looks like a wrong id when the id is actually right. Strip all of that
 * before handing the values to the provider.
 */
function cleanEnv(v: string | undefined): string | undefined {
    const t = v?.trim().replace(/^["']|["']$/g, "").trim();
    return t || undefined;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
    providers: [
        Google({
            clientId: cleanEnv(process.env.AUTH_GOOGLE_ID),
            clientSecret: cleanEnv(process.env.AUTH_GOOGLE_SECRET),
            // Show the account picker every time. Without it Google silently
            // re-uses whichever account the browser is signed into, which on a
            // shared computer is often the wrong one.
            authorization: { params: { prompt: "select_account" } },
        }),
    ],
    session: { strategy: "jwt" },
    callbacks: {
        async jwt({ token, profile }) {
            // `profile` is only present on an actual sign-in, so this writes
            // the users row once per login, not on every request.
            if (profile?.sub && profile.email) {
                token.userId = await upsertUser({ googleId: profile.sub, email: profile.email, name: profile.name ?? null });
            }
            return token;
        },
        // Auth.js v5 types this callback for both session strategies; with
        // JWT only, the adapter-session branch of that union never happens,
        // hence the cast.
        async session({ session, token }): Promise<Session> {
            return { ...session, user: { ...session.user, id: token.userId } } as unknown as Session;
        },
    },
    pages: { signIn: "/signin", error: "/signin" },
});
