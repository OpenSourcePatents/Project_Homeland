/**
 * FBI Wanted ingestion importer — TEST SCOPE (page 1 only, ~20 records).
 *
 * Pulls records live from the public FBI Wanted API and upserts them into
 * suspect_profiles. This is the authoritative ingestion path, so every row it
 * writes is stamped:
 *     data_class       = 'official'   (EXPLICIT — schema default is the
 *                                       fail-safe 'analytical'; official FBI
 *                                       data that forgot this would be hidden
 *                                       from the public surface. That is the
 *                                       entire point of this importer.)
 *     source_type      = 'fbi_api'
 *     source_url       = the record's FBI url
 *     last_verified_at = now()        (pulling it live from the authoritative
 *                                       API IS the verification event)
 *
 * Idempotent: ON CONFLICT (fbi_uid) DO UPDATE — re-running refreshes, never
 * duplicates. Records with a null uid are skipped (no conflict key).
 *
 * Pagination is parametrized (--page, default 1) so a full-list run is a
 * trivial later change, but THIS script fetches a single page only.
 *
 * Run:  npm run import:fbi            (page 1)
 *       npm run import:fbi -- --page=2
 */
import { config } from 'dotenv';

// src/lib/db.ts reads DATABASE_URL at module-evaluation time, and ES module
// imports are hoisted — so load .env.local first, then dynamic-import the db
// client inside main(). (fbi-field-offices has no env dependency: static import
// below is fine.)
config({ path: '.env.local' });

import { resolveFieldOfficeState } from '@/lib/fbi-field-offices';

const API_BASE = 'https://api.fbi.gov/wanted/v1/list';
const PAGE_SIZE = 20;
// The FBI API 403s default fetchers; a descriptive User-Agent is required.
const USER_AGENT =
  'ProjectHomeland/0.1 (FBI Wanted importer; +https://github.com/OpenSourcePatents/Project_Homeland)';
const FETCH_TIMEOUT_MS = 30_000;

// Our suspect_profiles.status CHECK vocabulary.
const VALID_STATUSES = new Set(['na', 'captured', 'deceased', 'recovered']);

// ---- FBI API shape (every field is nullable on any given record) ------------
interface FbiImage {
  original?: string | null;
  large?: string | null;
  thumb?: string | null;
  caption?: string | null;
}

interface FbiItem {
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

interface FbiListResponse {
  total?: number;
  page?: number;
  items?: FbiItem[];
}

// ---- Helpers ----------------------------------------------------------------

/** Null-safe array: keep arrays as-is (incl. empty); everything else -> null. */
function asArray(v: unknown): string[] | null {
  return Array.isArray(v) ? (v as string[]) : null;
}

/** images[0].original, falling back to .large; null-safe. */
function pickImageUrl(item: FbiItem): string | null {
  const img = item.images?.[0];
  if (!img) return null;
  return img.original ?? img.large ?? null;
}

/** Consolidate physical attributes into a JSONB object (or null if none). */
function buildPhysicalDescription(
  item: FbiItem,
): Record<string, unknown> | null {
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

/** Map FBI status into our CHECK vocab; record anything unexpected. */
function mapStatus(
  raw: string | null | undefined,
  unmapped: Map<string, number>,
): string {
  if (!raw) return 'na';
  const s = String(raw).toLowerCase().trim();
  if (VALID_STATUSES.has(s)) return s;
  unmapped.set(s, (unmapped.get(s) ?? 0) + 1);
  return 'na';
}

function parsePageArg(argv: string[]): number {
  const eq = argv.find((a) => a.startsWith('--page='));
  const raw = eq
    ? eq.slice('--page='.length)
    : argv[argv.indexOf('--page') + 1];
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

async function fetchPage(page: number): Promise<FbiListResponse> {
  const url = `${API_BASE}?page=${page}&pageSize=${PAGE_SIZE}`;
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

// ---- Main -------------------------------------------------------------------

async function main() {
  const page = parsePageArg(process.argv.slice(2));

  // db.ts reads DATABASE_URL on import — load it (above) before this line.
  const { sql } = await import('@/lib/db');

  console.log(`Fetching FBI Wanted page ${page} (pageSize ${PAGE_SIZE})…`);
  const data = await fetchPage(page);
  const items = data.items ?? [];
  console.log(
    `API total records: ${data.total ?? 'unknown'} | this page returned: ${items.length}\n`,
  );

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let errored = 0;
  let stateResolved = 0;
  let stateNull = 0;
  const unmappedStatuses = new Map<string, number>();

  for (const item of items) {
    // Can't upsert without the conflict key. Rare 'seeking-info' entries.
    if (!item.uid) {
      skipped++;
      console.warn(`  · skip (null uid): "${item.title ?? ''}" ${item.url ?? ''}`);
      continue;
    }

    const fieldOffices = asArray(item.field_offices);
    const primaryState =
      fieldOffices && fieldOffices.length > 0
        ? resolveFieldOfficeState(fieldOffices[0])
        : null;
    if (primaryState) stateResolved++;
    else stateNull++;

    const aliases = asArray(item.aliases);
    const datesOfBirthUsed = asArray(item.dates_of_birth_used);
    const subjects = asArray(item.subjects);
    const status = mapStatus(item.status, unmappedStatuses);
    const imageUrl = pickImageUrl(item);
    const physical = buildPhysicalDescription(item);
    const physicalParam = physical ? JSON.stringify(physical) : null;
    const rawParam = JSON.stringify(item); // entire verbatim item -> raw_payload

    try {
      const rows = await sql`
        INSERT INTO suspect_profiles (
          fbi_uid, first_name, last_name, title,
          aliases, dates_of_birth_used, subjects, field_offices,
          physical_description,
          reward_text, warning_message, status,
          person_classification, poster_classification, primary_state,
          image_url, source_link,
          source_type, data_class, source_url, last_verified_at,
          raw_payload, created_at, updated_at
        ) VALUES (
          ${item.uid}, ${item.first_name ?? null}, ${item.last_name ?? null}, ${item.title ?? null},
          ${aliases}::text[], ${datesOfBirthUsed}::text[], ${subjects}::text[], ${fieldOffices}::text[],
          ${physicalParam}::jsonb,
          ${item.reward_text ?? null}, ${item.warning_message ?? null}, ${status},
          ${item.person_classification ?? null}, ${item.poster_classification ?? null}, ${primaryState},
          ${imageUrl}, ${item.url ?? null},
          'fbi_api', 'official', ${item.url ?? null}, now(),
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
          raw_payload           = EXCLUDED.raw_payload,
          updated_at            = now()
        RETURNING (xmax = '0'::xid) AS inserted
      `;

      // xmax = 0 on a freshly inserted tuple; non-zero when DO UPDATE fired.
      const flag = rows[0]?.inserted;
      const wasInserted = flag === true || flag === 't' || flag === 'true';
      if (wasInserted) inserted++;
      else updated++;

      const name =
        [item.first_name, item.last_name].filter(Boolean).join(' ') ||
        item.title ||
        '(unnamed)';
      console.log(
        `  ${wasInserted ? '✓ inserted' : '↻ updated '}  state=${primaryState ?? '—'}  ${name}`,
      );
    } catch (err) {
      errored++;
      console.error(
        `  ! upsert failed uid=${item.uid}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // ---- Summary --------------------------------------------------------------
  console.log('\n' + '─'.repeat(60));
  console.log(`Import summary (page ${page}):`);
  console.log(`  fetched:        ${items.length}`);
  console.log(`  inserted:       ${inserted}`);
  console.log(`  updated:        ${updated}`);
  console.log(`  skipped:        ${skipped}  (null uid)`);
  console.log(`  state-resolved: ${stateResolved}`);
  console.log(`  state-null:     ${stateNull}`);
  if (errored > 0) {
    console.log(`  errored:        ${errored}  (upsert failures — see logs above)`);
  }
  if (unmappedStatuses.size > 0) {
    const parts = [...unmappedStatuses.entries()]
      .map(([k, v]) => `${k} (${v})`)
      .join(', ');
    console.log(`  unmapped status -> 'na': ${parts}`);
  }
  console.log('─'.repeat(60));
}

main().catch((err) => {
  console.error('\n❌ import:fbi failed:');
  console.error(err);
  process.exitCode = 1;
});
