import { config } from 'dotenv';
config({ path: '.env.local' });

async function main() {
  const { sql } = await import('@/lib/db');

  const wall = await sql`
    SELECT data_class, source_type, COUNT(*)::int AS n
    FROM suspect_profiles
    GROUP BY data_class, source_type
    ORDER BY data_class, source_type
  `;
  console.log('--- wall check (want: 20 rows, official / fbi_api) ---');
  console.table(wall);

  const raw = await sql`
    SELECT fbi_uid, primary_state, raw_payload IS NOT NULL AS has_raw
    FROM suspect_profiles
    LIMIT 3
  `;
  console.log('--- raw_payload check (want: has_raw = true) ---');
  console.table(raw);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
