"use client";

import { CSSProperties, useEffect, useRef, useState } from "react";
import { HOMELAND, hexA } from "@/lib/homeland-data";

/* Loads robflaherty/us-map-raphael path data onto window.usMap, measures each
   state's bounding-box center, then overlays markers, convergence zones,
   association lines and labels. Ported from the HomelandMap.dc.html design. */

declare global {
  interface Window {
    usMap?: Record<string, string>;
  }
}

const US_MAP_SRC = "https://cdn.jsdelivr.net/gh/robflaherty/us-map-raphael/us-map-svg.js";

type Variant = "sentinel" | "watchfloor";
type Centers = Record<string, { x: number; y: number }>;

export interface HomelandMapProps {
  variant?: Variant;
  showZones?: boolean;
  showConnectors?: boolean;
  scanline?: boolean;
}

function useUsMap(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.usMap) {
      setReady(true);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const existing = document.querySelector<HTMLScriptElement>(`script[data-usmap]`);
    const poll = () => {
      timer = setInterval(() => {
        if (window.usMap) {
          if (timer) clearInterval(timer);
          timer = null;
          if (!cancelled) setReady(true);
        }
      }, 40);
    };
    if (!existing) {
      const s = document.createElement("script");
      s.src = US_MAP_SRC;
      s.async = true;
      s.dataset.usmap = "1";
      document.head.appendChild(s);
    }
    poll();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);
  return ready;
}

export default function HomelandMap({
  variant = "sentinel",
  showZones = true,
  showConnectors = true,
  scanline = true,
}: HomelandMapProps) {
  const usMapReady = useUsMap();
  const svgRef = useRef<SVGSVGElement>(null);
  const [centers, setCenters] = useState<Centers | null>(null);

  const H = HOMELAND;
  const U = usMapReady && typeof window !== "undefined" ? window.usMap : undefined;
  const watch = variant === "watchfloor";

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

  const gradients = H.networks.map((n) => ({
    id: "grad-" + n.id,
    c0: hexA(n.color, 0.55),
    c1: hexA(n.color, 0.22),
    c2: hexA(n.color, 0),
  }));

  // state polygons, tinted by the network occupying that state
  const byState: Record<string, (typeof H.actors)[number]> = {};
  H.actors.forEach((a) => {
    byState[a.state.toLowerCase()] = a;
  });

  const statePaths = U
    ? Object.keys(U).map((code) => {
        const a = byState[code];
        const net = a ? H.netById(a.nets[0]) : null;
        const st: CSSProperties = {
          fill: "rgba(16,28,40,0.5)",
          stroke: `rgba(95,230,255,${watch ? 0.5 : 0.4})`,
          strokeWidth: "0.8",
          strokeLinejoin: "round",
          transition: "fill .3s",
        };
        if (net) {
          st.fill = hexA(net.color, 0.2);
          st.stroke = hexA(net.color, 0.92);
          st.strokeWidth = "1.1";
          st.filter = `drop-shadow(0 0 3px ${hexA(net.color, 0.85)})`;
          if (a && a.source === "analytical") {
            st.fill = "rgba(16,28,40,0.42)";
            st.strokeDasharray = "4 3";
            st.strokeWidth = "1";
            st.filter = `drop-shadow(0 0 2px ${hexA(net.color, 0.55)})`;
          }
        }
        return { code, d: U[code], style: st };
      })
    : [];

  // markers / lines / zones / labels only after centers are measured
  let markers: ReturnType<typeof buildMarkers> = [];
  let lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const zoneBlobs: { cx: number; cy: number; r: number; fill: string; style: CSSProperties }[] = [];
  const zoneOutlines: { cx: number; cy: number; r: number }[] = [];
  let leaderLines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  let labelEls: React.ReactNode[] = [];

  if (centers) {
    markers = buildMarkers(centers);

    if (showConnectors) {
      lines = H.links
        .map((p) => {
          const a = centers[H.actorById(p[0]).state.toLowerCase()];
          const b = centers[H.actorById(p[1]).state.toLowerCase()];
          if (!a || !b) return null;
          return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
        })
        .filter((l): l is NonNullable<typeof l> => Boolean(l));
    }

    const zoneLabelData: {
      cx: number; cy: number; rad: number;
      aName: string; bName: string; aColor: string; bColor: string;
      name: string; pct: number;
    }[] = [];

    if (showZones) {
      H.zones.forEach((z) => {
        const cs = z.cells.map((cd) => centers[cd.toLowerCase()]).filter(Boolean);
        if (cs.length < 2) return;
        const cx = cs.reduce((s, p) => s + p.x, 0) / cs.length;
        const cy = cs.reduce((s, p) => s + p.y, 0) / cs.length;
        let rad = 0;
        cs.forEach((p) => {
          rad = Math.max(rad, Math.hypot(p.x - cx, p.y - cy));
        });
        rad += 34;
        z.nets.forEach((nid, i) => {
          const off = (i === 0 ? -1 : 1) * 10;
          zoneBlobs.push({
            cx: cx + off,
            cy,
            r: rad,
            fill: `url(#grad-${nid})`,
            style: {
              mixBlendMode: "screen",
              filter: "blur(3px)",
              animation: `hl-zone ${5 + i}s ease-in-out infinite`,
            },
          });
        });
        zoneOutlines.push({ cx, cy, r: rad });
        const na = H.netById(z.nets[0]);
        const nb = H.netById(z.nets[1]);
        zoneLabelData.push({
          cx, cy, rad,
          aName: na.short, bName: nb.short, aColor: na.color, bColor: nb.color,
          name: z.label, pct: Math.round(z.index * 100),
        });
      });
    }

    // labels as real SVG <text>
    const built = buildLabels(centers, byState, zoneLabelData);
    leaderLines = built.leaders;
    labelEls = built.els;
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

  function buildMarkers(c: Centers) {
    return H.actors
      .map((a) => {
        const ctr = c[a.state.toLowerCase()];
        if (!ctr) return null;
        const net = H.netById(a.nets[0]);
        const sourced = a.source === "sourced";
        const dual = a.nets.length > 1;
        const m = {
          id: a.id,
          cx: ctr.x,
          cy: ctr.y,
          color: net.color,
          sourced,
          analytical: !sourced,
          dual,
          color2: dual ? H.netById(a.nets[1]).color : null,
          ringStyle: {
            transformBox: "fill-box",
            transformOrigin: "center",
            animation: "hl-pulse 2.8s ease-out infinite",
          } as CSSProperties,
          r: sourced ? 3.4 : 3.2,
          dotFill: sourced ? net.color : "rgba(8,12,16,0.75)",
          dotStroke: sourced ? "#ffffff" : net.color,
          dash: sourced ? "none" : "1.6 1.6",
          dotStyle: {
            filter: sourced
              ? `drop-shadow(0 0 3px ${net.color})`
              : `drop-shadow(0 0 2px ${hexA(net.color, 0.7)})`,
          } as CSSProperties,
        };
        return m;
      })
      .filter((m): m is NonNullable<typeof m> => Boolean(m));
  }

  function buildLabels(
    c: Centers,
    byStateMap: typeof byState,
    zoneLabelData: {
      cx: number; cy: number; rad: number;
      aName: string; bName: string; aColor: string; bColor: string;
      name: string; pct: number;
    }[],
  ) {
    const smallSet: Record<string, number> = { vt: 1, nh: 1, ma: 1, ri: 1, ct: 1, nj: 1, de: 1, md: 1 };
    const els: React.ReactNode[] = [];
    const smallArr: { code: string; c: { x: number; y: number }; color: string }[] = [];
    const leaders: { x1: number; y1: number; x2: number; y2: number }[] = [];

    Object.keys(c).forEach((code) => {
      const ctr = c[code];
      const a = byStateMap[code];
      const net = a ? H.netById(a.nets[0]) : null;
      const col = net ? net.color : "rgba(165,210,232,0.66)";
      if (smallSet[code]) {
        smallArr.push({ code, c: ctr, color: col });
        return;
      }
      els.push(
        <text key={"b_" + code} x={ctr.x} y={ctr.y + (a ? 7.6 : 2.6)} textAnchor="middle" style={codeStyle(col, 8)}>
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
          key={"zp" + zi}
          x={z.cx}
          y={py}
          textAnchor="middle"
          style={{
            fontFamily: "'Oxanium', sans-serif",
            fontSize: "10.5px",
            fontWeight: 700,
            letterSpacing: "0.4px",
            paintOrder: "stroke",
            stroke: "rgba(6,10,14,0.96)",
            strokeWidth: "2.8px",
          }}
        >
          <tspan style={{ fill: z.aColor }}>{z.aName}</tspan>
          <tspan style={{ fill: "#d4e3ec" }}>{"  ×  "}</tspan>
          <tspan style={{ fill: z.bColor }}>{z.bName}</tspan>
        </text>,
      );
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
          {z.name + "  ·  " + z.pct + "% CONVERGENCE"}
        </text>,
      );
    });

    return { els, leaders };
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
            <path key={s.code} d={s.d} data-state={s.code} style={s.style} />
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
            <g key={m.id}>
              {m.dual && m.color2 && (
                <circle cx={m.cx} cy={m.cy} r={8} fill="none" stroke={m.color2} strokeWidth="0.8" opacity="0.65" />
              )}
              {m.sourced && (
                <circle cx={m.cx} cy={m.cy} r={5} fill="none" stroke={m.color} strokeWidth="0.9" style={m.ringStyle} />
              )}
              {m.analytical && (
                <circle cx={m.cx} cy={m.cy} r={5.5} fill="none" stroke={m.color} strokeWidth="0.7" strokeDasharray="2 2" opacity="0.5" />
              )}
              <circle
                cx={m.cx}
                cy={m.cy}
                r={m.r}
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
    </div>
  );
}
