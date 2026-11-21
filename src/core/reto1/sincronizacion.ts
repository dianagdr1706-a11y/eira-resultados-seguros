/**
 * RETO 1 · Captura offline y sincronización segura.
 * El dispositivo guarda operaciones en una cola local y las envía en lote cuando hay señal.
 * - Idempotente: una operación (op_id) reenviada no se aplica dos veces.
 * - Nunca fusiona sola: si una alta se parece a un expediente, queda PENDIENTE de confirmación humana.
 * - Conflictos de edición (versión) quedan PENDIENTES con ambos valores para que administración decida.
 */
import { db, type SyncOp } from "@/lib/db";
import { audit } from "@/lib/audit";
import { nowIso } from "@/sim/reloj";
import { ErrorDominio, noEncontrado } from "../errores";
import { actorDe, exigir, type Ctx } from "../permisos";
import { actualizarPaciente, pacientePorId, registrarPaciente, registrarVisita, type Confirmacion } from "./expediente";
import type { DatosPaciente } from "./coincidencias";

export type Operacion = {
  op_id: string; tipo: "alta_paciente" | "visita" | "actualizacion_paciente"; capturado_en?: string;
  /** alta: DatosPaciente + temp_id · visita: {paciente_ref, fecha, sede, servicios} · actualización: {paciente_ref, cambios, version_base} */
  datos: Record<string, unknown>;
};

export type ResultadoOp = { op_id: string; estado: "aplicada" | "duplicada" | "pendiente_confirmacion" | "conflicto" | "rechazada"; resultado_id?: string | null; detalle?: unknown };

const guardar = (ctx: Ctx, dispositivo: string, op: Operacion, estado: string, detalle: unknown, resultadoId: string | null) =>
  db().prepare(
    `INSERT INTO sync_ops (op_id, dispositivo, tipo, datos, capturado_en, estado, detalle, resultado_id, usuario_id, recibido_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(op.op_id, dispositivo, op.tipo, JSON.stringify(op.datos), op.capturado_en ?? null, estado, detalle == null ? null : JSON.stringify(detalle), resultadoId, ctx.usuario.id, nowIso());

/** Resuelve una referencia a paciente: id real, ID EIRA o temp_id creado en este mismo dispositivo. */
function resolverRef(ref: string, temporales: Map<string, string>, dispositivo: string): string | null {
  if (temporales.has(ref)) return temporales.get(ref)!;
  const previa = db().prepare("SELECT resultado_id, estado FROM sync_ops WHERE dispositivo = ? AND tipo = 'alta_paciente' AND json_extract(datos, '$.temp_id') = ?").get(dispositivo, ref) as { resultado_id: string | null; estado: string } | undefined;
  if (previa) return previa.resultado_id;
  try { return pacientePorId(ref).id; } catch { return null; }
}

function aplicar(ctx: Ctx, op: Operacion, temporales: Map<string, string>, dispositivo: string, confirmacion?: Confirmacion): Omit<ResultadoOp, "op_id"> {
  try {
    if (op.tipo === "alta_paciente") {
      const r = registrarPaciente(ctx, op.datos as unknown as DatosPaciente, confirmacion);
      if (op.datos.temp_id) temporales.set(String(op.datos.temp_id), r.paciente.id);
      return { estado: "aplicada", resultado_id: r.paciente.id, detalle: { id_eira: r.paciente.id_eira, creada: r.creada } };
    }
    const pid = resolverRef(String(op.datos.paciente_ref ?? ""), temporales, dispositivo);
    if (!pid) return { estado: "pendiente_confirmacion", detalle: { motivo: "La paciente de esta operación aún espera confirmación" } };
    if (op.tipo === "visita") {
      const r = registrarVisita(ctx, { ...(op.datos as { fecha: string; sede?: string; municipio?: string; motivo?: string; servicios: { tipo: string }[] }), pacienteId: pid, origen: "offline" });
      return { estado: "aplicada", resultado_id: r.visita.id };
    }
    if (op.tipo === "actualizacion_paciente") {
      const p = actualizarPaciente(ctx, pid, op.datos.cambios as Partial<DatosPaciente>, Number(op.datos.version_base));
      return { estado: "aplicada", resultado_id: p.id, detalle: { version: p.version } };
    }
    return { estado: "rechazada", detalle: { codigo: "TIPO_DESCONOCIDO" } };
  } catch (err) {
    if (err instanceof ErrorDominio) {
      if (err.codigo === "REQUIERE_CONFIRMACION") return { estado: "pendiente_confirmacion", detalle: err.datos };
      if (err.codigo === "CONFLICTO_VERSION") return { estado: "conflicto", detalle: err.datos };
      return { estado: "rechazada", detalle: { codigo: err.codigo, mensaje: err.message } };
    }
    throw err;
  }
}

/** Recibe un lote capturado sin conexión y devuelve el resultado de cada operación, en orden. */
export function sincronizarLote(ctx: Ctx, d: { dispositivo: string; operaciones: Operacion[] }): { resultados: ResultadoOp[]; resumen: Record<string, number> } {
  exigir(ctx, "reto1.sincronizarLote");
  if (!d.dispositivo?.trim()) throw new ErrorDominio("DISPOSITIVO_REQUERIDO", "Indica el identificador del dispositivo");
  if (!Array.isArray(d.operaciones) || d.operaciones.length > 500) throw new ErrorDominio("LOTE_INVALIDO", "El lote debe tener entre 0 y 500 operaciones");
  const temporales = new Map<string, string>();
  const resultados: ResultadoOp[] = [];
  for (const op of d.operaciones) {
    if (!op?.op_id || !op.tipo || typeof op.datos !== "object") { resultados.push({ op_id: String(op?.op_id ?? ""), estado: "rechazada", detalle: { codigo: "OPERACION_MAL_FORMADA" } }); continue; }
    const previa = db().prepare("SELECT * FROM sync_ops WHERE op_id = ?").get(op.op_id) as SyncOp | undefined;
    if (previa) {
      if (previa.resultado_id && op.datos.temp_id) temporales.set(String(op.datos.temp_id), previa.resultado_id);
      resultados.push({ op_id: op.op_id, estado: "duplicada", resultado_id: previa.resultado_id, detalle: { estado_original: previa.estado } });
      continue;
    }
    const r = aplicar(ctx, op, temporales, d.dispositivo);
    guardar(ctx, d.dispositivo, op, r.estado, r.detalle, r.resultado_id ?? null);
    resultados.push({ op_id: op.op_id, ...r });
  }
  const resumen: Record<string, number> = {};
  for (const r of resultados) resumen[r.estado] = (resumen[r.estado] ?? 0) + 1;
  audit(actorDe(ctx), "LOTE_OFFLINE_SINCRONIZADO", null, { dispositivo: d.dispositivo, resumen }, ctx.ip);
  return { resultados, resumen };
}

/** Cola de operaciones que esperan una decisión humana. */
export function listarPendientesSync(ctx: Ctx) {
  exigir(ctx, "reto1.listarPendientesSync");
  return (db().prepare("SELECT * FROM sync_ops WHERE estado IN ('pendiente_confirmacion', 'conflicto') ORDER BY recibido_en").all() as SyncOp[])
    .map((o) => ({ ...o, datos: JSON.parse(o.datos), detalle: o.detalle ? JSON.parse(o.detalle) : null }));
}

/**
 * Administración resuelve un pendiente:
 * - alta parecida: `{decision:"existente", pacienteId}` o `{decision:"nueva", motivo}`
 * - conflicto de edición: `{decision:"aplicar"}` (gana lo capturado offline) o `{decision:"descartar"}` (gana el servidor)
 * - operación dependiente: `{decision:"reintentar"}` cuando su paciente ya fue confirmada
 */
export function resolverPendienteSync(
  ctx: Ctx, opId: string,
  decision: Confirmacion | { decision: "aplicar" | "descartar" | "reintentar" },
): ResultadoOp {
  exigir(ctx, "reto1.resolverPendienteSync");
  const o = db().prepare("SELECT * FROM sync_ops WHERE op_id = ?").get(opId) as SyncOp | undefined;
  if (!o) throw noEncontrado("La operación");
  if (!["pendiente_confirmacion", "conflicto"].includes(o.estado)) throw new ErrorDominio("YA_RESUELTA", "Esta operación ya fue resuelta", 409);
  const op: Operacion = { op_id: o.op_id, tipo: o.tipo as Operacion["tipo"], datos: JSON.parse(o.datos) };
  const temporales = new Map<string, string>();
  let r: Omit<ResultadoOp, "op_id">;
  if (decision.decision === "descartar") r = { estado: "rechazada", detalle: { codigo: "DESCARTADA_POR_ADMIN" } };
  else if (o.estado === "conflicto") {
    if (decision.decision !== "aplicar") throw new ErrorDominio("DECISION_INVALIDA", "Un conflicto se resuelve con aplicar o descartar");
    const pid = resolverRef(String(op.datos.paciente_ref), temporales, o.dispositivo);
    if (!pid) throw noEncontrado("La paciente");
    op.datos.version_base = pacientePorId(pid).version;
    r = aplicar(ctx, op, temporales, o.dispositivo);
  } else if (op.tipo === "alta_paciente") {
    if (decision.decision !== "nueva" && decision.decision !== "existente") throw new ErrorDominio("DECISION_INVALIDA", "Indica si es paciente nueva o existente");
    r = aplicar(ctx, op, temporales, o.dispositivo, decision);
  } else r = aplicar(ctx, op, temporales, o.dispositivo);
  if (r.estado === "pendiente_confirmacion" || r.estado === "conflicto") throw new ErrorDominio("AUN_PENDIENTE", "La operación todavía no se puede aplicar", 409, r.detalle);
  db().prepare("UPDATE sync_ops SET estado = ?, detalle = ?, resultado_id = ?, resuelto_en = ?, resuelto_por = ? WHERE op_id = ?")
    .run(r.estado, r.detalle == null ? null : JSON.stringify(r.detalle), r.resultado_id ?? null, nowIso(), ctx.usuario.id, opId);
  audit(actorDe(ctx), "PENDIENTE_OFFLINE_RESUELTO", null, { op_id: opId, decision: decision.decision, estado: r.estado }, ctx.ip);
  return { op_id: opId, ...r };
}
