import { config } from 'dotenv';
config({ path: '.env.local' });

async function main() {
  const { sql } = await import('@/lib/db');
  const rows = await sql`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'suspect_profiles'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  `;
  console.table(rows);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
