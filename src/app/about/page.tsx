import type { Metadata } from "next";
import Link from "next/link";
import { getDataFreshness, getWallCounts } from "@/lib/queries";

// Live counts + freshness stamp: render per request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "About · Project Homeland",
  description:
    "What Project Homeland is, where its data comes from, what SOURCED means, and how to report information to the FBI.",
};

const LABEL = "Oxanium, sans-serif";
const MONO = "'IBM Plex Mono', monospace";
const CYAN = "#5fe6ff";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 34 }}>
      <h2 style={{ fontFamily: LABEL, fontSize: 12, fontWeight: 700, letterSpacing: "2.6px", color: "#7f9aab", margin: "0 0 12px" }}>{title}</h2>
      <div style={{ fontFamily: "Barlow, sans-serif", fontSize: 15, lineHeight: 1.7, color: "#c8d6df" }}>{children}</div>
    </section>
  );
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: CYAN, textDecoration: "none", borderBottom: `1px dotted ${CYAN}` }}>
      {children}
    </a>
  );
}

function fmtStamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

export default async function AboutPage() {
  const [counts, syncedAt] = await Promise.all([getWallCounts(), getDataFreshness()]);

  return (
    <div style={{ position: "fixed", inset: 0, overflowY: "auto", background: "#04060a", color: "#eef4f8" }}>
      <div style={{ maxWidth: 780, margin: "0 auto", padding: "34px clamp(14px, 5vw, 24px) 80px" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 8 }}>
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
            <span style={{ fontFamily: LABEL, fontWeight: 800, fontSize: "clamp(16px, 4.5vw, 20px)", letterSpacing: "3px" }}>PROJECT HOMELAND</span>
            <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "2.6px", color: "#ff5667", marginTop: 6 }}>ABOUT THIS DATA</span>
          </div>
          <Link href="/" style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "1.2px", color: CYAN, textDecoration: "none" }}>
            ← COMMAND VIEW
          </Link>
        </div>

        <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.6px", color: "#7c93a1", marginBottom: 36 }}>
          DATA SYNCED {fmtStamp(syncedAt)}
          {counts ? ` · ${counts.official.toLocaleString("en-US")} OFFICIAL RECORDS` : ""}
        </div>

        <Section title="WHAT THIS IS">
          <p style={{ margin: "0 0 10px" }}>
            Project Homeland is an independent public-awareness tool that visualizes the FBI&apos;s public Wanted data —
            fugitives, missing persons, and cases where the FBI is seeking information from the public — on a single map
            and record browser.
          </p>
          <p style={{ margin: 0 }}>
            It is an open-source project. It is <strong>not affiliated with, operated by, or endorsed by</strong> the
            FBI, the Department of Homeland Security, or any government agency.
          </p>
        </Section>

        <Section title="DATA SOURCE & PIPELINE">
          <p style={{ margin: "0 0 10px" }}>
            Every record shown here comes from the FBI&apos;s public Wanted API (<Ext href="https://api.fbi.gov/wanted/v1/list">api.fbi.gov</Ext>),
            the same data behind <Ext href="https://www.fbi.gov/wanted">fbi.gov/wanted</Ext>. An automated job syncs the
            full list once a day and republishes each record <strong>verbatim</strong> — names, allegations, physical
            descriptions, reward language, and photographs are the FBI&apos;s own words and images, unedited. Every record
            links back to its official FBI source page.
          </p>
          <p style={{ margin: 0 }}>
            The header of the map shows when the data was last synced. The advisory banner shows the live status of the
            DHS <Ext href="https://www.dhs.gov/national-terrorism-advisory-system">National Terrorism Advisory System</Ext>,
            fetched from DHS directly — when there are no active advisories, the banner says so.
          </p>
        </Section>

        <Section title="WHAT “SOURCED” MEANS">
          <p style={{ margin: "0 0 10px" }}>
            The platform enforces a hard wall between two classes of information. <strong>SOURCED</strong> (official)
            records are confirmed federal records pulled from the FBI&apos;s API — every record you can see on this site
            is one of these{counts ? ` (currently ${counts.official.toLocaleString("en-US")})` : ""}. <strong>ANALYTICAL</strong>{" "}
            items would be the platform&apos;s own analysis or inference
            {counts ? ` — there are currently ${counts.analytical.toLocaleString("en-US")} such items` : ""}, and if any
            are ever added they will be walled off from the official data, always visually distinct and clearly labeled.
          </p>
          <p style={{ margin: 0 }}>
            The wall is enforced in code, not just in styling: every public query filters to official records only, so an
            unvetted item is structurally unreachable from this site.
          </p>
        </Section>

        <Section title="WHAT THIS TOOL IS NOT">
          <p style={{ margin: "0 0 10px" }}>
            This is <strong>not law enforcement</strong>, it is <strong>not real-time</strong> (data is synced daily), and
            it is <strong>not a substitute for official sources</strong> — always defer to{" "}
            <Ext href="https://www.fbi.gov/wanted">fbi.gov/wanted</Ext> for the authoritative record.
          </p>
          <p style={{ margin: 0 }}>
            <strong style={{ color: "#ff5667" }}>Never approach or attempt to apprehend anyone</strong> shown on this
            site. Individuals may be armed and dangerous. If you have information, report it to the FBI — this site
            stores no tips and has no way to receive them.
          </p>
        </Section>

        <Section title="HOW TO REPORT">
          <p style={{ margin: 0 }}>
            Submit tips online at <Ext href="https://tips.fbi.gov">tips.fbi.gov</Ext> or call{" "}
            <strong>1-800-CALL-FBI (1-800-225-5324)</strong>. For emergencies, call 911. Reporting is routed one-way to
            the FBI; nothing you report touches this site.
          </p>
        </Section>

        <Section title="PRESUMPTION OF INNOCENCE">
          <p style={{ margin: 0 }}>
            Individuals shown here are sought in connection with <strong>alleged</strong> crimes, or are missing, or may
            have information relevant to an investigation. Unless noted otherwise in the official record, they are
            wanted on charges or allegations only and are <strong>presumed innocent until proven guilty in a court of
            law</strong> — the same caution the FBI prints on its own posters. Allegation language from the FBI
            (&quot;allegedly&quot;, &quot;wanted in connection with&quot;) is preserved exactly as published.
          </p>
        </Section>

        <Section title="CORRECTIONS">
          <p style={{ margin: 0 }}>
            Spotted an error — a mislocated record, a display bug, anything that misstates the underlying FBI record?
            Please open an issue at{" "}
            <Ext href="https://github.com/OpenSourcePatents/Project_Homeland/issues">
              github.com/OpenSourcePatents/Project_Homeland
            </Ext>
            . Errors in the underlying FBI data itself should be reported to the FBI.
          </p>
        </Section>

        <div style={{ borderTop: "1px solid rgba(120,180,210,0.14)", paddingTop: 18, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontFamily: MONO, fontSize: 9, color: "#5d7180" }}>PROJECT HOMELAND · INDEPENDENT · OPEN SOURCE</span>
          <Link href="/" style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "1.2px", color: CYAN, textDecoration: "none" }}>
            ← RETURN TO COMMAND VIEW
          </Link>
        </div>
      </div>
    </div>
  );
}
