"use client";

import { CSSProperties, useEffect, useState } from "react";
import HomelandMap from "@/components/HomelandMap";
import { HOMELAND, hexA, Actor } from "@/lib/homeland-data";

/* DIRECTION A · SENTINEL — cinematic floating-glass command.
   Ported from "Project Homeland - Command.dc.html". */

function fmtReward(n: number): string {
  return n > 0 ? "$" + n.toLocaleString("en-US") : "— NO BOUNTY";
}

function statusColor(s: string): string {
  return s === "ARMED & DANGEROUS"
    ? "#ff3b4e"
    : s === "AT LARGE"
      ? "#f3c25a"
      : s === "UNDER SURVEILLANCE"
        ? "#5fe6ff"
        : "#8aa0ad";
}

const H = HOMELAND;

const roster = H.networks.map((n) => {
  const pct = n.activity === "HIGH" ? 88 : n.activity === "ELEVATED" ? 68 : 48;
  return {
    short: n.short,
    name: n.name,
    focus: n.focus,
    members: n.members,
    region: n.region,
    color: n.color,
    borderColor: hexA(n.color, 0.45),
    chip: {
      width: "11px",
      height: "11px",
      borderRadius: "3px",
      background: n.color,
      boxShadow: `0 0 8px ${n.color}`,
      flex: "0 0 auto",
    } as CSSProperties,
    bar: {
      height: "100%",
      width: pct + "%",
      borderRadius: "2px",
      background: `linear-gradient(90deg,${hexA(n.color, 0.4)},${n.color})`,
      boxShadow: `0 0 6px ${hexA(n.color, 0.55)}`,
    } as CSSProperties,
  };
});

const zonesV = H.zones.map((z) => {
  const a = H.netById(z.nets[0]);
  const b = H.netById(z.nets[1]);
  const pct = Math.round(z.index * 100);
  return {
    label: z.label,
    pct,
    aShort: a.short,
    bShort: b.short,
    aColor: a.color,
    bColor: b.color,
    bar: {
      height: "100%",
      width: pct + "%",
      borderRadius: "2px",
      background: `linear-gradient(90deg,${a.color},${b.color})`,
      boxShadow: "0 0 6px rgba(255,255,255,0.22)",
    } as CSSProperties,
  };
});

interface RecordVM {
  id: string;
  alias: string;
  sourced: boolean;
  loc: string;
  status: string;
  reward: string;
  tagText: string;
  card: CSSProperties;
  accent: CSSProperties;
  netDot: CSSProperties;
  tag: CSSProperties;
  statusStyle: CSSProperties;
}

function toRecord(a: Actor): RecordVM {
  const net = H.netById(a.nets[0]);
  const sourced = a.source === "sourced";
  const sc = statusColor(a.status);
  const card: CSSProperties = {
    position: "relative",
    display: "flex",
    gap: "11px",
    padding: "9px 11px 9px 15px",
    borderRadius: "7px",
    flex: "0 0 auto",
    background: sourced ? "rgba(18,27,36,0.68)" : "rgba(13,18,25,0.4)",
    border: sourced ? "1px solid rgba(120,180,210,0.2)" : "1.5px dashed rgba(150,170,190,0.34)",
  };
  const accent: CSSProperties = sourced
    ? {
        position: "absolute",
        left: 0,
        top: "8px",
        bottom: "8px",
        width: "3px",
        borderRadius: "0 3px 3px 0",
        background: net.color,
        boxShadow: `0 0 8px ${net.color}`,
      }
    : {
        position: "absolute",
        left: 0,
        top: "8px",
        bottom: "8px",
        width: "3px",
        borderRadius: "0 3px 3px 0",
        background: `repeating-linear-gradient(180deg,${net.color} 0 4px, transparent 4px 8px)`,
      };
  const netDot: CSSProperties = {
    width: "7px",
    height: "7px",
    borderRadius: "2px",
    background: net.color,
    boxShadow: `0 0 6px ${net.color}`,
    flex: "0 0 auto",
  };
  const tag: CSSProperties = sourced
    ? {
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: "7.5px",
        fontWeight: 700,
        letterSpacing: "1px",
        color: "#06121a",
        background: "#9fe7c8",
        padding: "2px 6px",
        borderRadius: "3px",
        flex: "0 0 auto",
      }
    : {
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: "7.5px",
        fontWeight: 700,
        letterSpacing: "1px",
        color: "#f3c25a",
        background: "transparent",
        border: "1px dashed rgba(243,194,90,0.7)",
        padding: "1px 5px",
        borderRadius: "3px",
        fontStyle: "italic",
        flex: "0 0 auto",
      };
  const statusStyle: CSSProperties = {
    fontFamily: "'Oxanium', sans-serif",
    fontSize: "10px",
    fontWeight: 600,
    letterSpacing: "0.5px",
    color: sc,
    textTransform: "uppercase",
  };
  return {
    id: a.id,
    alias: a.alias,
    sourced,
    loc: a.state + " · " + a.city,
    status: a.status,
    reward: fmtReward(a.reward),
    tagText: sourced ? "SOURCED" : "INFERRED",
    card,
    accent,
    netDot,
    tag,
    statusStyle,
  };
}

const records = H.actors.map(toRecord);
const sourcedCount = H.actors.filter((a) => a.source === "sourced").length;
const convAvg = Math.round((H.zones.reduce((s, z) => s + z.index, 0) / H.zones.length) * 100);
const stats = {
  total: H.actors.length,
  sourced: sourcedCount,
  analytical: H.actors.length - sourcedCount,
};

const LABEL = "Oxanium, sans-serif";
const MONO = "'IBM Plex Mono', monospace";

function useScale() {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / 1440, window.innerHeight / 900));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return scale;
}

export default function Home() {
  const scale = useScale();

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#04060a",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: 1440,
          height: 900,
          transform: `scale(${scale})`,
          transformOrigin: "center center",
          flex: "0 0 auto",
        }}
      >
        <div
          style={{
            position: "relative",
            width: 1440,
            height: 900,
            overflow: "hidden",
            borderRadius: 6,
            background: "#07090d",
            border: "1px solid rgba(120,180,210,0.16)",
            boxShadow: "0 30px 80px rgba(0,0,0,0.5)",
          }}
        >
          {/* map (full-bleed) */}
          <div style={{ position: "absolute", left: 0, top: 54, right: 0, bottom: 0 }}>
            <HomelandMap variant="sentinel" />
          </div>

          {/* top command bar */}
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              right: 0,
              height: 54,
              zIndex: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 22px",
              background: "linear-gradient(180deg, rgba(9,12,17,0.95), rgba(9,12,17,0.45))",
              backdropFilter: "blur(9px)",
              WebkitBackdropFilter: "blur(9px)",
              borderBottom: "1px solid rgba(243,194,90,0.22)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
              <div
                style={{
                  width: 14,
                  height: 14,
                  transform: "rotate(45deg)",
                  background: "linear-gradient(135deg,#f3c25a,#c4122b)",
                  boxShadow: "0 0 12px rgba(243,194,90,0.55)",
                }}
              />
              <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
                <span style={{ fontFamily: LABEL, fontWeight: 800, fontSize: 15, letterSpacing: "3.5px", color: "#eef4f8" }}>
                  PROJECT HOMELAND
                </span>
                <span style={{ fontFamily: MONO, fontSize: 8, letterSpacing: "2.6px", color: "#ff5667", marginTop: 4 }}>
                  CIVIL THREAT-CONVERGENCE GRID
                </span>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: "#5fe6ff",
                    boxShadow: "0 0 8px #5fe6ff",
                    animation: "hl-blink 2.2s ease-in-out infinite",
                  }}
                />
                <span style={{ fontFamily: LABEL, fontSize: 10, fontWeight: 600, letterSpacing: "1.6px", color: "#bfe9ff" }}>
                  GRID · LIVE
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#f3c25a", boxShadow: "0 0 8px #f3c25a" }} />
                <span style={{ fontFamily: LABEL, fontSize: 10, fontWeight: 600, letterSpacing: "1.6px", color: "#f3d79a" }}>
                  NATIONAL ADVISORY · ELEVATED
                </span>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "1px", color: "#9fdcef" }}>06:42:18 ZULU</span>
              <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "1px", color: "#5d7180" }}>26 JUN 2026</span>
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 8.5,
                  letterSpacing: "1.6px",
                  color: "#9fe7c8",
                  padding: "3px 8px",
                  border: "1px solid rgba(159,231,200,0.4)",
                  borderRadius: 3,
                }}
              >
                ● SECURE
              </span>
            </div>
          </div>

          {/* left rail: networks + convergence + integrity key */}
          <div
            style={{
              position: "absolute",
              left: 18,
              top: 70,
              width: 214,
              zIndex: 11,
              background: "rgba(9,13,19,0.62)",
              backdropFilter: "blur(11px)",
              WebkitBackdropFilter: "blur(11px)",
              border: "1px solid rgba(120,180,210,0.16)",
              borderRadius: 9,
              padding: "14px 14px 15px",
              display: "flex",
              flexDirection: "column",
              gap: 13,
            }}
          >
            <div>
              <div style={{ fontFamily: LABEL, fontSize: 10, fontWeight: 700, letterSpacing: "2.4px", color: "#7f9aab", marginBottom: 11 }}>
                THREAT NETWORKS
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {roster.map((n) => (
                  <div key={n.short} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={n.chip} />
                      <span style={{ fontFamily: LABEL, fontSize: 11.5, fontWeight: 600, letterSpacing: "1px", color: "#dce8ef", flex: 1 }}>
                        {n.short}
                      </span>
                      <span style={{ fontFamily: MONO, fontSize: 9, color: "#7c93a1" }}>{n.members} PAX</span>
                    </div>
                    <div style={{ height: 3, borderRadius: 2, background: "rgba(120,160,185,0.14)", overflow: "hidden" }}>
                      <div style={n.bar} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ height: 1, background: "rgba(120,180,210,0.14)" }} />

            <div>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 9 }}>
                <span style={{ fontFamily: LABEL, fontSize: 10, fontWeight: 700, letterSpacing: "2.4px", color: "#7f9aab" }}>
                  CONVERGENCE INDEX
                </span>
                <span style={{ fontFamily: LABEL, fontSize: 20, fontWeight: 800, color: "#5fe6ff", lineHeight: 1, textShadow: "0 0 12px rgba(95,230,255,0.5)" }}>
                  {convAvg}%
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {zonesV.map((z) => (
                  <div key={z.label} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.5px", color: "#aebfc9" }}>
                        <span style={{ color: z.aColor }}>{z.aShort}</span> × <span style={{ color: z.bColor }}>{z.bShort}</span>
                      </span>
                      <span style={{ fontFamily: MONO, fontSize: 8.5, color: "#7c93a1" }}>{z.pct}%</span>
                    </div>
                    <div style={{ height: 3, borderRadius: 2, background: "rgba(120,160,185,0.14)", overflow: "hidden" }}>
                      <div style={z.bar} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ height: 1, background: "rgba(120,180,210,0.14)" }} />

            <div>
              <div style={{ fontFamily: LABEL, fontSize: 10, fontWeight: 700, letterSpacing: "2.4px", color: "#7f9aab", marginBottom: 10 }}>
                DATA INTEGRITY
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span
                    style={{
                      width: 15,
                      height: 15,
                      borderRadius: 3,
                      background: "rgba(159,231,200,0.16)",
                      border: "1.5px solid #9fe7c8",
                      boxShadow: "0 0 7px rgba(159,231,200,0.35)",
                      flex: "0 0 auto",
                    }}
                  />
                  <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
                    <span style={{ fontFamily: LABEL, fontSize: 10.5, fontWeight: 600, letterSpacing: "0.8px", color: "#dce8ef" }}>SOURCED</span>
                    <span style={{ fontFamily: MONO, fontSize: 7.5, letterSpacing: "0.4px", color: "#7c93a1" }}>confirmed federal record</span>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span style={{ width: 15, height: 15, borderRadius: 3, background: "transparent", border: "1.5px dashed #f3c25a", flex: "0 0 auto" }} />
                  <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
                    <span style={{ fontFamily: LABEL, fontSize: 10.5, fontWeight: 600, fontStyle: "italic", letterSpacing: "0.8px", color: "#dce8ef" }}>
                      ANALYTICAL
                    </span>
                    <span style={{ fontFamily: MONO, fontSize: 7.5, letterSpacing: "0.4px", color: "#7c93a1" }}>our inference — unverified</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* right panel: active records */}
          <div
            style={{
              position: "absolute",
              right: 18,
              top: 70,
              bottom: 54,
              width: 338,
              zIndex: 11,
              background: "rgba(9,13,19,0.66)",
              backdropFilter: "blur(11px)",
              WebkitBackdropFilter: "blur(11px)",
              border: "1px solid rgba(120,180,210,0.16)",
              borderRadius: 9,
              padding: "14px 12px 6px",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 2px 11px" }}>
              <span style={{ fontFamily: LABEL, fontSize: 13, fontWeight: 700, letterSpacing: "2.6px", color: "#eef4f8" }}>ACTIVE RECORDS</span>
              <span style={{ fontFamily: MONO, fontSize: 10, color: "#06121a", background: "#5fe6ff", padding: "2px 7px", borderRadius: 3, fontWeight: 600 }}>
                {stats.total}
              </span>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "0 2px 11px" }}>
              <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "1px", color: "#06121a", background: "#9fb3c0", padding: "3px 9px", borderRadius: 3, fontWeight: 600 }}>
                ALL
              </span>
              {roster.map((n) => (
                <span
                  key={n.short}
                  style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "1px", color: n.color, border: `1px solid ${n.borderColor}`, padding: "3px 9px", borderRadius: 3 }}
                >
                  {n.short}
                </span>
              ))}
            </div>
            <div
              style={{
                flex: 1,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                gap: 7,
                padding: "0 2px",
                WebkitMaskImage: "linear-gradient(180deg,#000 92%,transparent)",
                maskImage: "linear-gradient(180deg,#000 92%,transparent)",
              }}
            >
              {records.map((r) => (
                <div key={r.id} style={r.card}>
                  <div style={r.accent} />
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={r.netDot} />
                      <span
                        style={{
                          fontFamily: LABEL,
                          fontSize: 13,
                          fontWeight: 700,
                          letterSpacing: "0.8px",
                          color: "#eef4f8",
                          flex: 1,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {r.alias}
                      </span>
                      <span style={r.tag}>{r.tagText}</span>
                    </div>
                    <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.4px", color: "#7c93a1" }}>{r.loc}</div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 1 }}>
                      <span style={r.statusStyle}>{r.status}</span>
                      <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, color: "#f3c25a" }}>{r.reward}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* bottom marker key */}
          <div
            style={{
              position: "absolute",
              left: 246,
              bottom: 16,
              zIndex: 11,
              display: "flex",
              alignItems: "center",
              gap: 16,
              background: "rgba(9,13,19,0.6)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              border: "1px solid rgba(120,180,210,0.16)",
              borderRadius: 7,
              padding: "8px 14px",
            }}
          >
            <span style={{ fontFamily: LABEL, fontSize: 9, fontWeight: 700, letterSpacing: "2px", color: "#7f9aab" }}>MAP KEY</span>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#5fe6ff", border: "1.5px solid #fff", boxShadow: "0 0 8px #5fe6ff" }} />
              <span style={{ fontFamily: MONO, fontSize: 8.5, color: "#aebfc9" }}>CONFIRMED SIGHTING</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 11, height: 11, borderRadius: "50%", background: "transparent", border: "1.5px dashed #f3c25a" }} />
              <span style={{ fontFamily: MONO, fontSize: 8.5, color: "#aebfc9" }}>INFERRED LOCATION</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 18, height: 0, borderTop: "2px solid rgba(236,246,250,0.7)" }} />
              <span style={{ fontFamily: MONO, fontSize: 8.5, color: "#aebfc9" }}>ASSOCIATION</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
