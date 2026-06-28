/**
 * The state codes the basemap can actually render.
 *
 * The map loads robflaherty/us-map-raphael, whose `window.usMap` exposes exactly
 * these 51 keys: the 50 states + 'dc'. NOTABLY ABSENT: territories such as 'pr'
 * (Puerto Rico) and 'gu' (Guam). The FBI importer can resolve a field office to
 * such a code (e.g. San Juan -> 'PR'), so a record may carry a real primary_state
 * that this projection cannot plot.
 *
 * Counting such a record as "mapped" would make the rail's MAPPED/UNMAPPED tallies
 * disagree with the dots actually drawn. So both the map and the rail count a
 * record as mappable ONLY if its lowercased state code is in this set — keeping the
 * numbers honest with what the user sees.
 */
export const MAPPABLE_STATES: ReadonlySet<string> = new Set([
  "al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga",
  "hi", "id", "il", "in", "ia", "ks", "ky", "la", "me", "md",
  "ma", "mi", "mn", "ms", "mo", "mt", "ne", "nv", "nh", "nj",
  "nm", "ny", "nc", "nd", "oh", "ok", "or", "pa", "ri", "sc",
  "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv", "wi", "wy",
  "dc",
]);

/** True if a primary_state (any case, may be null) can be plotted on the basemap. */
export function isMappable(code: string | null | undefined): boolean {
  return !!code && MAPPABLE_STATES.has(code.toLowerCase());
}
