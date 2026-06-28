/**
 * Public-surface projection of `suspect_profiles`.
 *
 * This module is TYPE-ONLY — it imports no database client, so it is safe to
 * import from both the server fetch (`queries.ts`) and client components
 * (`CommandView`, `HomelandMap`). Importing a type never bundles the db client.
 *
 * By construction, every value of this shape comes from `getPublicSuspects()`,
 * which filters `WHERE data_class = 'official'`. The analytical side of the wall
 * is structurally unreachable here.
 */

export type SuspectStatus = "na" | "captured" | "deceased" | "recovered";
export type DataClass = "official" | "analytical";

export interface PublicSuspect {
  id: string;
  fbi_uid: string | null;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  aliases: string[] | null;
  subjects: string[] | null;
  status: SuspectStatus;
  /** CHAR(2) state code, e.g. "NY". Often null — record stays in the list, off the map. */
  primary_state: string | null;
  warning_message: string | null;
  reward_text: string | null;
  image_url: string | null;
  source_url: string | null;
  /** Always 'official' on the public surface (the wall). Kept for the styling branch. */
  data_class: DataClass;
}
