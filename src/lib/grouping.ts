import type { PublicSuspect } from "@/lib/public-suspect";

/**
 * DISPLAY-LEVEL duplicate grouping (spec G2). The DB is never modified — the
 * FBI genuinely lists some people more than once (e.g. the same person on two
 * different program pages), and each row keeps its own verbatim record and
 * source link. We only fold them into one CARD when we are certain they are
 * the same person:
 *
 *   BOTH  normalized name matches (first_name + last_name when present; the
 *         live FBI data carries the person's name ONLY in `title` for every
 *         known duplicate pair — e.g. "CHRISTOPHER W. BURNS" twice with
 *         first/last null — so `title` is the fallback identity)
 *   AND   dates_of_birth_used arrays share at least one exact value.
 *
 * Records without a name or without DOBs are NEVER grouped. The DOB
 * requirement is what keeps incident-style records apart: the five separate
 * "CIVIL UNREST - OREGON" entries (and eight "VANDALISM ..." entries) share a
 * title but have NULL dates_of_birth_used, so they always remain distinct
 * rows. Fail-safe direction: when in doubt, do not group.
 */

export function normNamePart(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Grouping identity key, or null when the record is not eligible for grouping. */
export function identityKeyOf(first: string | null, last: string | null, title: string | null): string | null {
  const name = normNamePart([first, last].filter(Boolean).join(" "));
  const key = name || normNamePart(title);
  return key || null;
}

/** True when both DOB arrays are non-empty and share at least one exact value. */
export function sharesDob(a: string[] | null | undefined, b: string[] | null | undefined): boolean {
  if (!a?.length || !b?.length) return false;
  const set = new Set(a);
  return b.some((v) => set.has(v));
}

export interface DisplayGroup {
  primary: PublicSuspect;
  /** All member records, primary first. length 1 = not grouped. */
  members: PublicSuspect[];
}

/**
 * Fold a (already filtered) record list into display groups, preserving the
 * incoming order (a group sits where its first member appeared). Within a
 * name bucket, records are connected iff they share at least one exact DOB
 * value (transitively — A~B and B~C puts all three in one card).
 */
export function groupForDisplay(list: PublicSuspect[]): DisplayGroup[] {
  const groups: DisplayGroup[] = [];
  const absorbed = new Set<DisplayGroup>();
  // per identity-key: dob value -> the group (connected component) holding it
  const buckets = new Map<string, Map<string, DisplayGroup>>();

  for (const s of list) {
    const key = identityKeyOf(s.first_name, s.last_name, s.title);
    const dobs = s.dates_of_birth_used?.filter(Boolean) ?? [];
    if (!key || dobs.length === 0) {
      groups.push({ primary: s, members: [s] });
      continue;
    }
    let dobIndex = buckets.get(key);
    if (!dobIndex) {
      dobIndex = new Map();
      buckets.set(key, dobIndex);
    }
    const hits = [...new Set(dobs.map((d) => dobIndex.get(d)).filter((g): g is DisplayGroup => !!g))];
    if (hits.length > 0) {
      // join the EARLIEST-created component (list order, not the bridging
      // record's DOB order); a record bridging several merges them all
      const target =
        hits.length === 1 ? hits[0] : hits.reduce((a, b) => (groups.indexOf(a) <= groups.indexOf(b) ? a : b));
      target.members.push(s);
      for (const other of hits.slice(1)) {
        target.members.push(...other.members);
        absorbed.add(other);
      }
      for (const [d, g] of dobIndex) if (hits.includes(g)) dobIndex.set(d, target);
      for (const d of dobs) dobIndex.set(d, target);
    } else {
      const g: DisplayGroup = { primary: s, members: [s] };
      groups.push(g);
      for (const d of dobs) dobIndex.set(d, g);
    }
  }
  return absorbed.size ? groups.filter((g) => !absorbed.has(g)) : groups;
}
