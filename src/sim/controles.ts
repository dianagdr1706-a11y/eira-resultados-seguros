/**
 * SIMULACIÓN: controles de la demo (no existen en producción).
 * Reloj adelantable, caída de proveedores y reinicio de datos sintéticos.
 */
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { kv } from "@/lib/kv";
import { ErrorDominio } from "@/core/errores";
import { actorDe, exigir, type Ctx } from "@/core/permisos";
import { advanceDays, nowIso, offsetDays, resetClock } from "./reloj";
import { proveedorCaido, simularCaida, type Canal } from "./proveedores";
import { resetDemo } from "./datos-demo";

export async function estadoSimulacion(ctx: Ctx) {
  exigir(ctx, "sim.controles");
  return {
    reloj: { ahora: nowIso(), dias_adelantados: offsetDays() },
    proveedores: Object.fromEntries((["telegram", "sms", "correo", "malla"] as Canal[]).map((c) => [c, proveedorCaido(c) ? "caido" : "ok"])),
    almacen_sesiones: (await kv()).backend,
  };
}

export function cambiarProveedor(ctx: Ctx, canal: string, caido: boolean) {
  exigir(ctx, "sim.controles");
  if (!["sms", "correo", "telegram", "malla"].includes(canal)) throw new ErrorDominio("CANAL_INVALIDO", "Canal debe ser sms, correo, telegram o malla");
  simularCaida(canal as Canal, caido);
  audit(actorDe(ctx), caido ? `SIMULACION_CAIDA_PROVEEDOR_${canal.toUpperCase()}` : `PROVEEDOR_${canal.toUpperCase()}_RESTABLECIDO`, null);
}

export function moverReloj(ctx: Ctx, dias: number) {
  exigir(ctx, "sim.controles");
  if (!Number.isFinite(dias) || Math.abs(dias) > 365) throw new ErrorDominio("DIAS_INVALIDOS", "Días debe ser un número entre -365 y 365");
  if (dias === 0) resetClock();
  else advanceDays(dias);
}

export async function reiniciarDatos(ctx: Ctx) {
  exigir(ctx, "sim.controles");
  await resetDemo();
}

/** Bandeja simulada: los avisos que "saldrían" por SMS o correo. */
export function leerBandeja(ctx: Ctx) {
  if (!["eira_admin", "medico", "auditoria"].includes(ctx.usuario.rol)) throw new ErrorDominio("SIN_PERMISO", "Sin acceso a la bandeja simulada", 403);
  return db().prepare("SELECT id, estudio_id, canal, destino_enmascarado, asunto, mensaje, estado, tipo, creado_en FROM notificaciones ORDER BY id DESC LIMIT 100").all();
}
