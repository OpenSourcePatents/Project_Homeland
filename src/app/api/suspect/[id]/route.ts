import { NextResponse } from "next/server";
import { getPublicSuspectDetail } from "@/lib/queries";

// Node runtime (sanitize-html needs Node APIs) and never cached — the wall query
// runs per request on the server.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/suspect/[id] — rich detail for the modal.
 *
 * Server-only path: getPublicSuspectDetail enforces the official/analytical wall
 * (WHERE data_class='official') and sanitizes the HTML narrative. The client only
 * ever receives an official, sanitized record (or 404).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const detail = await getPublicSuspectDetail(id);
  if (!detail) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(detail);
}
