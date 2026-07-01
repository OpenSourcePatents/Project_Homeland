import "server-only";

/**
 * DHS National Terrorism Advisory System (NTAS) — live status for the header
 * banner. Replaces the previous hardcoded "NATIONAL ADVISORY · ELEVATED"
 * design chrome with the real feed.
 *
 * Feed: https://www.dhs.gov/ntas/1.1/feed.xml (verified live 2026-07-01;
 * HTTP 200, empty <alerts/> = the normal no-active-advisories state).
 * Schema per the official DHS NTAS API docs: root <alerts> with zero or more
 * <alert start=".." end=".." type=".." link=".."> children; timestamps
 * "YYYY/MM/DD HH:MM" in GMT; <summary> is CDATA. A "lite" variant carries
 * only start/end/href.
 *
 * ANTI-FABRICATION RULES (the failure mode this module replaces):
 *   - Never render a level that didn't come from the live feed.
 *   - An alert past its end is expired even if still present in the feed.
 *   - Any fetch or parse ambiguity -> "unavailable", never a made-up status.
 *
 * Fetched with Next's data cache (revalidate hourly) so DHS is hit at most
 * ~once an hour, never per pageload.
 */

export type NtasStatus =
  | { state: "none" }
  | { state: "active"; kind: string; summary: string; link: string }
  | { state: "unavailable" };

export const NTAS_FEED_URL = "https://www.dhs.gov/ntas/1.1/feed.xml";
export const NTAS_PUBLIC_URL = "https://www.dhs.gov/national-terrorism-advisory-system";

const USER_AGENT = "ProjectHomeland/1.0 (+https://github.com/OpenSourcePatents/Project_Homeland)";

// "YYYY/MM/DD HH:MM" in GMT -> epoch ms, or null if malformed.
function parseGmt(ts: string | undefined): number | null {
  if (!ts) return null;
  const m = ts.trim().match(/^(\d{4})\/(\d{2})\/(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const ms = Date.UTC(+y, +mo - 1, +d, +h, +mi);
  return Number.isFinite(ms) ? ms : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// CDATA/HTML summary -> single-line plain text, clipped to ~90 chars.
function plainSnippet(raw: string, max = 90): string {
  const text = decodeEntities(
    raw
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

function attrsOf(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) {
    out[m[1].toLowerCase()] = decodeEntities(m[2]);
  }
  return out;
}

const SEVERITY: Record<string, number> = { imminent: 3, elevated: 2, bulletin: 1 };
function severityOf(kind: string): number {
  const k = kind.toLowerCase();
  for (const key of Object.keys(SEVERITY)) if (k.includes(key)) return SEVERITY[key];
  return 0;
}

/**
 * Parse the NTAS feed XML into a status. Exported for the parser to be
 * exercised directly; throws on structural ambiguity so the caller maps any
 * doubt to "unavailable" (never to a fabricated calm or fabricated alert).
 */
export function parseNtasFeed(xml: string, nowMs: number): NtasStatus {
  if (!/<alerts[\s>/]/i.test(xml)) {
    throw new Error("NTAS feed missing <alerts> root");
  }

  // Iterate opening tags (an "[^>]*" body cannot cross the tag close, so each
  // match is exactly one tag). The lite variant's self-closing <alert/> carries
  // no body; a full <alert> owns everything up to its own </alert>. Matching
  // whole blocks in one regex would let a self-closing alert swallow the next
  // full alert via backtracking — this two-step walk cannot.
  const openTags = [...xml.matchAll(/<alert\b[^>]*>/gi)];
  const active: { kind: string; summary: string; link: string; severity: number }[] = [];

  for (const m of openTags) {
    const openTag = m[0];
    const attrs = attrsOf(openTag);
    const selfClosing = /\/\s*>$/.test(openTag);
    let body = "";
    if (!selfClosing) {
      const bodyStart = (m.index ?? 0) + openTag.length;
      const close = xml.indexOf("</alert>", bodyStart);
      if (close === -1) throw new Error("NTAS alert missing closing tag");
      body = xml.slice(bodyStart, close);
    }

    const start = parseGmt(attrs.start);
    const end = parseGmt(attrs.end);
    // An alert whose active window can't be established is a parse ambiguity —
    // dropping it could fabricate calm, keeping it could fabricate an alert.
    if (start === null || end === null) {
      throw new Error("NTAS alert with unparseable start/end window");
    }
    if (nowMs < start || nowMs > end) continue; // expired or not yet active

    const kind = (attrs.type ?? "").trim() || "ACTIVE ADVISORY"; // lite variant has no type
    const rawLink = (attrs.link ?? attrs.href ?? "").trim();
    const link = rawLink
      ? rawLink.startsWith("http")
        ? rawLink
        : `https://www.dhs.gov${rawLink.startsWith("/") ? "" : "/"}${rawLink}`
      : NTAS_PUBLIC_URL;

    const summaryMatch = body.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
    const summary = summaryMatch ? plainSnippet(summaryMatch[1]) : "";

    active.push({ kind, summary, link, severity: severityOf(kind) });
  }

  if (active.length === 0) return { state: "none" };
  active.sort((a, b) => b.severity - a.severity);
  const top = active[0];
  return { state: "active", kind: top.kind, summary: top.summary, link: top.link };
}

const FETCH_TIMEOUT_MS = 6000;

/**
 * Fetch + parse the live NTAS status. Never throws — every failure path
 * returns { state: "unavailable" } so the banner degrades honestly.
 *
 * Raced against a timeout (rather than an AbortSignal, which can interfere
 * with the Next data cache): a hung DHS connection must not block the
 * homepage render; the in-flight fetch may still complete later and warm the
 * hourly cache for the next request.
 */
export async function getNtasStatus(): Promise<NtasStatus> {
  try {
    const fetched = (async (): Promise<NtasStatus> => {
      const res = await fetch(NTAS_FEED_URL, {
        headers: { "User-Agent": USER_AGENT },
        next: { revalidate: 3600 },
      });
      if (!res.ok) return { state: "unavailable" };
      const xml = await res.text();
      return parseNtasFeed(xml, Date.now());
    })();
    // if the timeout wins the race, the eventual settle must not surface as
    // an unhandled rejection
    fetched.catch(() => {});
    const timedOut = new Promise<NtasStatus>((resolve) => {
      const t = setTimeout(() => resolve({ state: "unavailable" }), FETCH_TIMEOUT_MS);
      (t as { unref?: () => void }).unref?.();
    });
    return await Promise.race([fetched, timedOut]);
  } catch {
    return { state: "unavailable" };
  }
}
