"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db, type Paciente } from "@/lib/db";
import { kv } from "@/lib/kv";
import { audit } from "@/lib/audit";
import { clientIp, createPacSession, destroyPacSession, getPaciente } from "@/lib/auth";
import { hashSecret, randomDigits, randomToken, verifySecret } from "@/lib/ids";
import { enviarNeutro } from "@/lib/notify";

const OTP_TTL = 600;
const OTP_MAX = 5;
const OTP_COOKIE = "eira_otp";

const pacActor = (p: Paciente) => ({ tipo: "paciente" as const, id: p.id, nombre: `Paciente ${p.id_eira}` });

export async function iniciarAcceso(fd: FormData) {
  const folio = String(fd.get("folio") ?? "").trim().toUpperCase();
  const dob = String(fd.get("dob") ?? "");
  const metodo = String(fd.get("metodo") ?? "otp");
  const pin = String(fd.get("pin") ?? "").trim();
  const store = await kv();
  const ip = clientIp();
  if ((await store.incr(`rl:portal:${ip}`, 600)) > 15) redirect("/portal?error=limite");
  const p = db().prepare("SELECT * FROM pacientes WHERE upper(id_eira) = ? AND fecha_nacimiento = ?").get(folio, dob) as Paciente | undefined;
  if (!p) {
    audit({ tipo: "sistema" }, "ACCESO_PACIENTE_FALLIDO", null, { folio }, ip);
    redirect(`/portal?error=datos&folio=${encodeURIComponent(folio)}`);
  }
  if (metodo === "pin") {
    if ((await store.incr(`pinatt:${p.id}`, 900)) > OTP_MAX) redirect("/portal?error=limite");
    const vigente = p.pin_expira && new Date(p.pin_expira) > new Date();
    if (!vigente || !verifySecret(pin, p.pin_hash)) {
      audit(pacActor(p), "PIN_INCORRECTO", null, null, ip);
      redirect(`/portal?error=pin&folio=${encodeURIComponent(folio)}`);
    }
    await store.del(`pinatt:${p.id}`);
    await createPacSession(p.id);
    audit(pacActor(p), "LOGIN_PACIENTE_PIN_TALON", null, null, ip);
    redirect("/portal/resultados");
  }
  if (!p.telefono && !p.correo) redirect(`/portal?error=sincontacto&folio=${encodeURIComponent(folio)}`);
  const codigo = randomDigits(6);
  const envio = enviarNeutro(p, "otp", null, { codigo });
  if (!envio) redirect(`/portal?error=envio&folio=${encodeURIComponent(folio)}`);
  await store.set(`otp:${p.id}`, hashSecret(codigo), OTP_TTL);
  await store.del(`otpatt:${p.id}`);
  const t = randomToken(16);
  await store.set(`otpreq:${t}`, p.id, OTP_TTL);
  cookies().set(OTP_COOKIE, t, { httpOnly: true, sameSite: "lax", path: "/portal", maxAge: OTP_TTL });
  audit(pacActor(p), `OTP_ENVIADO (${envio.canal})`, null, { destino: envio.destino }, ip);
  redirect(`/portal/verificar?c=${envio.canal}&d=${encodeURIComponent(envio.destino)}`);
}

export async function verificarOtp(fd: FormData) {
  const codigo = String(fd.get("codigo") ?? "").replace(/\D/g, "");
  const store = await kv();
  const t = cookies().get(OTP_COOKIE)?.value;
  const pid = t ? await store.get(`otpreq:${t}`) : null;
  if (!pid) redirect("/portal?error=expirado");
  const p = db().prepare("SELECT * FROM pacientes WHERE id = ?").get(pid) as Paciente;
  const intentos = await store.incr(`otpatt:${pid}`, OTP_TTL);
  const stored = await store.get(`otp:${pid}`);
  if (!stored || intentos > OTP_MAX) {
    await store.del(`otp:${pid}`);
    audit(pacActor(p), "OTP_BLOQUEADO_O_EXPIRADO", null, { intentos }, clientIp());
    redirect("/portal?error=expirado");
  }
  if (!verifySecret(codigo, stored)) {
    audit(pacActor(p), "OTP_INCORRECTO", null, { intentos }, clientIp());
    redirect(`/portal/verificar?error=codigo&r=${OTP_MAX - intentos}`);
  }
  await store.del(`otp:${pid}`);
  await store.del(`otpreq:${t}`);
  cookies().delete(OTP_COOKIE);
  await createPacSession(p.id);
  audit(pacActor(p), "LOGIN_PACIENTE_OTP", null, null, clientIp());
  redirect("/portal/resultados");
}

export async function salirPortal() {
  const s = await getPaciente();
  if (s) audit(pacActor(s.paciente), "LOGOUT_PACIENTE", null);
  await destroyPacSession();
  redirect("/portal");
}
