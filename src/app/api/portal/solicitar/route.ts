import { NextResponse } from "next/server";
import { getPaciente } from "@/lib/auth";
import { emitirTokenDescarga } from "@/core/reto4/portal";
import { ErrorDominio } from "@/core/errores";

export async function POST(req: Request) {
  // Ubicación relativa: detrás de un proxy o túnel, req.url trae el host interno y el navegador no podría seguirla.
  const ir = (ruta: string) => new NextResponse(null, { status: 303, headers: { Location: ruta } });
  const s = await getPaciente();
  if (!s) return ir("/portal?error=sesion");
  const estudioId = String((await req.formData()).get("estudio_id") ?? "");
  try {
    const t = await emitirTokenDescarga({ pacienteId: s.paciente.id, sesion: s.token, estudioId });
    return ir(`/api/portal/descarga?t=${t}`);
  } catch (e) {
    if (e instanceof ErrorDominio) return ir("/portal/resultados?error=noautorizado");
    throw e;
  }
}
