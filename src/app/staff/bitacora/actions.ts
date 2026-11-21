"use server";

import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";

export async function intentarAlterar() {
  await requireStaff(["eira_admin", "auditoria"]);
  let msg = "UPDATE aplicado (no debería ocurrir)";
  try {
    db().prepare("UPDATE bitacora SET accion = 'ALTERADO' WHERE id = (SELECT MIN(id) FROM bitacora)").run();
  } catch (e) {
    msg = `UPDATE rechazado: ${(e as Error).message}`;
  }
  redirect(`/staff/bitacora?alterar=${encodeURIComponent(msg)}`);
}
