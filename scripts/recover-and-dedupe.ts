/**
 * Location-recovery + dedupe analysis. Reads ONLY the raw_payload already stored
 * (no FBI API re-hit). Two jobs in one script:
 *
 *  1. LOCATION RECOVERY (writes resolved_state + state_source)
 *     Best-available state per record, in priority order:
 *        possible_states  >  description "City, State"  >  field_office lookup  >  null
 *     SAFETY: only EXPLICIT US state names/abbreviations match. Foreign locations
 *     ("Mannheim, Germany", "Mumbai, India") never match — we match against a fixed
 *     US-state list, comma-anchored, longest-name-first, with a state-only-line
 *     fallback. We never fuzzy-guess. primary_state is NEVER overwritten.
 *
 *  2. DEDUPE ANALYSIS (report only — writes NOTHING, deletes NOTHING)
 *     Clusters records by normalized name + date-of-birth to surface the same
 *     person cross-listed multiple times. DOB is what stops two different people
 *     with the same name from being merged. Real cross-listings stay separate
 *     rows; grouping for display happens later in the query layer.
 *
 * Run:  npm run recover -- --dry-run   (prints what it WOULD do, writes nothing)
 *       npm run recover               (applies location-recovery writes)
 * Dedupe is always report-only regardless of the flag.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { resolveFieldOfficeState } from '@/lib/fbi-field-offices';

const DRY_RUN = process.argv.includes('--dry-run');

// ---- US state / territory names -> USPS code -------------------------------
const STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO',
  montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH',
  oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
  'district of columbia': 'DC', 'puerto rico': 'PR', guam: 'GU',
  'u.s. virgin islands': 'VI', 'virgin islands': 'VI', 'american samoa': 'AS',
  'northern mariana islands': 'MP',
};
const STATE_CODES = new Set(Object.values(STATE_NAME_TO_CODE));

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// longest names first so "west virginia" matches before "virginia"
const STATE_ALT = Object.keys(STATE_NAME_TO_CODE)
  .sort((a, b) => b.length - a.length)
  .map(escapeRegex)
  .join('|');
const COMMA_STATE_RE = new RegExp(`,\\s*(${STATE_ALT})\\b`, 'i');
const COMMA_ABBR_RE = /,\s*([A-Z]{2})\b/g;

type StateSource = 'possible_states' | 'description' | 'field_office' | 'none';

/** Parse a US state from a free-text description. Returns null for foreign or
 *  unparseable text (we only ever match explicit US state names/abbreviations). */
function parseStateFromDescription(desc: string | null): { code: string; matched: string } | null {
  if (!desc) return null;

  // 1) "City, <State Name>" — comma-anchored so a city that contains a state word
  //    (e.g. "Missouri City, Texas") resolves to the post-comma state (Texas).
  const m = desc.match(COMMA_STATE_RE);
  if (m) {
    const code = STATE_NAME_TO_CODE[m[1].toLowerCase()];
    if (code) return { code, matched: m[0].replace(/\s+/g, ' ').trim() };
  }

  // 2) a line that is EXACTLY a state name (e.g. "Montana" on its own line)
  for (const raw of desc.split(/\r?\n/)) {
    const line = raw.trim();
    const code = STATE_NAME_TO_CODE[line.toLowerCase()];
    if (code) return { code, matched: line };
  }

  // 3) "City, ST" — explicit uppercase 2-letter USPS code after a comma
  COMMA_ABBR_RE.lastIndex = 0;
  let am: RegExpExecArray | null;
  while ((am = COMMA_ABBR_RE.exec(desc)) !== null) {
    if (STATE_CODES.has(am[1])) return { code: am[1], matched: am[0].replace(/\s+/g, ' ').trim() };
  }

  return null;
}

/** Parse a US state from the FBI possible_states field (array or object). */
function parseStateFromPossibleStates(ps: unknown): string | null {
  if (!ps) return null;
  const tokens: string[] = [];
  if (Array.isArray(ps)) tokens.push(...ps.map((x) => String(x)));
  else if (typeof ps === 'object') tokens.push(...Object.keys(ps as Record<string, unknown>));
  for (const t of tokens) {
    const up = t.trim().toUpperCase();
    if (up.length === 2 && STATE_CODES.has(up)) return up;
    const code = STATE_NAME_TO_CODE[t.trim().toLowerCase()];
    if (code) return code;
  }
  return null;
}

interface Row {
  id: string;
  fbi_uid: string | null;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  subjects: string[] | null;
  dates_of_birth_used: string[] | null;
  primary_state: string | null;
  resolved_state: string | null;
  state_source: string | null;
  field_offices: string[] | null;
  description: string | null;
  possible_states: unknown;
}

interface Resolved {
  code: string | null;
  source: StateSource;
  matched?: string;
}

function resolveState(r: Row): Resolved {
  const ps = parseStateFromPossibleStates(r.possible_states);
  if (ps) return { code: ps, source: 'possible_states' };
  const d = parseStateFromDescription(r.description);
  if (d) return { code: d.code, source: 'description', matched: d.matched };
  const fo = r.field_offices && r.field_offices.length > 0 ? resolveFieldOfficeState(r.field_offices[0]) : null;
  if (fo) return { code: fo, source: 'field_office' };
  return { code: null, source: 'none' };
}

// ---- dedupe helpers ---------------------------------------------------------
function normName(r: Row): string {
  const base = [r.first_name, r.last_name].filter(Boolean).join(' ') || r.title || '';
  return base
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function dobSet(r: Row): string[] {
  return (r.dates_of_birth_used ?? []).map((d) => d.trim()).filter(Boolean);
}

function clusterByDob(records: Row[]): Row[][] {
  // union-find: records that share any DOB are the same person
  const parent = records.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };
  const dobToIdx = new Map<string, number>();
  records.forEach((r, i) => {
    for (const d of dobSet(r)) {
      const seen = dobToIdx.get(d);
      if (seen !== undefined) union(i, seen);
      else dobToIdx.set(d, i);
    }
  });
  const groups = new Map<number, Row[]>();
  records.forEach((r, i) => {
    const root = find(i);
    const g = groups.get(root) ?? [];
    g.push(r);
    groups.set(root, g);
  });
  return [...groups.values()];
}

function label(r: Row): string {
  const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || r.title || '(unnamed)';
  const subs = (r.subjects ?? []).join(', ');
  return `${name}${subs ? ` — ${subs}` : ''}  [uid ${r.fbi_uid ?? '—'}]`;
}

async function main() {
  const { sql } = await import('@/lib/db');

  console.log(`\n=== recover-and-dedupe ${DRY_RUN ? '(DRY RUN — no writes)' : '(LIVE — will write resolved_state/state_source)'} ===\n`);

  const rows = (await sql`
    SELECT
      id, fbi_uid, first_name, last_name, title, subjects, dates_of_birth_used,
      primary_state, resolved_state, state_source, field_offices,
      raw_payload->>'description'      AS description,
      raw_payload->'possible_states'   AS possible_states
    FROM suspect_profiles
    ORDER BY last_name NULLS LAST, first_name NULLS LAST, id
  `) as unknown as Row[];

  console.log(`Loaded ${rows.length} records.\n`);

  // ---- JOB 1: location recovery -------------------------------------------
  const counts: Record<StateSource, number> = { possible_states: 0, description: 0, field_office: 0, none: 0 };
  const recoveredFromUnmapped: Record<StateSource, number> = { possible_states: 0, description: 0, field_office: 0, none: 0 };
  const diffsToWrite: { id: string; code: string | null; source: StateSource }[] = [];
  const descDiffersFromFieldOffice: { r: Row; code: string; matched: string; fo: string | null }[] = [];
  const descSamples: string[] = [];

  for (const r of rows) {
    const res = resolveState(r);
    counts[res.source]++;

    if (!r.primary_state && res.code) recoveredFromUnmapped[res.source]++;

    // collect a description-vs-field-office discrepancy view for spot-checking
    if (res.source === 'description') {
      const fo = r.field_offices && r.field_offices.length ? resolveFieldOfficeState(r.field_offices[0]) : null;
      if (fo && fo !== res.code) descDiffersFromFieldOffice.push({ r, code: res.code!, matched: res.matched!, fo });
      if (descSamples.length < 25) {
        descSamples.push(`  ${res.code}  ←  "${res.matched}"   (${label(r)})`);
      }
    }

    // only write when the derived value actually differs from what's stored
    if (r.resolved_state !== res.code || r.state_source !== res.source) {
      diffsToWrite.push({ id: r.id, code: res.code, source: res.source });
    }
  }

  const previouslyUnmapped = rows.filter((r) => !r.primary_state).length;
  const nowResolvable = rows.filter((r) => !r.primary_state && resolveState(r).code).length;

  console.log('── LOCATION RECOVERY ─────────────────────────────────────────');
  console.log(`  resolved_state source (all ${rows.length}):`);
  console.log(`     possible_states : ${counts.possible_states}`);
  console.log(`     description     : ${counts.description}`);
  console.log(`     field_office    : ${counts.field_office}`);
  console.log(`     none (null)     : ${counts.none}`);
  console.log(`  previously unmapped (primary_state NULL): ${previouslyUnmapped}`);
  console.log(`     now resolvable          : ${nowResolvable}  (${previouslyUnmapped - nowResolvable} still null)`);
  console.log(`        via description      : ${recoveredFromUnmapped.description}`);
  console.log(`        via possible_states  : ${recoveredFromUnmapped.possible_states}`);
  console.log(`  description-derived state DIFFERS from field-office state: ${descDiffersFromFieldOffice.length}`);
  console.log(`  rows whose resolved_state/state_source would change: ${diffsToWrite.length}`);
  console.log('\n  sample description matches (verify foreign/edge cases skipped):');
  console.log(descSamples.join('\n'));
  if (descDiffersFromFieldOffice.length) {
    console.log('\n  sample description≠field_office (description wins per priority):');
    descDiffersFromFieldOffice.slice(0, 12).forEach((d) => {
      console.log(`     ${d.fo} (office) → ${d.code} (desc "${d.matched}")   ${label(d.r)}`);
    });
  }

  // ---- JOB 2: dedupe analysis (report only) -------------------------------
  const byName = new Map<string, Row[]>();
  for (const r of rows) {
    const k = normName(r);
    if (!k) continue;
    const g = byName.get(k) ?? [];
    g.push(r);
    byName.set(k, g);
  }

  const confirmed: Row[][] = []; // DOB-connected, >=2 records
  const nameOnly: Row[][] = []; // >=2 records, none with a confirming DOB
  let distinctSameName = 0; // same name, different DOB -> kept as different people

  for (const [, group] of byName) {
    if (group.length < 2) continue;
    const clusters = clusterByDob(group);
    const multi = clusters.filter((c) => c.length >= 2);
    for (const c of multi) confirmed.push(c);

    // singletons that all lack DOBs and share the name = possible (unconfirmable)
    const singletons = clusters.filter((c) => c.length === 1).map((c) => c[0]);
    const noDob = singletons.filter((r) => dobSet(r).length === 0);
    const withDob = singletons.filter((r) => dobSet(r).length > 0);
    if (noDob.length >= 2 && multi.length === 0) nameOnly.push(noDob);
    // singletons that each carry a DOB but didn't connect = genuinely different people
    if (withDob.length >= 2) distinctSameName += withDob.length;
  }

  const confirmedRecords = confirmed.reduce((s, c) => s + c.length, 0);
  console.log('\n── DEDUPE ANALYSIS (report only — nothing deleted) ───────────');
  console.log(`  DOB-confirmed duplicate clusters: ${confirmed.length}  (${confirmedRecords} records)`);
  console.log(`  name-only possible duplicates (no DOB to confirm): ${nameOnly.length} cluster(s)`);
  console.log(`  same name but DIFFERENT DOB (kept distinct, NOT merged): ${distinctSameName} records`);

  if (confirmed.length) {
    console.log('\n  ▸ DOB-confirmed clusters:');
    confirmed
      .sort((a, b) => b.length - a.length)
      .forEach((c, i) => {
        const dobs = [...new Set(c.flatMap(dobSet))].join(' | ');
        console.log(`    [${i + 1}] ${c.length}× — DOB: ${dobs || '—'}`);
        c.forEach((r) => console.log(`         · ${label(r)}`));
      });
  }
  if (nameOnly.length) {
    console.log('\n  ▸ name-only possible duplicates (sample):');
    nameOnly.slice(0, 10).forEach((c, i) => {
      console.log(`    [${i + 1}] ${c.length}× "${normName(c[0])}" (no DOB on any — unconfirmed)`);
      c.forEach((r) => console.log(`         · ${label(r)}`));
    });
  }

  // ---- apply (location recovery only) -------------------------------------
  console.log('\n── APPLY ─────────────────────────────────────────────────────');
  if (DRY_RUN) {
    console.log(`  DRY RUN — would update ${diffsToWrite.length} row(s). Nothing written.`);
  } else {
    console.log(`  Writing resolved_state/state_source for ${diffsToWrite.length} changed row(s)…`);
    let written = 0;
    for (const d of diffsToWrite) {
      await sql`UPDATE suspect_profiles SET resolved_state = ${d.code}, state_source = ${d.source} WHERE id = ${d.id}`;
      written++;
      if (written % 100 === 0) process.stdout.write(`    ${written}/${diffsToWrite.length}\r`);
    }
    console.log(`  ✓ Wrote ${written} row(s). Dedupe was report-only (no rows changed by it).`);
  }
  console.log('──────────────────────────────────────────────────────────────\n');
}

main().catch((e) => {
  console.error('\n❌ recover-and-dedupe failed:');
  console.error(e);
  process.exitCode = 1;
});
