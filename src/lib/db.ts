import { neon } from '@neondatabase/serverless';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env.local and paste your ' +
      'Neon pooled connection string. (In the Next.js runtime, .env.local is ' +
      'loaded automatically; for standalone scripts, load it first — see ' +
      'scripts/db-check.ts.)',
  );
}

/**
 * Neon serverless SQL client (HTTP, one query per call).
 *
 * Use as a tagged template — values are parameterized, not string-interpolated:
 *
 *   import { sql } from '@/lib/db';
 *   const rows = await sql`SELECT * FROM widgets WHERE id = ${id}`;
 */
export const sql = neon(connectionString);
