import { sql, hasDatabase } from "./db";
import { ensureSchema } from "./db/ensure";

/** Called on every Google sign-in; returns our numeric user id. */
export async function upsertUser(user: { googleId: string; email: string; name: string | null }): Promise<number> {
    // Defence in depth behind isCloudConfigured(), which already hides
    // sign-in without a database: turn an opaque connection error deep in an
    // Auth.js callback into a log line naming the real cause.
    if (!hasDatabase) throw new Error("upsertUser called with no DATABASE_URL set -- sign-in should be disabled (see lib/authConfig.ts).");
    await ensureSchema();
    const rows = await sql<{ id: number }[]>`
        INSERT INTO users (google_id, email, name)
        VALUES (${user.googleId}, ${user.email}, ${user.name})
        ON CONFLICT (google_id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name
        RETURNING id
    `;
    return rows[0].id;
}
