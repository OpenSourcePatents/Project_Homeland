/**
 * Migration runner — applies one .sql file ATOMICALLY against Neon.
 *
 * Two things the previous version got wrong, fixed here:
 *
 *  1. REAL transaction. neon() is the HTTP driver: every sql.query() is a
 *     separate, stateless HTTP request, so issuing BEGIN / COMMIT / ROLLBACK as
 *     individual calls does NOT group anything — each statement autocommits on
 *     its own (which is how a "rolled back" migration left a column behind).
 *     We use neon's sql.transaction([...]) instead, which sends all statements
 *     in ONE request wrapped in a single transaction: all commit, or none do.
 *
 *  2. Quote/comment-aware splitting. The old splitter stripped '--' lines then
 *     split on ';', which breaks on a ';' inside a string literal (e.g. a
 *     COMMENT ON body). The splitter below tracks line comments, block comments,
 *     and single-quoted strings (incl. '' escapes), so only real statement
 *     terminators split.
 *
 * Also: no process.exit() — that races Node's handle teardown on Windows and
 * trips a libuv assertion. We set process.exitCode and let the loop drain.
 *
 * Usage: tsx scripts/migrate.ts migrations/00X_name.sql
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

/**
 * Split a SQL script into individual statements. Respects `-- line comments`,
 * `/* block comments *​/`, and `'single-quoted strings'` (with `''` escapes), so a
 * `;` inside any of those never ends a statement. Standalone BEGIN/COMMIT are
 * dropped — the runner provides the transaction itself.
 */
export function splitStatements(ddl: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inLine = false;
  let inBlock = false;
  let inStr = false;
  for (let i = 0; i < ddl.length; i++) {
    const c = ddl[i];
    const next = ddl[i + 1];

    if (inLine) {
      if (c === "\n") {
        inLine = false;
        buf += c;
      }
      continue;
    }
    if (inBlock) {
      if (c === "*" && next === "/") {
        inBlock = false;
        i++;
        buf += " "; // don't fuse tokens that hugged the comment
      }
      continue;
    }
    if (inStr) {
      buf += c;
      if (c === "'") {
        if (next === "'") {
          buf += next;
          i++; // escaped quote, stay in string
        } else {
          inStr = false;
        }
      }
      continue;
    }

    // not inside a comment or string
    if (c === "-" && next === "-") {
      inLine = true;
      i++;
      continue;
    }
    if (c === "/" && next === "*") {
      inBlock = true;
      i++;
      continue;
    }
    if (c === "'") {
      inStr = true;
      buf += c;
      continue;
    }
    if (c === ";") {
      const s = buf.trim();
      if (s) out.push(s);
      buf = "";
      continue;
    }
    buf += c;
  }
  const tail = buf.trim();
  if (tail) out.push(tail);

  // The file's own BEGIN/COMMIT are redundant — we wrap everything in one tx.
  return out.filter((s) => !/^(BEGIN|COMMIT|START\s+TRANSACTION)$/i.test(s.trim()));
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: tsx scripts/migrate.ts <path.sql>");
    process.exitCode = 1;
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set (put it in .env.local or the environment).");
    process.exitCode = 1;
    return;
  }

  const statements = splitStatements(readFileSync(file, "utf8"));
  if (statements.length === 0) {
    console.error(`No executable statements found in ${file}.`);
    process.exitCode = 1;
    return;
  }

  const sql = neon(process.env.DATABASE_URL);

  console.log(`Applying ${file} — ${statements.length} statement(s) in ONE transaction…`);
  statements.forEach((s, i) => {
    console.log(`  [${i + 1}/${statements.length}] ${s.replace(/\s+/g, " ").slice(0, 80)}…`);
  });

  try {
    // sql.transaction() runs the whole array atomically in a single request.
    // Lazy query objects (sql.query() is not awaited here) are what it expects.
    await sql.transaction(statements.map((s) => sql.query(s)));
    console.log("✓ Applied and committed (atomic).");
  } catch (e) {
    console.error(
      "✗ Failed — transaction rolled back, DB unchanged:",
      e instanceof Error ? e.message : e,
    );
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
