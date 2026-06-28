/* Project Homeland — synthetic threat-network dataset (fictional).
   Ported from the Claude Design source `homeland-data.js`. */

export type Activity = "HIGH" | "ELEVATED" | "MODERATE";
export type Source = "sourced" | "analytical";

export interface Network {
  id: string;
  name: string;
  short: string;
  color: string;
  focus: string;
  members: number;
  region: string;
  activity: Activity;
}

export interface Actor {
  id: string;
  alias: string;
  nets: string[];
  state: string;
  city: string;
  status: string;
  source: Source;
  threat: number;
  reward: number;
}

export interface Zone {
  id: string;
  label: string;
  nets: [string, string];
  cells: string[];
  index: number;
}

// Tactical tile grid: every US state -> [row, col] (north->south, west->east)
export const GRID: Record<string, [number, number]> = {
  AK: [0, 0], VT: [0, 9], ME: [0, 10],
  WA: [1, 0], ID: [1, 1], MT: [1, 2], ND: [1, 3], MN: [1, 4], WI: [1, 6], MI: [1, 8], NY: [1, 9], NH: [1, 10],
  OR: [2, 0], NV: [2, 1], WY: [2, 2], SD: [2, 3], IA: [2, 4], IL: [2, 5], IN: [2, 6], OH: [2, 7], PA: [2, 8], MA: [2, 10],
  CA: [3, 0], UT: [3, 1], CO: [3, 2], NE: [3, 3], MO: [3, 4], KY: [3, 5], WV: [3, 6], VA: [3, 7], NJ: [3, 8], CT: [3, 9], RI: [3, 10],
  AZ: [4, 1], NM: [4, 2], KS: [4, 3], AR: [4, 4], TN: [4, 5], NC: [4, 6], MD: [4, 7], DE: [4, 8],
  OK: [5, 3], LA: [5, 4], MS: [5, 5], AL: [5, 6], GA: [5, 7], SC: [5, 8],
  HI: [6, 0], TX: [6, 3], FL: [6, 8],
};

export const PITCH = 70;
export const CELL = 60;
export const COLS = 11;
export const ROWS = 7;

export const networks: Network[] = [
  { id: "orion", name: "ORION SYNDICATE", short: "ORION", color: "#FF49A3", focus: "Financial / Cyber Fraud", members: 7, region: "Northeast Corridor", activity: "ELEVATED" },
  { id: "vesper", name: "VESPER COLLECTIVE", short: "VESPER", color: "#33E0A0", focus: "Narcotics Logistics", members: 9, region: "Gulf & Southwest", activity: "HIGH" },
  { id: "halon", name: "HALON CELL", short: "HALON", color: "#9B6CFF", focus: "Arms Trafficking", members: 5, region: "Great Lakes", activity: "MODERATE" },
  { id: "cinder", name: "CINDER NETWORK", short: "CINDER", color: "#FF8A3C", focus: "Domestic Extremism", members: 6, region: "Mountain West", activity: "ELEVATED" },
];

// source: 'sourced' = officially confirmed location/record. 'analytical' = our inferred placement.
export const actors: Actor[] = [
  { id: "greyhound", alias: "GREYHOUND", nets: ["orion"], state: "NY", city: "Albany sector", status: "ARMED & DANGEROUS", source: "sourced", threat: 5, reward: 250000 },
  { id: "meridian", alias: "MERIDIAN", nets: ["orion", "halon"], state: "PA", city: "Allegheny sector", status: "AT LARGE", source: "sourced", threat: 4, reward: 150000 },
  { id: "calloway", alias: "CALLOWAY", nets: ["halon"], state: "MI", city: "Wayne sector", status: "ARMED & DANGEROUS", source: "sourced", threat: 4, reward: 100000 },
  { id: "tinder9", alias: "TINDER-9", nets: ["halon"], state: "OH", city: "Cuyahoga sector", status: "AT LARGE", source: "analytical", threat: 3, reward: 75000 },
  { id: "vesperp", alias: "VESPER PRIME", nets: ["vesper"], state: "TX", city: "Bexar sector", status: "ARMED & DANGEROUS", source: "sourced", threat: 5, reward: 300000 },
  { id: "saltwing", alias: "SALTWING", nets: ["vesper", "cinder"], state: "AZ", city: "Pima sector", status: "AT LARGE", source: "analytical", threat: 4, reward: 120000 },
  { id: "dustoff", alias: "DUSTOFF", nets: ["cinder"], state: "NM", city: "Doña Ana sector", status: "UNDER SURVEILLANCE", source: "sourced", threat: 3, reward: 0 },
  { id: "redline", alias: "REDLINE", nets: ["cinder"], state: "CO", city: "El Paso Cnty sector", status: "ARMED & DANGEROUS", source: "sourced", threat: 4, reward: 90000 },
  { id: "quarry", alias: "QUARRY", nets: ["vesper"], state: "LA", city: "Orleans sector", status: "AT LARGE", source: "sourced", threat: 3, reward: 60000 },
  { id: "nightjar", alias: "NIGHTJAR", nets: ["orion"], state: "MA", city: "Suffolk sector", status: "UNDER SURVEILLANCE", source: "analytical", threat: 2, reward: 0 },
  { id: "hollowpt", alias: "HOLLOWPOINT", nets: ["halon", "cinder"], state: "MO", city: "Jackson sector", status: "AT LARGE", source: "analytical", threat: 4, reward: 110000 },
  { id: "ashford", alias: "ASHFORD", nets: ["orion"], state: "IL", city: "Cook sector", status: "IN CUSTODY", source: "sourced", threat: 3, reward: 0 },
  { id: "coastline", alias: "COASTLINE", nets: ["vesper"], state: "FL", city: "Dade sector", status: "ARMED & DANGEROUS", source: "sourced", threat: 4, reward: 140000 },
  { id: "palehorse", alias: "PALEHORSE", nets: ["cinder"], state: "ID", city: "Ada sector", status: "AT LARGE", source: "analytical", threat: 3, reward: 80000 },
];

// connector lines (analytical association) between actors
export const links: [string, string][] = [
  ["greyhound", "meridian"], ["meridian", "calloway"], ["calloway", "tinder9"],
  ["vesperp", "saltwing"], ["saltwing", "dustoff"], ["saltwing", "redline"],
  ["hollowpt", "calloway"], ["hollowpt", "redline"],
  ["vesperp", "quarry"], ["quarry", "coastline"],
  ["greyhound", "nightjar"], ["greyhound", "ashford"],
];

// convergence zones: where two networks share territory (all analytical / inferred)
export const zones: Zone[] = [
  { id: "ne", label: "NE CONVERGENCE", nets: ["orion", "halon"], cells: ["NY", "MI", "PA", "OH"], index: 0.71 },
  { id: "sw", label: "SW CONVERGENCE", nets: ["vesper", "cinder"], cells: ["AZ", "NM", "CO"], index: 0.64 },
  { id: "mid", label: "MIDLINE OVERLAP", nets: ["halon", "cinder"], cells: ["MO", "KS"], index: 0.38 },
];

export const netById = (id: string): Network =>
  networks.filter((n) => n.id === id)[0];

export const actorById = (id: string): Actor =>
  actors.filter((a) => a.id === id)[0];

export const center = (code: string): { x: number; y: number } | null => {
  const g = GRID[code];
  if (!g) return null;
  return { x: g[1] * PITCH + PITCH / 2, y: g[0] * PITCH + PITCH / 2 };
};

/** Convert #rrggbb to rgba() with the given alpha. */
export const hexA = (hex: string, a: number): string => {
  const h = hex.replace("#", "");
  const r = parseInt(h.substr(0, 2), 16);
  const g = parseInt(h.substr(2, 2), 16);
  const b = parseInt(h.substr(4, 2), 16);
  return `rgba(${r},${g},${b},${a})`;
};

export const HOMELAND = {
  GRID, PITCH, CELL, COLS, ROWS,
  networks, actors, links, zones,
  netById, actorById, center,
};
