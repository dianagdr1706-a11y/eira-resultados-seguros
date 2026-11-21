import { NextResponse } from "next/server";
import { getPaciente } from "@/lib/auth";
import { db, type Estudio } from "@/lib/db";
import { kv } from "@/lib/kv";
import { randomToken } from "@/lib/ids";

export async function POST(req: Request) {
  const base = new URL(req.url);
  const s = await getPaciente();
  if (!s) return NextResponse.redirect(new URL("/portal?error=sesion", base), 303);
  const estudioId = String((await req.formData()).get("estudio_id") ?? "");
  const e = db().prepare("SELECT * FROM estudios WHERE id = ? AND paciente_id = ?").get(estudioId, s.paciente.id) as Estudio | undefined;
  if (!e || !["autorizado_digital", "notificado", "consultado"].includes(e.estado))
    return NextResponse.redirect(new URL("/portal/resultados?error=noautorizado", base), 303);
  const t = randomToken();
  await (await kv()).set(`dl:${t}`, JSON.stringify({ pid: s.paciente.id, estudioId, sess: s.token }), 120);
  return NextResponse.redirect(new URL(`/api/portal/descarga?t=${t}`, base), 303);
}
