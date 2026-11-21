/**
 * RETO 4 · Ciclo de contacto escalonado.
 * Si la paciente no consulta su documento en 72 h, se intenta por el siguiente medio de la escalera:
 *   1. telegram  (mensajería por internet, costo cero)
 *   2. sms       (red celular, sin internet)
 *   3. correo
 *   4. malla     (Bluetooth / Wi-Fi local: Bridgefy, Briar o Nearby; lo lleva una "mula" de datos a la comunidad)
 *   5. asistida  (llamada o visita: siempre termina en una persona)
 * Todos los avisos son neutros: nunca llevan diagnóstico. Cada intento queda en `intentos_contacto` y en la bitácora.
 */
import { db, type Estudio, type Paciente } from "@/lib/db";
import { audit } from "@/lib/audit";
import { maskEmail, maskPhone } from "@/lib/ids";
import { PORTAL_URL, esNeutro } from "@/lib/notify";
import { daysSince, nowIso } from "@/sim/reloj";
import { entregar, type Canal } from "@/sim/proveedores";
import { exigir, type Ctx } from "../permisos";

export const ESCALERA = ["telegram", "sms", "correo", "malla", "asistida"] as const;
export type Medio = (typeof ESCALERA)[number];
export const HORAS_ENTRE_INTENTOS = 72;

const AVISO = `EIRA: Tienes un documento disponible. Consulta en ${PORTAL_URL}, acerca tu llavero en el punto EIRA o llama al 341 410 8111.`;

/** Destino (enmascarado) de cada medio, o null si la paciente no lo tiene. */
function destino(p: Paciente, m: Medio): string | null {
  if (m === "telegram") return p.telegram ? `${p.telegram.slice(0, 3)}•••` : null;
  if (m === "sms") return p.telefono ? maskPhone(p.telefono) : null;
  if (m === "correo") return p.correo ? maskEmail(p.correo) : null;
  if (m === "malla") return p.municipio ? `Punto comunitario de ${p.municipio}` : null;
  return "Equipo EIRA (llamada o visita)";
}

/** Medios ya usados con éxito para un estudio (incluye el aviso inicial por SMS o correo). */
function mediosUsados(estudioId: string): Set<string> {
  const a = db().prepare("SELECT DISTINCT canal FROM intentos_contacto WHERE estudio_id = ? AND estado = 'enviado'").all(estudioId) as { canal: string }[];
  const b = db().prepare("SELECT DISTINCT canal FROM notificaciones WHERE estudio_id = ? AND estado = 'simulado'").all(estudioId) as { canal: string }[];
  return new Set([...a, ...b].map((x) => x.canal));
}

function ultimoIntento(e: Estudio): string | null {
  const r = db().prepare("SELECT MAX(creado_en) AS t FROM intentos_contacto WHERE estudio_id = ? AND estado = 'enviado'").get(e.id) as { t: string | null };
  const n = db().prepare("SELECT MAX(creado_en) AS t FROM notificaciones WHERE estudio_id = ? AND estado = 'simulado'").get(e.id) as { t: string | null };
  return [r.t, n.t, e.notificado_en, e.autorizado_en].filter(Boolean).sort().pop() ?? null;
}

/** Siguiente medio de la escalera que la paciente tiene y que aún no se ha usado. */
export function siguienteMedio(p: Paciente, usados: Set<string>): Medio | null {
  const ultimo = Math.max(-1, ...ESCALERA.map((m, i) => (usados.has(m) ? i : -1)));
  return ESCALERA.find((m, i) => i > ultimo && destino(p, m) !== null) ?? null;
}

export type PasoCiclo = { estudio_id: string; folio: string; medio: Medio; destino: string; estado: "enviado" | "fallido" };

/**
 * Recorre los estudios autorizados para entrega digital que nadie ha consultado y, si pasaron 72 h desde el
 * último intento, prueba el siguiente medio. Si un proveedor falla, sigue con el que viene en la misma pasada.
 */
export function ejecutarCicloContacto(ctx: Ctx | "sistema"): { revisados: number; pasos: PasoCiclo[] } {
  if (ctx !== "sistema") exigir(ctx, "reto4.ejecutarCicloContacto");
  const pendientes = db().prepare("SELECT * FROM estudios WHERE estado IN ('notificado', 'autorizado_digital') AND cerrado_en IS NULL AND paciente_id IS NOT NULL").all() as Estudio[];
  const pasos: PasoCiclo[] = [];
  const ins = db().prepare("INSERT INTO intentos_contacto (estudio_id, canal, estado, detalle, creado_en) VALUES (?, ?, ?, ?, ?)");
  for (const e of pendientes) {
    if (daysSince(ultimoIntento(e)) * 24 < HORAS_ENTRE_INTENTOS) continue;
    const p = db().prepare("SELECT * FROM pacientes WHERE id = ?").get(e.paciente_id) as Paciente;
    const usados = mediosUsados(e.id);
    for (let m = siguienteMedio(p, usados); m; m = siguienteMedio(p, usados)) {
      usados.add(m);
      const dest = destino(p, m)!;
      if (!esNeutro(AVISO)) throw new Error("Aviso con términos clínicos bloqueado");
      const ok = m === "asistida" ? true : entregar(m as Canal).ok;
      ins.run(e.id, m, ok ? "enviado" : "fallido", JSON.stringify({ destino: dest }), nowIso());
      if (ok && m === "asistida") db().prepare("UPDATE estudios SET requiere_asistida = 1 WHERE id = ?").run(e.id);
      else if (m !== "asistida")
        db().prepare("INSERT INTO notificaciones (estudio_id, paciente_id, canal, destino_enmascarado, asunto, mensaje, estado, tipo, creado_en) VALUES (?, ?, ?, ?, NULL, ?, ?, 'seguimiento', ?)")
          .run(e.id, p.id, m, dest, AVISO, ok ? "simulado" : "fallido", nowIso());
      if (ok && e.estado === "autorizado_digital" && m !== "asistida")
        db().prepare("UPDATE estudios SET estado = 'notificado', notificado_en = ? WHERE id = ?").run(nowIso(), e.id);
      audit({ tipo: "sistema", nombre: "Ciclo de contacto" }, ok ? `CONTACTO_ESCALADO (${m})` : `CONTACTO_FALLIDO (${m})`, e.id, { destino: dest, horas_sin_consulta: Math.round(daysSince(e.notificado_en ?? e.autorizado_en) * 24) });
      pasos.push({ estudio_id: e.id, folio: e.folio_muestra, medio: m, destino: dest, estado: ok ? "enviado" : "fallido" });
      if (ok) break;
    }
  }
  return { revisados: pendientes.length, pasos };
}

/** Historial de intentos de un estudio, en orden. */
export function intentosDe(estudioId: string) {
  return db().prepare("SELECT canal, estado, detalle, creado_en FROM intentos_contacto WHERE estudio_id = ? ORDER BY id").all(estudioId);
}
