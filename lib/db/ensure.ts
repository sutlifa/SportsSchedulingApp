import { sql } from "../db";
import { SCHEMA_SQL } from "./schema";

/**
 * Creates the tables on first use, once per server instance.
 *
 * This app's database comes from Vercel's Neon integration and its owner
 * never has to open a terminal, so a fresh, empty database must just work.
 * SCHEMA_SQL is idempotent (CREATE ... IF NOT EXISTS), so one round trip per
 * cold start can't damage anything. A failure is NOT cached: the next
 * request tries again instead of the instance staying broken until recycled.
 */
let ready: Promise<void> | null = null;
export function ensureSchema(): Promise<void> {
    if (!ready) {
        ready = sql
            .unsafe(SCHEMA_SQL)
            .then(() => undefined)
            .catch((err) => {
                ready = null;
                throw err;
            });
    }
    return ready;
}
