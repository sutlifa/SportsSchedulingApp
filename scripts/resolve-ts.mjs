// scripts/resolve-ts.mjs
//
// A resolver hook for `node --experimental-strip-types`, needed by
// scripts/verify-db.ts and nothing else (copied from SongRank).
//
// lib/leagues.ts imports "./db", meaning lib/db.ts. Node's ESM resolver sees
// the lib/db/ DIRECTORY (schema.ts, ensure.ts) first and fails with
// ERR_UNSUPPORTED_DIR_IMPORT, and node won't add a missing ".ts" either.
// Next's bundler resolves both, which is why the app itself is fine and only
// a bare-node harness trips over it. The engine verify script imports only
// pure lib/engine files (which spell out ".ts"), so it doesn't need this.
//
// Used as:  node --experimental-strip-types --import ./scripts/register-ts.mjs ...
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

export async function resolve(specifier, context, next) {
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier) && context.parentURL) {
        const candidate = resolvePath(dirname(fileURLToPath(context.parentURL)), `${specifier}.ts`);
        if (existsSync(candidate)) return next(pathToFileURL(candidate).href, context);
    }
    return next(specifier, context);
}
