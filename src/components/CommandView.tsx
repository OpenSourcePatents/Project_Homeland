"use client";

import { CSSProperties, useEffect, useState } from "react";
import HomelandMap from "@/components/HomelandMap";
import type { PublicSuspect } from "@/lib/public-suspect";
import { hexA } from "@/lib/color";
import { isMappable } from "@/lib/us-states";

/* DIRECTION A · SENTINEL — cinematic floating-glass command, wired to REAL
   suspect_profiles data (Product B). All records are official/sourced. The
   Product-A convergence layer (networks, links, zones) has no data yet, so:
     - the map's convergence layers receive empty arrays (render nothing)
     - the left rail shows REAL aggregates of the official records instead of
       fabricated threat-network rosters.

   Client component: receives plain serializable PublicSuspect[] as props. */

const LABEL = "Oxanium, sans-serif";
const MONO = "'IBM Plex Mono', monospace";
const SOURCED_COLOR = "#5fe6ff";

// ---- record-level helpers (operate on real fields) --------------------------

function suspectName(s: PublicSuspect): string {
  const n = [s.first_name, s.last_name].filter(Boolean).join(" ").trim();
  return n || (s.title ?? "").trim() || "(unnamed record)";
}

function statusLabel(s: PublicSuspect): string {
  const w = (s.warning_message ?? "").trim();
  if (w) return w;
  switch (s.status) {
    case "captured":
      return "IN CUSTODY";
    case "deceased":
      return "DECEASED";
    case "recovered":
      return "RECOVERED";
    default:
      return "AT LARGE";
  }
}

function statusColor(s: PublicSuspect): string {
  const w = (s.warning_message ?? "").trim();
  if (w && /ARMED/i.test(w)) return "#ff3b4e";
  if (w) return "#ff7a4e";
  switch (s.status) {
    case "captured":
    case "deceased":
      return "#8aa0ad";
    case "recovered":
      return "#9fe7c8";
    default:
      return "#f3c25a";
  }
}

function rewardShort(s: PublicSuspect): string {
  if (!s.reward_text) return "—";
  const m = s.reward_text.match(/\$[\d,]+/);
  return m ? "UP TO " + m[0] : "REWARD OFFERED";
}

function subjectsShort(s: PublicSuspect): string {
  return (s.subjects ?? []).filter(Boolean).join(" · ");
}

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

export default function CommandView({ suspects }: { suspects: PublicSuspect[] }) {
  const scale = useScale();

  // ---- real aggregates (no fabricated networks) ----------------------------
  const total = suspects.length;
  // "mapped" must match what the basemap can actually plot, not just "has a state
  // code" — a real but unplottable code (e.g. PR) counts as UNMAPPED so the rail
  // never claims more placed records than the map draws.
  const mapped = suspects.filter((s) => isMappable(s.primary_state)).length;
  const unmapped = total - mapped;
  const armed = suspects.filter((s) => (s.warning_message ?? "").match(/ARMED/i)).length;
  const sourcedCount = suspects.filter((s) => s.data_class === "official").length;
  const analyticalCount = total - sourcedCount;

  const catCounts = new Map<string, number>();
  suspects.forEach((s) => {
    (s.subjects ?? []).forEach((c) => {
      const k = c.trim();
      if (k) catCounts.set(k, (catCounts.get(k) ?? 0) + 1);
    });
  });
  const categories = [...catCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const catMax = categories.reduce((m, [, n]) => Math.max(m, n), 1);

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
            <HomelandMap suspects={suspects} />
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
                    background: SOURCED_COLOR,
                    boxShadow: `0 0 8px ${SOURCED_COLOR}`,
                    animation: "hl-blink 2.2s ease-in-out infinite",
                  }}
                />
                <span style={{ fontFamily: LABEL, fontSize: 10, fontWeight: 600, letterSpacing: "1.6px", color: "#bfe9ff" }}>
                  FBI WANTED · LIVE
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
              <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "1px", color: "#5d7180" }}>27 JUN 2026</span>
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

          {/* left rail: real aggregates of the official records */}
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
            {/* WANTED CATEGORIES — aggregated from real subjects[] */}
            <div>
              <div style={{ fontFamily: LABEL, fontSize: 10, fontWeight: 700, letterSpacing: "2.4px", color: "#7f9aab", marginBottom: 11 }}>
                WANTED CATEGORIES
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {categories.length === 0 && (
                  <div style={{ fontFamily: MONO, fontSize: 9, color: "#5d7180" }}>no categories</div>
                )}
                {categories.map(([label, n]) => (
                  <div key={label} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          width: 11,
                          height: 11,
                          borderRadius: 3,
                          background: SOURCED_COLOR,
                          boxShadow: `0 0 8px ${SOURCED_COLOR}`,
                          flex: "0 0 auto",
                        }}
                      />
                      <span
                        style={{
                          fontFamily: LABEL,
                          fontSize: 11,
                          fontWeight: 600,
                          letterSpacing: "0.5px",
                          color: "#dce8ef",
                          flex: 1,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {label}
                      </span>
                      <span style={{ fontFamily: MONO, fontSize: 9, color: "#7c93a1" }}>{n}</span>
                    </div>
                    <div style={{ height: 3, borderRadius: 2, background: "rgba(120,160,185,0.14)", overflow: "hidden" }}>
                      <div
                        style={{
                          height: "100%",
                          width: (n / catMax) * 100 + "%",
                          borderRadius: 2,
                          background: `linear-gradient(90deg,${hexA(SOURCED_COLOR, 0.4)},${SOURCED_COLOR})`,
                          boxShadow: `0 0 6px ${hexA(SOURCED_COLOR, 0.55)}`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ height: 1, background: "rgba(120,180,210,0.14)" }} />

            {/* SITUATION — real counts */}
            <div>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 9 }}>
                <span style={{ fontFamily: LABEL, fontSize: 10, fontWeight: 700, letterSpacing: "2.4px", color: "#7f9aab" }}>
                  SITUATION
                </span>
                <span style={{ fontFamily: LABEL, fontSize: 20, fontWeight: 800, color: SOURCED_COLOR, lineHeight: 1, textShadow: "0 0 12px rgba(95,230,255,0.5)" }}>
                  {total}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                <SituationRow label="MAPPED / TOTAL" value={`${mapped} / ${total}`} />
                <SituationRow label="UNMAPPED" value={String(unmapped)} />
                <SituationRow label="ARMED & DANGEROUS" value={String(armed)} valueColor="#ff5667" />
              </div>
            </div>

            <div style={{ height: 1, background: "rgba(120,180,210,0.14)" }} />

            {/* DATA INTEGRITY — the wall legend (all current records are SOURCED) */}
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
                  <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.25, flex: 1 }}>
                    <span style={{ fontFamily: LABEL, fontSize: 10.5, fontWeight: 600, letterSpacing: "0.8px", color: "#dce8ef" }}>SOURCED</span>
                    <span style={{ fontFamily: MONO, fontSize: 7.5, letterSpacing: "0.4px", color: "#7c93a1" }}>confirmed federal record</span>
                  </div>
                  <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, color: "#9fe7c8" }}>{sourcedCount}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span style={{ width: 15, height: 15, borderRadius: 3, background: "transparent", border: "1.5px dashed #f3c25a", flex: "0 0 auto" }} />
                  <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.25, flex: 1 }}>
                    <span style={{ fontFamily: LABEL, fontSize: 10.5, fontWeight: 600, fontStyle: "italic", letterSpacing: "0.8px", color: "#dce8ef" }}>
                      ANALYTICAL
                    </span>
                    <span style={{ fontFamily: MONO, fontSize: 7.5, letterSpacing: "0.4px", color: "#7c93a1" }}>inference — walled off</span>
                  </div>
                  <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, color: "#7c93a1" }}>{analyticalCount}</span>
                </div>
              </div>
            </div>
          </div>

          {/* right panel: active records (real FBI suspect_profiles) */}
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
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 2px 4px" }}>
              <span style={{ fontFamily: LABEL, fontSize: 13, fontWeight: 700, letterSpacing: "2.6px", color: "#eef4f8" }}>ACTIVE RECORDS</span>
              <span style={{ fontFamily: MONO, fontSize: 10, color: "#06121a", background: SOURCED_COLOR, padding: "2px 7px", borderRadius: 3, fontWeight: 600 }}>
                {total}
              </span>
            </div>
            <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.5px", color: "#7c93a1", padding: "0 2px 9px" }}>
              {sourcedCount} SOURCED · {analyticalCount} INFERRED
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "0 2px 11px" }}>
              <Chip text={`ALL ${total}`} solid />
              <Chip text={`MAPPED ${mapped}`} />
              <Chip text={`ARMED ${armed}`} />
            </div>
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                overflowX: "hidden",
                display: "flex",
                flexDirection: "column",
                gap: 7,
                padding: "0 2px",
                WebkitMaskImage: "linear-gradient(180deg,#000 96%,transparent)",
                maskImage: "linear-gradient(180deg,#000 96%,transparent)",
              }}
            >
              {suspects.map((s) => (
                <RecordCard key={s.id} s={s} />
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
              <span style={{ width: 11, height: 11, borderRadius: "50%", background: SOURCED_COLOR, border: "1.5px solid #fff", boxShadow: `0 0 8px ${SOURCED_COLOR}` }} />
              <span style={{ fontFamily: MONO, fontSize: 8.5, color: "#aebfc9" }}>CONFIRMED RECORD</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 11, height: 11, borderRadius: 3, background: hexA(SOURCED_COLOR, 0.12), border: `1.5px solid ${hexA(SOURCED_COLOR, 0.8)}` }} />
              <span style={{ fontFamily: MONO, fontSize: 8.5, color: "#aebfc9" }}>STATE WITH RECORDS</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ fontFamily: MONO, fontSize: 8.5, color: "#5d7180" }}>{unmapped} UNMAPPED</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- small presentational helpers -------------------------------------------

function SituationRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.4px", color: "#aebfc9" }}>{label}</span>
      <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, color: valueColor ?? "#dce8ef" }}>{value}</span>
    </div>
  );
}

function Chip({ text, solid }: { text: string; solid?: boolean }) {
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 8.5,
        letterSpacing: "1px",
        fontWeight: solid ? 600 : 400,
        color: solid ? "#06121a" : "#aebfc9",
        background: solid ? "#9fb3c0" : "transparent",
        border: solid ? "none" : "1px solid rgba(120,180,210,0.3)",
        padding: "3px 9px",
        borderRadius: 3,
      }}
    >
      {text}
    </span>
  );
}

function RecordCard({ s }: { s: PublicSuspect }) {
  const sourced = s.data_class === "official";
  const sc = statusColor(s);
  const subs = subjectsShort(s);
  // show the state code, but only if the basemap can plot it; otherwise UNMAPPED.
  const stateLabel = isMappable(s.primary_state) ? (s.primary_state as string) : "UNMAPPED";
  const locParts = [stateLabel, subs].filter(Boolean);

  const card: CSSProperties = {
    position: "relative",
    display: "flex",
    gap: 10,
    padding: "9px 11px 9px 15px",
    borderRadius: 7,
    flex: "0 0 auto",
    textDecoration: "none",
    background: sourced ? "rgba(18,27,36,0.68)" : "rgba(13,18,25,0.4)",
    border: sourced ? "1px solid rgba(120,180,210,0.2)" : "1.5px dashed rgba(150,170,190,0.34)",
  };
  const accent: CSSProperties = sourced
    ? {
        position: "absolute",
        left: 0,
        top: 8,
        bottom: 8,
        width: 3,
        borderRadius: "0 3px 3px 0",
        background: SOURCED_COLOR,
        boxShadow: `0 0 8px ${SOURCED_COLOR}`,
      }
    : {
        position: "absolute",
        left: 0,
        top: 8,
        bottom: 8,
        width: 3,
        borderRadius: "0 3px 3px 0",
        background: `repeating-linear-gradient(180deg,${SOURCED_COLOR} 0 4px, transparent 4px 8px)`,
      };

  const inner = (
    <>
      <div style={accent} />
      {s.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={s.image_url}
          alt=""
          loading="lazy"
          style={{ width: 30, height: 40, objectFit: "cover", borderRadius: 3, flex: "0 0 auto", background: "#10161c", border: "1px solid rgba(120,180,210,0.25)" }}
        />
      ) : null}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          {!s.image_url && (
            <span style={{ width: 7, height: 7, borderRadius: 2, background: SOURCED_COLOR, boxShadow: `0 0 6px ${SOURCED_COLOR}`, flex: "0 0 auto" }} />
          )}
          <span
            style={{
              fontFamily: LABEL,
              fontSize: 12.5,
              fontWeight: 700,
              letterSpacing: "0.6px",
              color: "#eef4f8",
              flex: 1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {suspectName(s)}
          </span>
          <span
            style={{
              fontFamily: MONO,
              fontSize: 7.5,
              fontWeight: 700,
              letterSpacing: "1px",
              color: "#06121a",
              background: "#9fe7c8",
              padding: "2px 6px",
              borderRadius: 3,
              flex: "0 0 auto",
            }}
          >
            {sourced ? "SOURCED" : "INFERRED"}
          </span>
        </div>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 8.5,
            letterSpacing: "0.4px",
            color: "#7c93a1",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {locParts.join("  ·  ")}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 1 }}>
          <span
            style={{
              fontFamily: LABEL,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.5px",
              color: sc,
              textTransform: "uppercase",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: "60%",
            }}
          >
            {statusLabel(s)}
          </span>
          <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, color: "#f3c25a", flex: "0 0 auto" }}>{rewardShort(s)}</span>
        </div>
      </div>
    </>
  );

  if (s.source_url) {
    return (
      <a href={s.source_url} target="_blank" rel="noopener noreferrer" style={card}>
        {inner}
      </a>
    );
  }
  return <div style={card}>{inner}</div>;
}
