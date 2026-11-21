"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db, type Usuario } from "@/lib/db";
import { audit, type Actor } from "@/lib/audit";
import { clientIp, createStaffSession, destroyStaffSession, requireStaff } from "@/lib/auth";
import { verifySecret } from "@/lib/ids";
import { kv } from "@/lib/kv";
import { resetDemo } from "@/sim/datos-demo";
import * as sim from "@/sim/controles";
import * as core from "@/core/reto4/estudios";
import { confirmarEntregaMalla, registrarAcuseMalla } from "@/core/reto4/malla";
import { ejecutarCicloContacto } from "@/core/reto4/contacto";
import { ErrorDominio } from "@/core/errores";
import type { Ctx } from "@/core/permisos";

const actorOf = (u: Usuario): Actor => ({ tipo: "usuario", id: u.id, nombre: `${u.nombre} (${u.rol})` });

const ctxDe = (u: Usuario): Ctx => ({ usuario: u, ip: clientIp() });

/** Ejecuta una función del núcleo; si falla por regla de negocio, vuelve a la página con ?error=CODIGO. */
function ejecutar<T>(fn: () => T, volver: string): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ErrorDominio) redirect(`${volver}${volver.includes("?") ? "&" : "?"}error=${e.codigo}`);
    throw e;
  }
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
  const pdf = file ? Buffer.from(await file.arrayBuffer()) : Buffer.alloc(0);
  const e = ejecutar(() => core.cargarEstudio(ctxDe(u), {
    pdf, nombreArchivo: file?.name ?? "", folio: String(fd.get("folio_muestra") ?? ""),
    fechaToma: String(fd.get("fecha_toma") ?? "") || null, sede: String(fd.get("sede_jornada") ?? ""),
  }), "/staff/cargar");
  redirect(u.rol === "laboratorio" ? "/staff?ok=cargado" : `/staff/estudios/${e.id}`);
}

export async function asociarPaciente(fd: FormData) {
  const u = await requireStaff(["eira_admin"]);
  const estudioId = String(fd.get("estudio_id"));
  const mapa: Record<string, string> = { chk_nombre: "nombre", chk_nacimiento: "fecha_nacimiento", chk_folio: "folio", chk_legible: "legible" };
  const checklist = Object.keys(mapa).filter((c) => fd.get(c) === "on").map((c) => mapa[c]);
  ejecutar(() => core.asociarPaciente(ctxDe(u), { estudioId, pacienteId: String(fd.get("paciente_id") ?? ""), checklist }), `/staff/estudios/${estudioId}`);
  redirect(`/staff/estudios/${estudioId}`);
}

export async function revisionAdmin(fd: FormData) {
  const u = await requireStaff(["eira_admin"]);
  const estudioId = String(fd.get("estudio_id"));
  ejecutar(() => core.revisarAdministrativamente(ctxDe(u), {
    estudioId, decision: String(fd.get("decision")) as "aprobar" | "devolver", comentarios: String(fd.get("comentarios") ?? ""),
  }), `/staff/estudios/${estudioId}`);
  redirect(`/staff/estudios/${estudioId}`);
}

export async function autorizacionClinica(fd: FormData) {
  const u = await requireStaff(["medico"]);
  const estudioId = String(fd.get("estudio_id"));
  ejecutar(() => core.autorizarClinicamente(ctxDe(u), {
    estudioId, decision: String(fd.get("decision")) as "digital" | "acompanado" | "devolver",
    bethesda: String(fd.get("bethesda") ?? ""), comentarios: String(fd.get("comentarios") ?? ""),
  }), `/staff/estudios/${estudioId}`);
  redirect(`/staff/estudios/${estudioId}`);
}

export async function reintentarNotificacion(fd: FormData) {
  const u = await requireStaff(["eira_admin"]);
  const estudioId = String(fd.get("estudio_id"));
  ejecutar(() => core.reenviarNotificacion(ctxDe(u), estudioId), `/staff/estudios/${estudioId}`);
  redirect(`/staff/estudios/${estudioId}`);
}

export async function registrarEntrega(fd: FormData) {
  const u = await requireStaff(["eira_admin", "medico"]);
  const estudioId = String(fd.get("estudio_id"));
  ejecutar(() => core.registrarEntrega(ctxDe(u), {
    estudioId, modalidad: String(fd.get("modalidad")), resultado: String(fd.get("resultado") ?? "entregado"),
    identidadVerificada: fd.get("chk_identidad") === "on", acuse: String(fd.get("acuse") ?? ""), observaciones: String(fd.get("observaciones") ?? ""),
  }), `/staff/estudios/${estudioId}`);
  redirect(`/staff/estudios/${estudioId}`);
}

export async function generarPin(fd: FormData) {
  const u = await requireStaff(["eira_admin"]);
  const pacienteId = String(fd.get("paciente_id"));
  const r = ejecutar(() => core.generarPinTalon(ctxDe(u), pacienteId), "/staff/pacientes");
  await (await kv()).set(`pinview:${u.id}:${pacienteId}`, r.pin, 300);
  redirect(`/staff/pacientes/${pacienteId}/talon`);
}

export async function toggleProveedor(fd: FormData) {
  const u = await requireStaff(["eira_admin", "auditoria"]);
  ejecutar(() => sim.cambiarProveedor(ctxDe(u), String(fd.get("canal")), String(fd.get("valor")) === "1"), "/staff");
  revalidatePath("/staff");
  redirect(String(fd.get("back") ?? "/staff"));
}

export async function correrCicloContacto() {
  const u = await requireStaff(["eira_admin"]);
  const r = ejecutar(() => ejecutarCicloContacto(ctxDe(u)), "/staff");
  redirect(`/staff?ciclo=${encodeURIComponent(r.pasos.length ? r.pasos.map((p) => `${p.folio}: ${p.medio} ${p.estado}`).join(" · ") : "Sin casos que escalar (menos de 72 h o ya consultados)")}`);
}

export async function avanzarReloj(fd: FormData) {
  const u = await requireStaff(["eira_admin", "auditoria"]);
  ejecutar(() => sim.moverReloj(ctxDe(u), Number(fd.get("dias") ?? 0)), "/staff");
  redirect("/staff");
}

export async function reiniciarDemo() {
  await requireStaff(["eira_admin", "auditoria"]);
  await resetDemo();
  await destroyStaffSession();
  redirect("/staff/login?ok=reinicio");
}

export async function entregaMalla(fd: FormData) {
  const u = await requireStaff(["eira_admin"]);
  ejecutar(() => confirmarEntregaMalla(ctxDe(u), { intentoId: Number(fd.get("intento_id")), portador: String(fd.get("portador") ?? ""), app: String(fd.get("app") ?? "") }), "/staff/malla");
  revalidatePath("/staff/malla");
  redirect("/staff/malla?ok=1");
}

export async function acuseMalla(fd: FormData) {
  const u = await requireStaff(["eira_admin"]);
  const r = ejecutar(() => registrarAcuseMalla(ctxDe(u), { texto: String(fd.get("texto") ?? ""), portador: String(fd.get("portador") ?? "") }), "/staff/malla");
  revalidatePath("/staff/malla");
  redirect(`/staff/malla?acuse=${encodeURIComponent([
    `${r.confirmados.length} entrega(s) registrada(s)${r.confirmados.length ? `: ${r.confirmados.join(", ")}` : ""}`,
    r.ya_registrados.length ? `ya estaban registradas: ${r.ya_registrados.join(", ")}` : "",
    r.desconocidas.length ? `claves que no existen: ${r.desconocidas.join(", ")}` : "",
  ].filter(Boolean).join(" · "))}`);
}
