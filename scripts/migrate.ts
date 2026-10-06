// Applies lib/db/schema.ts against DATABASE_URL:
//
//     DATABASE_URL=... npm run db:migrate
//
// Optional -- the app also applies the same idempotent SQL on its first
// request (see ensureSchema in lib/leagues.ts). Useful to check a connection
// string works before deploying.
import { sql } from "../lib/db.ts";
import { SCHEMA_SQL } from "../lib/db/schema.ts";

async function main() {
    await sql.unsafe(SCHEMA_SQL);
    console.log("Schema applied.");
    await sql.end();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
