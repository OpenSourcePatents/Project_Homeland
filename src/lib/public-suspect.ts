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

export type SuspectStatus = "na" | "captured" | "deceased" | "recovered" | "surrendered" | "resolved" | "removed_from_fbi";
export type DataClass = "official" | "analytical";
export type StateSource = "possible_states" | "description" | "field_office" | "none";

export interface PublicSuspect {
  id: string;
  fbi_uid: string | null;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  aliases: string[] | null;
  subjects: string[] | null;
  status: SuspectStatus;
  /** CHAR(2), field-office-derived. Often null. The map prefers resolved_state. */
  primary_state: string | null;
  /** CHAR(2), best-available state from location-recovery (003). What the map plots. */
  resolved_state: string | null;
  /** How resolved_state was derived (provenance). */
  state_source: StateSource | null;
  warning_message: string | null;
  reward_text: string | null;
  image_url: string | null;
  source_url: string | null;
  /** Always 'official' on the public surface (the wall). Kept for the styling branch. */
  data_class: DataClass;
}

export interface PhysicalDescription {
  sex?: string;
  race?: string;
  hair?: string;
  eyes?: string;
  height_min?: number; // inches
  height_max?: number; // inches
  weight?: string;
  build?: string;
  complexion?: string;
  scars_and_marks?: string;
  [k: string]: unknown;
}

export interface SuspectImage {
  url: string;
  caption: string | null;
}

/**
 * Rich detail for the record modal. Fetched on demand from the wall-enforced
 * route handler (/api/suspect/[id]); the HTML narrative fields are SANITIZED
 * server-side, so the client may render them as HTML safely.
 */
export interface SuspectDetail {
  id: string;
  fbi_uid: string | null;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  aliases: string[] | null;
  subjects: string[] | null;
  status: SuspectStatus;
  primary_state: string | null;
  resolved_state: string | null;
  state_source: StateSource | null;
  warning_message: string | null;
  reward_text: string | null;
  image_url: string | null;
  images: SuspectImage[];
  source_url: string | null;
  data_class: DataClass;
  poster_classification: string | null;
  person_classification: string | null;
  physical_description: PhysicalDescription | null;
  /** SANITIZED HTML (server-side). Safe to render. Original "alleged" language preserved. */
  caution_html: string | null;
  remarks_html: string | null;
  details_html: string | null;
  /** True for John/Jane Doe / unidentified-suspect records — display with a misID caveat. */
  unidentified: boolean;
}
