"use client";

import { CSSProperties, useEffect, useRef, useState } from "react";
import HomelandMap from "@/components/HomelandMap";
import SuspectModal from "@/components/SuspectModal";
import type { PublicSuspect } from "@/lib/public-suspect";
import { hexA } from "@/lib/color";
import { isMappable } from "@/lib/us-states";

/* DIRECTION A · SENTINEL — responsive tactical command shell, wired to REAL
   suspect_profiles data (Product B). All records are official/sourced.

   This is the interactive client shell: it receives the already-fetched
   PublicSuspect[] as props (the Server Component page.tsx owns the DB query and
   the wall) and does ALL filtering in-browser. Layout is fully responsive
   (flex/grid + viewport units + one stack breakpoint); the side panels are
   draggable "sticky notes" with per-panel opacity. Drag/opacity are session-only
   (no persistence); drag offsets reset on window resize so drag never fights the
   responsive layout. */

const LABEL = "Oxanium, sans-serif";
const MONO = "'IBM Plex Mono', monospace";
const SOURCED_COLOR = "#5fe6ff";

// Below this viewport width the three columns stack vertically (tablet/phone).
const STACK_BREAKPOINT = 820;

// ---- record-level helpers (operate on real fields) --------------------------

function suspectName(s: PublicSuspect): string {
  const n = [s.first_name, s.last_name].filter(Boolean).join(" ").trim();
  return n || (s.title ?? "").trim() || "(unnamed record)";
}

function isArmed(s: PublicSuspect): boolean {
  return /ARMED/i.test(s.warning_message ?? "");
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

// ---- live ZULU clock (hydration proof) --------------------------------------

const pad2 = (n: number) => String(n).padStart(2, "0");

/** The viewer's IANA timezone, or America/New_York (Eastern — covers New
 *  Hampshire) as a fallback when the environment can't report one. */
function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch {
    return "America/New_York";
  }
}

function LiveClock() {
  // null until mounted so server and client render the SAME placeholder (no
  // hydration mismatch); the interval then drives a live tick every second.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  let local = "--:--:--";
  let zulu = "--:--:-- ZULU";
  let dateStr = "-- --- ----";
  if (now) {
    const tz = viewerTimeZone();
    // viewer-local time with its zone abbreviation, e.g. "14:23:05 EDT"
    local = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: tz,
      timeZoneName: "short",
    }).format(now);
    // Zulu (UTC) readout kept alongside
    zulu = `${pad2(now.getUTCHours())}:${pad2(now.getUTCMinutes())}:${pad2(now.getUTCSeconds())} ZULU`;
    // day-first date in the viewer's zone, e.g. "29 JUN 2026"
    dateStr = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: tz })
      .format(now)
      .toUpperCase();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.3 }}>
      <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "1px", color: "#9fdcef" }}>{local}</span>
      <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.8px", color: "#5d7180" }}>
        {zulu} · {dateStr}
      </span>
    </div>
  );
}

// ---- viewport hook (responsive breakpoint + resize signal) ------------------

function useViewport() {
  // Deterministic SSR/first-render value (wide) so hydration matches; the effect
  // then sets the real size post-mount.
  const [vp, setVp] = useState({ width: 1280, height: 800 });
  useEffect(() => {
    const on = () => setVp({ width: window.innerWidth, height: window.innerHeight });
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return vp;
}

// ---- filter model -----------------------------------------------------------

type Quick = "all" | "mapped" | "armed";
type SourceFilter = "all" | "official" | "analytical";

export default function CommandView({ suspects }: { suspects: PublicSuspect[] }) {
  const vp = useViewport();
  const wide = vp.width >= STACK_BREAKPOINT;
  // changes on any resize -> draggable panels reset to their docked positions
  const resetSignal = `${vp.width}x${vp.height}`;

  // ---- client-side filter state (no server round-trip) ---------------------
  const [quick, setQuick] = useState<Quick>("all");
  const [category, setCategory] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<string | null>(null);
  const [source, setSource] = useState<SourceFilter>("all");
  const [selected, setSelected] = useState<PublicSuspect | null>(null); // open record modal

  const anyActive = quick !== "all" || category !== null || stateFilter !== null || source !== "all";

  const clearAll = () => {
    setQuick("all");
    setCategory(null);
    setStateFilter(null);
    setSource("all");
  };

  // ---- real aggregates over the FULL dataset (the rail is an overview) ------
  const total = suspects.length;
  // "mapped" now reflects the recovered location (resolved_state), so the rail
  // matches what the map plots after location-recovery (003).
  const mapped = suspects.filter((s) => isMappable(s.resolved_state)).length;
  const unmapped = total - mapped;
  const armed = suspects.filter(isArmed).length;
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

  // ---- the pure client-side filtered view (drives BOTH list and map) -------
  // No manual useMemo: React Compiler (Next 16) memoizes this automatically, and
  // filtering 20 rows is trivial. The SAME array feeds the list and the map.
  const visible = suspects.filter((s) => {
    if (quick === "mapped" && !isMappable(s.resolved_state)) return false;
    if (quick === "armed" && !isArmed(s)) return false;
    if (category && !(s.subjects ?? []).includes(category)) return false;
    if (stateFilter && (s.resolved_state ?? "").toUpperCase() !== stateFilter) return false;
    if (source !== "all" && s.data_class !== source) return false;
    return true;
  });
  const visSourced = visible.filter((s) => s.data_class === "official").length;
  const visInferred = visible.length - visSourced;

  const toggleQuick = (q: Quick) => setQuick((cur) => (cur === q ? "all" : q));
  const toggleCategory = (c: string) => setCategory((cur) => (cur === c ? null : c));
  const toggleSource = (sf: Exclude<SourceFilter, "all">) => setSource((cur) => (cur === sf ? "all" : sf));

  const activeTags: { key: string; label: string; clear: () => void }[] = [];
  if (quick !== "all") activeTags.push({ key: "quick", label: quick.toUpperCase(), clear: () => setQuick("all") });
  if (category) activeTags.push({ key: "cat", label: category, clear: () => setCategory(null) });
  if (stateFilter) activeTags.push({ key: "state", label: `STATE ${stateFilter}`, clear: () => setStateFilter(null) });
  if (source !== "all")
    activeTags.push({ key: "src", label: source === "official" ? "SOURCED" : "INFERRED", clear: () => setSource("all") });

  // ---- left panel content (filters / intel) --------------------------------
  const leftBody = (
    <div style={{ display: "flex", flexDirection: "column", gap: 13, padding: "12px 14px 14px", overflowY: "auto", flex: 1, minHeight: 0 }}>
      {/* WANTED CATEGORIES — click a row to filter by that subject */}
      <div>
        <div style={{ fontFamily: LABEL, fontSize: 10, fontWeight: 700, letterSpacing: "2.4px", color: "#7f9aab", marginBottom: 11 }}>
          WANTED CATEGORIES
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {categories.length === 0 && <div style={{ fontFamily: MONO, fontSize: 9, color: "#5d7180" }}>no categories</div>}
          {categories.map(([label, n]) => {
            const active = category === label;
            return (
              <button
                key={label}
                type="button"
                onClick={() => toggleCategory(label)}
                title={`Filter: ${label}`}
                style={{
                  ...btnReset,
                  display: "flex",
                  flexDirection: "column",
                  gap: 5,
                  width: "100%",
                  padding: "4px 6px",
                  margin: "0 -6px",
                  borderRadius: 5,
                  background: active ? hexA(SOURCED_COLOR, 0.1) : "transparent",
                  border: active ? `1px solid ${hexA(SOURCED_COLOR, 0.5)}` : "1px solid transparent",
                  transition: "background .15s",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      width: 11,
                      height: 11,
                      borderRadius: 3,
                      background: SOURCED_COLOR,
                      boxShadow: `0 0 8px ${SOURCED_COLOR}`,
                      flex: "0 0 auto",
                      opacity: active || !category ? 1 : 0.4,
                    }}
                  />
                  <span
                    style={{
                      fontFamily: LABEL,
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: "0.5px",
                      color: active ? "#eef4f8" : "#dce8ef",
                      flex: 1,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      textAlign: "left",
                    }}
                  >
                    {label}
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: 9, color: active ? SOURCED_COLOR : "#7c93a1" }}>{n}</span>
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
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ height: 1, background: "rgba(120,180,210,0.14)" }} />

      {/* SITUATION — real counts (overview of the full set) */}
      <div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 9 }}>
          <span style={{ fontFamily: LABEL, fontSize: 10, fontWeight: 700, letterSpacing: "2.4px", color: "#7f9aab" }}>SITUATION</span>
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

      {/* DATA INTEGRITY — click a row to filter by data_class (the wall) */}
      <div>
        <div style={{ fontFamily: LABEL, fontSize: 10, fontWeight: 700, letterSpacing: "2.4px", color: "#7f9aab", marginBottom: 10 }}>
          DATA INTEGRITY
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <IntegrityRow
            active={source === "official"}
            onClick={() => toggleSource("official")}
            swatch={
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
            }
            title="SOURCED"
            titleStyle={{ fontFamily: LABEL, fontSize: 10.5, fontWeight: 600, letterSpacing: "0.8px", color: "#dce8ef" }}
            subtitle="confirmed federal record"
            count={sourcedCount}
            countColor="#9fe7c8"
            activeColor="#9fe7c8"
          />
          <IntegrityRow
            active={source === "analytical"}
            onClick={() => toggleSource("analytical")}
            swatch={<span style={{ width: 15, height: 15, borderRadius: 3, background: "transparent", border: "1.5px dashed #f3c25a", flex: "0 0 auto" }} />}
            title="ANALYTICAL"
            titleStyle={{ fontFamily: LABEL, fontSize: 10.5, fontWeight: 600, fontStyle: "italic", letterSpacing: "0.8px", color: "#dce8ef" }}
            subtitle="inference — walled off"
            count={analyticalCount}
            countColor="#7c93a1"
            activeColor="#f3c25a"
          />
        </div>
      </div>
    </div>
  );

  // ---- right panel content (records feed) ----------------------------------
  const rightBody = (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, padding: "10px 12px 6px" }}>
      <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.5px", color: "#7c93a1", padding: "0 2px 9px" }}>
        {visSourced} SOURCED · {visInferred} INFERRED
      </div>

      {/* quick filter chips */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "0 2px 8px" }}>
        <FilterChip text={`ALL ${total}`} active={!anyActive} onClick={clearAll} />
        <FilterChip text={`MAPPED ${mapped}`} active={quick === "mapped"} onClick={() => toggleQuick("mapped")} />
        <FilterChip text={`ARMED ${armed}`} active={quick === "armed"} onClick={() => toggleQuick("armed")} />
      </div>

      {/* active-filter tags (removable) */}
      {anyActive && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", padding: "0 2px 9px" }}>
          <span style={{ fontFamily: MONO, fontSize: 8, letterSpacing: "1px", color: "#5d7180", flex: "0 0 auto" }}>FILTERS</span>
          {activeTags.map((t) => (
            <button key={t.key} type="button" onClick={t.clear} title={`Remove ${t.label}`} style={{ ...btnReset, ...tagStyle }}>
              <span style={{ maxWidth: 120, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "inline-block", verticalAlign: "bottom" }}>
                {t.label}
              </span>
              <span style={{ color: "#f3c25a", fontWeight: 700 }}> ✕</span>
            </button>
          ))}
          <button key="clear" type="button" onClick={clearAll} title="Clear all filters" style={{ ...btnReset, ...clearStyle }}>
            CLEAR
          </button>
        </div>
      )}

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
        {visible.length === 0 ? (
          <div
            style={{
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: "1px",
              color: "#5d7180",
              textAlign: "center",
              padding: "26px 8px",
              border: "1px dashed rgba(120,180,210,0.25)",
              borderRadius: 7,
              marginTop: 4,
            }}
          >
            NO RECORDS MATCH
            <br />
            <button type="button" onClick={clearAll} style={{ ...btnReset, ...clearStyle, marginTop: 10, display: "inline-block" }}>
              CLEAR FILTERS
            </button>
          </div>
        ) : (
          visible.map((s) => <RecordCard key={s.id} s={s} onOpen={() => setSelected(s)} />)
        )}
      </div>
    </div>
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#04060a",
        color: "#eef4f8",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* ---- top command bar (logo removed) ---- */}
      <div
        style={{
          flex: "0 0 auto",
          zIndex: 50,
          minHeight: 54,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "8px 20px",
          padding: "8px 20px",
          background: "linear-gradient(180deg, rgba(9,12,17,0.95), rgba(9,12,17,0.45))",
          backdropFilter: "blur(9px)",
          WebkitBackdropFilter: "blur(9px)",
          borderBottom: "1px solid rgba(243,194,90,0.22)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
          <span style={{ fontFamily: LABEL, fontWeight: 800, fontSize: 15, letterSpacing: "3.5px", color: "#eef4f8" }}>PROJECT HOMELAND</span>
          <span style={{ fontFamily: MONO, fontSize: 8, letterSpacing: "2.6px", color: "#ff5667", marginTop: 4 }}>CIVIL THREAT-CONVERGENCE GRID</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: SOURCED_COLOR, boxShadow: `0 0 8px ${SOURCED_COLOR}`, animation: "hl-blink 2.2s ease-in-out infinite" }} />
            <span style={{ fontFamily: LABEL, fontSize: 10, fontWeight: 600, letterSpacing: "1.6px", color: "#bfe9ff" }}>FBI WANTED · LIVE</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#f3c25a", boxShadow: "0 0 8px #f3c25a" }} />
            <span style={{ fontFamily: LABEL, fontSize: 10, fontWeight: 600, letterSpacing: "1.6px", color: "#f3d79a" }}>NATIONAL ADVISORY · ELEVATED</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <LiveClock />
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

      {/* ---- body: 3 columns (wide) or stacked (narrow) ---- */}
      <div
        style={
          wide
            ? {
                flex: 1,
                minHeight: 0,
                display: "grid",
                gridTemplateColumns: "clamp(190px, 17vw, 250px) minmax(0, 1fr) clamp(290px, 25vw, 380px)",
                gap: 14,
                padding: 14,
                overflow: "hidden",
              }
            : {
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                gap: 12,
                padding: 12,
                overflowY: "auto",
                overflowX: "hidden",
              }
        }
      >
        {/* LEFT panel — docked left, draggable on wide screens */}
        <DraggablePanel title="THREAT INTEL" draggable={wide} resetSignal={resetSignal} style={{ maxHeight: wide ? undefined : "52dvh" }}>
          {leftBody}
        </DraggablePanel>

        {/* CENTER — map (centerpiece) + legend, never overlapped by panels */}
        <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 8, minWidth: 0, minHeight: wide ? 0 : "46dvh", order: wide ? 0 : -1 }}>
          <div
            style={{
              flex: 1,
              minHeight: wide ? 0 : "40dvh",
              position: "relative",
              borderRadius: 9,
              overflow: "hidden",
              border: "1px solid rgba(120,180,210,0.12)",
            }}
          >
            <HomelandMap suspects={visible} selectedState={stateFilter} onSelectState={setStateFilter} />
          </div>

          {/* map key legend — under the map, not over it */}
          <div
            style={{
              flex: "0 0 auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
              flexWrap: "wrap",
              background: "rgba(9,13,19,0.6)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              border: "1px solid rgba(120,180,210,0.16)",
              borderRadius: 7,
              padding: "7px 14px",
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
            <span style={{ fontFamily: MONO, fontSize: 8.5, color: "#5d7180" }}>CLICK A STATE TO FILTER · {unmapped} UNMAPPED</span>
          </div>
        </div>

        {/* RIGHT panel — docked right, draggable on wide screens */}
        <DraggablePanel
          title={
            <>
              ACTIVE RECORDS
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 10,
                  color: "#06121a",
                  background: anyActive ? "#f3c25a" : SOURCED_COLOR,
                  padding: "2px 7px",
                  borderRadius: 3,
                  fontWeight: 600,
                  marginLeft: 8,
                }}
              >
                {anyActive ? `${visible.length} / ${total}` : total}
              </span>
            </>
          }
          draggable={wide}
          resetSignal={resetSignal}
          style={{ maxHeight: wide ? undefined : "70dvh" }}
        >
          {rightBody}
        </DraggablePanel>
      </div>

      {/* record detail modal (lazy-loads detail from the wall-enforced route) */}
      <SuspectModal suspect={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

// ---- draggable sticky-note panel (lightweight pointer-event drag) -----------

const panelGlass: CSSProperties = {
  background: "rgba(9,13,19,0.64)",
  backdropFilter: "blur(11px)",
  WebkitBackdropFilter: "blur(11px)",
  border: "1px solid rgba(120,180,210,0.16)",
  borderRadius: 9,
  overflow: "hidden",
};

function DraggablePanel({
  title,
  draggable,
  resetSignal,
  style,
  children,
}: {
  title: React.ReactNode;
  draggable: boolean;
  resetSignal: string;
  style?: CSSProperties;
  children: React.ReactNode;
}) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [opacity, setOpacity] = useState(1);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  // session-only positions: reset to docked layout on any window resize so drag
  // never fights the responsive layout (syncing to the external resize signal).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOffset({ x: 0, y: 0 });
  }, [resetSignal]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!draggable) return;
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* no active pointer (e.g. synthetic event) — drag still tracks via move */
    }
    start.current = { px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || !start.current) return;
    setOffset({ x: start.current.ox + (e.clientX - start.current.px), y: start.current.oy + (e.clientY - start.current.py) });
  };
  const endDrag = (e: React.PointerEvent) => {
    if (!dragging) return;
    setDragging(false);
    start.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* pointer may already be released */
    }
  };

  return (
    <div
      style={{
        ...panelGlass,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        opacity,
        zIndex: dragging ? 30 : 20,
        transform: draggable && (offset.x !== 0 || offset.y !== 0) ? `translate(${offset.x}px, ${offset.y}px)` : undefined,
        boxShadow: dragging ? "0 18px 50px rgba(0,0,0,0.6)" : undefined,
        transition: dragging ? "none" : "opacity .15s",
        ...style,
      }}
    >
      {/* header = drag handle */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{
          flex: "0 0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "8px 11px",
          borderBottom: "1px solid rgba(120,180,210,0.14)",
          cursor: draggable ? (dragging ? "grabbing" : "grab") : "default",
          touchAction: draggable ? "none" : undefined,
          userSelect: "none",
        }}
      >
        <span style={{ fontFamily: LABEL, fontSize: 12, fontWeight: 700, letterSpacing: "2px", color: "#cdd9e2", display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
          {draggable && <GripIcon />}
          {title}
        </span>
        <OpacityControl value={opacity} onChange={setOpacity} />
      </div>

      {/* body */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>{children}</div>
    </div>
  );
}

function GripIcon() {
  return (
    <svg width="8" height="12" viewBox="0 0 8 12" fill="rgba(159,179,192,0.7)" style={{ flex: "0 0 auto" }} aria-hidden="true">
      <circle cx="2" cy="2" r="1" />
      <circle cx="6" cy="2" r="1" />
      <circle cx="2" cy="6" r="1" />
      <circle cx="6" cy="6" r="1" />
      <circle cx="2" cy="10" r="1" />
      <circle cx="6" cy="10" r="1" />
    </svg>
  );
}

function OpacityControl({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flex: "0 0 auto" }} title="Panel opacity">
      <span style={{ fontFamily: MONO, fontSize: 7.5, letterSpacing: "1px", color: "#5d7180" }}>OPACITY</span>
      <input
        type="range"
        min={25}
        max={100}
        step={5}
        value={Math.round(value * 100)}
        aria-label="Panel opacity"
        onChange={(e) => onChange(parseInt(e.target.value, 10) / 100)}
        // don't let the slider start a panel drag
        onPointerDown={(e) => e.stopPropagation()}
        style={{ width: 58, accentColor: SOURCED_COLOR, cursor: "pointer" }}
      />
    </div>
  );
}

// ---- small presentational helpers -------------------------------------------

const btnReset: CSSProperties = {
  appearance: "none",
  background: "transparent",
  border: "none",
  padding: 0,
  margin: 0,
  font: "inherit",
  color: "inherit",
  cursor: "pointer",
};

const tagStyle: CSSProperties = {
  fontFamily: MONO,
  fontSize: 8,
  letterSpacing: "0.6px",
  color: "#dce8ef",
  background: hexA(SOURCED_COLOR, 0.1),
  border: `1px solid ${hexA(SOURCED_COLOR, 0.4)}`,
  padding: "3px 7px",
  borderRadius: 3,
};

const clearStyle: CSSProperties = {
  fontFamily: MONO,
  fontSize: 8,
  letterSpacing: "1px",
  fontWeight: 600,
  color: "#ff9aa6",
  background: "transparent",
  border: "1px solid rgba(255,86,103,0.5)",
  padding: "3px 8px",
  borderRadius: 3,
};

function SituationRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.4px", color: "#aebfc9" }}>{label}</span>
      <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, color: valueColor ?? "#dce8ef" }}>{value}</span>
    </div>
  );
}

function FilterChip({ text, active, onClick }: { text: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...btnReset,
        fontFamily: MONO,
        fontSize: 8.5,
        letterSpacing: "1px",
        fontWeight: active ? 600 : 400,
        color: active ? "#06121a" : "#aebfc9",
        background: active ? SOURCED_COLOR : "transparent",
        border: active ? "none" : "1px solid rgba(120,180,210,0.3)",
        padding: "3px 9px",
        borderRadius: 3,
      }}
    >
      {text}
    </button>
  );
}

function IntegrityRow({
  active,
  onClick,
  swatch,
  title,
  titleStyle,
  subtitle,
  count,
  countColor,
  activeColor,
}: {
  active: boolean;
  onClick: () => void;
  swatch: React.ReactNode;
  title: string;
  titleStyle: CSSProperties;
  subtitle: string;
  count: number;
  countColor: string;
  activeColor: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Filter: ${title}`}
      style={{
        ...btnReset,
        display: "flex",
        alignItems: "center",
        gap: 9,
        width: "100%",
        padding: "4px 6px",
        margin: "0 -6px",
        borderRadius: 5,
        background: active ? hexA(activeColor, 0.12) : "transparent",
        border: active ? `1px solid ${hexA(activeColor, 0.5)}` : "1px solid transparent",
        transition: "background .15s",
      }}
    >
      {swatch}
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.25, flex: 1, textAlign: "left" }}>
        <span style={titleStyle}>{title}</span>
        <span style={{ fontFamily: MONO, fontSize: 7.5, letterSpacing: "0.4px", color: "#7c93a1" }}>{subtitle}</span>
      </div>
      <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, color: countColor }}>{count}</span>
    </button>
  );
}

function RecordCard({ s, onOpen }: { s: PublicSuspect; onOpen: () => void }) {
  const sourced = s.data_class === "official";
  const sc = statusColor(s);
  const subs = subjectsShort(s);
  const stateLabel = isMappable(s.resolved_state) ? (s.resolved_state as string) : "UNMAPPED";
  const locParts = [stateLabel, subs].filter(Boolean);

  const card: CSSProperties = {
    ...btnReset,
    width: "100%",
    textAlign: "left",
    position: "relative",
    display: "flex",
    gap: 10,
    padding: "9px 11px 9px 15px",
    borderRadius: 7,
    flex: "0 0 auto",
    background: sourced ? "rgba(18,27,36,0.68)" : "rgba(13,18,25,0.4)",
    border: sourced ? "1px solid rgba(120,180,210,0.2)" : "1.5px dashed rgba(150,170,190,0.34)",
  };
  const accent: CSSProperties = sourced
    ? { position: "absolute", left: 0, top: 8, bottom: 8, width: 3, borderRadius: "0 3px 3px 0", background: SOURCED_COLOR, boxShadow: `0 0 8px ${SOURCED_COLOR}` }
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
          {!s.image_url && <span style={{ width: 7, height: 7, borderRadius: 2, background: SOURCED_COLOR, boxShadow: `0 0 6px ${SOURCED_COLOR}`, flex: "0 0 auto" }} />}
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
        <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.4px", color: "#7c93a1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
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

  return (
    <button type="button" onClick={onOpen} title={`Open ${suspectName(s)}`} style={card}>
      {inner}
    </button>
  );
}
