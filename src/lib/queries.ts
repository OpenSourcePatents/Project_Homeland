import "server-only";

import { cache } from "react";
import sanitizeHtml from "sanitize-html";
import { sql } from "@/lib/db";
import { identityKeyOf, sharesDob } from "@/lib/grouping";
import type {
  PublicSuspect,
  SuspectDetail,
  SuspectImage,
  SuspectCategory,
  LinkedRecord,
  PhysicalDescription,
} from "@/lib/public-suspect";

/**
 * THE OFFICIAL / ANALYTICAL WALL — enforced here, in code, not just in styling.
 *
 * Every public read of suspect records goes through this module, and each query
 * filters `WHERE data_class = 'official'`. The public surface is therefore
 * structurally incapable of returning analytical (inferred/OSINT) rows: the wall
 * fails closed.
 *
 * Server-only: this file imports `server-only` and the db client. Importing it
 * from a client component is a build-time error — DATABASE_URL never reaches the
 * browser bundle. Client components receive the RESULT as plain serializable
 * props (the list) or via the /api/suspect/[id] route (the detail).
 */

// ---- category derivation (server-side, once) --------------------------------

/**
 * Top-level category, derived LIVE from subjects[] + poster_classification —
 * no DB column, no migration. Priority order, first match wins; substring
 * matching is case-insensitive because the live data has variants
 * ("Kidnappings and Missing Persons", "Kidnappings/Missing Persons",
 * "Seeking Information - Terrorism", ...).
 *
 * Rationale: a record tagged both missing-person and anything else is a person
 * to LOCATE -> MISSING wins. Unidentified remains (ViCAP Unidentified) and
 * ECAP posters (Endangered Child Alert Program — UNKNOWN suspects the FBI is
 * asking the public to identify) are identification appeals -> SEEKING_INFO.
 * Everything else is WANTED.
 *
 * The "Parental Kidnapping" subject is deliberately NOT a MISSING trigger:
 * in the live data every record carrying it is the WANTED abductor parent
 * (poster 'default', "Unlawful Flight to Avoid Prosecution", some armed and
 * dangerous) — filing those under "MISSING · HELP LOCATE" would misstate the
 * official record and drop the do-not-approach framing. The abducted children
 * appear as separate "Kidnappings and Missing Persons" records, which the
 * missing-persons rule already catches.
 */
function deriveCategory(subjects: string[] | null, posterClassification: string | null): SuspectCategory {
  const subs = (subjects ?? []).map((s) => s.toLowerCase());
  const has = (needle: string) => subs.some((s) => s.includes(needle));
  if (has("missing persons") || posterClassification === "missing") {
    return "MISSING";
  }
  if (
    has("seeking information") ||
    has("vicap homicides and sexual assaults") ||
    has("vicap unidentified persons") ||
    posterClassification === "information" ||
    posterClassification === "ecap"
  ) {
    return "SEEKING_INFO";
  }
  return "WANTED";
}

// ---- public list -------------------------------------------------------------

export async function getPublicSuspects(): Promise<PublicSuspect[]> {
  const rows = await sql`
    SELECT
      id,
      fbi_uid,
      first_name,
      last_name,
      title,
      aliases,
      subjects,
      dates_of_birth_used,
      poster_classification,
      status,
      primary_state,
      resolved_state,
      state_source,
      warning_message,
      reward_text,
      image_url,
      source_url,
      data_class
    FROM suspect_profiles
    WHERE data_class = 'official'
    ORDER BY last_name ASC NULLS LAST, title ASC NULLS LAST, id ASC
  `;

  return (rows as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    fbi_uid: (r.fbi_uid as string) ?? null,
    first_name: (r.first_name as string) ?? null,
    last_name: (r.last_name as string) ?? null,
    title: (r.title as string) ?? null,
    aliases: (r.aliases as string[]) ?? null,
    subjects: (r.subjects as string[]) ?? null,
    dates_of_birth_used: (r.dates_of_birth_used as string[]) ?? null,
    category: deriveCategory((r.subjects as string[]) ?? null, (r.poster_classification as string) ?? null),
    status: r.status as PublicSuspect["status"],
    primary_state: (r.primary_state as string) ?? null,
    resolved_state: (r.resolved_state as string) ?? null,
    state_source: (r.state_source as PublicSuspect["state_source"]) ?? null,
    warning_message: (r.warning_message as string) ?? null,
    reward_text: (r.reward_text as string) ?? null,
    image_url: (r.image_url as string) ?? null,
    source_url: (r.source_url as string) ?? null,
    data_class: r.data_class as PublicSuspect["data_class"],
  }));
}

// ---- data freshness (header stamp) -------------------------------------------

/**
 * UTC ISO timestamp of the most recent successful FBI sync touch across the
 * OFFICIAL set — the header "DATA SYNCED" stamp. Null (rendered as an em dash)
 * on any failure; never a fabricated time.
 */
export async function getDataFreshness(): Promise<string | null> {
  try {
    const rows = await sql`
      SELECT max(last_seen_at) AS last_synced
      FROM suspect_profiles
      WHERE data_class = 'official'
    `;
    const v = (rows[0] as { last_synced: string | Date | null } | undefined)?.last_synced;
    return v ? new Date(v).toISOString() : null;
  } catch {
    return null;
  }
}

/** Aggregate counts on each side of the wall, for the /about page. No row data. */
export async function getWallCounts(): Promise<{ official: number; analytical: number } | null> {
  try {
    const rows = await sql`
      SELECT
        count(*) FILTER (WHERE data_class = 'official')   AS official,
        count(*) FILTER (WHERE data_class = 'analytical') AS analytical
      FROM suspect_profiles
    `;
    const r = rows[0] as { official: string | number; analytical: string | number } | undefined;
    if (!r) return null;
    return { official: Number(r.official), analytical: Number(r.analytical) };
  } catch {
    return null;
  }
}

// ---- detail (modal + permalink) ----------------------------------------------

/** Sanitize FBI narrative HTML: keep basic formatting + safe links, drop scripts,
 *  styles, event handlers, and unsafe URLs. Text (incl. "alleged"/"allegedly") is
 *  preserved verbatim — only markup is filtered. */
function cleanHtml(html: unknown): string | null {
  if (typeof html !== "string" || html.trim() === "") return null;
  const out = sanitizeHtml(html, {
    allowedTags: ["p", "br", "b", "strong", "i", "em", "u", "ul", "ol", "li", "a", "span", "blockquote"],
    allowedAttributes: { a: ["href", "target", "rel"] },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer", target: "_blank" }),
    },
  }).trim();
  return out || null;
}

function buildImages(raw: unknown): SuspectImage[] {
  if (!Array.isArray(raw)) return [];
  const out: SuspectImage[] = [];
  for (const img of raw) {
    if (!img || typeof img !== "object") continue;
    const o = img as Record<string, unknown>;
    const url = (o.original ?? o.large ?? o.thumb) as string | undefined;
    if (typeof url === "string" && url) {
      out.push({ url, caption: typeof o.caption === "string" ? o.caption : null });
    }
  }
  return out;
}

function isUnidentified(
  title: string | null,
  subjects: string[] | null,
  poster: string | null,
  firstName: string | null,
  lastName: string | null,
): boolean {
  const t = (title ?? "").toLowerCase();
  if (/\b(john doe|jane doe|unidentified|unknown (?:suspect|individual|male|female|person))\b/.test(t)) return true;
  if ((subjects ?? []).some((s) => /unidentified/i.test(s))) return true;
  if (poster === "ecap") return true; // Endangered Child Alert Program — unknown suspect
  // a "Main" person record with no name and a placeholder title is effectively unidentified
  if (!firstName && !lastName && /\b(unknown|unidentified|doe)\b/i.test(t)) return true;
  return false;
}

/**
 * Other OFFICIAL records for the same person: same normalized identity (name,
 * falling back to title — see grouping.ts) AND at least one shared exact DOB
 * value. The SQL prefilters by DOB overlap (small candidate set); the exact
 * identity + DOB rule is then applied in JS with the SAME shared functions the
 * client-side display grouping uses, so the two surfaces can never disagree.
 * Returns [] whenever the record is not eligible — never groups on doubt.
 */
async function getLinkedOfficialRecords(
  id: string,
  firstName: string | null,
  lastName: string | null,
  title: string | null,
  dobs: string[] | null,
): Promise<LinkedRecord[]> {
  const key = identityKeyOf(firstName, lastName, title);
  if (!key || !dobs?.length) return [];
  const rows = await sql`
    SELECT id, title, first_name, last_name, subjects, source_url, dates_of_birth_used
    FROM suspect_profiles
    WHERE data_class = 'official'
      AND id <> ${id}
      AND dates_of_birth_used && ${dobs}
  `;
  return (rows as Record<string, unknown>[])
    .filter(
      (row) =>
        identityKeyOf(
          (row.first_name as string) ?? null,
          (row.last_name as string) ?? null,
          (row.title as string) ?? null,
        ) === key && sharesDob(dobs, (row.dates_of_birth_used as string[]) ?? null),
    )
    .map((row) => ({
      id: row.id as string,
      title: (row.title as string) ?? null,
      subjects: (row.subjects as string[]) ?? null,
      source_url: (row.source_url as string) ?? null,
    }));
}

/**
 * Wall-enforced single-record detail for the modal, the /api route, and the
 * /suspect/[id] permalink. Returns null if the id is not an official record
 * (so analytical/nonexistent rows are indistinguishable — the wall holds at
 * the detail surface too). Wrapped in React cache() so generateMetadata and
 * the page render share one query per request.
 */
export const getPublicSuspectDetail = cache(async (id: string): Promise<SuspectDetail | null> => {
  const rows = await sql`
    SELECT
      id, fbi_uid, first_name, last_name, title, aliases, subjects,
      dates_of_birth_used, field_offices, status,
      primary_state, resolved_state, state_source, warning_message, reward_text,
      image_url, source_url, data_class, poster_classification, person_classification,
      physical_description,
      raw_payload->>'description' AS description,
      raw_payload->>'caution' AS caution,
      raw_payload->>'remarks' AS remarks,
      raw_payload->>'details' AS details,
      raw_payload->'images'   AS images
    FROM suspect_profiles
    WHERE id = ${id} AND data_class = 'official'
    LIMIT 1
  `;
  const r = rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;

  const also_listed = await getLinkedOfficialRecords(
    r.id as string,
    (r.first_name as string) ?? null,
    (r.last_name as string) ?? null,
    (r.title as string) ?? null,
    (r.dates_of_birth_used as string[]) ?? null,
  );

  return {
    id: r.id as string,
    fbi_uid: (r.fbi_uid as string) ?? null,
    first_name: (r.first_name as string) ?? null,
    last_name: (r.last_name as string) ?? null,
    title: (r.title as string) ?? null,
    aliases: (r.aliases as string[]) ?? null,
    subjects: (r.subjects as string[]) ?? null,
    dates_of_birth_used: (r.dates_of_birth_used as string[]) ?? null,
    field_offices: (r.field_offices as string[]) ?? null,
    category: deriveCategory((r.subjects as string[]) ?? null, (r.poster_classification as string) ?? null),
    description: (r.description as string) ?? null,
    status: r.status as SuspectDetail["status"],
    primary_state: (r.primary_state as string) ?? null,
    resolved_state: (r.resolved_state as string) ?? null,
    state_source: (r.state_source as SuspectDetail["state_source"]) ?? null,
    warning_message: (r.warning_message as string) ?? null,
    reward_text: (r.reward_text as string) ?? null,
    image_url: (r.image_url as string) ?? null,
    images: buildImages(r.images),
    source_url: (r.source_url as string) ?? null,
    data_class: r.data_class as SuspectDetail["data_class"],
    poster_classification: (r.poster_classification as string) ?? null,
    person_classification: (r.person_classification as string) ?? null,
    physical_description: (r.physical_description as PhysicalDescription) ?? null,
    caution_html: cleanHtml(r.caution),
    remarks_html: cleanHtml(r.remarks),
    details_html: cleanHtml(r.details),
    unidentified: isUnidentified(
      (r.title as string) ?? null,
      (r.subjects as string[]) ?? null,
      (r.poster_classification as string) ?? null,
      (r.first_name as string) ?? null,
      (r.last_name as string) ?? null,
    ),
    also_listed,
  };
});
