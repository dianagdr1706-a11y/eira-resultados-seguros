import { NextResponse } from "next/server";
import { requireStaffApi } from "@/lib/auth";
import { ensureSeedPdfs } from "@/lib/db";
import { getPatientHistory, registryErrorResponse } from "@/lib/registry";

export const dynamic = "force-dynamic";

/** Reto 1 · Expediente: visitas + estudios (nota clínica solo para rol médico) + bitácora. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffApi();
  if (auth.response) return auth.response;
  await ensureSeedPdfs();
  const { id } = await context.params;
  try {
    return NextResponse.json(getPatientHistory(id, auth.staff), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return registryErrorResponse(err);
  }
}
