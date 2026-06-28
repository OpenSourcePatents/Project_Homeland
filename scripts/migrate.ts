import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync } from "node:fs";

// Strip SQL comments and split into individual statements on semicolons.
// (Safe for our migrations: no semicolons inside string literals or bodies.)
function splitStatements(ddl: string): string[] {
  const noComments = ddl
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  return noComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^(BEGIN|COMMIT)$/i.test(s));
}

async function main() {
  const file = process.argv[2];
  if (!file) { console.error("usage: tsx scripts/migrate.ts <path.sql>"); process.exit(1); }
  const statements = splitStatements(readFileSync(file, "utf8"));
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(process.env.DATABASE_URL!);

  console.log(`Applying ${file} — ${statements.length} statements, in a transaction...`);
  try {
    await sql.query("BEGIN");
    for (const [i, stmt] of statements.entries()) {
      const preview = stmt.replace(/\s+/g, " ").slice(0, 70);
      console.log(`  [${i + 1}/${statements.length}] ${preview}...`);
      await sql.query(stmt);
    }
    await sql.query("COMMIT");
    console.log("✓ Applied and committed.");
  } catch (e: any) {
    await sql.query("ROLLBACK").catch(() => {});
    console.error("✗ Failed — rolled back, DB unchanged:", e.message ?? e);
    process.exit(1);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
