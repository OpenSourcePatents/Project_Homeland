/**
 * FBI Wanted DAILY FULL SYNC.
 *
 * Fetches every page of the FBI Wanted list, upserts all records via the shared,
 * proven core (./fbi-core — same data_class='official' stamp, upsert, raw_payload,
 * field-office→state resolution), stamps last_seen_at on everything it sees, and
 * — only when the pull is COMPLETE — marks records that have vanished from the FBI
 * list as status='removed_from_fbi' (never hard-deleting).
 *
 * FAILURE POLICY
 *   - A page that fails is recorded as skipped; the pass continues.
 *   - After the first pass, skipped pages are retried once, in order.
 *   - A page that fails on BOTH the initial attempt and its retry (twice in a row)
 *     is marked FAILED and abandoned.
 *   - The run still applies everything it got, but if ≥1 page is FAILED the process
 *     exits NON-ZERO so the scheduled job shows as failed ("passes with a fail").
 *
 * VANISHED-DETECTION (safety crux) runs ONLY on a complete pull (zero FAILED pages).
 *   An incomplete pull SKIPS it entirely, so a timed-out page can never cause a live
 *   record to be marked gone. (We additionally skip it if any individual upsert
 *   errored this run, since an un-applied record would otherwise look "vanished".)
 *
 * Run:  npm run sync:fbi
 */
import { config } from 'dotenv';

// Load .env.local for local runs BEFORE the db client is imported (it reads
// DATABASE_URL at module-eval). In CI there is no .env.local; DATABASE_URL comes
// from the environment (the GitHub Actions `env:` block) and this call is a no-op.
config({ path: '.env.local' });

import { FbiItem, FbiListResponse, Sql, fetchPage, upsertActor } from './fbi-core';

const PAGE_SIZE = 50;
const INTER_PAGE_DELAY_MS = 250; // be polite to the FBI API between page fetches

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface PageFetch {
  ok: boolean;
  data?: FbiListResponse;
  error?: string;
}

async function fetchPageSafe(page: number, pageSize: number): Promise<PageFetch> {
  try {
    const data = await fetchPage(page, pageSize);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

interface Summary {
  totalPages: number;
  okPages: number[];
  failedPages: number[];
  fetched: number;
  inserted: number;
  updated: number;
  unchanged: number;
  skippedNullUid: number;
  errored: number;
  lastSeenStamped: number;
  reappeared: number;
  vanished: number | null; // null => skipped (incomplete pull or upsert errors)
  vanishedSkipReason: string | null;
  statusCounts: Map<string, number>;
  unmapped: Map<string, number>;
  complete: boolean;
}

function printSummary(s: Summary): number {
  const exitCode = s.failedPages.length > 0 || s.errored > 0 ? 1 : 0;
  const line = '═'.repeat(64);
  console.log('\n' + line);
  console.log('FBI DAILY SYNC — SUMMARY');
  console.log(line);
  console.log(
    `  pages:        ${s.totalPages} total / ${s.okPages.length} succeeded / ${s.failedPages.length} failed` +
      (s.failedPages.length ? `  [failed: ${s.failedPages.join(', ')}]` : ''),
  );
  console.log(`  records:      ${s.fetched} fetched`);
  console.log(`                  ${s.inserted} inserted`);
  console.log(`                  ${s.updated} updated`);
  console.log(`                  ${s.unchanged} unchanged`);
  if (s.skippedNullUid) console.log(`                  ${s.skippedNullUid} skipped (null uid)`);
  if (s.errored) console.log(`                  ${s.errored} errored (upsert failures)`);
  console.log(`  last_seen stamped: ${s.lastSeenStamped}`);
  console.log(`  reappeared (un-marked removed_from_fbi): ${s.reappeared}`);
  if (s.vanished === null) {
    console.log(`  vanished:     skipped (${s.vanishedSkipReason})`);
  } else {
    console.log(`  vanished:     ${s.vanished} marked removed_from_fbi`);
  }

  const passthroughs = ['surrendered', 'resolved']
    .map((k) => `${k}: ${s.statusCounts.get(k) ?? 0}`)
    .join(', ');
  console.log(`  status pass-throughs: ${passthroughs}`);
  if (s.unmapped.size > 0) {
    const parts = [...s.unmapped.entries()].map(([k, v]) => `${k} (${v})`).join(', ');
    console.log(`  unmapped status -> 'na': ${parts}`);
  } else {
    console.log(`  unmapped status -> 'na': none`);
  }
  console.log(line);
  console.log(`  exit code: ${exitCode}  (${exitCode === 0 ? 'complete' : 'INCOMPLETE — see above'})`);
  console.log(line);
  return exitCode;
}

async function main() {
  const { sql } = (await import('@/lib/db')) as { sql: Sql };

  // Authoritative run-start from the DB clock (NOT the app clock) — this is the
  // threshold for vanished-detection. Records seen this run get last_seen_at =
  // now() (> runStart); unseen records keep an older last_seen_at (< runStart).
  const startRows = await sql`SELECT now() AS run_start`;
  const runStart = (startRows[0] as { run_start: string }).run_start;
  console.log(`Sync run start (DB clock): ${runStart}`);

  // Snapshot of records currently marked removed_from_fbi, so we can COUNT the
  // ones that reappear this run (the upsert un-marks them by writing the FBI's
  // current status; see fbi-core upsertActor).
  const removedRows = await sql`
    SELECT fbi_uid FROM suspect_profiles
    WHERE source_type = 'fbi_api' AND status = 'removed_from_fbi' AND fbi_uid IS NOT NULL
  `;
  const previouslyRemoved = new Set((removedRows as { fbi_uid: string }[]).map((r) => r.fbi_uid));
  console.log(`Currently marked removed_from_fbi: ${previouslyRemoved.size}`);

  // ---- pagination + failure policy -----------------------------------------
  const okPages: number[] = [];
  const failedPages: number[] = [];
  const itemsByPage = new Map<number, FbiItem[]>();

  // Bootstrap: page 1 also tells us `total`. It needs ONE immediate retry on
  // failure because without it we cannot enumerate the remaining pages at all.
  let boot = await fetchPageSafe(1, PAGE_SIZE);
  if (!boot.ok) {
    console.warn(`page 1 failed (initial): ${boot.error} — retrying to bootstrap pagination`);
    boot = await fetchPageSafe(1, PAGE_SIZE);
  }
  if (!boot.ok) {
    console.error(`FATAL: page 1 failed twice (${boot.error}). Cannot determine pagination; applying nothing.`);
    const exitCode = printSummary({
      totalPages: 0,
      okPages: [],
      failedPages: [1],
      fetched: 0,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      skippedNullUid: 0,
      errored: 0,
      lastSeenStamped: 0,
      reappeared: 0,
      vanished: null,
      vanishedSkipReason: 'incomplete pull, page 1 failed',
      statusCounts: new Map(),
      unmapped: new Map(),
      complete: false,
    });
    process.exit(exitCode);
  }

  okPages.push(1);
  itemsByPage.set(1, boot.data!.items ?? []);
  const total = boot.data!.total ?? (boot.data!.items?.length ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  console.log(`API total records: ${total} | pageSize ${PAGE_SIZE} | pages: ${totalPages}\n`);

  // First pass over pages 2..totalPages — record failures, keep going.
  const skipped: number[] = [];
  for (let p = 2; p <= totalPages; p++) {
    await sleep(INTER_PAGE_DELAY_MS);
    const r = await fetchPageSafe(p, PAGE_SIZE);
    if (r.ok) {
      okPages.push(p);
      itemsByPage.set(p, r.data!.items ?? []);
      process.stdout.write(`  page ${p}/${totalPages} ok\r`);
    } else {
      skipped.push(p);
      console.warn(`  page ${p}/${totalPages} failed (initial): ${r.error}`);
    }
  }

  // Retry pass: skipped pages, in order. Failing again = FAILED (abandoned).
  if (skipped.length) {
    console.log(`\nRetrying ${skipped.length} skipped page(s): [${skipped.join(', ')}]`);
    for (const p of skipped) {
      await sleep(INTER_PAGE_DELAY_MS);
      const r = await fetchPageSafe(p, PAGE_SIZE);
      if (r.ok) {
        okPages.push(p);
        itemsByPage.set(p, r.data!.items ?? []);
        console.log(`  page ${p} recovered on retry`);
      } else {
        failedPages.push(p);
        console.error(`  page ${p} FAILED (twice in a row): ${r.error}`);
      }
    }
  }

  okPages.sort((a, b) => a - b);
  failedPages.sort((a, b) => a - b);
  const complete = failedPages.length === 0;
  console.log(`\nFetch complete: ${okPages.length} page(s) ok, ${failedPages.length} failed.\n`);

  // ---- apply data (ALWAYS, even on incomplete runs) ------------------------
  let fetched = 0;
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let skippedNullUid = 0;
  let errored = 0;
  let reappeared = 0;
  const unmapped = new Map<string, number>();
  const statusCounts = new Map<string, number>();

  for (const p of okPages) {
    const items = itemsByPage.get(p) ?? [];
    for (const item of items) {
      fetched++;
      if (!item.uid) {
        skippedNullUid++;
        continue;
      }
      try {
        const res = await upsertActor(sql, item, unmapped);
        statusCounts.set(res.status, (statusCounts.get(res.status) ?? 0) + 1);
        if (previouslyRemoved.has(item.uid)) reappeared++;
        if (res.inserted) inserted++;
        else if (res.changed) updated++;
        else unchanged++;
      } catch (e) {
        errored++;
        console.error(`  ! upsert failed uid=${item.uid}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  const lastSeenStamped = inserted + updated + unchanged;

  // ---- vanished-detection (gated on completeness) --------------------------
  let vanished: number | null = null;
  let vanishedSkipReason: string | null = null;

  if (!complete) {
    vanishedSkipReason = `incomplete pull, ${failedPages.length} page(s) failed: [${failedPages.join(', ')}]`;
    console.warn(`Vanished-detection SKIPPED — ${vanishedSkipReason}. Marking nothing vanished.`);
  } else if (errored > 0) {
    vanishedSkipReason = `${errored} record upsert(s) errored — cannot safely tell vanished from un-applied`;
    console.warn(`Vanished-detection SKIPPED — ${vanishedSkipReason}. Marking nothing vanished.`);
  } else if (lastSeenStamped === 0) {
    // A "complete" pull that applied ZERO records is almost certainly an empty
    // but HTTP-200 API response (outage), not a genuinely empty FBI list. Running
    // vanished-detection here would mark EVERY live record removed_from_fbi.
    vanishedSkipReason = 'pull applied 0 records (likely empty/200 API response) — refusing to mass-mark vanished';
    console.warn(`Vanished-detection SKIPPED — ${vanishedSkipReason}. Marking nothing vanished.`);
  } else {
    // Mark FBI-sourced records not seen this run (last_seen_at older than the run
    // start) as removed_from_fbi. NEVER delete; raw_payload is preserved. A future
    // run that sees the record again will overwrite status via the upsert.
    const rows = await sql`
      UPDATE suspect_profiles
      SET status = 'removed_from_fbi', updated_at = now()
      WHERE source_type = 'fbi_api'
        AND status <> 'removed_from_fbi'
        AND last_seen_at < ${runStart}::timestamptz
      RETURNING fbi_uid
    `;
    vanished = (rows as unknown[]).length;
    console.log(`Vanished-detection: marked ${vanished} record(s) removed_from_fbi.`);
  }

  const exitCode = printSummary({
    totalPages,
    okPages,
    failedPages,
    fetched,
    inserted,
    updated,
    unchanged,
    skippedNullUid,
    errored,
    lastSeenStamped,
    reappeared,
    vanished,
    vanishedSkipReason,
    statusCounts,
    unmapped,
    complete,
  });

  process.exit(exitCode);
}

main().catch((err) => {
  console.error('\n❌ sync:fbi crashed:');
  console.error(err);
  process.exit(1);
});
