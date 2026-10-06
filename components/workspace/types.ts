import type { Mode } from "@/lib/client/store";
import type { Audit } from "@/lib/engine/engine";
import type { NameLookup } from "@/lib/engine/rules";
import type { League, Schedule } from "@/lib/engine/types";

export type Doc = { name: string; data: League; schedule: Schedule };
export type Tab = "schedule" | "teams" | "brackets" | "courts" | "season";

export type TabProps = {
    doc: Doc;
    /** Every edit goes through here; it marks the league dirty for autosave. */
    change: (fn: (d: Doc) => Doc) => void;
    /** The schedule re-checked against the current rules. Derived, never stored. */
    result: Audit;
    lookup: NameLookup;
    goTo: (t: Tab) => void;
    mode: Mode;
};

/** Small helper: replace one field of `data`. */
export const withData = (d: Doc, patch: Partial<League>): Doc => ({ ...d, data: { ...d.data, ...patch } });
