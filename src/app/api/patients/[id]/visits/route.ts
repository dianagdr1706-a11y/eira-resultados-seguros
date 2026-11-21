import { NextResponse } from "next/server";
import { requireStaffApi } from "@/lib/auth";
import { createVisit, registryErrorResponse, type VisitInput } from "@/lib/registry";

export const dynamic = "force-dynamic";

/** Reto 1 · Registra una visita (servicios por separado). Idempotente por client_uuid. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffApi(["promotora_kiosco", "eira_admin"]);
  if (auth.response) return auth.response;
  const { id } = await context.params;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Cuerpo JSON inválido." }, { status: 400 });
  }
  try {
    const result = createVisit(id, body as VisitInput, auth.staff, {
      fromMatch: body.from_match === true,
      matchScore: typeof body.match_score === "number" ? body.match_score : undefined,
    });
    return NextResponse.json(result, {
      status: result.duplicate ? 200 : 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return registryErrorResponse(err);
  }
}
