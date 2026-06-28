import "server-only";

import { sql } from "@/lib/db";
import type { PublicSuspect } from "@/lib/public-suspect";

/**
 * THE OFFICIAL / ANALYTICAL WALL — enforced here, in code, not just in styling.
 *
 * Every public read of suspect records goes through this function, and it filters
 * `WHERE data_class = 'official'`. The public surface is therefore structurally
 * incapable of returning analytical (inferred/OSINT) rows: the wall fails closed.
 *
 * Server-only: this file imports `server-only` and the db client. Importing it
 * from a client component is a build-time error — DATABASE_URL never reaches the
 * browser bundle. Client components receive the RESULT as plain serializable
 * props instead.
 */
export async function getPublicSuspects(): Promise<PublicSuspect[]> {
  const rows = await sql`
    SELECT
      id,
      fbi_uid,
      first_name,
      last_name,
      title,
      aliases,
      subjects,
      status,
      primary_state,
      warning_message,
      reward_text,
      image_url,
      source_url,
      data_class
    FROM suspect_profiles
    WHERE data_class = 'official'
    ORDER BY last_name ASC NULLS LAST, title ASC NULLS LAST, id ASC
  `;

  return rows as unknown as PublicSuspect[];
}
