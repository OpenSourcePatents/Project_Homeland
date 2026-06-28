/**
 * FBI field office (the slug as returned in api.fbi.gov `field_offices[]`,
 * e.g. "charlotte", "newhaven", "saltlakecity") -> US state / territory code.
 *
 * Used ONLY to resolve suspect_profiles.primary_state from field_offices[0].
 * This is a deliberately conservative, honest lookup: if an office slug is not
 * in this table we return null. We NEVER guess a state from prose, details, or
 * a partial match — a wrong state is worse than null for a tool that maps named
 * people to places.
 *
 * Coverage: the 55 FBI field offices plus the Washington Field Office (DC).
 * Keys are stored in NORMALIZED form (lowercased, non-alphanumerics stripped)
 * so lookups are robust to casing/spacing/punctuation variations in the source.
 */
export const FBI_FIELD_OFFICE_STATES: Readonly<Record<string, string>> = {
  albany: 'NY',
  albuquerque: 'NM',
  anchorage: 'AK',
  atlanta: 'GA',
  baltimore: 'MD',
  birmingham: 'AL',
  boston: 'MA',
  buffalo: 'NY',
  charlotte: 'NC',
  chicago: 'IL',
  cincinnati: 'OH',
  cleveland: 'OH',
  columbia: 'SC',
  dallas: 'TX',
  denver: 'CO',
  detroit: 'MI',
  elpaso: 'TX',
  honolulu: 'HI',
  houston: 'TX',
  indianapolis: 'IN',
  jackson: 'MS',
  jacksonville: 'FL',
  kansascity: 'MO', // Kansas City field office is in Missouri
  knoxville: 'TN',
  lasvegas: 'NV',
  littlerock: 'AR',
  losangeles: 'CA',
  louisville: 'KY',
  memphis: 'TN',
  miami: 'FL',
  milwaukee: 'WI',
  minneapolis: 'MN',
  mobile: 'AL',
  newark: 'NJ',
  newhaven: 'CT',
  neworleans: 'LA',
  newyork: 'NY',
  norfolk: 'VA',
  oklahomacity: 'OK',
  omaha: 'NE',
  philadelphia: 'PA',
  phoenix: 'AZ',
  pittsburgh: 'PA',
  portland: 'OR', // Portland field office covers Oregon
  richmond: 'VA',
  sacramento: 'CA',
  saltlakecity: 'UT',
  sanantonio: 'TX',
  sandiego: 'CA',
  sanfrancisco: 'CA',
  sanjuan: 'PR',
  seattle: 'WA',
  springfield: 'IL', // Springfield field office is in Illinois
  stlouis: 'MO',
  tampa: 'FL',
  washingtondc: 'DC', // Washington Field Office (WFO)
  washington: 'DC', // alias, in case the source emits the short slug
};

/** Normalize an office string to the key form used in the table above. */
export function normalizeFieldOffice(office: string): string {
  return office.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Resolve a single field-office slug to a 2-letter state/territory code.
 * Returns null for empty input or any office not in the lookup — by design.
 */
export function resolveFieldOfficeState(
  office: string | null | undefined,
): string | null {
  if (!office) return null;
  return FBI_FIELD_OFFICE_STATES[normalizeFieldOffice(office)] ?? null;
}
