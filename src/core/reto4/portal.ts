/**
 * RETO 4 · Portal de la paciente: identificación, segundo factor y descarga protegida.
 * Estas funciones no dependen de cookies ni de Next: reciben y devuelven identificadores.
 */
import fs from "node:fs";
import path from "node:path";
import { UPLOAD_DIR, db, type Documento, type Estudio, type Paciente } from "@/lib/db";
import { audit } from "@/lib/audit";
import { kv } from "@/lib/kv";
import { hashSecret, randomDigits, randomToken, sha256, verifySecret } from "@/lib/ids";
import { enviarNeutro } from "@/lib/notify";
import { nowIso } from "@/sim/reloj";
import { ErrorDominio } from "../errores";

export const OTP_TTL = 600;
export const OTP_MAX = 5;
export const DESCARGA_TTL = 120;
const DESCARGABLES = ["autorizado_digital", "notificado", "consultado"];
const VISIBLES = [...DESCARGABLES, "autorizado_acompanado", "entregado_asistido"];

const actorPac = (p: Paciente) => ({ tipo: "paciente" as const, id: p.id, nombre: `Paciente ${p.id_eira}` });

export type Acceso =
  | { tipo: "sesion"; pacienteId: string }
  | { tipo: "otp"; reto: string; canal: string; destino: string; vigenciaSeg: number; intentos: number };

/**
 * Paso 1. Identifica por folio EIRA + fecha de nacimiento.
 * Con PIN del talón abre sesión; sin PIN envía un código de un solo uso (OTP) por el canal disponible.
 */
export async function iniciarAcceso(d: { folio: string; fechaNacimiento: string; metodo?: "otp" | "pin"; pin?: string; ip?: string | null }): Promise<Acceso> {
  const store = await kv();
  const ip = d.ip ?? "local";
  const folio = d.folio.trim().toUpperCase();
  if ((await store.incr(`rl:portal:${ip}`, 600)) > 15) throw new ErrorDominio("LIMITE", "Demasiados intentos. Espera unos minutos.", 429);
  const p = db().prepare("SELECT * FROM pacientes WHERE upper(id_eira) = ? AND fecha_nacimiento = ?").get(folio, d.fechaNacimiento) as Paciente | undefined;
  if (!p) {
    audit({ tipo: "sistema" }, "ACCESO_PACIENTE_FALLIDO", null, { folio }, ip);
    throw new ErrorDominio("DATOS_NO_COINCIDEN", "No encontramos un registro con esos datos.", 401);
  }
  if (d.metodo === "pin") {
    if ((await store.incr(`pinatt:${p.id}`, 900)) > OTP_MAX) throw new ErrorDominio("LIMITE", "Demasiados intentos. Espera unos minutos.", 429);
    const vigente = p.pin_expira && new Date(p.pin_expira) > new Date();
    if (!vigente || !verifySecret((d.pin ?? "").trim(), p.pin_hash)) {
      audit(actorPac(p), "PIN_INCORRECTO", null, null, ip);
      throw new ErrorDominio("PIN_INCORRECTO", "El PIN no es correcto o ya venció.", 401);
    }
    await store.del(`pinatt:${p.id}`);
    audit(actorPac(p), "LOGIN_PACIENTE_PIN_TALON", null, null, ip);
    return { tipo: "sesion", pacienteId: p.id };
  }
  if (!p.telefono && !p.correo) throw new ErrorDominio("SIN_CONTACTO", "No hay teléfono ni correo registrado. Usa el PIN de tu talón.", 409);
  const codigo = randomDigits(6);
  const envio = enviarNeutro(p, "otp", null, { codigo });
  if (!envio) throw new ErrorDominio("ENVIO_FALLIDO", "No pudimos enviar el código. Usa el PIN de tu talón o llama a EIRA.", 503);
  await store.set(`otp:${p.id}`, hashSecret(codigo), OTP_TTL);
  await store.del(`otpatt:${p.id}`);
  const reto = randomToken(16);
  await store.set(`otpreq:${reto}`, p.id, OTP_TTL);
  audit(actorPac(p), `OTP_ENVIADO (${envio.canal})`, null, { destino: envio.destino }, ip);
  return { tipo: "otp", reto, canal: envio.canal, destino: envio.destino, vigenciaSeg: OTP_TTL, intentos: OTP_MAX };
}

/** Paso 2. Verifica el OTP (10 min, 5 intentos, un solo uso). Devuelve la paciente autenticada. */
export async function verificarOtp(d: { reto: string; codigo: string; ip?: string | null }): Promise<{ pacienteId: string }> {
  const store = await kv();
  const pid = d.reto ? await store.get(`otpreq:${d.reto}`) : null;
  if (!pid) throw new ErrorDominio("OTP_EXPIRADO", "Tu código venció. Solicita uno nuevo.", 401);
  const p = db().prepare("SELECT * FROM pacientes WHERE id = ?").get(pid) as Paciente;
  const intentos = await store.incr(`otpatt:${pid}`, OTP_TTL);
  const guardado = await store.get(`otp:${pid}`);
  if (!guardado || intentos > OTP_MAX) {
    await store.del(`otp:${pid}`);
    audit(actorPac(p), "OTP_BLOQUEADO_O_EXPIRADO", null, { intentos }, d.ip);
    throw new ErrorDominio("OTP_EXPIRADO", "Tu código venció o hubo demasiados intentos. Solicita uno nuevo.", 401);
  }
  if (!verifySecret(String(d.codigo).replace(/\D/g, ""), guardado)) {
    audit(actorPac(p), "OTP_INCORRECTO", null, { intentos }, d.ip);
    throw new ErrorDominio("OTP_INCORRECTO", "Código incorrecto.", 401, { restantes: OTP_MAX - intentos });
  }
  await store.del(`otp:${pid}`);
  await store.del(`otpreq:${d.reto}`);
  audit(actorPac(p), "LOGIN_PACIENTE_OTP", null, null, d.ip);
  return { pacienteId: p.id };
}

/** Paso 3. Documentos de la paciente ya autorizados por la médica. Nunca incluye diagnóstico. */
export function documentosDePaciente(pacienteId: string) {
  const rows = db().prepare(
    `SELECT * FROM estudios WHERE paciente_id = ? AND estado IN (${VISIBLES.map(() => "?").join(",")}) ORDER BY fecha_toma DESC`,
  ).all(pacienteId, ...VISIBLES) as Estudio[];
  return rows.map((e) => ({
    id: e.id, folio: e.folio_muestra, fecha_toma: e.fecha_toma, sede: e.sede_jornada,
    entrega: e.estado === "autorizado_acompanado" ? "acompanada" : e.estado === "entregado_asistido" ? "entregada_en_persona" : "digital",
    descargable: DESCARGABLES.includes(e.estado), consultado: e.estado === "consultado",
  }));
}

/** Paso 4a. Emite un token de descarga de 120 s ligado a la sesión de la paciente. */
export async function emitirTokenDescarga(d: { pacienteId: string; sesion: string; estudioId: string }): Promise<string> {
  const e = db().prepare("SELECT * FROM estudios WHERE id = ? AND paciente_id = ?").get(d.estudioId, d.pacienteId) as Estudio | undefined;
  if (!e || !DESCARGABLES.includes(e.estado)) throw new ErrorDominio("NO_AUTORIZADO", "Documento no disponible para descarga.", 403);
  const t = randomToken();
  await (await kv()).set(`dl:${t}`, JSON.stringify({ pid: d.pacienteId, estudioId: d.estudioId, sess: d.sesion }), DESCARGA_TTL);
  return t;
}

/**
 * Paso 4b. Canjea el token: exige la misma sesión, verifica el SHA-256 del PDF y marca el estudio como consultado.
 * `pacienteDeSesion` es la paciente a la que pertenece la sesión que presenta el token (null si no hay sesión).
 */
export async function canjearDescarga(d: { token: string; sesion: string | null; pacienteDeSesion: string | null; ip?: string | null }): Promise<{ pdf: Buffer; archivo: string }> {
  const store = await kv();
  const raw = d.token ? await store.get(`dl:${d.token}`) : null;
  if (!raw) {
    audit({ tipo: "sistema" }, "DESCARGA_DENEGADA (token inválido, usado o expirado)", null, null, d.ip);
    throw new ErrorDominio("ENLACE_INVALIDO", "Este enlace no es válido o expiró. Los documentos solo se ven iniciando sesión en el portal.", 401);
  }
  const info = JSON.parse(raw) as { pid: string; estudioId: string; sess: string };
  if (!d.sesion || d.sesion !== info.sess || d.pacienteDeSesion !== info.pid) {
    audit({ tipo: "sistema" }, "DESCARGA_DENEGADA (sin sesión de la paciente)", info.estudioId, null, d.ip);
    throw new ErrorDominio("SIN_SESION", "Necesitas iniciar sesión como la paciente titular para ver este documento.", 401);
  }
  const e = db().prepare("SELECT * FROM estudios WHERE id = ? AND paciente_id = ?").get(info.estudioId, info.pid) as Estudio | undefined;
  if (!e || !DESCARGABLES.includes(e.estado)) throw new ErrorDominio("NO_AUTORIZADO", "Documento no disponible.", 403);
  const doc = db().prepare("SELECT * FROM documentos WHERE estudio_id = ? AND vigente = 1").get(e.id) as Documento;
  const pdf = fs.readFileSync(path.join(UPLOAD_DIR, path.basename(doc.ruta)));
  if (sha256(pdf) !== doc.sha256) {
    audit({ tipo: "sistema" }, "INTEGRIDAD_FALLIDA: el PDF no coincide con su SHA-256", e.id);
    throw new ErrorDominio("INTEGRIDAD_FALLIDA", "El documento no pasó la verificación de integridad. EIRA fue notificada.", 409);
  }
  const archivo = `documento_eira_${e.folio_muestra}`.normalize("NFKD").replace(/[^A-Za-z0-9._-]/g, "_") + ".pdf";
  const primeraVez = (await store.incr(`dlused:${d.token}`, DESCARGA_TTL)) === 1;
  if (e.estado !== "consultado")
    db().prepare("UPDATE estudios SET estado = 'consultado', consultado_en = ?, requiere_asistida = 0 WHERE id = ?").run(nowIso(), e.id);
  if (primeraVez) audit({ tipo: "paciente", id: info.pid, nombre: "Paciente titular" }, "DESCARGA_PACIENTE (integridad SHA-256 verificada)", e.id, null, d.ip);
  return { pdf, archivo };
}
