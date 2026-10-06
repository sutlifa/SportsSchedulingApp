import NextAuth, { type Session } from "next-auth";
import Google from "next-auth/providers/google";
import { upsertUser } from "./lib/users";
import { cleanEnv } from "./lib/authConfig";

/**
 * Google sign-in, JWT sessions, no Auth.js database adapter. Anyone with a
 * Google account can sign in and gets their own private leagues; during
 * testing, Google's consent-screen test-user list decides who that is.
 */
// Env values are cleaned (spaces, line breaks, quotes) by cleanEnv, shared
// with lib/authConfig.ts so "is sign-in configured?" and the provider agree.

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
            // Auth.js's default token also carries Google's `picture` URL.
            // /privacy promises that only the account's id, email and name
            // are kept, so the cookie holds exactly those (plus our users
            // row id) and nothing else. iat/exp/jti are re-stamped by
            // Auth.js when it encodes the token, so they needn't pass here.
            return { sub: token.sub, email: token.email, name: token.name, userId: token.userId };
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
