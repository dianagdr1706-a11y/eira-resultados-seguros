/** Bitácora transversal (Retos 1 y 4): solo inserción, encadenada por SHA-256. */
import { db } from "@/lib/db";
import { audit, verifyChain, type BitacoraRow } from "@/lib/audit";
import { actorDe, exigir, type Ctx } from "./permisos";

export function consultarBitacora(ctx: Ctx, limite = 300) {
  exigir(ctx, "bitacora.consultar");
  const registros = db().prepare("SELECT * FROM bitacora ORDER BY id DESC LIMIT ?").all(Math.min(Math.max(limite, 1), 1000)) as BitacoraRow[];
  return { integridad: verifyChain(), registros };
}

/** Recalcula toda la cadena de hashes y dice si está íntegra. */
export function verificarIntegridad(ctx: Ctx) {
  exigir(ctx, "bitacora.consultar");
  return verifyChain();
}

/** Prueba real de inmutabilidad: intenta un UPDATE y devuelve el rechazo de la base de datos. */
export function intentarAlterar(ctx: Ctx): { rechazado: boolean; mensaje: string } {
  exigir(ctx, "bitacora.consultar");
  let r: { rechazado: boolean; mensaje: string };
  try {
    db().prepare("UPDATE bitacora SET accion = 'ALTERADO' WHERE id = (SELECT MIN(id) FROM bitacora)").run();
    r = { rechazado: false, mensaje: "La base de datos aceptó el cambio" };
  } catch (err) {
    r = { rechazado: true, mensaje: `UPDATE rechazado: ${(err as Error).message}` };
  }
  audit(actorDe(ctx), "INTENTO_ALTERAR_BITACORA (demostración)", null, r, ctx.ip);
  return r;
}
