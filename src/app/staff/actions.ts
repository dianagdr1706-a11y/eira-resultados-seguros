"use server";

import fs from "node:fs";
import path from "node:path";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { UPLOAD_DIR, db, setSetting, type Estudio, type Paciente, type Usuario } from "@/lib/db";
import { audit, type Actor } from "@/lib/audit";
import { clientIp, createStaffSession, destroyStaffSession, requireStaff } from "@/lib/auth";
import { hashSecret, newId, randomDigits, sha256, verifySecret } from "@/lib/ids";
import { kv } from "@/lib/kv";
import { nowIso, advanceDays, resetClock } from "@/lib/clock";
import { enviarNeutro } from "@/lib/notify";
import { sugerir } from "@/lib/bethesda";
import { resetDemo } from "@/lib/seed";

const actorOf = (u: Usuario): Actor => ({ tipo: "usuario", id: u.id, nombre: `${u.nombre} (${u.rol})` });

function getEstudio(id: string) {
  const e = db().prepare("SELECT * FROM estudios WHERE id = ?").get(id) as Estudio | undefined;
  if (!e) throw new Error("Estudio no encontrado");
  return e;
}

function setEstado(id: string, estado: string, extra: Record<string, unknown> = {}) {
  const sets = ["estado = @estado", ...Object.keys(extra).map((k) => `${k} = @${k}`)].join(", ");
  db().prepare(`UPDATE estudios SET ${sets} WHERE id = @id`).run({ id, estado, ...extra });
}

export async function loginStaff(fd: FormData) {
  const usuario = String(fd.get("usuario") ?? "").trim();
  const password = String(fd.get("password") ?? "");
  const store = await kv();
  const n = await store.incr(`rl:staff:${clientIp()}`, 600);
  if (n > 20) redirect("/staff/login?error=limite");
  const u = db().prepare("SELECT * FROM usuarios WHERE usuario = ? AND activo = 1").get(usuario) as Usuario | undefined;
  if (!u || !verifySecret(password, u.password_hash)) {
    audit({ tipo: "sistema" }, "LOGIN_PERSONAL_FALLIDO", null, { usuario }, clientIp());
    redirect("/staff/login?error=credenciales");
  }
  await createStaffSession(u.id);
  audit(actorOf(u), "LOGIN_PERSONAL", null, null, clientIp());
  redirect("/staff");
}

export async function logoutStaff() {
  await destroyStaffSession();
  redirect("/staff/login");
}

export async function subirPdf(fd: FormData) {
  const u = await requireStaff(["laboratorio", "eira_admin"]);
  const file = fd.get("pdf") as File | null;
  const folio = String(fd.get("folio_muestra") ?? "").trim();
  const fechaToma = String(fd.get("fecha_toma") ?? "") || null;
  const sede = String(fd.get("sede_jornada") ?? "").trim() || null;
  if (!file || file.size === 0 || !folio) redirect("/staff/cargar?error=datos");
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.subarray(0, 5).toString() !== "%PDF-") redirect("/staff/cargar?error=pdf");
  const estudioId = newId("EST");
  const docId = newId("DOC");
  const ruta = `${docId}.pdf`;
  fs.writeFileSync(path.join(UPLOAD_DIR, ruta), buf);
  const hash = sha256(buf);
  const d = db();
  d.prepare(
    `INSERT INTO estudios (id, folio_muestra, fecha_toma, sede_jornada, estado, creado_en) VALUES (?, ?, ?, ?, 'cargado', ?)`,
  ).run(estudioId, folio, fechaToma, sede, nowIso());
  d.prepare(
    `INSERT INTO documentos (id, estudio_id, ruta, nombre_original, sha256, tamano, subido_por, subido_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(docId, estudioId, ruta, file.name, hash, buf.length, u.id, nowIso());
  audit(actorOf(u), "PDF_CARGADO", estudioId, { archivo: file.name, sha256: hash, bytes: buf.length, folio }, clientIp());
  redirect(u.rol === "laboratorio" ? "/staff?ok=cargado" : `/staff/estudios/${estudioId}`);
}

export async function asociarPaciente(fd: FormData) {
  const u = await requireStaff(["eira_admin"]);
  const estudioId = String(fd.get("estudio_id"));
  const pacienteId = String(fd.get("paciente_id") ?? "");
  const checks = ["chk_nombre", "chk_nacimiento", "chk_folio", "chk_legible"];
  const e = getEstudio(estudioId);
  if (!["cargado", "devuelto"].includes(e.estado)) redirect(`/staff/estudios/${estudioId}`);
  if (!pacienteId || checks.some((c) => fd.get(c) !== "on")) redirect(`/staff/estudios/${estudioId}?error=verificacion`);
  const p = db().prepare("SELECT * FROM pacientes WHERE id = ?").get(pacienteId) as Paciente;
  const verif = { nombre: true, fecha_nacimiento: true, folio: true, legible: true, verificado_por: u.id, en: nowIso() };
  db().prepare("UPDATE documentos SET verificacion_json = ? WHERE estudio_id = ? AND vigente = 1").run(JSON.stringify(verif), estudioId);
  setEstado(estudioId, "revision_admin", { paciente_id: pacienteId, sede_jornada: e.sede_jornada ?? p.sede_ultima });
  audit(actorOf(u), "IDENTIDAD_VERIFICADA_Y_ASOCIADA", estudioId, { paciente: p.id_eira, checklist: Object.keys(verif).slice(0, 4) }, clientIp());
  redirect(`/staff/estudios/${estudioId}`);
}

export async function revisionAdmin(fd: FormData) {
  const u = await requireStaff(["eira_admin"]);
  const estudioId = String(fd.get("estudio_id"));
  const decision = String(fd.get("decision"));
  const comentarios = String(fd.get("comentarios") ?? "").trim();
  const e = getEstudio(estudioId);
  if (e.estado !== "revision_admin") redirect(`/staff/estudios/${estudioId}`);
  if (decision === "devolver" && !comentarios) redirect(`/staff/estudios/${estudioId}?error=motivo`);
  db().prepare("INSERT INTO revisiones (estudio_id, etapa, decision, comentarios, revisor_id, creado_en) VALUES (?, 'administrativa', ?, ?, ?, ?)")
    .run(estudioId, decision, comentarios, u.id, nowIso());
  setEstado(estudioId, decision === "aprobar" ? "pendiente_clinica" : "devuelto");
  audit(actorOf(u), decision === "aprobar" ? "REVISION_ADMIN_APROBADA" : "REVISION_ADMIN_DEVUELTA", estudioId, comentarios || null, clientIp());
  redirect(`/staff/estudios/${estudioId}`);
}

function notificar(e: Estudio, p: Paciente, tipo: "disponible" | "acompanado", actor: Actor) {
  const r = enviarNeutro(p, tipo, e.id);
  if (r) {
    audit({ tipo: "sistema", nombre: "Notificador" }, `NOTIFICACION_NEUTRA_ENVIADA (${r.canal})`, e.id, { destino: r.destino, tipo });
    return true;
  }
  db().prepare("UPDATE estudios SET requiere_asistida = 1 WHERE id = ?").run(e.id);
  audit(actor, "SIN_CANAL_DIGITAL: requiere entrega asistida", e.id, { tipo });
  return false;
}

export async function autorizacionClinica(fd: FormData) {
  const u = await requireStaff(["medico"]);
  const estudioId = String(fd.get("estudio_id"));
  const decision = String(fd.get("decision"));
  const bethesda = String(fd.get("bethesda") ?? "");
  const comentarios = String(fd.get("comentarios") ?? "").trim();
  const e = getEstudio(estudioId);
  if (e.estado !== "pendiente_clinica") redirect(`/staff/estudios/${estudioId}`);
  if (decision === "devolver") {
    if (!comentarios) redirect(`/staff/estudios/${estudioId}?error=motivo`);
    db().prepare("INSERT INTO revisiones (estudio_id, etapa, decision, comentarios, revisor_id, creado_en) VALUES (?, 'clinica', 'devolver', ?, ?, ?)")
      .run(estudioId, comentarios, u.id, nowIso());
    setEstado(estudioId, "devuelto");
    audit(actorOf(u), "AUTORIZACION_CLINICA_DEVUELTA", estudioId, comentarios, clientIp());
    redirect(`/staff/estudios/${estudioId}`);
  }
  if (!bethesda) redirect(`/staff/estudios/${estudioId}?error=bethesda`);
  const sug = sugerir(bethesda);
  const modo = decision === "digital" ? "digital" : "acompanado";
  const prioridad = modo === "digital" ? "rutinario" : sug.prioridad === "prioritario" ? "prioritario" : "rutinario";
  db().prepare("INSERT INTO revisiones (estudio_id, etapa, decision, comentarios, revisor_id, creado_en) VALUES (?, 'clinica', ?, ?, ?, ?)")
    .run(estudioId, `autorizar_${modo}`, comentarios, u.id, nowIso());
  setEstado(estudioId, modo === "digital" ? "autorizado_digital" : "autorizado_acompanado", {
    bethesda, prioridad, autorizado_por: u.id, autorizado_en: nowIso(),
  });
  audit(actorOf(u), modo === "digital" ? "AUTORIZADO_ENTREGA_DIGITAL" : "AUTORIZADO_ENTREGA_ACOMPANADA", estudioId,
    { cedula: u.cedula, sugerencia_sistema: sug.modo, decision_medico: modo, coincide_sugerencia: sug.modo === modo, prioridad }, clientIp());
  const e2 = getEstudio(estudioId);
  const p = db().prepare("SELECT * FROM pacientes WHERE id = ?").get(e2.paciente_id) as Paciente;
  const ok = notificar(e2, p, modo === "digital" ? "disponible" : "acompanado", actorOf(u));
  if (ok) {
    if (modo === "digital") setEstado(estudioId, "notificado", { notificado_en: nowIso() });
    else db().prepare("UPDATE estudios SET notificado_en = ? WHERE id = ?").run(nowIso(), estudioId);
  }
  redirect(`/staff/estudios/${estudioId}`);
}

export async function reintentarNotificacion(fd: FormData) {
  const u = await requireStaff(["eira_admin"]);
  const e = getEstudio(String(fd.get("estudio_id")));
  const p = db().prepare("SELECT * FROM pacientes WHERE id = ?").get(e.paciente_id) as Paciente;
  const tipo = e.estado === "autorizado_acompanado" ? "acompanado" : e.estado === "notificado" ? "seguimiento" : "disponible";
  const r = enviarNeutro(p, tipo, e.id);
  if (r) {
    audit(actorOf(u), `NOTIFICACION_REENVIADA (${r.canal})`, e.id, { destino: r.destino, tipo });
    if (e.estado === "autorizado_digital") setEstado(e.id, "notificado", { notificado_en: nowIso(), requiere_asistida: 0 });
  } else {
    db().prepare("UPDATE estudios SET requiere_asistida = 1 WHERE id = ?").run(e.id);
    audit(actorOf(u), "REENVIO_FALLIDO: requiere entrega asistida", e.id);
  }
  redirect(`/staff/estudios/${e.id}`);
}

export async function registrarEntrega(fd: FormData) {
  const u = await requireStaff(["eira_admin", "medico"]);
  const e = getEstudio(String(fd.get("estudio_id")));
  const modalidad = String(fd.get("modalidad"));
  const resultado = String(fd.get("resultado") ?? "entregado");
  const observaciones = String(fd.get("observaciones") ?? "").trim();
  const acuse = String(fd.get("acuse") ?? "").trim();
  const identidad = fd.get("chk_identidad") === "on";
  if (resultado === "entregado" && (!identidad || !acuse)) redirect(`/staff/estudios/${e.id}?error=acuse`);
  db().prepare("INSERT INTO entregas (estudio_id, modalidad, operador_id, resultado, observaciones, acuse, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(e.id, modalidad, u.id, resultado, observaciones, acuse, nowIso());
  if (resultado === "entregado") {
    setEstado(e.id, "entregado_asistido", { cerrado_en: nowIso() });
    audit(actorOf(u), "ENTREGA_ASISTIDA_REGISTRADA", e.id, { modalidad, acuse, identidad_verificada: identidad }, clientIp());
  } else {
    audit(actorOf(u), "INTENTO_CONTACTO_REGISTRADO", e.id, { modalidad, resultado, observaciones }, clientIp());
  }
  redirect(`/staff/estudios/${e.id}`);
}

export async function generarPin(fd: FormData) {
  const u = await requireStaff(["eira_admin"]);
  const pacienteId = String(fd.get("paciente_id"));
  const pin = randomDigits(6);
  const expira = new Date(Date.now() + 60 * 86400000).toISOString();
  db().prepare("UPDATE pacientes SET pin_hash = ?, pin_expira = ? WHERE id = ?").run(hashSecret(pin), expira, pacienteId);
  audit(actorOf(u), "PIN_TALON_GENERADO", null, { paciente_id: pacienteId }, clientIp());
  await (await kv()).set(`pinview:${u.id}:${pacienteId}`, pin, 300);
  redirect(`/staff/pacientes/${pacienteId}/talon`);
}

export async function toggleProveedor(fd: FormData) {
  const u = await requireStaff(["eira_admin", "auditoria"]);
  const canal = String(fd.get("canal"));
  const valor = String(fd.get("valor"));
  setSetting(`fallo_${canal}`, valor);
  audit(actorOf(u), valor === "1" ? `SIMULACION_CAIDA_PROVEEDOR_${canal.toUpperCase()}` : `PROVEEDOR_${canal.toUpperCase()}_RESTABLECIDO`, null);
  revalidatePath("/staff");
  redirect(String(fd.get("back") ?? "/staff"));
}

export async function avanzarReloj(fd: FormData) {
  await requireStaff();
  const dias = Number(fd.get("dias") ?? 0);
  if (dias === 0) resetClock();
  else advanceDays(dias);
  redirect("/staff");
}

export async function reiniciarDemo() {
  await requireStaff(["eira_admin", "auditoria"]);
  await resetDemo();
  await destroyStaffSession();
  redirect("/staff/login?ok=reinicio");
}
