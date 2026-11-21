import { NextResponse } from "next/server";
import { requireStaffApi } from "@/lib/auth";
import { registryErrorResponse, updatePatient } from "@/lib/registry";

export const dynamic = "force-dynamic";

/** Reto 1 · Actualiza solo los campos de contacto cambiados (control de versión + bitácora antes/después). */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
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
    return NextResponse.json(updatePatient(id, body.base_version, body.changes, auth.staff), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return registryErrorResponse(err);
  }
}
