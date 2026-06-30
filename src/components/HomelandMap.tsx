"use client";

import { CSSProperties, useEffect, useRef, useState } from "react";
import { hexA } from "@/lib/color";
import type { PublicSuspect } from "@/lib/public-suspect";

/* US tactical map. Loads robflaherty/us-map-raphael path data onto window.usMap,
   measures each state's bbox center, then overlays:
     - a uniform "official" tint on states that hold ≥1 record
     - one marker per state-resolved suspect (single 'sourced' treatment)
     - convergence association lines + zones — PRODUCT A, no data yet, so they
       come in as empty arrays and render NOTHING (guarded, never crash).

   Client component: receives plain serializable PublicSuspect[] as props. It does
   NOT import the db client. */

declare global {
  interface Window {
    usMap?: Record<string, string>;
  }
}

const US_MAP_SRC = "https://cdn.jsdelivr.net/gh/robflaherty/us-map-raphael/us-map-svg.js";

// Single default treatment for official/sourced records (no per-network color —
// that is Product A, which has no data yet).
const SOURCED_COLOR = "#5fe6ff";

type Variant = "sentinel" | "watchfloor";
type Centers = Record<string, { x: number; y: number }>;

/** Convergence association between two state centers (Product A — empty for now). */
export interface ConvergenceLink {
  fromState: string;
  toState: string;
}

/** Convergence zone spanning several states (Product A — empty for now). */
export interface ConvergenceZone {
  cells: string[];
  label: string;
  pct: number;
  colorA: string;
  colorB: string;
}

export interface HomelandMapProps {
  suspects: PublicSuspect[];
  /** Product-A convergence layers. Default empty -> render nothing. */
  links?: ConvergenceLink[];
  zones?: ConvergenceZone[];
  variant?: Variant;
  showZones?: boolean;
  showConnectors?: boolean;
  scanline?: boolean;
  /** Active state filter (uppercase 2-letter code) — highlights that state. */
  selectedState?: string | null;
  /** Click a state/marker to drive the shared filter. Toggle: same code -> null. */
  onSelectState?: (code: string | null) => void;
}

const SELECTED_COLOR = "#f3c25a";

type MapStatus = "loading" | "ready" | "failed";

// Stop polling after this many 40ms ticks (~6s) so a CDN/CSP/offline failure
// degrades to a visible "basemap unavailable" state instead of spinning forever.
const MAX_POLL_TICKS = 150;

function useUsMap(): MapStatus {
  // Deterministic initial state (SSR-safe): always "loading" on first render so
  // server and client hydrate identically; the effect promotes it to ready/failed.
  const [status, setStatus] = useState<MapStatus>("loading");
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.usMap) {
      // Sync a pre-existing third-party global (e.g. cached across navigations)
      // into React state. This is an external-system sync, not derived state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus("ready");
      return;
    }
    let cancelled = false;
    let ticks = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const existing = document.querySelector<HTMLScriptElement>(`script[data-usmap]`);
    if (!existing) {
      const s = document.createElement("script");
      s.src = US_MAP_SRC;
      s.async = true;
      s.dataset.usmap = "1";
      s.onerror = () => {
        if (!cancelled) {
          stop();
          setStatus("failed");
        }
      };
      document.head.appendChild(s);
    }
    timer = setInterval(() => {
      if (window.usMap) {
        stop();
        if (!cancelled) setStatus("ready");
      } else if (++ticks >= MAX_POLL_TICKS) {
        stop();
        if (!cancelled) setStatus("failed");
      }
    }, 40);
    return () => {
      cancelled = true;
      stop();
    };
  }, []);
  return status;
}

function codeStyle(col: string, size = 8): CSSProperties {
  return {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: `${size}px`,
    fontWeight: 600,
    letterSpacing: "0.3px",
    fill: col,
    paintOrder: "stroke",
    stroke: "rgba(6,10,14,0.95)",
    strokeWidth: "2px",
  };
}

export default function HomelandMap({
  suspects,
  links = [],
  zones = [],
  variant = "sentinel",
  showZones = true,
  showConnectors = true,
  scanline = true,
  selectedState = null,
  onSelectState,
}: HomelandMapProps) {
  const mapStatus = useUsMap();
  const svgRef = useRef<SVGSVGElement>(null);
  const [centers, setCenters] = useState<Centers | null>(null);

  const U = mapStatus === "ready" && typeof window !== "undefined" ? window.usMap : undefined;
  const watch = variant === "watchfloor";

  // group by resolved_state (best-available from location-recovery) — lowercased
  // to match usMap keys. Records with no resolved state stay in the list, off the map.
  const byState: Record<string, PublicSuspect[]> = {};
  suspects.forEach((s) => {
    if (!s.resolved_state) return;
    const code = s.resolved_state.toLowerCase();
    (byState[code] ||= []).push(s);
  });
  const occupied = new Set(Object.keys(byState));

  // measure state path centers once the SVG paths are in the DOM
  useEffect(() => {
    if (!U || centers || !svgRef.current) return;
    const svg = svgRef.current;
    const measured: Centers = {};
    svg.querySelectorAll<SVGPathElement>("path[data-state]").forEach((p) => {
      try {
        const b = p.getBBox();
        const code = p.getAttribute("data-state");
        if (code) measured[code] = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      } catch {
        /* getBBox can throw if not yet laid out */
      }
    });
    // Storing geometry read from the laid-out DOM (getBBox) — a genuine
    // external-system→state sync that can only happen after paint.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (Object.keys(measured).length) setCenters(measured);
  }, [U, centers]);

  const boardWrap: CSSProperties = {
    position: "relative",
    width: "100%",
    height: "100%",
    minHeight: "200px",
    background: "#0a0c10",
    borderRadius: "10px",
  };
  const gridBg: CSSProperties = {
    position: "absolute",
    inset: 0,
    borderRadius: "10px",
    overflow: "hidden",
    pointerEvents: "none",
    background:
      "radial-gradient(ellipse 70% 80% at 50% 46%, rgba(22,46,62,0.5), rgba(6,9,13,0.0) 75%)," +
      `repeating-linear-gradient(0deg, rgba(95,230,255,${watch ? 0.06 : 0.04}) 0 1px, transparent 1px 34px),` +
      `repeating-linear-gradient(90deg, rgba(95,230,255,${watch ? 0.06 : 0.04}) 0 1px, transparent 1px 34px)`,
  };
  const svgStyle: CSSProperties = {
    position: "relative",
    width: "100%",
    height: "100%",
    display: "block",
    overflow: "visible",
  };
  const baseGlow: CSSProperties = { filter: "drop-shadow(0 0 2px rgba(95,230,255,0.55))" };

  // per-zone radial gradients (empty while there are no zones)
  const gradients = zones.map((z, i) => ({
    id: "grad-z" + i,
    c0: hexA(z.colorA, 0.5),
    c1: hexA(z.colorB, 0.22),
    c2: hexA(z.colorB, 0),
  }));

  // state polygons: default base, or a SINGLE uniform official tint where records exist.
  const statePaths = U
    ? Object.keys(U).map((code) => {
        const st: CSSProperties = {
          fill: "rgba(16,28,40,0.5)",
          stroke: `rgba(95,230,255,${watch ? 0.5 : 0.4})`,
          strokeWidth: "0.8",
          strokeLinejoin: "round",
          transition: "fill .3s",
        };
        if (occupied.has(code)) {
          st.fill = hexA(SOURCED_COLOR, 0.12);
          st.stroke = hexA(SOURCED_COLOR, 0.8);
          st.strokeWidth = "1.1";
          st.filter = `drop-shadow(0 0 3px ${hexA(SOURCED_COLOR, 0.7)})`;
        }
        // active state filter highlight overrides the occupied tint
        if (selectedState && code.toUpperCase() === selectedState) {
          st.fill = hexA(SELECTED_COLOR, 0.18);
          st.stroke = SELECTED_COLOR;
          st.strokeWidth = "1.4";
          st.filter = `drop-shadow(0 0 4px ${hexA(SELECTED_COLOR, 0.8)})`;
        }
        if (onSelectState) st.cursor = "pointer";
        return { code, d: U[code], style: st };
      })
    : [];

  // markers / lines / zones / labels only after centers are measured
  type Marker = {
    id: string;
    code: string;
    cx: number;
    cy: number;
    sourced: boolean;
    ringStyle: CSSProperties;
    dotFill: string;
    dotStroke: string;
    dash: string;
    dotStyle: CSSProperties;
  };
  let markers: Marker[] = [];
  let lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const zoneBlobs: { cx: number; cy: number; r: number; fill: string; style: CSSProperties }[] = [];
  const zoneOutlines: { cx: number; cy: number; r: number }[] = [];
  let leaderLines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  let labelEls: React.ReactNode[] = [];

  if (centers) {
    // one marker per state-resolved suspect; jitter when several share a state
    const built: Marker[] = [];
    Object.entries(byState).forEach(([code, group]) => {
      const ctr = centers[code];
      if (!ctr) return;
      const n = group.length;
      // spread co-located markers on a ring; widen it a touch with the count so a
      // busy state's dots stay distinguishable (capped so they don't fly off-state).
      const rad = Math.min(6 + n, 13);
      group.forEach((s, i) => {
        let cx = ctr.x;
        let cy = ctr.y;
        if (n > 1) {
          const ang = (i / n) * Math.PI * 2;
          cx += Math.cos(ang) * rad;
          cy += Math.sin(ang) * rad;
        }
        // data_class is always 'official' here, but keep the branch for later.
        const sourced = s.data_class === "official";
        built.push({
          id: s.id,
          code,
          cx,
          cy,
          sourced,
          ringStyle: {
            transformBox: "fill-box",
            transformOrigin: "center",
            animation: "hl-pulse 2.8s ease-out infinite",
          },
          dotFill: sourced ? SOURCED_COLOR : "rgba(8,12,16,0.75)",
          dotStroke: sourced ? "#ffffff" : SOURCED_COLOR,
          dash: sourced ? "none" : "1.6 1.6",
          dotStyle: {
            filter: sourced
              ? `drop-shadow(0 0 3px ${SOURCED_COLOR})`
              : `drop-shadow(0 0 2px ${hexA(SOURCED_COLOR, 0.7)})`,
          },
        });
      });
    });
    markers = built;

    // convergence association lines — empty array now -> renders nothing
    if (showConnectors) {
      lines = links
        .map((l) => {
          const a = centers[l.fromState.toLowerCase()];
          const b = centers[l.toState.toLowerCase()];
          if (!a || !b) return null;
          return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
        })
        .filter((l): l is NonNullable<typeof l> => Boolean(l));
    }

    // convergence zones — empty array now -> renders nothing
    const zoneLabelData: {
      cx: number; cy: number; rad: number;
      label: string; pct: number; colorA: string; colorB: string;
    }[] = [];
    if (showZones) {
      zones.forEach((z, zi) => {
        const cs = z.cells.map((cd) => centers[cd.toLowerCase()]).filter(Boolean);
        if (cs.length < 2) return;
        const cx = cs.reduce((s, p) => s + p.x, 0) / cs.length;
        const cy = cs.reduce((s, p) => s + p.y, 0) / cs.length;
        let rad = 0;
        cs.forEach((p) => {
          rad = Math.max(rad, Math.hypot(p.x - cx, p.y - cy));
        });
        rad += 34;
        zoneBlobs.push({
          cx,
          cy,
          r: rad,
          fill: `url(#grad-z${zi})`,
          style: { mixBlendMode: "screen", filter: "blur(3px)", animation: `hl-zone 5s ease-in-out infinite` },
        });
        zoneOutlines.push({ cx, cy, r: rad });
        zoneLabelData.push({ cx, cy, rad, label: z.label, pct: z.pct, colorA: z.colorA, colorB: z.colorB });
      });
    }

    // labels as real SVG <text>: state codes (geometry, not network data) + any zone labels
    const built2 = buildLabels(centers, occupied, zoneLabelData);
    leaderLines = built2.leaders;
    labelEls = built2.els;
  }

  function buildLabels(
    c: Centers,
    occupiedCodes: Set<string>,
    zoneLabelData: {
      cx: number; cy: number; rad: number;
      label: string; pct: number; colorA: string; colorB: string;
    }[],
  ) {
    const smallSet: Record<string, number> = { vt: 1, nh: 1, ma: 1, ri: 1, ct: 1, nj: 1, de: 1, md: 1 };
    const els: React.ReactNode[] = [];
    const smallArr: { code: string; c: { x: number; y: number }; color: string }[] = [];
    const leaders: { x1: number; y1: number; x2: number; y2: number }[] = [];

    Object.keys(c).forEach((code) => {
      const ctr = c[code];
      const has = occupiedCodes.has(code);
      const col = has ? SOURCED_COLOR : "rgba(165,210,232,0.66)";
      if (smallSet[code]) {
        smallArr.push({ code, c: ctr, color: col });
        return;
      }
      els.push(
        <text key={"b_" + code} x={ctr.x} y={ctr.y + (has ? 7.6 : 2.6)} textAnchor="middle" style={codeStyle(col, 8)}>
          {code.toUpperCase()}
        </text>,
      );
    });

    smallArr.sort((p, q) => p.c.y - q.c.y);
    const sx = 944;
    const sy0 = 148;
    const dy = 17.5;
    smallArr.forEach((o, i) => {
      const ly = sy0 + i * dy;
      leaders.push({ x1: o.c.x, y1: o.c.y, x2: sx - 4, y2: ly - 2.6 });
      els.push(
        <text key={"s_" + o.code} x={sx} y={ly} textAnchor="start" style={codeStyle(o.color, 8.5)}>
          {o.code.toUpperCase()}
        </text>,
      );
    });

    zoneLabelData.forEach((z, zi) => {
      const py = Math.max(12, z.cy - z.rad - 7);
      els.push(
        <text
          key={"zn" + zi}
          x={z.cx}
          y={py + 11}
          textAnchor="middle"
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: "7.5px",
            fontWeight: 600,
            letterSpacing: "0.5px",
            fill: "rgba(195,218,236,0.84)",
            paintOrder: "stroke",
            stroke: "rgba(6,10,14,0.92)",
            strokeWidth: "1.8px",
          }}
        >
          {z.label + "  ·  " + z.pct + "% CONVERGENCE"}
        </text>,
      );
    });

    return { els, leaders };
  }

  // toggle the shared state filter: clicking the active state clears it
  function toggleState(code: string) {
    if (!onSelectState) return;
    const up = code.toUpperCase();
    onSelectState(selectedState === up ? null : up);
  }

  return (
    <div style={boardWrap}>
      <div style={gridBg} />
      <svg ref={svgRef} viewBox="0 0 959 593" preserveAspectRatio="xMidYMid meet" style={svgStyle}>
        <defs>
          {gradients.map((g) => (
            <radialGradient key={g.id} id={g.id} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={g.c0} />
              <stop offset="46%" stopColor={g.c1} />
              <stop offset="72%" stopColor={g.c2} />
            </radialGradient>
          ))}
        </defs>

        <g style={baseGlow}>
          {statePaths.map((s) => (
            <path
              key={s.code}
              d={s.d}
              data-state={s.code}
              style={s.style}
              onClick={onSelectState ? () => toggleState(s.code) : undefined}
            />
          ))}
        </g>

        <g>
          {zoneBlobs.map((z, i) => (
            <circle key={"zb" + i} cx={z.cx} cy={z.cy} r={z.r} fill={z.fill} style={z.style} />
          ))}
        </g>

        <g>
          {zoneOutlines.map((z, i) => (
            <circle
              key={"zo" + i}
              cx={z.cx}
              cy={z.cy}
              r={z.r}
              fill="none"
              stroke="rgba(190,215,235,0.32)"
              strokeWidth="0.7"
              strokeDasharray="3 3"
            />
          ))}
        </g>

        <g>
          {lines.map((l, i) => (
            <g key={"ln" + i}>
              <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="rgba(236,246,250,0.7)" strokeWidth="2.4" strokeLinecap="round" />
              <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="rgba(7,13,18,0.95)" strokeWidth="1.1" strokeLinecap="round" />
            </g>
          ))}
        </g>

        <g>
          {markers.map((m) => (
            <g
              key={m.id}
              onClick={onSelectState ? () => toggleState(m.code) : undefined}
              style={onSelectState ? { cursor: "pointer" } : undefined}
            >
              {m.sourced && (
                <circle cx={m.cx} cy={m.cy} r={5} fill="none" stroke={SOURCED_COLOR} strokeWidth="0.9" style={m.ringStyle} />
              )}
              {!m.sourced && (
                <circle cx={m.cx} cy={m.cy} r={5.5} fill="none" stroke={SOURCED_COLOR} strokeWidth="0.7" strokeDasharray="2 2" opacity="0.5" />
              )}
              <circle
                cx={m.cx}
                cy={m.cy}
                r={m.sourced ? 3.4 : 3.2}
                fill={m.dotFill}
                stroke={m.dotStroke}
                strokeWidth="0.8"
                strokeDasharray={m.dash}
                style={m.dotStyle}
              />
            </g>
          ))}
        </g>

        <g>
          {leaderLines.map((l, i) => (
            <line key={"ll" + i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="rgba(155,205,228,0.32)" strokeWidth="0.5" />
          ))}
        </g>

        <g>{labelEls}</g>

        {scanline && <rect x="0" y="0" width="959" height="2" fill="url(#hl-scanfill)" style={{ animation: "hl-scan 9s linear infinite" }} />}
        <defs>
          <linearGradient id="hl-scanfill" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(95,230,255,0)" />
            <stop offset="50%" stopColor="rgba(95,230,255,0.5)" />
            <stop offset="100%" stopColor="rgba(95,230,255,0)" />
          </linearGradient>
        </defs>
      </svg>

      {mapStatus === "failed" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              letterSpacing: "2px",
              color: "#7c93a1",
              border: "1px solid rgba(120,180,210,0.25)",
              borderRadius: 5,
              padding: "8px 14px",
              background: "rgba(9,13,19,0.7)",
            }}
          >
            ◬ BASEMAP UNAVAILABLE
          </span>
        </div>
      )}
    </div>
  );
}
