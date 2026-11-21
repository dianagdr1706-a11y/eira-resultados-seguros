import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { UPLOAD_DIR, db, type Documento, type Estudio } from "@/lib/db";
import { kv } from "@/lib/kv";
import { PAC_COOKIE, clientIp } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { sha256 } from "@/lib/ids";
import { nowIso } from "@/lib/clock";

function denegado(msg: string, status = 401) {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Acceso denegado</title><body style="font-family:sans-serif;max-width:560px;margin:60px auto;padding:20px"><h1 style="color:#be123c">Acceso denegado</h1><p>${msg}</p><p><a href="/portal">Ir al portal de EIRA</a></p></body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

export async function GET(req: Request) {
  const t = new URL(req.url).searchParams.get("t") ?? "";
  const store = await kv();
  const raw = t ? await store.get(`dl:${t}`) : null;
  const sess = cookies().get(PAC_COOKIE)?.value;
  if (!raw) {
    audit({ tipo: "sistema" }, "DESCARGA_DENEGADA (token inválido, usado o expirado)", null, null, clientIp());
    return denegado("Este enlace no es válido, ya se usó o expiró. Los documentos solo se pueden ver iniciando sesión en el portal.");
  }
  const info = JSON.parse(raw) as { pid: string; estudioId: string; sess: string };
  const pid = sess ? await store.get(`ps:${sess}`) : null;
  if (!sess || sess !== info.sess || pid !== info.pid) {
    audit({ tipo: "sistema" }, "DESCARGA_DENEGADA (sin sesión de la paciente)", info.estudioId, null, clientIp());
    return denegado("Necesitas iniciar sesión como la paciente titular para ver este documento.");
  }
  const primeraVez = (await store.incr(`dlused:${t}`, 120)) === 1;
  const d = db();
  const e = d.prepare("SELECT * FROM estudios WHERE id = ? AND paciente_id = ?").get(info.estudioId, info.pid) as Estudio | undefined;
  if (!e || !["autorizado_digital", "notificado", "consultado"].includes(e.estado)) return denegado("Documento no disponible.", 403);
  const doc = d.prepare("SELECT * FROM documentos WHERE estudio_id = ? AND vigente = 1").get(e.id) as Documento;
  const buf = fs.readFileSync(path.join(UPLOAD_DIR, path.basename(doc.ruta)));
  if (sha256(buf) !== doc.sha256) {
    audit({ tipo: "sistema" }, "INTEGRIDAD_FALLIDA: el PDF no coincide con su SHA-256", e.id);
    return denegado("El documento no pasó la verificación de integridad. EIRA fue notificada.", 409);
  }
  const archivo = `documento_eira_${e.folio_muestra}`.normalize("NFKD").replace(/[^A-Za-z0-9._-]/g, "_");
  if (e.estado !== "consultado")
    d.prepare("UPDATE estudios SET estado = 'consultado', consultado_en = ?, requiere_asistida = 0 WHERE id = ?").run(nowIso(), e.id);
  if (primeraVez) audit({ tipo: "paciente", id: info.pid, nombre: "Paciente titular" }, "DESCARGA_PACIENTE (integridad SHA-256 verificada)", e.id, null, clientIp());
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${archivo}.pdf"`,
      "Cache-Control": "no-store, private, max-age=0",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
