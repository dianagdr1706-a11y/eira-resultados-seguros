import { NextResponse } from "next/server";
import { requireStaffApi } from "@/lib/auth";
import { findCandidates, parseCaptureInput } from "@/lib/matching";

export const dynamic = "force-dynamic";

/** Reto 1 · Busca expedientes que podrían ser de la misma paciente (no vincula nada). */
export async function POST(request: Request) {
  const auth = await requireStaffApi(["promotora_kiosco", "eira_admin", "laboratorio"]);
  if (auth.response) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Cuerpo JSON inválido." }, { status: 400 });
  }
  const input = parseCaptureInput(body);
  if (typeof input === "string") return NextResponse.json({ error: input }, { status: 400 });

  return NextResponse.json(
    { candidates: findCandidates(input) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
