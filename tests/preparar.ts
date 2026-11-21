/** Entorno aislado para pruebas: base temporal y almacén en memoria (sin Valkey). */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "eira-test-"));
process.env.VALKEY_URL = "off";

export async function preparar() {
  const { ensureSeeded } = await import("@/sim/datos-demo");
  const { db } = await import("@/lib/db");
  await ensureSeeded();
  const usuario = (u: string) => ({ usuario: db().prepare("SELECT * FROM usuarios WHERE usuario = ?").get(u) as import("@/lib/db").Usuario, ip: "test" });
  return { db, lab: usuario("laboratorio"), admin: usuario("admin"), medico: usuario("medico"), auditoria: usuario("auditoria"), captura: usuario("captura") };
}

/** Ejecuta fn y devuelve el código del ErrorDominio que lanza (o null si no lanza). */
export async function codigo(fn: () => unknown): Promise<string | null> {
  try { await fn(); return null; } catch (e) { return (e as { codigo?: string }).codigo ?? `OTRO:${(e as Error).message}`; }
}
