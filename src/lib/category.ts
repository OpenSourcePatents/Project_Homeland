import type { SuspectCategory } from "@/lib/public-suspect";

/**
 * Presentational metadata for the three top-level record categories.
 *
 * The category VALUE is derived once, server-side, in the query layer
 * (deriveCategory in queries.ts) and shipped on every record — client code
 * only ever reads `record.category` and looks up its treatment here. This
 * module is pure constants: no db import, safe for client components.
 */
export const CATEGORY_META: Record<
  SuspectCategory,
  { label: string; accent: string; action: string; actionSub: string }
> = {
  WANTED: {
    label: "WANTED",
    accent: "#ff5667",
    action: "REPORT A SIGHTING",
    actionSub: "If you see this person, do not approach — report to the FBI.",
  },
  MISSING: {
    label: "MISSING",
    accent: "#f3c25a",
    action: "HELP LOCATE",
    actionSub: "Any detail may help bring a missing person home.",
  },
  SEEKING_INFO: {
    label: "SEEKING INFO",
    accent: "#5fe6ff",
    action: "SHARE WHAT YOU KNOW",
    actionSub: "The FBI is asking the public for information on this case.",
  },
};

export const CATEGORY_ORDER: SuspectCategory[] = ["WANTED", "MISSING", "SEEKING_INFO"];
