"use client";

import { useEffect, useState } from "react";
import type { PublicSuspect, SuspectDetail, PhysicalDescription } from "@/lib/public-suspect";
import { CATEGORY_META } from "@/lib/category";
import { formatReward } from "@/lib/reward";
import { hexA } from "@/lib/color";

/* Record detail modal. Opens on a record click; fetches rich detail on demand
   from the wall-enforced /api/suspect/[id] route. Three deliberate safeguards:
     - the caution/remarks/details narrative is SANITIZED server-side, so the
       dangerouslySetInnerHTML below is XSS-safe (no client sanitizer needed);
     - UNIDENTIFIED (John/Jane Doe / unknown-suspect) records get a misidentification
       caveat and non-accusatory framing instead of a "wanted person" treatment;
     - the official/analytical wall stays visible (the SOURCED · FBI badge). */

const LABEL = "Oxanium, sans-serif";
const MONO = "'IBM Plex Mono', monospace";
const SOURCED_COLOR = "#5fe6ff";

function suspectName(s: { first_name: string | null; last_name: string | null; title: string | null }): string {
  const n = [s.first_name, s.last_name].filter(Boolean).join(" ").trim();
  return n || (s.title ?? "").trim() || "(unnamed record)";
}

function heightStr(p: PhysicalDescription): string | null {
  const inMin = p.height_min;
  const inMax = p.height_max;
  const fmt = (inches: number) => `${Math.floor(inches / 12)}'${inches % 12}"`;
  if (typeof inMin === "number" && typeof inMax === "number") {
    return inMin === inMax ? fmt(inMin) : `${fmt(inMin)}–${fmt(inMax)}`;
  }
  if (typeof inMin === "number") return fmt(inMin);
  if (typeof inMax === "number") return fmt(inMax);
  return null;
}

function physicalRows(p: PhysicalDescription): [string, string][] {
  const rows: [string, string][] = [];
  const h = heightStr(p);
  if (h) rows.push(["HEIGHT", h]);
  if (p.weight) rows.push(["WEIGHT", String(p.weight)]);
  if (p.sex) rows.push(["SEX", String(p.sex)]);
  if (p.race) rows.push(["RACE", String(p.race)]);
  if (p.hair) rows.push(["HAIR", String(p.hair)]);
  if (p.eyes) rows.push(["EYES", String(p.eyes)]);
  if (p.build) rows.push(["BUILD", String(p.build)]);
  if (p.complexion) rows.push(["COMPLEXION", String(p.complexion)]);
  if (p.scars_and_marks) rows.push(["SCARS / MARKS", String(p.scars_and_marks)]);
  return rows;
}

const SOURCE_LABEL: Record<string, string> = {
  description: "from case description",
  field_office: "from field office",
  possible_states: "from possible states",
  none: "",
};

export default function SuspectModal({ suspect, onClose }: { suspect: PublicSuspect | null; onClose: () => void }) {
  const [detail, setDetail] = useState<SuspectDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = suspect !== null;

  // close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // fetch detail when a suspect is selected (when closed, render returns null)
  useEffect(() => {
    if (!suspect) return;
    let cancelled = false;
    // reset UI for the newly-selected record before the async fetch resolves
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    setError(null);
    setDetail(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    fetch(`/api/suspect/${suspect.id}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: SuspectDetail) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [suspect]);

  if (!suspect) return null;

  const d = detail;
  const unidentified = d?.unidentified ?? false;
  const name = suspectName(d ?? suspect);
  const photo = d?.image_url ?? suspect.image_url;
  const armed = /ARMED/i.test((d?.warning_message ?? suspect.warning_message) ?? "");
  const stateCode = d?.resolved_state ?? suspect.resolved_state;
  const stateProvenance = d?.state_source ? SOURCE_LABEL[d.state_source] ?? "" : "";
  // category is derived server-side (query layer) — the client only reads it
  const cat = CATEGORY_META[d?.category ?? suspect.category];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(2,4,7,0.72)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={name}
        style={{
          position: "relative",
          width: "min(840px, 96vw)",
          maxHeight: "92dvh",
          overflowY: "auto",
          background: "linear-gradient(180deg, rgba(11,16,22,0.98), rgba(8,11,16,0.98))",
          border: `1px solid ${unidentified ? "rgba(243,194,90,0.5)" : "rgba(120,180,210,0.25)"}`,
          borderRadius: 12,
          boxShadow: "0 40px 120px rgba(0,0,0,0.7)",
          color: "#eef4f8",
        }}
      >
        {/* close */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            zIndex: 2,
            width: 30,
            height: 30,
            borderRadius: 6,
            border: "1px solid rgba(120,180,210,0.3)",
            background: "rgba(9,13,19,0.8)",
            color: "#cdd9e2",
            fontFamily: MONO,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          ✕
        </button>

        {/* header */}
        <div style={{ display: "flex", gap: 16, padding: 18, borderBottom: "1px solid rgba(120,180,210,0.14)" }}>
          {/* enlarged photo */}
          <div
            style={{
              width: 150,
              height: 190,
              flex: "0 0 auto",
              borderRadius: 8,
              overflow: "hidden",
              background: "#0a0f14",
              border: "1px solid rgba(120,180,210,0.25)",
              position: "relative",
            }}
          >
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt={unidentified ? "Unidentified — image on file" : name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontFamily: MONO, fontSize: 10, color: "#5d7180" }}>
                NO IMAGE
              </div>
            )}
          </div>

          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {/* wall badge + status */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 8.5,
                  fontWeight: 700,
                  letterSpacing: "1px",
                  color: "#06121a",
                  background: "#9fe7c8",
                  padding: "3px 8px",
                  borderRadius: 3,
                }}
              >
                ◤ SOURCED · FBI
              </span>
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 8.5,
                  fontWeight: 700,
                  letterSpacing: "1px",
                  color: cat.accent,
                  border: `1px solid ${hexA(cat.accent, 0.55)}`,
                  padding: "3px 8px",
                  borderRadius: 3,
                }}
              >
                {cat.label}
              </span>
              {unidentified && (
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 8.5,
                    fontWeight: 700,
                    letterSpacing: "1px",
                    color: "#f3c25a",
                    border: "1px solid rgba(243,194,90,0.6)",
                    padding: "3px 8px",
                    borderRadius: 3,
                  }}
                >
                  ⚠ UNIDENTIFIED
                </span>
              )}
              {armed && (
                <span style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: 700, letterSpacing: "1px", color: "#ff3b4e", border: "1px solid rgba(255,59,78,0.6)", padding: "3px 8px", borderRadius: 3 }}>
                  ARMED &amp; DANGEROUS
                </span>
              )}
            </div>

            <h2 style={{ margin: 0, fontFamily: LABEL, fontSize: 23, fontWeight: 800, letterSpacing: "0.5px", color: "#eef4f8", lineHeight: 1.1 }}>{name}</h2>

            <div style={{ fontFamily: MONO, fontSize: 10, color: "#7c93a1", display: "flex", gap: 14, flexWrap: "wrap" }}>
              {(d?.subjects ?? suspect.subjects ?? []).length > 0 && <span>{(d?.subjects ?? suspect.subjects ?? []).join(" · ")}</span>}
            </div>

            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 2 }}>
              <Field label="LOCATION" value={stateCode ? `${stateCode}${stateProvenance ? `  ·  ${stateProvenance}` : ""}` : "—"} />
              <Field label="REWARD" value={formatReward(d?.reward_text ?? suspect.reward_text)} valueColor="#f3c25a" wide />
            </div>
          </div>
        </div>

        {/* body */}
        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 18 }}>
          {loading && <div style={{ fontFamily: MONO, fontSize: 11, color: "#7c93a1" }}>Loading detail…</div>}
          {error && <div style={{ fontFamily: MONO, fontSize: 11, color: "#ff7a4e" }}>Couldn’t load detail ({error}).</div>}

          {unidentified && (
            <div
              style={{
                fontFamily: MONO,
                fontSize: 10.5,
                lineHeight: 1.5,
                color: "#f3d79a",
                background: "rgba(243,194,90,0.08)",
                border: "1px solid rgba(243,194,90,0.3)",
                borderRadius: 7,
                padding: "10px 12px",
              }}
            >
              This is an <strong>unidentified-persons</strong> record. The identity shown is not established — do not
              assume the image depicts any specific named individual. The FBI is seeking information to identify this
              record.
            </div>
          )}

          {/* aliases */}
          {d && (d.aliases ?? []).length > 0 && (
            <Section title="ALSO KNOWN AS">
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                {(d.aliases ?? []).map((a, i) => (
                  <span key={i} style={{ fontFamily: MONO, fontSize: 10, color: "#cdd9e2", border: "1px solid rgba(120,180,210,0.25)", padding: "3px 8px", borderRadius: 3 }}>
                    {a}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* physical description */}
          {d?.physical_description && physicalRows(d.physical_description).length > 0 && (
            <Section title="PHYSICAL DESCRIPTION">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "8px 18px" }}>
                {physicalRows(d.physical_description).map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 8, borderBottom: "1px solid rgba(120,180,210,0.1)", paddingBottom: 3 }}>
                    <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.6px", color: "#7c93a1" }}>{k}</span>
                    <span style={{ fontFamily: MONO, fontSize: 10, color: "#dce8ef", textAlign: "right" }}>{v}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* caution narrative (sanitized server-side) */}
          {d?.caution_html && (
            <Section title={unidentified ? "CASE NARRATIVE" : "CAUTION"}>
              <Narrative html={d.caution_html} />
            </Section>
          )}
          {d?.remarks_html && (
            <Section title="REMARKS">
              <Narrative html={d.remarks_html} />
            </Section>
          )}
          {d?.details_html && (
            <Section title="DETAILS">
              <Narrative html={d.details_html} />
            </Section>
          )}

          {/* display-level duplicate linkage: same name + shared DOB (G2) */}
          {d && d.also_listed.length > 0 && (
            <Section title="ALSO LISTED UNDER">
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {d.also_listed.map((r) => (
                  <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: MONO, fontSize: 9.5, color: "#cdd9e2", flex: "1 1 auto", minWidth: 120 }}>
                      {(r.subjects ?? []).filter(Boolean).join(" · ") || r.title || "UNCATEGORIZED"}
                    </span>
                    <a href={`/suspect/${r.id}`} target="_blank" rel="noopener noreferrer" style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.6px", color: SOURCED_COLOR, textDecoration: "none", border: `1px solid ${hexA(SOURCED_COLOR, 0.4)}`, padding: "2px 7px", borderRadius: 3 }}>
                      FULL RECORD →
                    </a>
                    {r.source_url && (
                      <a href={r.source_url} target="_blank" rel="noopener noreferrer" style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.6px", color: "#9fe7c8", textDecoration: "none", border: "1px solid rgba(159,231,200,0.4)", padding: "2px 7px", borderRadius: 3 }}>
                        FBI SOURCE →
                      </a>
                    )}
                  </div>
                ))}
              </div>
              <p style={{ fontFamily: MONO, fontSize: 8, color: "#5d7180", margin: "8px 0 0", lineHeight: 1.5 }}>
                The FBI lists this person on more than one program page (same name and date of birth). Each listing keeps
                its own official source record — nothing is merged in the data.
              </p>
            </Section>
          )}
        </div>

        {/* report routing — one-way to the FBI; this site stores no tips */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "12px 18px",
            borderTop: "1px solid rgba(120,180,210,0.14)",
            background: hexA(cat.accent, 0.06),
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
            <span style={{ fontFamily: LABEL, fontSize: 11, fontWeight: 700, letterSpacing: "1.8px", color: cat.accent }}>{cat.action}</span>
            <span style={{ fontFamily: MONO, fontSize: 8.5, color: "#aebfc9", lineHeight: 1.5 }}>
              {cat.actionSub} 1-800-CALL-FBI (1-800-225-5324) — this site stores no tips.
            </span>
          </div>
          <a
            href="https://tips.fbi.gov"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontFamily: LABEL,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "1px",
              color: "#06121a",
              background: cat.accent,
              padding: "9px 16px",
              borderRadius: 5,
              textDecoration: "none",
              flex: "0 0 auto",
            }}
          >
            REPORT TO FBI → TIPS.FBI.GOV
          </a>
        </div>

        {/* footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "14px 18px",
            borderTop: "1px solid rgba(120,180,210,0.14)",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontFamily: MONO, fontSize: 8.5, color: "#5d7180" }}>
            {d?.fbi_uid ? `FBI UID ${d.fbi_uid}` : suspect.fbi_uid ? `FBI UID ${suspect.fbi_uid}` : ""}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <CopyLinkButton id={suspect.id} />
            <a
              href={`/suspect/${suspect.id}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontFamily: LABEL,
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "1px",
                color: SOURCED_COLOR,
                border: `1px solid ${hexA(SOURCED_COLOR, 0.5)}`,
                padding: "8px 14px",
                borderRadius: 5,
                textDecoration: "none",
              }}
            >
              OPEN FULL RECORD →
            </a>
            {(d?.source_url ?? suspect.source_url) && (
              <a
                href={(d?.source_url ?? suspect.source_url) as string}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontFamily: LABEL,
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "1px",
                  color: "#06121a",
                  background: SOURCED_COLOR,
                  padding: "9px 16px",
                  borderRadius: 5,
                  textDecoration: "none",
                }}
              >
                VIEW OFFICIAL FBI RECORD →
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CopyLinkButton({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        const url = `${window.location.origin}/suspect/${id}`;
        navigator.clipboard
          ?.writeText(url)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          })
          .catch(() => {
            /* clipboard unavailable (permissions/insecure context) — no-op */
          });
      }}
      title="Copy a shareable link to this record"
      style={{
        appearance: "none",
        cursor: "pointer",
        fontFamily: LABEL,
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: "1px",
        color: copied ? "#9fe7c8" : "#cdd9e2",
        background: "transparent",
        border: `1px solid ${copied ? "rgba(159,231,200,0.6)" : "rgba(120,180,210,0.35)"}`,
        padding: "8px 14px",
        borderRadius: 5,
      }}
    >
      {copied ? "COPIED ✓" : "COPY LINK"}
    </button>
  );
}

function Field({ label, value, valueColor, wide }: { label: string; value: string; valueColor?: string; wide?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, maxWidth: wide ? 360 : undefined }}>
      <span style={{ fontFamily: MONO, fontSize: 8, letterSpacing: "1px", color: "#5d7180" }}>{label}</span>
      <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, color: valueColor ?? "#dce8ef", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontFamily: LABEL, fontSize: 10, fontWeight: 700, letterSpacing: "2.4px", color: "#7f9aab", marginBottom: 9 }}>{title}</div>
      {children}
    </div>
  );
}

function Narrative({ html }: { html: string }) {
  // html is sanitized server-side in queries.ts (cleanHtml) — safe to render.
  return (
    <div
      style={{ fontFamily: "Barlow, sans-serif", fontSize: 13.5, lineHeight: 1.6, color: "#c8d6df" }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
