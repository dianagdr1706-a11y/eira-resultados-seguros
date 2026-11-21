"use server";

import { redirect } from "next/navigation";
import { clientIp, requireStaff } from "@/lib/auth";
import { intentarAlterar as alterar } from "@/core/bitacora";

export async function intentarAlterar() {
  const u = await requireStaff(["eira_admin", "auditoria"]);
  const r = alterar({ usuario: u, ip: clientIp() });
  redirect(`/staff/bitacora?alterar=${encodeURIComponent(r.mensaje)}`);
}
