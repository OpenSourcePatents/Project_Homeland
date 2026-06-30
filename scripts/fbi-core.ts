/**
 * Shared FBI Wanted ingestion core.
 *
 * Extracted from the proven single-page importer so the daily full-sync
 * (sync-fbi.ts) and the single-page importer (import-fbi.ts) share ONE copy of
 * the load-bearing logic: the FBI API shape, the helpers, and — crucially — the
 * upsert that stamps data_class='official', source_type='fbi_api', the verbatim
 * raw_payload, and the field-office→state resolution. Do not fork this logic.
 *
 * Schema note (002 applied): suspect_profiles now has last_seen_at and the status
 * CHECK allows 'surrendered','resolved','removed_from_fbi'. The upsert here always
 * stamps last_seen_at = now() (the record was seen in THIS pull) and passes the
 * widened status vocabulary through. 'removed_from_fbi' is an INTERNAL state set
 * only by vanished-detection — it is never produced by mapStatus().
 */
import type { NeonQueryFunction } from '@neondatabase/serverless';
import { resolveFieldOfficeState } from '@/lib/fbi-field-offices';

/** The neon HTTP client type, as exported by src/lib/db.ts (`neon(connStr)`). */
export type Sql = NeonQueryFunction<false, false>;

export const API_BASE = 'https://api.fbi.gov/wanted/v1/list';
// The FBI API 403s default fetchers; a descriptive User-Agent is required.
export const USER_AGENT =
  'ProjectHomeland/0.1 (FBI Wanted importer; +https://github.com/OpenSourcePatents/Project_Homeland)';
export const FETCH_TIMEOUT_MS = 30_000;

// suspect_profiles.status values that may come FROM the FBI API. Widened by 002 to
// pass through 'surrendered' and 'resolved' (previously flattened to 'na').
// 'removed_from_fbi' is intentionally NOT here — it is set only by vanished-detection.
export const VALID_STATUSES = new Set([
  'na',
  'captured',
  'deceased',
  'recovered',
  'surrendered',
  'resolved',
]);

// ---- FBI API shape (every field is nullable on any given record) ------------
export interface FbiImage {
  original?: string | null;
  large?: string | null;
  thumb?: string | null;
  caption?: string | null;
}

export interface FbiItem {
  uid?: string | null;
  title?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  aliases?: string[] | null;
  dates_of_birth_used?: string[] | null;
  subjects?: string[] | null;
  field_offices?: string[] | null;
  reward_text?: string | null;
  warning_message?: string | null;
  status?: string | null;
  person_classification?: string | null;
  poster_classification?: string | null;
  images?: FbiImage[] | null;
  url?: string | null;
  weight?: string | null;
  hair?: string | null;
  eyes?: string | null;
  scars_and_marks?: string | null;
  race?: string | null;
  height_min?: number | null;
  height_max?: number | null;
  build?: string | null;
  complexion?: string | null;
  // Verbatim preservation: keep every other key the API sends.
  [key: string]: unknown;
}

export interface FbiListResponse {
  total?: number;
  page?: number;
  items?: FbiItem[];
}

// ---- Helpers ----------------------------------------------------------------

/** Null-safe array: keep arrays as-is (incl. empty); everything else -> null. */
export function asArray(v: unknown): string[] | null {
  return Array.isArray(v) ? (v as string[]) : null;
}

/** images[0].original, falling back to .large; null-safe. */
export function pickImageUrl(item: FbiItem): string | null {
  const img = item.images?.[0];
  if (!img) return null;
  return img.original ?? img.large ?? null;
}

/** Consolidate physical attributes into a JSONB object (or null if none). */
export function buildPhysicalDescription(item: FbiItem): Record<string, unknown> | null {
  const candidates: Record<string, unknown> = {
    weight: item.weight,
    hair: item.hair,
    eyes: item.eyes,
    scars_and_marks: item.scars_and_marks,
    race: item.race,
    height_min: item.height_min,
    height_max: item.height_max,
    build: item.build,
    complexion: item.complexion,
  };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(candidates)) {
    if (v !== null && v !== undefined && v !== '') out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Map FBI status into our (widened) CHECK vocab; record anything unexpected. */
export function mapStatus(raw: string | null | undefined, unmapped: Map<string, number>): string {
  if (!raw) return 'na';
  const s = String(raw).toLowerCase().trim();
  if (VALID_STATUSES.has(s)) return s;
  unmapped.set(s, (unmapped.get(s) ?? 0) + 1);
  return 'na';
}

/** Fetch one page of the FBI Wanted list. Throws on non-OK / timeout. */
export async function fetchPage(page: number, pageSize: number): Promise<FbiListResponse> {
  const url = `${API_BASE}?page=${page}&pageSize=${pageSize}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`FBI API returned HTTP ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as FbiListResponse;
  } finally {
    clearTimeout(timer);
  }
}

export interface UpsertResult {
  inserted: boolean; // true on INSERT, false on ON CONFLICT DO UPDATE
  changed: boolean; // for updates: did the verbatim raw_payload actually differ?
  status: string; // the mapped status written (post-widening)
  primaryState: string | null;
}

/**
 * The authoritative upsert. Identical column set / ON CONFLICT semantics to the
 * original tested importer, with two additions enabled by 002:
 *   - last_seen_at = now()  (stamped on BOTH insert and update paths)
 *   - a CTE that compares the pre-update raw_payload to the new one so callers can
 *     distinguish "updated" (FBI data changed) from "unchanged" (only last_seen
 *     refreshed). The two WITH branches share one snapshot, so `prev` sees the OLD
 *     row while `up` writes the new one.
 *
 * Caller MUST guarantee item.uid is non-null (the ON CONFLICT key); null-uid
 * records have no conflict key and are skipped upstream.
 */
export async function upsertActor(
  sql: Sql,
  item: FbiItem,
  unmapped: Map<string, number>,
): Promise<UpsertResult> {
  const fieldOffices = asArray(item.field_offices);
  const primaryState =
    fieldOffices && fieldOffices.length > 0 ? resolveFieldOfficeState(fieldOffices[0]) : null;

  const aliases = asArray(item.aliases);
  const datesOfBirthUsed = asArray(item.dates_of_birth_used);
  const subjects = asArray(item.subjects);
  const status = mapStatus(item.status, unmapped);
  const imageUrl = pickImageUrl(item);
  const physical = buildPhysicalDescription(item);
  const physicalParam = physical ? JSON.stringify(physical) : null;
  const rawParam = JSON.stringify(item); // entire verbatim item -> raw_payload

  const rows = await sql`
    WITH prev AS (
      SELECT raw_payload FROM suspect_profiles WHERE fbi_uid = ${item.uid}
    ),
    up AS (
      INSERT INTO suspect_profiles (
        fbi_uid, first_name, last_name, title,
        aliases, dates_of_birth_used, subjects, field_offices,
        physical_description,
        reward_text, warning_message, status,
        person_classification, poster_classification, primary_state,
        image_url, source_link,
        source_type, data_class, source_url, last_verified_at, last_seen_at,
        raw_payload, created_at, updated_at
      ) VALUES (
        ${item.uid}, ${item.first_name ?? null}, ${item.last_name ?? null}, ${item.title ?? null},
        ${aliases}::text[], ${datesOfBirthUsed}::text[], ${subjects}::text[], ${fieldOffices}::text[],
        ${physicalParam}::jsonb,
        ${item.reward_text ?? null}, ${item.warning_message ?? null}, ${status},
        ${item.person_classification ?? null}, ${item.poster_classification ?? null}, ${primaryState},
        ${imageUrl}, ${item.url ?? null},
        'fbi_api', 'official', ${item.url ?? null}, now(), now(),
        ${rawParam}::jsonb, now(), now()
      )
      ON CONFLICT (fbi_uid) DO UPDATE SET
        first_name            = EXCLUDED.first_name,
        last_name             = EXCLUDED.last_name,
        title                 = EXCLUDED.title,
        aliases               = EXCLUDED.aliases,
        dates_of_birth_used   = EXCLUDED.dates_of_birth_used,
        subjects              = EXCLUDED.subjects,
        field_offices         = EXCLUDED.field_offices,
        physical_description  = EXCLUDED.physical_description,
        reward_text           = EXCLUDED.reward_text,
        warning_message       = EXCLUDED.warning_message,
        status                = EXCLUDED.status,
        person_classification = EXCLUDED.person_classification,
        poster_classification = EXCLUDED.poster_classification,
        primary_state         = EXCLUDED.primary_state,
        image_url             = EXCLUDED.image_url,
        source_link           = EXCLUDED.source_link,
        source_type           = EXCLUDED.source_type,
        data_class            = EXCLUDED.data_class,
        source_url            = EXCLUDED.source_url,
        last_verified_at      = EXCLUDED.last_verified_at,
        last_seen_at          = EXCLUDED.last_seen_at,
        raw_payload           = EXCLUDED.raw_payload,
        updated_at            = now()
      RETURNING (xmax = '0'::xid) AS inserted, raw_payload
    )
    SELECT
      up.inserted,
      ((SELECT raw_payload FROM prev) IS DISTINCT FROM up.raw_payload) AS changed
    FROM up
  `;

  const row = rows[0] as { inserted: boolean | string; changed: boolean | string } | undefined;
  const truthy = (v: boolean | string | undefined) => v === true || v === 't' || v === 'true';
  return { inserted: truthy(row?.inserted), changed: truthy(row?.changed), status, primaryState };
}
