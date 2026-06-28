import { config } from 'dotenv';
config({ path: '.env.local' });

async function main() {
  const { sql } = await import('@/lib/db');
  const counts = await sql`
    SELECT COUNT(*)::int AS total, COUNT(last_seen_at)::int AS with_last_seen
    FROM suspect_profiles
  `;
  console.log('--- backfill (want total=20, with_last_seen=20) ---');
  console.table(counts);
  const def = await sql`
    SELECT pg_get_constraintdef(oid) AS def
    FROM pg_constraint WHERE conname = 'suspect_profiles_status_check'
  `;
  console.log('--- widened constraint (want all 7 values) ---');
  console.table(def);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
