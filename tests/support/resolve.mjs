// tests/support/resolve.mjs
//
// Resolver hook so `node --test --experimental-strip-types` can load the
// parts of the app that are written for Next's bundler rather than for bare
// node. Registered by tests/support/register.mjs (`--import`).
//
//  - "@/x"            -> <repo>/x(.ts|.tsx|/index.ts), the tsconfig `paths` alias
//                        that lib/client/*, lib/guard.ts and the API routes use.
//  - "@/auth"         -> tests/support/fake-auth.ts. The real auth.ts builds
//                        NextAuth with Google at import time; the route tests
//                        only need "who is signed in", which the fake reads from
//                        globalThis.__TEST_SESSION__. This is the ONE module the
//                        tests replace -- the guard, the routes, sanitize and
//                        (in tests/db) lib/leagues.ts all run for real.
//  - "./db" etc.      -> "./db.ts": node won't add a missing ".ts", and sees the
//                        lib/db/ directory first (see scripts/resolve-ts.mjs).
//  - "next/server"    -> "next/server.js": the next package has no `exports`
//                        map, so ESM needs the file name spelled out.
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolvePath(here, "..", "..");

function firstFile(base) {
    for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
        if (existsSync(c) && statSync(c).isFile()) return c;
    }
    return null;
}

export async function resolve(specifier, context, next) {
    if (specifier === "@/auth") return next(pathToFileURL(resolvePath(here, "fake-auth.ts")).href, context);
    if (specifier.startsWith("@/")) {
        const file = firstFile(resolvePath(root, specifier.slice(2)));
        if (file) return next(pathToFileURL(file).href, context);
    }
    if (specifier === "next/server") return next("next/server.js", context);
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier) && context.parentURL) {
        const candidate = resolvePath(dirname(fileURLToPath(context.parentURL)), `${specifier}.ts`);
        if (existsSync(candidate)) return next(pathToFileURL(candidate).href, context);
    }
    return next(specifier, context);
}
