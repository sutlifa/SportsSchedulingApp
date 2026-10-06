/**
 * Just enough "browser" for lib/client/store.ts under node: an in-memory
 * localStorage on `window`, which can be told to fail the way real storage
 * does (quota exceeded on write, SecurityError on any access when site data
 * is blocked), and a scripted `fetch`.
 */
export class MemoryStorage {
    private map = new Map<string, string>();
    /** "full": setItem throws (quota). "blocked": every access throws. */
    mode: "ok" | "full" | "blocked" = "ok";

    private guard(write: boolean) {
        if (this.mode === "blocked") throw new DOMException("The operation is insecure.", "SecurityError");
        if (write && this.mode === "full") throw new DOMException("Quota exceeded", "QuotaExceededError");
    }
    get length(): number {
        this.guard(false);
        return this.map.size;
    }
    key(i: number): string | null {
        this.guard(false);
        return [...this.map.keys()][i] ?? null;
    }
    getItem(k: string): string | null {
        this.guard(false);
        return this.map.has(k) ? this.map.get(k)! : null;
    }
    setItem(k: string, v: string): void {
        this.guard(true);
        this.map.set(k, String(v));
    }
    removeItem(k: string): void {
        this.guard(false);
        this.map.delete(k);
    }
    clear(): void {
        this.guard(true);
        this.map.clear();
    }
    /** Test-side view of the raw contents, never throws. */
    keys(): string[] {
        return [...this.map.keys()];
    }
    raw(k: string): string | undefined {
        return this.map.get(k);
    }
}

/** Installs a fresh `window.localStorage` and returns it. */
export function installWindow(): MemoryStorage {
    const storage = new MemoryStorage();
    Object.defineProperty(globalThis, "window", { value: { localStorage: storage }, configurable: true, writable: true });
    return storage;
}

export type Call = { url: string; init: RequestInit | undefined };

/**
 * Replaces global fetch with a script: each call takes the next reply. A
 * reply is a Response, or an Error to throw (a network failure).
 */
export function scriptFetch(...replies: (Response | Error)[]): Call[] {
    const calls: Call[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        const next = replies.shift();
        if (!next) throw new Error(`unexpected fetch ${String(url)}`);
        if (next instanceof Error) throw next;
        return next;
    }) as typeof fetch;
    return calls;
}

export const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
export const text = (status: number, body = "") => new Response(body, { status });
