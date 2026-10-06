import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { isCloudConfigured, missingCloudConfig } from "../../lib/authConfig.ts";

const VARS = ["DATABASE_URL", "POSTGRES_URL", "AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"] as const;
const FULL = { DATABASE_URL: "postgres://u:p@host-pooler/db", AUTH_SECRET: "secret", AUTH_GOOGLE_ID: "id.apps.googleusercontent.com", AUTH_GOOGLE_SECRET: "gsecret" };

let saved: Record<string, string | undefined> = {};
beforeEach(() => {
    saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
    for (const k of VARS) delete process.env[k];
});
afterEach(() => {
    for (const k of VARS) if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
});
const set = (env: Partial<Record<(typeof VARS)[number], string>>) => Object.assign(process.env, env);

describe("isCloudConfigured / missingCloudConfig", () => {
    test("zero env vars: browser mode, all four named, in a stable order", () => {
        assert.equal(isCloudConfigured(), false);
        assert.deepEqual(missingCloudConfig(), ["DATABASE_URL", "AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"]);
    });

    test("all four: cloud mode", () => {
        set(FULL);
        assert.equal(isCloudConfigured(), true);
        assert.deepEqual(missingCloudConfig(), []);
    });

    for (const k of ["DATABASE_URL", "AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"] as const) {
        test(`missing only ${k}: browser mode, and exactly that one is named`, () => {
            set(FULL);
            delete process.env[k];
            assert.equal(isCloudConfigured(), false);
            assert.deepEqual(missingCloudConfig(), [k]);
        });
        test(`${k} set to "" counts as missing`, () => {
            set({ ...FULL, [k]: "" });
            assert.deepEqual(missingCloudConfig(), [k]);
        });
    }

    test("POSTGRES_URL stands in for DATABASE_URL (Vercel integrations use either name)", () => {
        set({ ...FULL, POSTGRES_URL: "postgres://u:p@host/db" });
        delete process.env.DATABASE_URL;
        assert.equal(isCloudConfigured(), true);
    });

    test("names only, never values", () => {
        set({ AUTH_SECRET: "super-secret-value" });
        assert.ok(!missingCloudConfig().join(" ").includes("super-secret-value"));
    });

    test(
        "a whitespace-only value counts as missing",
        { todo: "BUG: missingCloudConfig tests truthiness (lib/authConfig.ts:28-31), so AUTH_GOOGLE_ID=\"  \" counts as set and the site turns on cloud mode -- while auth.ts's cleanEnv() trims the same value to undefined, so Google sign-in then fails" },
        () => {
            for (const k of ["DATABASE_URL", "AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"] as const) {
                set({ ...FULL, [k]: "   " });
                assert.deepEqual(missingCloudConfig(), [k], k);
                set(FULL);
            }
        }
    );
});
