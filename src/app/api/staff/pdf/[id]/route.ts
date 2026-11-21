import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { UPLOAD_DIR, db, type Documento } from "@/lib/db";
import { getStaff, clientIp } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const u = await getStaff();
  if (!u || !["eira_admin", "medico", "auditoria"].includes(u.rol)) return new NextResponse("No autorizado", { status: 401 });
  const doc = db().prepare("SELECT * FROM documentos WHERE id = ?").get(params.id) as Documento | undefined;
  if (!doc) return new NextResponse("No encontrado", { status: 404 });
  const buf = fs.readFileSync(path.join(UPLOAD_DIR, path.basename(doc.ruta)));
  audit({ tipo: "usuario", id: u.id, nombre: `${u.nombre} (${u.rol})` }, "PDF_VISUALIZADO_PERSONAL", doc.estudio_id, null, clientIp());
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "inline",
      "Cache-Control": "no-store, private",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
