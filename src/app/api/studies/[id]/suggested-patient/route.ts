import { NextResponse } from "next/server";
import { requireStaffApi } from "@/lib/auth";
import { ensureSeedPdfs } from "@/lib/db";
import { registryErrorResponse, suggestPatientForStudy } from "@/lib/registry";

export const dynamic = "force-dynamic";

/** Puente Reto 1 → Reto 4: propone la paciente cuya visita registró el mismo folio de muestra. Nunca asocia. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffApi(["eira_admin", "laboratorio"]);
  if (auth.response) return auth.response;
  await ensureSeedPdfs();
  const { id } = await context.params;
  try {
    return NextResponse.json(
      { suggestion: suggestPatientForStudy(id) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return registryErrorResponse(err);
  }
}
