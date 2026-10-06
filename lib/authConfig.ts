/**
 * Which mode this deployment runs in. Plain env reads only (no `postgres`
 * import), so calling these never drags database code into a page.
 *
 * CLOUD mode needs a database, Google credentials and a session secret --
 * all four, together:
 *
 *  - Database without sign-in would have no way to tell whose leagues are
 *    whose. There is no shared/public mode.
 *  - Sign-in without a database authenticates someone into saves with
 *    nowhere to go (sign-in itself writes a users row).
 *
 * Anyone with a Google account can sign in; each account sees only its own
 * leagues. Who can sign in at all while testing is controlled on Google's
 * side (the OAuth consent screen's test-user list), not here.
 *
 * Anything short of the full set runs in BROWSER mode: the app is fully
 * usable, leagues live in this browser's storage, and a banner says so in
 * plain words. Browser leagues are offered for upload once cloud mode is on.
 */
/**
 * An env value as it is meant, or undefined. Values pasted into a dashboard
 * often pick up a trailing space, a line break or surrounding quotes; Google
 * then rejects the client id as unknown ("Error 401: invalid_client"), which
 * looks like a wrong id when the id is right. auth.ts and lib/db.ts read
 * their values through this too, so a whitespace-only value is "missing"
 * here AND there -- it can't switch on cloud mode with a blank credential.
 */
export function cleanEnv(v: string | undefined): string | undefined {
    const t = v?.trim().replace(/^["']|["']$/g, "").trim();
    return t || undefined;
}

export function isCloudConfigured(): boolean {
    return missingCloudConfig().length === 0;
}

/** Which settings are missing, for the setup notice. Names only, never values. */
export function missingCloudConfig(): string[] {
    const missing: string[] = [];
    const env = (k: string) => cleanEnv(process.env[k]);
    if (!env("DATABASE_URL") && !env("POSTGRES_URL")) missing.push("DATABASE_URL");
    if (!env("AUTH_SECRET")) missing.push("AUTH_SECRET");
    if (!env("AUTH_GOOGLE_ID")) missing.push("AUTH_GOOGLE_ID");
    if (!env("AUTH_GOOGLE_SECRET")) missing.push("AUTH_GOOGLE_SECRET");
    return missing;
}
