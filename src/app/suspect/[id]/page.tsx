import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicSuspectDetail } from "@/lib/queries";
import type { PhysicalDescription, SuspectDetail } from "@/lib/public-suspect";
import { CATEGORY_META } from "@/lib/category";
import { formatReward } from "@/lib/reward";
import { hexA } from "@/lib/color";

/**
 * Shareable permalink for a single record. Server-rendered; the query is
 * wall-enforced (getPublicSuspectDetail filters WHERE data_class='official'),
 * so a missing OR non-official id is identically a 404 — the wall applies to
 * deep links. Narrative HTML is sanitized server-side before render; the
 * FBI's own allegation language ("allegedly", "wanted for") is preserved
 * verbatim.
 */
export const runtime = "nodejs"; // sanitize-html needs Node APIs
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LABEL = "Oxanium, sans-serif";
const MONO = "'IBM Plex Mono', monospace";
const CYAN = "#5fe6ff";

// getPublicSuspectDetail is wrapped in React cache(), so generateMetadata and
// the page body share a single wall-enforced query per request.
async function loadDetail(id: string): Promise<SuspectDetail | null> {
  if (!UUID_RE.test(id)) return null;
  return getPublicSuspectDetail(id);
}

function displayName(d: SuspectDetail): string {
  const n = [d.first_name, d.last_name].filter(Boolean).join(" ").trim();
  return n || (d.title ?? "").trim() || "(unnamed record)";
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Plain-text summary for social metadata — verbatim FBI text, just clipped. */
function metaDescription(d: SuspectDetail): string {
  const source =
    (d.description ?? "").trim() ||
    (d.caution_html ? stripHtml(d.caution_html) : "") ||
    (d.subjects ?? []).filter(Boolean).join(" · ") ||
    "Official FBI record, republished verbatim by Project Homeland.";
  return source.length > 150 ? source.slice(0, 149).trimEnd() + "…" : source;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const d = await loadDetail(id);
  if (!d) return { title: "Record not found — Project Homeland" };
  const name = displayName(d);
  const description = metaDescription(d);
  return {
    title: `${name} — Project Homeland`,
    description,
    openGraph: {
      title: `${name} — Project Homeland`,
      description,
      ...(d.image_url ? { images: [d.image_url] } : {}),
    },
    twitter: {
      card: d.image_url ? "summary_large_image" : "summary",
      title: `${name} — Project Homeland`,
      description,
      ...(d.image_url ? { images: [d.image_url] } : {}),
    },
  };
}

// ---- small presentational helpers --------------------------------------------

function heightStr(p: PhysicalDescription): string | null {
  const fmt = (inches: number) => `${Math.floor(inches / 12)}'${inches % 12}"`;
  if (typeof p.height_min === "number" && typeof p.height_max === "number") {
    return p.height_min === p.height_max ? fmt(p.height_min) : `${fmt(p.height_min)}–${fmt(p.height_max)}`;
  }
  if (typeof p.height_min === "number") return fmt(p.height_min);
  if (typeof p.height_max === "number") return fmt(p.height_max);
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

function statusLabel(d: SuspectDetail): string {
  switch (d.status) {
    case "captured":
      return "IN CUSTODY";
    case "deceased":
      return "DECEASED";
    case "recovered":
      return "RECOVERED";
    case "surrendered":
      return "SURRENDERED";
    case "resolved":
      return "RESOLVED";
    case "removed_from_fbi":
      return "REMOVED FROM FBI LIST";
    default:
      return "ACTIVE RECORD";
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 26 }}>
      <h2 style={{ fontFamily: LABEL, fontSize: 11, fontWeight: 700, letterSpacing: "2.6px", color: "#7f9aab", margin: "0 0 10px" }}>{title}</h2>
      {children}
    </section>
  );
}

function Chip({ text, color }: { text: string; color: string }) {
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "1px",
        color,
        border: `1px solid ${hexA(color, 0.55)}`,
        padding: "3px 8px",
        borderRadius: 3,
      }}
    >
      {text}
    </span>
  );
}

// ---- the page -----------------------------------------------------------------

export default async function SuspectPermalink({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await loadDetail(id);
  if (!d) notFound(); // wall-enforced: non-official and nonexistent are identical

  const name = displayName(d);
  const cat = CATEGORY_META[d.category];
  const armed = /ARMED/i.test(d.warning_message ?? "");
  const recognizeFraming = d.unidentified || d.category === "SEEKING_INFO";
  const kicker = recognizeFraming
    ? "DO YOU RECOGNIZE THIS PERSON OR HAVE INFORMATION?"
    : d.category === "MISSING"
      ? "MISSING PERSON — HELP LOCATE"
      : "WANTED BY THE FBI";
  const aliases = (d.aliases ?? []).filter(Boolean);
  const dobs = (d.dates_of_birth_used ?? []).filter(Boolean);
  const offices = (d.field_offices ?? []).filter(Boolean);
  const subjects = (d.subjects ?? []).filter(Boolean);
  const physRows = d.physical_description ? physicalRows(d.physical_description) : [];

  return (
    <div style={{ position: "fixed", inset: 0, overflowY: "auto", background: "#04060a", color: "#eef4f8" }}>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "24px clamp(12px, 4vw, 22px) 70px" }}>
        {/* top bar */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 14, flexWrap: "wrap", marginBottom: 22 }}>
          <Link href="/" style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "1.2px", color: CYAN, textDecoration: "none" }}>
            ← PROJECT HOMELAND · COMMAND VIEW
          </Link>
          <Link href="/about" style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "1.2px", color: "#7c93a1", textDecoration: "none" }}>
            ABOUT THIS DATA →
          </Link>
        </div>

        {/* record card */}
        <div style={{ background: "linear-gradient(180deg, rgba(11,16,22,0.98), rgba(8,11,16,0.98))", border: `1px solid ${hexA(cat.accent, 0.35)}`, borderRadius: 12 }}>
          {/* header */}
          <div style={{ padding: "18px clamp(12px, 4vw, 22px)", borderBottom: "1px solid rgba(120,180,210,0.14)" }}>
            <div style={{ fontFamily: LABEL, fontSize: 11, fontWeight: 700, letterSpacing: "2.6px", color: cat.accent, marginBottom: 10 }}>{kicker}</div>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
              <div
                style={{
                  width: "clamp(116px, 32vw, 170px)",
                  height: "clamp(146px, 40vw, 214px)",
                  flex: "0 0 auto",
                  borderRadius: 8,
                  overflow: "hidden",
                  background: "#0a0f14",
                  border: "1px solid rgba(120,180,210,0.25)",
                }}
              >
                {d.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={d.image_url}
                    alt={d.unidentified ? "Unidentified — image on file with the FBI" : name}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontFamily: MONO, fontSize: 10, color: "#5d7180" }}>
                    NO IMAGE
                  </div>
                )}
              </div>

              <div style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: "1px", color: "#06121a", background: "#9fe7c8", padding: "3px 8px", borderRadius: 3 }}>
                    ◤ SOURCED · FBI
                  </span>
                  <Chip text={cat.label} color={cat.accent} />
                  {d.unidentified && <Chip text="⚠ UNIDENTIFIED" color="#f3c25a" />}
                  <Chip text={statusLabel(d)} color={d.status === "na" ? "#f3c25a" : "#8aa0ad"} />
                </div>

                <h1 style={{ margin: 0, fontFamily: LABEL, fontSize: "clamp(19px, 5.5vw, 28px)", fontWeight: 800, letterSpacing: "0.5px", lineHeight: 1.15, overflowWrap: "anywhere" }}>{name}</h1>

                {subjects.length > 0 && (
                  <div style={{ fontFamily: MONO, fontSize: 10, color: "#7c93a1" }}>{subjects.join(" · ")}</div>
                )}

                <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 4 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontFamily: MONO, fontSize: 8, letterSpacing: "1px", color: "#5d7180" }}>LOCATION</span>
                    <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, color: "#dce8ef" }}>{d.resolved_state ?? "—"}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontFamily: MONO, fontSize: 8, letterSpacing: "1px", color: "#5d7180" }}>REWARD</span>
                    <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, color: "#f3c25a" }}>{formatReward(d.reward_text)}</span>
                  </div>
                  {offices.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontFamily: MONO, fontSize: 8, letterSpacing: "1px", color: "#5d7180" }}>FIELD OFFICE</span>
                      <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, color: "#dce8ef" }}>{offices.join(" · ").toUpperCase()}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* body */}
          <div style={{ padding: "18px clamp(12px, 4vw, 22px)" }}>
            {/* FBI warning — prominent when present, verbatim */}
            {d.warning_message && (
              <div
                style={{
                  fontFamily: LABEL,
                  fontSize: 14,
                  fontWeight: 800,
                  letterSpacing: "2px",
                  color: armed ? "#ff3b4e" : "#ff7a4e",
                  background: armed ? "rgba(255,59,78,0.08)" : "rgba(255,122,78,0.08)",
                  border: `1px solid ${armed ? "rgba(255,59,78,0.5)" : "rgba(255,122,78,0.5)"}`,
                  borderRadius: 8,
                  padding: "12px 16px",
                  marginBottom: 24,
                }}
              >
                ⚠ {d.warning_message}
              </div>
            )}

            {d.unidentified && (
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  lineHeight: 1.6,
                  color: "#f3d79a",
                  background: "rgba(243,194,90,0.08)",
                  border: "1px solid rgba(243,194,90,0.3)",
                  borderRadius: 8,
                  padding: "12px 14px",
                  marginBottom: 24,
                }}
              >
                This is an <strong>unidentified-persons</strong> record. The identity shown is not established — do not
                assume the image depicts any specific named individual. The FBI is seeking the public&apos;s help with
                identification.
              </div>
            )}

            {aliases.length > 0 && (
              <Section title="ALSO KNOWN AS">
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                  {aliases.map((a, i) => (
                    <span key={i} style={{ fontFamily: MONO, fontSize: 10.5, color: "#cdd9e2", border: "1px solid rgba(120,180,210,0.25)", padding: "3px 9px", borderRadius: 3 }}>
                      {a}
                    </span>
                  ))}
                </div>
              </Section>
            )}

            {dobs.length > 0 && (
              <Section title="DATES OF BIRTH USED">
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                  {dobs.map((v, i) => (
                    <span key={i} style={{ fontFamily: MONO, fontSize: 10.5, color: "#cdd9e2", border: "1px solid rgba(120,180,210,0.25)", padding: "3px 9px", borderRadius: 3 }}>
                      {v}
                    </span>
                  ))}
                </div>
              </Section>
            )}

            {physRows.length > 0 && (
              <Section title="PHYSICAL DESCRIPTION">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: "8px 20px" }}>
                  {physRows.map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 8, borderBottom: "1px solid rgba(120,180,210,0.1)", paddingBottom: 4 }}>
                      <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.6px", color: "#7c93a1" }}>{k}</span>
                      <span style={{ fontFamily: MONO, fontSize: 10.5, color: "#dce8ef", textAlign: "right" }}>{v}</span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {d.reward_text && (
              <Section title="REWARD">
                {/* one live record carries literal HTML markup in reward_text —
                    strip tags for display; the words themselves stay verbatim */}
                <p style={{ fontFamily: "Barlow, sans-serif", fontSize: 14.5, lineHeight: 1.65, color: "#c8d6df", margin: 0 }}>{stripHtml(d.reward_text)}</p>
              </Section>
            )}

            {/* FBI narrative — sanitized server-side; allegation language verbatim */}
            {d.caution_html && (
              <Section title={recognizeFraming ? "CASE NARRATIVE" : "CAUTION"}>
                <div style={{ fontFamily: "Barlow, sans-serif", fontSize: 14.5, lineHeight: 1.65, color: "#c8d6df" }} dangerouslySetInnerHTML={{ __html: d.caution_html }} />
              </Section>
            )}
            {d.remarks_html && (
              <Section title="REMARKS">
                <div style={{ fontFamily: "Barlow, sans-serif", fontSize: 14.5, lineHeight: 1.65, color: "#c8d6df" }} dangerouslySetInnerHTML={{ __html: d.remarks_html }} />
              </Section>
            )}
            {d.details_html && (
              <Section title="DETAILS">
                <div style={{ fontFamily: "Barlow, sans-serif", fontSize: 14.5, lineHeight: 1.65, color: "#c8d6df" }} dangerouslySetInnerHTML={{ __html: d.details_html }} />
              </Section>
            )}

            {d.also_listed.length > 0 && (
              <Section title="ALSO LISTED UNDER">
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {d.also_listed.map((r) => (
                    <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: MONO, fontSize: 10, color: "#cdd9e2", flex: "1 1 auto", minWidth: 140 }}>
                        {(r.subjects ?? []).filter(Boolean).join(" · ") || r.title || "UNCATEGORIZED"}
                      </span>
                      <Link href={`/suspect/${r.id}`} style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.6px", color: CYAN, textDecoration: "none", border: `1px solid ${hexA(CYAN, 0.4)}`, padding: "2px 8px", borderRadius: 3 }}>
                        FULL RECORD →
                      </Link>
                      {r.source_url && (
                        <a href={r.source_url} target="_blank" rel="noopener noreferrer" style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.6px", color: "#9fe7c8", textDecoration: "none", border: "1px solid rgba(159,231,200,0.4)", padding: "2px 8px", borderRadius: 3 }}>
                          FBI SOURCE →
                        </a>
                      )}
                    </div>
                  ))}
                </div>
                <p style={{ fontFamily: MONO, fontSize: 8.5, color: "#5d7180", margin: "10px 0 0", lineHeight: 1.5 }}>
                  The FBI lists this person on more than one program page (same name and date of birth). Each listing
                  keeps its own official source record.
                </p>
              </Section>
            )}
          </div>

          {/* report routing — one-way to the FBI */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "12px clamp(12px, 4vw, 22px)",
              borderTop: "1px solid rgba(120,180,210,0.14)",
              background: hexA(cat.accent, 0.06),
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
              <span style={{ fontFamily: LABEL, fontSize: 12, fontWeight: 700, letterSpacing: "1.8px", color: cat.accent }}>{cat.action}</span>
              <span style={{ fontFamily: MONO, fontSize: 9, color: "#aebfc9", lineHeight: 1.5 }}>
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
                padding: "10px 16px",
                borderRadius: 5,
                textDecoration: "none",
                flex: "0 0 auto",
              }}
            >
              REPORT TO FBI → TIPS.FBI.GOV
            </a>
          </div>

          {/* source footer */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "12px clamp(12px, 4vw, 22px)",
              borderTop: "1px solid rgba(120,180,210,0.14)",
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontFamily: MONO, fontSize: 9, color: "#5d7180" }}>{d.fbi_uid ? `FBI UID ${d.fbi_uid}` : ""}</span>
            {d.source_url && (
              <a
                href={d.source_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontFamily: LABEL,
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "1px",
                  color: "#06121a",
                  background: CYAN,
                  padding: "10px 16px",
                  borderRadius: 5,
                  textDecoration: "none",
                }}
              >
                VIEW OFFICIAL FBI RECORD →
              </a>
            )}
          </div>
        </div>

        {/* presumption of innocence — on every permalink */}
        <p style={{ fontFamily: MONO, fontSize: 9.5, lineHeight: 1.65, color: "#7c93a1", margin: "22px 4px 0" }}>
          Individuals shown are sought in connection with alleged crimes, are missing, or may have information relevant
          to an investigation. Unless the official record states otherwise, they are presumed innocent until proven
          guilty in a court of law. Data is republished verbatim from the FBI&apos;s public Wanted API and synced daily —
          see <Link href="/about" style={{ color: CYAN, textDecoration: "none" }}>About this data</Link>.
        </p>
      </div>
    </div>
  );
}
