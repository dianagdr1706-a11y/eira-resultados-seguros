import { test, before } from "node:test";
import assert from "node:assert/strict";
import { preparar, codigo } from "./preparar";

let t: Awaited<ReturnType<typeof preparar>>;
let r4: typeof import("@/core/reto4/estudios");
let portal: typeof import("@/core/reto4/portal");
let bit: typeof import("@/core/bitacora");
let sim: typeof import("@/sim/controles");
let pdf: Buffer;
const pac = (idEira: string) => t.db().prepare("SELECT * FROM pacientes WHERE id_eira = ?").get(idEira) as import("@/lib/db").Paciente;
const ultimoOtp = () => /es (\d{6})/.exec((t.db().prepare("SELECT mensaje FROM notificaciones WHERE tipo = 'otp' AND estado = 'simulado' ORDER BY id DESC LIMIT 1").get() as { mensaje: string }).mensaje)![1];
const CHECK = ["nombre", "fecha_nacimiento", "folio", "legible"];

before(async () => {
  t = await preparar();
  r4 = await import("@/core/reto4/estudios");
  portal = await import("@/core/reto4/portal");
  bit = await import("@/core/bitacora");
  sim = await import("@/sim/controles");
  const { samplePdf } = await import("@/sim/pdf-muestra");
  pdf = await samplePdf({ ...pac("EIRA-00348"), folio: "CIT-T-1", fecha_toma: "2026-11-01", bethesda: "1" });
});

/** Lleva un estudio nuevo hasta "pendiente_clinica". */
function hastaClinica(idEira: string, folio: string) {
  const e = r4.cargarEstudio(t.lab, { pdf, nombreArchivo: `${folio}.pdf`, folio });
  r4.asociarPaciente(t.admin, { estudioId: e.id, pacienteId: pac(idEira).id, checklist: CHECK });
  return r4.revisarAdministrativamente(t.admin, { estudioId: e.id, decision: "aprobar" });
}

test("cargarEstudio valida PDF y permisos, y sella con SHA-256", async () => {
  assert.equal(await codigo(() => r4.cargarEstudio(t.lab, { pdf: Buffer.from("hola"), nombreArchivo: "x.pdf", folio: "F" })), "NO_ES_PDF");
  assert.equal(await codigo(() => r4.cargarEstudio(t.medico, { pdf, nombreArchivo: "x.pdf", folio: "F" })), "SIN_PERMISO");
  const e = r4.cargarEstudio(t.lab, { pdf, nombreArchivo: "x.pdf", folio: "CIT-T-0" });
  assert.equal(e.estado, "cargado");
  assert.match(r4.obtenerEstudio(t.admin, e.id).documento!.sha256, /^[0-9a-f]{64}$/);
});

test("doble compuerta: no se puede saltar ningún paso ni rol", async () => {
  const e = r4.cargarEstudio(t.lab, { pdf, nombreArchivo: "a.pdf", folio: "CIT-T-1" });
  const p = pac("EIRA-00348");
  assert.equal(await codigo(() => r4.autorizarClinicamente(t.medico, { estudioId: e.id, decision: "digital", bethesda: "1" })), "ESTADO_INVALIDO");
  assert.equal(await codigo(() => r4.registrarEntrega(t.admin, { estudioId: e.id, modalidad: "presencial_eira", identidadVerificada: true, acuse: "x" })), "ESTADO_INVALIDO");
  assert.equal(await codigo(() => r4.asociarPaciente(t.admin, { estudioId: e.id, pacienteId: p.id, checklist: ["nombre"] })), "VERIFICACION_INCOMPLETA");
  assert.equal(await codigo(() => r4.asociarPaciente(t.medico, { estudioId: e.id, pacienteId: p.id, checklist: CHECK })), "SIN_PERMISO");
  assert.equal(r4.asociarPaciente(t.admin, { estudioId: e.id, pacienteId: p.id, checklist: CHECK }).estado, "revision_admin");
  assert.equal(await codigo(() => r4.revisarAdministrativamente(t.admin, { estudioId: e.id, decision: "devolver" })), "MOTIVO_REQUERIDO");
  assert.equal(await codigo(() => r4.revisarAdministrativamente(t.medico, { estudioId: e.id, decision: "aprobar" })), "SIN_PERMISO");
  assert.equal(r4.revisarAdministrativamente(t.admin, { estudioId: e.id, decision: "aprobar" }).estado, "pendiente_clinica");
  assert.equal(await codigo(() => r4.autorizarClinicamente(t.admin, { estudioId: e.id, decision: "digital", bethesda: "1" })), "SIN_PERMISO");
  assert.equal(await codigo(() => r4.autorizarClinicamente(t.medico, { estudioId: e.id, decision: "digital" })), "BETHESDA_REQUERIDA");
  assert.equal(portal.documentosDePaciente(p.id).length, 0, "la paciente no ve nada antes de la autorización médica");
  const r = r4.autorizarClinicamente(t.medico, { estudioId: e.id, decision: "digital", bethesda: "1" });
  assert.equal(r.estudio.estado, "notificado");
  assert.equal(r.sugerencia!.color, "verde");
  assert.equal(r.notificacion!.canal, "sms");
});

test("semáforo Bethesda: alto grado sugiere acompañada prioritaria y la decisión médica queda registrada", () => {
  const cat = r4.catalogoBethesda();
  assert.equal(cat.find((b) => b.id === "1")!.sugerencia.color, "verde");
  for (const id of ["3", "5", "6", "7"]) assert.equal(cat.find((b) => b.id === id)!.sugerencia.color, "rojo");
  const e = hastaClinica("EIRA-00412", "CIT-T-2");
  const r = r4.autorizarClinicamente(t.medico, { estudioId: e.id, decision: "acompanado", bethesda: "5" });
  assert.equal(r.estudio.estado, "autorizado_acompanado");
  assert.equal(r.estudio.prioridad, "prioritario");
  const doc = portal.documentosDePaciente(pac("EIRA-00412").id).find((d) => d.id === e.id)!;
  assert.equal(doc.descargable, false, "un resultado acompañado no se descarga");
  const log = r4.obtenerEstudio(t.auditoria, e.id).bitacora.find((b) => b.accion === "AUTORIZADO_ENTREGA_ACOMPANADA")!;
  assert.equal(JSON.parse(log.detalle!).coincide_sugerencia, true);
});

test("los avisos nunca contienen términos clínicos", async () => {
  const { esNeutro } = await import("@/lib/notify");
  const msgs = t.db().prepare("SELECT asunto, mensaje FROM notificaciones WHERE tipo != 'otp'").all() as { asunto: string | null; mensaje: string }[];
  assert.ok(msgs.length > 0);
  for (const m of msgs) assert.ok(esNeutro(`${m.asunto ?? ""} ${m.mensaje}`), m.mensaje);
  assert.equal(esNeutro("Tu resultado de VPH fue positivo"), false);
});

test("portal: datos incorrectos, OTP incorrecto, OTP correcto y un solo uso", async () => {
  assert.equal(await codigo(() => portal.iniciarAcceso({ folio: "EIRA-00348", fechaNacimiento: "1990-01-01", ip: "a" })), "DATOS_NO_COINCIDEN");
  const a = await portal.iniciarAcceso({ folio: "eira-00348", fechaNacimiento: "1991-07-30", ip: "a" });
  assert.equal(a.tipo, "otp");
  if (a.tipo !== "otp") return;
  const otp = ultimoOtp();
  const malo = otp === "000000" ? "111111" : "000000";
  assert.equal(await codigo(() => portal.verificarOtp({ reto: a.reto, codigo: malo })), "OTP_INCORRECTO");
  assert.equal((await portal.verificarOtp({ reto: a.reto, codigo: otp })).pacienteId, pac("EIRA-00348").id);
  assert.equal(await codigo(() => portal.verificarOtp({ reto: a.reto, codigo: otp })), "OTP_EXPIRADO");
});

test("portal: el OTP se bloquea al quinto intento fallido", async () => {
  const a = await portal.iniciarAcceso({ folio: "EIRA-00348", fechaNacimiento: "1991-07-30", ip: "b" });
  if (a.tipo !== "otp") return assert.fail();
  const otp = ultimoOtp();
  const malo = otp === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++) assert.equal(await codigo(() => portal.verificarOtp({ reto: a.reto, codigo: malo })), "OTP_INCORRECTO");
  assert.equal(await codigo(() => portal.verificarOtp({ reto: a.reto, codigo: otp })), "OTP_EXPIRADO");
});

test("descarga: solo con la sesión de la titular; verifica integridad y marca consultado", async () => {
  const p = pac("EIRA-00348");
  const doc = portal.documentosDePaciente(p.id).find((d) => d.folio === "CIT-T-1")!;
  assert.equal(doc.descargable, true);
  const otra = pac("EIRA-00121");
  assert.equal(await codigo(() => portal.emitirTokenDescarga({ pacienteId: otra.id, sesion: "s-otra", estudioId: doc.id })), "NO_AUTORIZADO");
  const token = await portal.emitirTokenDescarga({ pacienteId: p.id, sesion: "s-1", estudioId: doc.id });
  assert.equal(await codigo(() => portal.canjearDescarga({ token, sesion: null, pacienteDeSesion: null })), "SIN_SESION");
  assert.equal(await codigo(() => portal.canjearDescarga({ token, sesion: "s-otra", pacienteDeSesion: otra.id })), "SIN_SESION");
  assert.equal(await codigo(() => portal.canjearDescarga({ token: "inventado", sesion: "s-1", pacienteDeSesion: p.id })), "ENLACE_INVALIDO");
  const r = await portal.canjearDescarga({ token, sesion: "s-1", pacienteDeSesion: p.id });
  assert.equal(r.pdf.subarray(0, 5).toString(), "%PDF-");
  assert.equal(r4.estudioPorId(doc.id).estado, "consultado");
});

test("descarga: un PDF alterado en disco se bloquea", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { UPLOAD_DIR } = await import("@/lib/db");
  const p = pac("EIRA-00533");
  const e = hastaClinica("EIRA-00533", "CIT-T-3");
  r4.autorizarClinicamente(t.medico, { estudioId: e.id, decision: "digital", bethesda: "1" });
  const ruta = (t.db().prepare("SELECT ruta FROM documentos WHERE estudio_id = ?").get(e.id) as { ruta: string }).ruta;
  fs.appendFileSync(path.join(UPLOAD_DIR, ruta), "alterado");
  const token = await portal.emitirTokenDescarga({ pacienteId: p.id, sesion: "s-2", estudioId: e.id });
  assert.equal(await codigo(() => portal.canjearDescarga({ token, sesion: "s-2", pacienteDeSesion: p.id })), "INTEGRIDAD_FALLIDA");
  assert.equal(r4.estudioPorId(e.id).estado, "notificado");
});

test("continuidad: SMS caído pasa a correo; sin canal queda en entrega asistida y se puede reintentar", () => {
  sim.cambiarProveedor(t.admin, "sms", true);
  const conCorreo = hastaClinica("EIRA-00121", "CIT-T-4");
  const a = r4.autorizarClinicamente(t.medico, { estudioId: conCorreo.id, decision: "digital", bethesda: "1" });
  assert.equal(a.notificacion!.canal, "correo");
  assert.equal(a.estudio.estado, "notificado");
  const soloSms = hastaClinica("EIRA-00348", "CIT-T-5");
  const b = r4.autorizarClinicamente(t.medico, { estudioId: soloSms.id, decision: "digital", bethesda: "1" });
  assert.equal(b.notificacion, null);
  assert.equal(b.estudio.estado, "autorizado_digital");
  assert.equal(b.estudio.requiere_asistida, 1);
  assert.ok(r4.listarPanel(t.admin).alertas.some((x) => x.tipo === "asistida" && x.estudio_id === soloSms.id));
  sim.cambiarProveedor(t.admin, "sms", false);
  const c = r4.reenviarNotificacion(t.admin, soloSms.id);
  assert.equal(c.notificacion!.canal, "sms");
  assert.equal(c.estudio.estado, "notificado");
  assert.equal(c.estudio.requiere_asistida, 0);
});

test("inclusión: paciente sin teléfono ni correo entra con el PIN de su talón", async () => {
  const rosa = pac("EIRA-00507");
  assert.equal(await codigo(() => portal.iniciarAcceso({ folio: "EIRA-00507", fechaNacimiento: "1962-05-21", ip: "c" })), "SIN_CONTACTO");
  assert.equal(await codigo(() => r4.generarPinTalon(t.medico, rosa.id)), "SIN_PERMISO");
  const { pin } = r4.generarPinTalon(t.admin, rosa.id);
  assert.match(pin, /^\d{6}$/);
  assert.equal(pac("EIRA-00507").pin_hash!.includes(pin), false, "solo se guarda el hash");
  const malo = pin === "000000" ? "111111" : "000000";
  assert.equal(await codigo(() => portal.iniciarAcceso({ folio: "EIRA-00507", fechaNacimiento: "1962-05-21", metodo: "pin", pin: malo, ip: "c" })), "PIN_INCORRECTO");
  const a = await portal.iniciarAcceso({ folio: "EIRA-00507", fechaNacimiento: "1962-05-21", metodo: "pin", pin, ip: "c" });
  assert.deepEqual(a, { tipo: "sesion", pacienteId: rosa.id });
});

test("entrega asistida: cerrar exige identidad y acuse; un intento no cierra", async () => {
  const e = hastaClinica("EIRA-00412", "CIT-T-6");
  r4.autorizarClinicamente(t.medico, { estudioId: e.id, decision: "acompanado", bethesda: "2" });
  assert.equal(await codigo(() => r4.registrarEntrega(t.admin, { estudioId: e.id, modalidad: "presencial_eira" })), "ACUSE_REQUERIDO");
  assert.equal(await codigo(() => r4.registrarEntrega(t.admin, { estudioId: e.id, modalidad: "teletransporte", identidadVerificada: true, acuse: "x" })), "MODALIDAD_INVALIDA");
  assert.equal(r4.registrarEntrega(t.admin, { estudioId: e.id, modalidad: "llamada_seguimiento", resultado: "no_contesta" }).estado, "autorizado_acompanado");
  const fin = r4.registrarEntrega(t.medico, { estudioId: e.id, modalidad: "orientacion_medica", identidadVerificada: true, acuse: "Ana Sofía Ramírez" });
  assert.equal(fin.estado, "entregado_asistido");
  assert.ok(fin.cerrado_en);
  assert.equal(r4.obtenerEstudio(t.admin, e.id).entregas.length, 2);
});

test("seguimiento: a los 7 días sin consultar aparece la alerta", () => {
  const e = hastaClinica("EIRA-00533", "CIT-T-7");
  r4.autorizarClinicamente(t.medico, { estudioId: e.id, decision: "digital", bethesda: "1" });
  assert.equal(r4.listarPanel(t.admin).alertas.some((a) => a.tipo === "seguimiento" && a.estudio_id === e.id), false);
  sim.moverReloj(t.admin, 8);
  assert.equal(r4.listarPanel(t.admin).alertas.some((a) => a.tipo === "seguimiento" && a.estudio_id === e.id), true);
  sim.moverReloj(t.admin, 0);
});

test("el laboratorio no ve nombres en el panel", () => {
  assert.ok(r4.listarPanel(t.lab).estudios.every((e) => e.paciente === null));
  assert.ok(r4.listarPanel(t.admin).estudios.some((e) => e.paciente));
});

test("bitácora: íntegra, de solo inserción y restringida por rol", async () => {
  assert.equal(await codigo(() => bit.consultarBitacora(t.medico)), "SIN_PERMISO");
  assert.equal(bit.verificarIntegridad(t.auditoria).ok, true);
  const r = bit.intentarAlterar(t.auditoria);
  assert.equal(r.rechazado, true);
  assert.throws(() => t.db().prepare("DELETE FROM bitacora").run(), /solo de insercion/);
  const v = bit.verificarIntegridad(t.auditoria);
  assert.equal(v.ok, true);
  assert.ok(v.total > 30);
});
