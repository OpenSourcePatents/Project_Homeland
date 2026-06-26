import { config } from 'dotenv';

// src/lib/db.ts reads DATABASE_URL at module-evaluation time. ES module imports
// are hoisted, so load .env.local *before* importing the client — which means
// the client must be brought in via a dynamic import below, not a static one.
config({ path: '.env.local' });

async function main() {
  const { sql } = await import('@/lib/db');

  const rows = await sql`SELECT version()`;
  const version = rows[0]?.version ?? JSON.stringify(rows[0]);

  console.log('✅ Connected to Neon.');
  console.log(version);
}

main().catch((err) => {
  console.error('❌ db:check failed:');
  console.error(err);
  process.exitCode = 1;
});
