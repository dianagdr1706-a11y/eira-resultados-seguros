import { NextResponse } from "next/server";
import { getPaciente } from "@/lib/auth";
import { emitirTokenDescarga } from "@/core/reto4/portal";
import { ErrorDominio } from "@/core/errores";

export async function POST(req: Request) {
  const base = new URL(req.url);
  const s = await getPaciente();
  if (!s) return NextResponse.redirect(new URL("/portal?error=sesion", base), 303);
  const estudioId = String((await req.formData()).get("estudio_id") ?? "");
  try {
    const t = await emitirTokenDescarga({ pacienteId: s.paciente.id, sesion: s.token, estudioId });
    return NextResponse.redirect(new URL(`/api/portal/descarga?t=${t}`, base), 303);
  } catch (e) {
    if (e instanceof ErrorDominio) return NextResponse.redirect(new URL("/portal/resultados?error=noautorizado", base), 303);
    throw e;
  }
}
