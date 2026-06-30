/**
 * FBI Wanted ingestion importer — TEST SCOPE (single page, default page 1).
 *
 * The load-bearing logic (the data_class='official' stamp, the upsert,
 * raw_payload, field-office→state resolution, status mapping) now lives in
 * ./fbi-core and is SHARED with the daily full-sync (sync-fbi.ts). This script
 * is the thin single-page wrapper it always was; its proven behavior is
 * unchanged — it still fetches one page and upserts each record, counting
 * inserted vs updated. (The shared upsert additionally stamps last_seen_at =
 * now(), enabled by migration 002; that is additive and harmless here.)
 *
 * Idempotent: ON CONFLICT (fbi_uid) DO UPDATE — re-running refreshes, never
 * duplicates. Records with a null uid are skipped (no conflict key).
 *
 * Run:  npm run import:fbi            (page 1)
 *       npm run import:fbi -- --page=2
 */
import { config } from 'dotenv';

// src/lib/db.ts reads DATABASE_URL at module-evaluation time, and ES module
// imports are hoisted — so load .env.local first, then dynamic-import the db
// client inside main(). fbi-core has no env dependency at import time (it takes
// the sql client as a parameter), so the static import below is fine.
config({ path: '.env.local' });

import { fetchPage, upsertActor } from './fbi-core';

const PAGE_SIZE = 20;

function parsePageArg(argv: string[]): number {
  const eq = argv.find((a) => a.startsWith('--page='));
  const raw = eq ? eq.slice('--page='.length) : argv[argv.indexOf('--page') + 1];
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

async function main() {
  const page = parsePageArg(process.argv.slice(2));

  // db.ts reads DATABASE_URL on import — load it (above) before this line.
  const { sql } = await import('@/lib/db');

  console.log(`Fetching FBI Wanted page ${page} (pageSize ${PAGE_SIZE})…`);
  const data = await fetchPage(page, PAGE_SIZE);
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

    try {
      const { inserted: wasInserted, primaryState } = await upsertActor(sql, item, unmappedStatuses);
      if (primaryState) stateResolved++;
      else stateNull++;

      // Preserve the original importer's classification: any conflict is "updated".
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
    const parts = [...unmappedStatuses.entries()].map(([k, v]) => `${k} (${v})`).join(', ');
    console.log(`  unmapped status -> 'na': ${parts}`);
  }
  console.log('─'.repeat(60));
}

main().catch((err) => {
  console.error('\n❌ import:fbi failed:');
  console.error(err);
  process.exitCode = 1;
});
