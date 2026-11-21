/**
 * RETO 4 · Flujo de personal: del PDF del laboratorio a la entrega.
 * cargado → revision_admin → pendiente_clinica → autorizado_digital | autorizado_acompanado → notificado → consultado | entregado_asistido
 * Cada función valida permiso y estado, hace una sola cosa y deja registro en la bitácora.
 */
import fs from "node:fs";
import path from "node:path";
import { UPLOAD_DIR, db, type Documento, type Estudio, type Paciente } from "@/lib/db";
import { audit, bitacoraDe } from "@/lib/audit";
import { hashSecret, maskEmail, maskPhone, newId, randomDigits, sha256 } from "@/lib/ids";
import { enviarNeutro } from "@/lib/notify";
import { BETHESDA, sugerir } from "@/lib/bethesda";
import { alertas, listarEstudios } from "@/lib/consultas";
import { MODALIDADES } from "@/lib/estados";
import { nowIso } from "@/sim/reloj";
import { ErrorDominio, noEncontrado } from "../errores";
import { actorDe, exigir, type Ctx } from "../permisos";

export const CHECKLIST_IDENTIDAD = ["nombre", "fecha_nacimiento", "folio", "legible"] as const;
export const RESULTADOS_ENTREGA = ["entregado", "no_contesta", "cita_agendada", "numero_incorrecto"] as const;

export function estudioPorId(id: string): Estudio {
  const e = db().prepare("SELECT * FROM estudios WHERE id = ?").get(id) as Estudio | undefined;
  if (!e) throw noEncontrado("El estudio");
  return e;
}

function pacientePorId(id: string | null): Paciente {
  const p = id ? (db().prepare("SELECT * FROM pacientes WHERE id = ?").get(id) as Paciente | undefined) : undefined;
  if (!p) throw noEncontrado("La paciente");
  return p;
}

function cambiarEstado(id: string, estado: string, extra: Record<string, unknown> = {}) {
  const sets = ["estado = @estado", ...Object.keys(extra).map((k) => `${k} = @${k}`)].join(", ");
  db().prepare(`UPDATE estudios SET ${sets} WHERE id = @id`).run({ id, estado, ...extra });
}

function exigirEstado(e: Estudio, permitidos: string[]) {
  if (!permitidos.includes(e.estado))
    throw new ErrorDominio("ESTADO_INVALIDO", `El estudio está en "${e.estado}"; se requiere ${permitidos.join(" o ")}`, 409);
}

/** 1. El laboratorio carga el PDF. Se valida que sea PDF y se sella con SHA-256. */
export function cargarEstudio(ctx: Ctx, d: { pdf: Buffer; nombreArchivo: string; folio: string; fechaToma?: string | null; sede?: string | null }): Estudio {
  exigir(ctx, "reto4.cargarEstudio");
  const folio = d.folio.trim();
  if (!folio || !d.pdf?.length) throw new ErrorDominio("DATOS_INCOMPLETOS", "Faltan el folio o el archivo");
  if (d.pdf.subarray(0, 5).toString() !== "%PDF-") throw new ErrorDominio("NO_ES_PDF", "El archivo no es un PDF válido");
  const estudioId = newId("EST");
  const docId = newId("DOC");
  const ruta = `${docId}.pdf`;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, ruta), d.pdf);
  const hash = sha256(d.pdf);
  db().prepare("INSERT INTO estudios (id, folio_muestra, fecha_toma, sede_jornada, estado, creado_en) VALUES (?, ?, ?, ?, 'cargado', ?)")
    .run(estudioId, folio, d.fechaToma || null, d.sede?.trim() || null, nowIso());
  db().prepare("INSERT INTO documentos (id, estudio_id, ruta, nombre_original, sha256, tamano, subido_por, subido_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(docId, estudioId, ruta, d.nombreArchivo, hash, d.pdf.length, ctx.usuario.id, nowIso());
  audit(actorDe(ctx), "PDF_CARGADO", estudioId, { archivo: d.nombreArchivo, sha256: hash, bytes: d.pdf.length, folio }, ctx.ip);
  return estudioPorId(estudioId);
}

/** 2. Administración asocia el PDF a UNA paciente; exige las cuatro comprobaciones de identidad. */
export function asociarPaciente(ctx: Ctx, d: { estudioId: string; pacienteId: string; checklist: string[] }): Estudio {
  exigir(ctx, "reto4.asociarPaciente");
  const e = estudioPorId(d.estudioId);
  exigirEstado(e, ["cargado", "devuelto"]);
  const faltan = CHECKLIST_IDENTIDAD.filter((c) => !d.checklist?.includes(c));
  if (!d.pacienteId || faltan.length)
    throw new ErrorDominio("VERIFICACION_INCOMPLETA", `Faltan comprobaciones de identidad: ${faltan.join(", ") || "paciente"}`, 400, { faltan });
  const p = pacientePorId(d.pacienteId);
  const verif = { nombre: true, fecha_nacimiento: true, folio: true, legible: true, verificado_por: ctx.usuario.id, en: nowIso() };
  db().prepare("UPDATE documentos SET verificacion_json = ? WHERE estudio_id = ? AND vigente = 1").run(JSON.stringify(verif), e.id);
  cambiarEstado(e.id, "revision_admin", { paciente_id: p.id, sede_jornada: e.sede_jornada ?? p.sede_ultima });
  audit(actorDe(ctx), "IDENTIDAD_VERIFICADA_Y_ASOCIADA", e.id, { paciente: p.id_eira, checklist: CHECKLIST_IDENTIDAD }, ctx.ip);
  return estudioPorId(e.id);
}

/** 3. Primera compuerta: revisión administrativa (aprobar o devolver con motivo). */
export function revisarAdministrativamente(ctx: Ctx, d: { estudioId: string; decision: "aprobar" | "devolver"; comentarios?: string }): Estudio {
  exigir(ctx, "reto4.revisarAdministrativamente");
  const e = estudioPorId(d.estudioId);
  exigirEstado(e, ["revision_admin"]);
  if (!["aprobar", "devolver"].includes(d.decision)) throw new ErrorDominio("DECISION_INVALIDA", "La decisión debe ser aprobar o devolver");
  const comentarios = (d.comentarios ?? "").trim();
  if (d.decision === "devolver" && !comentarios) throw new ErrorDominio("MOTIVO_REQUERIDO", "Para devolver se requiere un motivo");
  db().prepare("INSERT INTO revisiones (estudio_id, etapa, decision, comentarios, revisor_id, creado_en) VALUES (?, 'administrativa', ?, ?, ?, ?)")
    .run(e.id, d.decision, comentarios, ctx.usuario.id, nowIso());
  cambiarEstado(e.id, d.decision === "aprobar" ? "pendiente_clinica" : "devuelto");
  audit(actorDe(ctx), d.decision === "aprobar" ? "REVISION_ADMIN_APROBADA" : "REVISION_ADMIN_DEVUELTA", e.id, comentarios || null, ctx.ip);
  return estudioPorId(e.id);
}

/** Aviso neutro con respaldo de canal; si no hay canal disponible marca entrega asistida. */
function notificar(ctx: Ctx, e: Estudio, tipo: "disponible" | "acompanado" | "seguimiento"): { canal: string; destino: string } | null {
  const r = enviarNeutro(pacientePorId(e.paciente_id), tipo, e.id);
  if (r) {
    audit({ tipo: "sistema", nombre: "Notificador" }, `NOTIFICACION_NEUTRA_ENVIADA (${r.canal})`, e.id, { destino: r.destino, tipo });
    return r;
  }
  db().prepare("UPDATE estudios SET requiere_asistida = 1 WHERE id = ?").run(e.id);
  audit(actorDe(ctx), "SIN_CANAL_DIGITAL: requiere entrega asistida", e.id, { tipo });
  return null;
}

/**
 * 4. Segunda compuerta: autorización clínica. El semáforo Bethesda sugiere; la médica decide.
 * La bitácora guarda la sugerencia y la decisión. Al autorizar se envía el aviso neutro.
 */
export function autorizarClinicamente(
  ctx: Ctx,
  d: { estudioId: string; decision: "digital" | "acompanado" | "devolver"; bethesda?: string; comentarios?: string },
): { estudio: Estudio; sugerencia: ReturnType<typeof sugerir> | null; notificacion: { canal: string; destino: string } | null } {
  exigir(ctx, "reto4.autorizarClinicamente");
  const e = estudioPorId(d.estudioId);
  exigirEstado(e, ["pendiente_clinica"]);
  const comentarios = (d.comentarios ?? "").trim();
  const insRev = db().prepare("INSERT INTO revisiones (estudio_id, etapa, decision, comentarios, revisor_id, creado_en) VALUES (?, 'clinica', ?, ?, ?, ?)");
  if (d.decision === "devolver") {
    if (!comentarios) throw new ErrorDominio("MOTIVO_REQUERIDO", "Para devolver se requiere un motivo");
    insRev.run(e.id, "devolver", comentarios, ctx.usuario.id, nowIso());
    cambiarEstado(e.id, "devuelto");
    audit(actorDe(ctx), "AUTORIZACION_CLINICA_DEVUELTA", e.id, comentarios, ctx.ip);
    return { estudio: estudioPorId(e.id), sugerencia: null, notificacion: null };
  }
  if (!["digital", "acompanado"].includes(d.decision)) throw new ErrorDominio("DECISION_INVALIDA", "La decisión debe ser digital, acompanado o devolver");
  if (!d.bethesda || !BETHESDA.some((b) => b.id === d.bethesda)) throw new ErrorDominio("BETHESDA_REQUERIDA", "Elige la categoría Bethesda del informe");
  const sug = sugerir(d.bethesda);
  const modo = d.decision;
  const prioridad = modo === "acompanado" && sug.prioridad === "prioritario" ? "prioritario" : "rutinario";
  insRev.run(e.id, `autorizar_${modo}`, comentarios, ctx.usuario.id, nowIso());
  cambiarEstado(e.id, modo === "digital" ? "autorizado_digital" : "autorizado_acompanado", {
    bethesda: d.bethesda, prioridad, autorizado_por: ctx.usuario.id, autorizado_en: nowIso(),
  });
  audit(actorDe(ctx), modo === "digital" ? "AUTORIZADO_ENTREGA_DIGITAL" : "AUTORIZADO_ENTREGA_ACOMPANADA", e.id,
    { cedula: ctx.usuario.cedula, sugerencia_sistema: sug.modo, decision_medico: modo, coincide_sugerencia: sug.modo === modo, prioridad }, ctx.ip);
  const notificacion = notificar(ctx, estudioPorId(e.id), modo === "digital" ? "disponible" : "acompanado");
  if (notificacion) {
    if (modo === "digital") cambiarEstado(e.id, "notificado", { notificado_en: nowIso() });
    else db().prepare("UPDATE estudios SET notificado_en = ? WHERE id = ?").run(nowIso(), e.id);
  }
  return { estudio: estudioPorId(e.id), sugerencia: sug, notificacion };
}

/** 5. Reintento o recordatorio neutro (por ejemplo, cuando el proveedor se restablece). */
export function reenviarNotificacion(ctx: Ctx, estudioId: string): { estudio: Estudio; notificacion: { canal: string; destino: string } | null } {
  exigir(ctx, "reto4.reenviarNotificacion");
  const e = estudioPorId(estudioId);
  exigirEstado(e, ["autorizado_digital", "autorizado_acompanado", "notificado"]);
  const tipo = e.estado === "autorizado_acompanado" ? "acompanado" : e.estado === "notificado" ? "seguimiento" : "disponible";
  const notificacion = notificar(ctx, e, tipo);
  if (notificacion && e.estado === "autorizado_digital") cambiarEstado(e.id, "notificado", { notificado_en: nowIso(), requiere_asistida: 0 });
  return { estudio: estudioPorId(e.id), notificacion };
}

/** 6. Entrega asistida o intento de contacto. Cerrar exige identidad verificada y acuse. */
export function registrarEntrega(
  ctx: Ctx,
  d: { estudioId: string; modalidad: string; resultado?: string; identidadVerificada?: boolean; acuse?: string; observaciones?: string },
): Estudio {
  exigir(ctx, "reto4.registrarEntrega");
  const e = estudioPorId(d.estudioId);
  exigirEstado(e, ["autorizado_digital", "autorizado_acompanado", "notificado"]);
  if (!(d.modalidad in MODALIDADES)) throw new ErrorDominio("MODALIDAD_INVALIDA", "Modalidad de entrega no reconocida");
  const resultado = d.resultado ?? "entregado";
  if (!(RESULTADOS_ENTREGA as readonly string[]).includes(resultado)) throw new ErrorDominio("RESULTADO_INVALIDO", "Resultado no reconocido");
  const acuse = (d.acuse ?? "").trim();
  const observaciones = (d.observaciones ?? "").trim();
  if (resultado === "entregado" && (!d.identidadVerificada || !acuse))
    throw new ErrorDominio("ACUSE_REQUERIDO", "Para cerrar la entrega verifica la identidad y captura el acuse");
  db().prepare("INSERT INTO entregas (estudio_id, modalidad, operador_id, resultado, observaciones, acuse, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(e.id, d.modalidad, ctx.usuario.id, resultado, observaciones, acuse, nowIso());
  if (resultado === "entregado") {
    cambiarEstado(e.id, "entregado_asistido", { cerrado_en: nowIso(), requiere_asistida: 0 });
    audit(actorDe(ctx), "ENTREGA_ASISTIDA_REGISTRADA", e.id, { modalidad: d.modalidad, acuse, identidad_verificada: true }, ctx.ip);
  } else {
    audit(actorDe(ctx), "INTENTO_CONTACTO_REGISTRADO", e.id, { modalidad: d.modalidad, resultado, observaciones }, ctx.ip);
  }
  return estudioPorId(e.id);
}

/** Talón impreso: PIN de 6 dígitos (60 días) para pacientes sin teléfono ni correo. Solo se guarda su hash. */
export function generarPinTalon(ctx: Ctx, pacienteId: string): { paciente: Paciente; pin: string; expira: string } {
  exigir(ctx, "reto4.generarPinTalon");
  const p = pacientePorId(pacienteId);
  const pin = randomDigits(6);
  const expira = new Date(Date.now() + 60 * 86400000).toISOString();
  db().prepare("UPDATE pacientes SET pin_hash = ?, pin_expira = ? WHERE id = ?").run(hashSecret(pin), expira, p.id);
  audit(actorDe(ctx), "PIN_TALON_GENERADO", null, { paciente_id: p.id }, ctx.ip);
  return { paciente: p, pin, expira };
}

/** Panel: estudios, contadores por estado y alertas de seguimiento (7 días / 48 h / asistida). */
export function listarPanel(ctx: Ctx) {
  exigir(ctx, "reto4.listarPanel");
  const rows = listarEstudios();
  const conteo: Record<string, number> = {};
  for (const r of rows) conteo[r.estado] = (conteo[r.estado] ?? 0) + 1;
  const verNombres = ctx.usuario.rol !== "laboratorio";
  return {
    conteo,
    alertas: alertas(rows).map((a) => ({ tipo: a.tipo, texto: a.texto, estudio_id: a.estudio.id, folio: a.estudio.folio_muestra })),
    estudios: rows.map((r) => ({
      id: r.id, folio: r.folio_muestra, estado: r.estado, prioridad: r.prioridad, requiere_asistida: !!r.requiere_asistida,
      fecha_toma: r.fecha_toma, sede: r.sede_jornada, creado_en: r.creado_en, id_eira: r.id_eira,
      paciente: verNombres ? r.paciente_nombre : null,
    })),
  };
}

/** Detalle de un estudio con contactos enmascarados, revisiones, entregas y su línea de tiempo. */
export function obtenerEstudio(ctx: Ctx, id: string) {
  exigir(ctx, "reto4.obtenerEstudio");
  const e = estudioPorId(id);
  const p = e.paciente_id ? pacientePorId(e.paciente_id) : null;
  const doc = db().prepare("SELECT * FROM documentos WHERE estudio_id = ? AND vigente = 1").get(id) as Documento | undefined;
  return {
    estudio: { ...e, bethesda_label: BETHESDA.find((b) => b.id === e.bethesda)?.label ?? null },
    documento: doc ? { sha256: doc.sha256, nombre: doc.nombre_original, bytes: doc.tamano, url: `/api/staff/pdf/${id}` } : null,
    paciente: p && {
      id: p.id, id_eira: p.id_eira, nombre: p.nombre, fecha_nacimiento: p.fecha_nacimiento, municipio: p.municipio,
      telefono: maskPhone(p.telefono), correo: maskEmail(p.correo), canal_preferido: p.canal_preferido,
    },
    revisiones: db().prepare("SELECT etapa, decision, comentarios, creado_en FROM revisiones WHERE estudio_id = ? ORDER BY id").all(id),
    entregas: db().prepare("SELECT modalidad, resultado, observaciones, acuse, creado_en FROM entregas WHERE estudio_id = ? ORDER BY id").all(id),
    bitacora: bitacoraDe(id),
  };
}

/** Semáforo Bethesda: catálogo y sugerencia de entrega para cada categoría. */
export function catalogoBethesda() {
  return BETHESDA.map((b) => ({ ...b, sugerencia: sugerir(b.id) }));
}
