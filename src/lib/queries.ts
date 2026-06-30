import "server-only";

import sanitizeHtml from "sanitize-html";
import { sql } from "@/lib/db";
import type {
  PublicSuspect,
  SuspectDetail,
  SuspectImage,
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

  return rows as unknown as PublicSuspect[];
}

// ---- detail (modal) ---------------------------------------------------------

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
 * Wall-enforced single-record detail for the modal. Returns null if the id is not
 * an official record (so analytical/nonexistent rows are indistinguishable — the
 * wall holds at the detail surface too).
 */
export async function getPublicSuspectDetail(id: string): Promise<SuspectDetail | null> {
  const rows = await sql`
    SELECT
      id, fbi_uid, first_name, last_name, title, aliases, subjects, status,
      primary_state, resolved_state, state_source, warning_message, reward_text,
      image_url, source_url, data_class, poster_classification, person_classification,
      physical_description,
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

  return {
    id: r.id as string,
    fbi_uid: (r.fbi_uid as string) ?? null,
    first_name: (r.first_name as string) ?? null,
    last_name: (r.last_name as string) ?? null,
    title: (r.title as string) ?? null,
    aliases: (r.aliases as string[]) ?? null,
    subjects: (r.subjects as string[]) ?? null,
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
  };
}
