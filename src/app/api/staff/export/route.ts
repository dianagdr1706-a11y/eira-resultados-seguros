import { NextResponse } from "next/server";
import { getStaff, clientIp } from "@/lib/auth";
import { listarEstudios } from "@/lib/consultas";
import { audit } from "@/lib/audit";

const CAMPOS = ["id", "folio_muestra", "id_eira", "municipio", "sede_jornada", "fecha_toma", "estado", "prioridad", "requiere_asistida", "autorizado_en", "notificado_en", "consultado_en", "cerrado_en", "creado_en"] as const;

export async function GET(req: Request) {
  const u = await getStaff();
  if (!u || u.rol === "laboratorio") return new NextResponse("No autorizado", { status: 401 });
  const format = new URL(req.url).searchParams.get("format") ?? "csv";
  const rows = listarEstudios().map((r) => Object.fromEntries(CAMPOS.map((c) => [c, (r as Record<string, unknown>)[c] ?? null])));
  audit({ tipo: "usuario", id: u.id, nombre: `${u.nombre} (${u.rol})` }, `EXPORTACION_${format.toUpperCase()}`, null, { filas: rows.length }, clientIp());
  if (format === "json") {
    return NextResponse.json({ generado: new Date().toISOString(), nota: "Sin nombres ni datos de contacto (minimización)", estudios: rows }, { headers: { "Cache-Control": "no-store" } });
  }
  const esc = (v: unknown) => (v === null ? "" : `"${String(v).replace(/"/g, '""')}"`);
  const csv = [CAMPOS.join(","), ...rows.map((r) => CAMPOS.map((c) => esc(r[c])).join(","))].join("\n");
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="estudios_eira.csv"', "Cache-Control": "no-store" } });
}
