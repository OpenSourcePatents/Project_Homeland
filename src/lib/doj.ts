import "server-only";

/**
 * DOJ ENFORCEMENT WIRE — most recent US Department of Justice press releases,
 * republished verbatim as plain-text headlines linking out to justice.gov.
 * Display-only official data, same trust model as the NTAS module: no DB
 * storage, no sync job, server-side fetch with caching, honest degradation.
 *
 * API (verified live 2026-07-03 against https://www.justice.gov/developer):
 *   GET https://www.justice.gov/api/v1/press_releases.json
 *     ?pagesize=10&sort=date&direction=DESC
 * Response: { metadata: { resultset: { count, pagesize, page } }, results: [...] }
 * Each result: title (plain text), date (epoch SECONDS as a string), url
 * (absolute justice.gov link), component (array of {uuid, name} — may be "" or
 * absent), teaser/body (HTML — unused here), created/changed (HTML <time>
 * markup strings), number, uuid. Default sort is OLDEST-first; sort=date&
 * direction=DESC returns newest-first (re-sorted here anyway, belt and braces).
 *
 * ANTI-FABRICATION RULES (same discipline as ntas.ts):
 *   - Headlines display exactly as DOJ published them (HTML stripped, entities
 *     decoded) — no rewording, no summarization.
 *   - A malformed item is skipped; zero valid items -> "unavailable" (an empty
 *     wire would fabricate the claim that DOJ published nothing).
 *   - Any fetch/parse failure -> "unavailable"; the wire never breaks the page.
 *   - Links are only ever emitted if they point at https://www.justice.gov/.
 */

export interface DojWireItem {
  /** Verbatim DOJ headline, HTML stripped. */
  title: string;
  /** Publication date as ISO 8601 (from the API's epoch-seconds `date`). */
  dateISO: string;
  /** Absolute justice.gov link to the release. */
  url: string;
  /** Lead DOJ component (e.g. "Criminal Division"), when present. */
  component?: string;
}

export type DojWire = { state: "ok"; items: DojWireItem[] } | { state: "unavailable" };

const DOJ_API_URL =
  "https://www.justice.gov/api/v1/press_releases.json?pagesize=10&sort=date&direction=DESC";

const USER_AGENT = "ProjectHomeland/1.0 (+https://github.com/OpenSourcePatents/Project_Homeland)";
const FETCH_TIMEOUT_MS = 6000;

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** HTML/markup -> single-line plain text. Words stay verbatim. */
function plainText(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function componentOf(raw: unknown): string | undefined {
  // Drupal serializes "no components" as "" — only arrays carry real values
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const first = raw[0] as Record<string, unknown>;
  const name = typeof first?.name === "string" ? plainText(first.name) : "";
  return name || undefined;
}

/**
 * Parse the API payload into a wire. Exported so the parser can be exercised
 * directly. Malformed items are skipped; an unusable payload throws so the
 * caller maps it to "unavailable".
 */
export function parseDojWire(payload: unknown): DojWire {
  const results = (payload as { results?: unknown })?.results;
  if (!Array.isArray(results)) throw new Error("DOJ payload missing results array");

  const items: DojWireItem[] = [];
  for (const raw of results) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;

    const title = typeof r.title === "string" ? plainText(r.title) : "";
    const url = typeof r.url === "string" ? r.url.trim() : "";
    const epochSec = Number(r.date);
    if (!title || !Number.isFinite(epochSec) || epochSec <= 0) continue;
    // never emit a link that doesn't point at DOJ itself
    if (!url.startsWith("https://www.justice.gov/")) continue;

    items.push({
      title,
      dateISO: new Date(epochSec * 1000).toISOString(),
      url,
      component: componentOf(r.component),
    });
  }

  if (items.length === 0) return { state: "unavailable" };
  items.sort((a, b) => (a.dateISO < b.dateISO ? 1 : a.dateISO > b.dateISO ? -1 : 0));
  return { state: "ok", items };
}

/**
 * Fetch + parse the live wire. Never throws — every failure path returns
 * { state: "unavailable" } so the panel degrades independently of the page.
 * Raced against a timeout (not an AbortSignal, which can interfere with the
 * Next data cache): a hung justice.gov connection must not block the render;
 * the in-flight fetch may still complete later and warm the 30-min cache.
 */
export async function getDojWire(): Promise<DojWire> {
  try {
    const fetched = (async (): Promise<DojWire> => {
      const res = await fetch(DOJ_API_URL, {
        headers: { "User-Agent": USER_AGENT },
        next: { revalidate: 1800 },
      });
      if (!res.ok) return { state: "unavailable" };
      return parseDojWire(await res.json());
    })();
    // if the timeout wins the race, the eventual settle must not surface as
    // an unhandled rejection
    fetched.catch(() => {});
    const timedOut = new Promise<DojWire>((resolve) => {
      const t = setTimeout(() => resolve({ state: "unavailable" }), FETCH_TIMEOUT_MS);
      (t as { unref?: () => void }).unref?.();
    });
    return await Promise.race([fetched, timedOut]);
  } catch {
    return { state: "unavailable" };
  }
}
