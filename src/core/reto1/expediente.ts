/**
 * RETO 1 · Expediente digital único.
 * Una paciente = un ID interno estable (EIRA-00000). Las visitas y los servicios se guardan aparte,
 * de modo que volver a una jornada agrega una visita y no otra paciente.
 */
import { db, type Estudio, type Paciente, type Servicio, type Visita } from "@/lib/db";
import { audit } from "@/lib/audit";
import { maskEmail, maskPhone, newId } from "@/lib/ids";
import { nowIso } from "@/sim/reloj";
import { ErrorDominio, noEncontrado } from "../errores";
import { actorDe, exigir, type Ctx } from "../permisos";
import { UMBRAL_CONFIRMACION, candidatasPara, type Candidata, type DatosPaciente } from "./coincidencias";

export const TIPOS_SERVICIO = ["papanicolaou", "exploracion_mamaria", "mastografia", "ultrasonido_mamario", "vph", "orientacion", "otro"] as const;
const EDITABLES = ["nombre", "fecha_nacimiento", "telefono", "correo", "curp", "municipio", "canal_preferido", "tercero_autorizado"] as const;

/** Confirmación humana ante coincidencias: registrar como nueva (con motivo) o usar el expediente existente. */
export type Confirmacion = { decision: "nueva"; motivo: string } | { decision: "existente"; pacienteId: string };

export function pacientePorId(id: string): Paciente {
  const p = db().prepare("SELECT * FROM pacientes WHERE id = ? OR id_eira = ?").get(id, id.toUpperCase()) as Paciente | undefined;
  if (!p) throw noEncontrado("La paciente");
  return p;
}

function fechaReal(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === s;
}

function validar(d: DatosPaciente) {
  const nombre = (d.nombre ?? "").replace(/\s+/g, " ").trim();
  if (nombre.split(" ").length < 2) throw new ErrorDominio("NOMBRE_INVALIDO", "Escribe nombre y al menos un apellido");
  if (!fechaReal(d.fecha_nacimiento) || new Date(d.fecha_nacimiento) > new Date())
    throw new ErrorDominio("FECHA_INVALIDA", "La fecha de nacimiento debe ser AAAA-MM-DD y no futura");
  const telefono = d.telefono ? d.telefono.replace(/\D/g, "") : null;
  if (telefono && telefono.length !== 10) throw new ErrorDominio("TELEFONO_INVALIDO", "El teléfono debe tener 10 dígitos");
  const correo = d.correo?.trim().toLowerCase() || null;
  if (correo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) throw new ErrorDominio("CORREO_INVALIDO", "El correo no es válido");
  const curp = d.curp?.trim().toUpperCase() || null;
  if (curp && !/^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/.test(curp)) throw new ErrorDominio("CURP_INVALIDA", "La CURP no tiene un formato válido");
  const canal = d.canal_preferido ?? (telefono ? "sms" : correo ? "correo" : "asistido");
  if (!["sms", "correo", "asistido"].includes(canal)) throw new ErrorDominio("CANAL_INVALIDO", "Canal preferido no reconocido");
  return { nombre, fecha_nacimiento: d.fecha_nacimiento, telefono, correo, curp, municipio: d.municipio?.trim() || null, canal_preferido: canal };
}

/** Genera el siguiente ID EIRA estable (consecutivo, nunca se reutiliza). */
function siguienteIdEira(): string {
  const r = db().prepare("SELECT MAX(CAST(substr(id_eira, 6) AS INTEGER)) AS n FROM pacientes WHERE id_eira LIKE 'EIRA-%'").get() as { n: number | null };
  return `EIRA-${String((r.n ?? 0) + 1).padStart(5, "0")}`;
}

/** Busca posibles duplicados antes de registrar. No modifica nada. */
export function buscarCoincidencias(ctx: Ctx, d: DatosPaciente): Candidata[] {
  exigir(ctx, "reto1.buscarCoincidencias");
  return candidatasPara(d);
}

/**
 * Alta de paciente. Si hay candidatas con puntaje ≥ umbral, se detiene y exige una confirmación humana:
 * "nueva" (con motivo) crea otro expediente; "existente" devuelve el que ya había. La decisión queda registrada.
 */
export function registrarPaciente(ctx: Ctx, datos: DatosPaciente, confirmacion?: Confirmacion): { paciente: Paciente; creada: boolean } {
  exigir(ctx, "reto1.registrarPaciente");
  const d = validar(datos);
  const candidatas = candidatasPara(d).filter((c) => c.puntaje >= UMBRAL_CONFIRMACION);
  if (candidatas.length) {
    if (!confirmacion)
      throw new ErrorDominio("REQUIERE_CONFIRMACION", "Hay expedientes parecidos. Una persona debe confirmar si es la misma paciente.", 409, { candidatas });
    const registrar = (decision: string, pacienteId: string | null, motivo: string | null) =>
      db().prepare("INSERT INTO decisiones_coincidencia (datos_capturados, candidatos, decision, paciente_id, motivo, usuario_id, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(JSON.stringify(d), JSON.stringify(candidatas.map((c) => ({ id_eira: c.paciente.id_eira, puntaje: c.puntaje }))), decision, pacienteId, motivo, ctx.usuario.id, nowIso());
    if (confirmacion.decision === "existente") {
      if (!candidatas.some((c) => c.paciente.id === confirmacion.pacienteId))
        throw new ErrorDominio("CANDIDATA_INVALIDA", "El expediente elegido no está entre las coincidencias");
      const p = pacientePorId(confirmacion.pacienteId);
      registrar("existente", p.id, null);
      audit(actorDe(ctx), "COINCIDENCIA_CONFIRMADA_MISMA_PACIENTE", null, { paciente: p.id_eira }, ctx.ip);
      return { paciente: p, creada: false };
    }
    const motivo = (confirmacion.motivo ?? "").trim();
    if (motivo.length < 5) throw new ErrorDominio("MOTIVO_REQUERIDO", "Explica por qué es una persona distinta");
    const p = insertar(ctx, d);
    registrar("nueva", p.id, motivo);
    audit(actorDe(ctx), "COINCIDENCIA_DESCARTADA_PACIENTE_NUEVA", null, { paciente: p.id_eira, parecidas: candidatas.map((c) => c.paciente.id_eira), motivo }, ctx.ip);
    return { paciente: p, creada: true };
  }
  return { paciente: insertar(ctx, d), creada: true };
}

function insertar(ctx: Ctx, d: ReturnType<typeof validar>): Paciente {
  const id = newId("PAC");
  const idEira = siguienteIdEira();
  db().prepare(
    `INSERT INTO pacientes (id, id_eira, nombre, fecha_nacimiento, telefono, correo, curp, canal_preferido, municipio, version, creado_en, actualizado_en)
     VALUES (@id, @idEira, @nombre, @fecha_nacimiento, @telefono, @correo, @curp, @canal_preferido, @municipio, 1, @en, @en)`,
  ).run({ id, idEira, ...d, en: nowIso() });
  audit(actorDe(ctx), "PACIENTE_REGISTRADA", null, { paciente: idEira }, ctx.ip);
  return pacientePorId(id);
}

/**
 * Edita datos de la paciente con control de versión: si otra persona la cambió después de `versionBase`,
 * se rechaza con CONFLICTO_VERSION y se devuelven los valores actuales para que alguien decida.
 */
export function actualizarPaciente(ctx: Ctx, pacienteId: string, cambios: Partial<DatosPaciente> & { tercero_autorizado?: string | null }, versionBase: number): Paciente {
  exigir(ctx, "reto1.actualizarPaciente");
  const p = pacientePorId(pacienteId);
  const campos = EDITABLES.filter((c) => c in cambios);
  if (!campos.length) throw new ErrorDominio("SIN_CAMBIOS", "No hay campos para actualizar");
  if (versionBase !== p.version) {
    const actual = Object.fromEntries(campos.map((c) => [c, (p as Record<string, unknown>)[c]]));
    throw new ErrorDominio("CONFLICTO_VERSION", "Otra persona modificó este expediente. Revisa los valores actuales.", 409, { version: p.version, actual, propuesto: cambios });
  }
  const limpio = validar({ ...p, ...cambios } as DatosPaciente) as Record<string, unknown>;
  limpio.tercero_autorizado = "tercero_autorizado" in cambios ? cambios.tercero_autorizado?.trim() || null : p.tercero_autorizado;
  const sets = campos.map((c) => `${c} = @${c}`).join(", ");
  db().prepare(`UPDATE pacientes SET ${sets}, version = version + 1, actualizado_en = @en WHERE id = @id`)
    .run({ ...Object.fromEntries(campos.map((c) => [c, limpio[c]])), en: nowIso(), id: p.id });
  audit(actorDe(ctx), "PACIENTE_ACTUALIZADA", null, { paciente: p.id_eira, campos, version: p.version + 1 }, ctx.ip);
  return pacientePorId(p.id);
}

/** Registra una visita (jornada) con sus servicios, separada de los datos de la paciente. */
export function registrarVisita(
  ctx: Ctx,
  d: { pacienteId: string; fecha: string; sede?: string | null; municipio?: string | null; motivo?: string | null; servicios: { tipo: string; notas?: string | null }[]; origen?: "en_linea" | "offline" },
): { visita: Visita; servicios: Servicio[] } {
  exigir(ctx, "reto1.registrarVisita");
  const p = pacientePorId(d.pacienteId);
  if (!fechaReal(d.fecha)) throw new ErrorDominio("FECHA_INVALIDA", "La fecha de la visita debe ser AAAA-MM-DD");
  if (!d.servicios?.length) throw new ErrorDominio("SIN_SERVICIOS", "Registra al menos un servicio");
  const malos = d.servicios.filter((s) => !(TIPOS_SERVICIO as readonly string[]).includes(s.tipo));
  if (malos.length) throw new ErrorDominio("SERVICIO_INVALIDO", `Servicio no reconocido: ${malos.map((s) => s.tipo).join(", ")}`);
  const visitaId = newId("VIS");
  const tx = db().transaction(() => {
    db().prepare("INSERT INTO visitas (id, paciente_id, fecha, sede, municipio, motivo, capturado_por, origen, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(visitaId, p.id, d.fecha, d.sede?.trim() || null, d.municipio?.trim() || p.municipio, d.motivo?.trim() || null, ctx.usuario.id, d.origen ?? "en_linea", nowIso());
    for (const s of d.servicios)
      db().prepare("INSERT INTO servicios (id, visita_id, tipo, notas, creado_en) VALUES (?, ?, ?, ?, ?)").run(newId("SRV"), visitaId, s.tipo, s.notas?.trim() || null, nowIso());
    if (d.sede) db().prepare("UPDATE pacientes SET sede_ultima = ? WHERE id = ?").run(d.sede.trim(), p.id);
  });
  tx();
  audit(actorDe(ctx), "VISITA_REGISTRADA", null, { paciente: p.id_eira, visita: visitaId, servicios: d.servicios.map((s) => s.tipo), origen: d.origen ?? "en_linea" }, ctx.ip);
  return {
    visita: db().prepare("SELECT * FROM visitas WHERE id = ?").get(visitaId) as Visita,
    servicios: db().prepare("SELECT * FROM servicios WHERE visita_id = ?").all(visitaId) as Servicio[],
  };
}

/**
 * Expediente completo: datos, historial de visitas con servicios y estudios de Papanicolaou (Reto 4).
 * Captura ve contactos enmascarados y no ve la clasificación clínica; clínica y administración sí.
 */
export function obtenerExpediente(ctx: Ctx, pacienteId: string) {
  exigir(ctx, "reto1.obtenerExpediente");
  const p = pacientePorId(pacienteId);
  const clinico = ["medico", "eira_admin"].includes(ctx.usuario.rol);
  const visitas = (db().prepare("SELECT * FROM visitas WHERE paciente_id = ? ORDER BY fecha DESC, creado_en DESC").all(p.id) as Visita[]).map((v) => ({
    ...v, servicios: db().prepare("SELECT id, tipo, estado, notas FROM servicios WHERE visita_id = ?").all(v.id) as Servicio[],
  }));
  const estudios = (db().prepare("SELECT * FROM estudios WHERE paciente_id = ? ORDER BY creado_en DESC").all(p.id) as Estudio[]).map((e) => ({
    id: e.id, folio: e.folio_muestra, fecha_toma: e.fecha_toma, estado: e.estado,
    ...(ctx.usuario.rol === "medico" ? { bethesda: e.bethesda, prioridad: e.prioridad } : {}),
  }));
  audit(actorDe(ctx), "EXPEDIENTE_CONSULTADO", null, { paciente: p.id_eira }, ctx.ip);
  return {
    paciente: {
      id: p.id, id_eira: p.id_eira, nombre: p.nombre, fecha_nacimiento: p.fecha_nacimiento, municipio: p.municipio,
      canal_preferido: p.canal_preferido, sede_ultima: p.sede_ultima, version: p.version,
      telefono: clinico ? p.telefono : maskPhone(p.telefono), correo: clinico ? p.correo : maskEmail(p.correo),
      curp: clinico ? p.curp : p.curp ? `${p.curp.slice(0, 4)}••••••••••••••` : null,
    },
    resumen: { visitas: visitas.length, servicios: visitas.reduce((n, v) => n + v.servicios.length, 0), estudios: estudios.length },
    visitas, estudios,
  };
}

/** Búsqueda rápida para el mostrador: por ID EIRA, nombre o fecha de nacimiento. */
export function buscarPacientes(ctx: Ctx, q: string) {
  exigir(ctx, "reto1.buscarCoincidencias");
  const t = q.trim();
  if (t.length < 2) return [];
  const todas = db().prepare("SELECT id, id_eira, nombre, fecha_nacimiento, municipio FROM pacientes").all() as Paciente[];
  const n = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return todas.filter((p) => `${p.id_eira} ${p.nombre} ${p.fecha_nacimiento}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(n)).slice(0, 20);
}
