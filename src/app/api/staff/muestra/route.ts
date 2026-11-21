import { NextResponse } from "next/server";
import { getStaff } from "@/lib/auth";
import { PACIENTES_DEMO } from "@/lib/seed";
import { samplePdf } from "@/lib/pdf";

export async function GET(req: Request) {
  const u = await getStaff();
  if (!u) return new NextResponse("No autorizado", { status: 401 });
  const url = new URL(req.url);
  const p = PACIENTES_DEMO[Number(url.searchParams.get("i") ?? 0)] ?? PACIENTES_DEMO[0];
  const folio = `CIT-2026-${1000 + Math.floor(Math.random() * 900)}`;
  const buf = await samplePdf({ ...p, folio, fecha_toma: new Date().toISOString().slice(0, 10), bethesda: url.searchParams.get("bethesda") ?? "1" });
  return new NextResponse(new Uint8Array(buf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${folio}_${p.id_eira}.pdf"`, "Cache-Control": "no-store" },
  });
}
