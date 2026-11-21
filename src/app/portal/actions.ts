"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Paciente } from "@/lib/db";
import { audit } from "@/lib/audit";
import { SECURE_COOKIES, clientIp, createPacSession, destroyPacSession, getPaciente } from "@/lib/auth";
import * as portal from "@/core/reto4/portal";
import { ErrorDominio } from "@/core/errores";

const OTP_COOKIE = "eira_otp";
const pacActor = (p: Paciente) => ({ tipo: "paciente" as const, id: p.id, nombre: `Paciente ${p.id_eira}` });
const ERRORES: Record<string, string> = {
  LIMITE: "limite", DATOS_NO_COINCIDEN: "datos", PIN_INCORRECTO: "pin", SIN_CONTACTO: "sincontacto", ENVIO_FALLIDO: "envio", OTP_EXPIRADO: "expirado",
};

export async function iniciarAcceso(fd: FormData) {
  const folio = String(fd.get("folio") ?? "").trim().toUpperCase();
  let a: portal.Acceso;
  try {
    a = await portal.iniciarAcceso({
      folio, fechaNacimiento: String(fd.get("dob") ?? ""), metodo: String(fd.get("metodo") ?? "otp") as "otp" | "pin",
      pin: String(fd.get("pin") ?? ""), ip: clientIp(),
    });
  } catch (e) {
    if (e instanceof ErrorDominio) redirect(`/portal?error=${ERRORES[e.codigo] ?? "datos"}&folio=${encodeURIComponent(folio)}`);
    throw e;
  }
  if (a.tipo === "sesion") {
    await createPacSession(a.pacienteId);
    redirect("/portal/resultados");
  }
  cookies().set(OTP_COOKIE, a.reto, { httpOnly: true, sameSite: "lax", secure: SECURE_COOKIES, path: "/portal", maxAge: portal.OTP_TTL });
  redirect(`/portal/verificar?c=${a.canal}&d=${encodeURIComponent(a.destino)}`);
}

export async function verificarOtp(fd: FormData) {
  const reto = cookies().get(OTP_COOKIE)?.value ?? "";
  let pacienteId: string;
  try {
    ({ pacienteId } = await portal.verificarOtp({ reto, codigo: String(fd.get("codigo") ?? ""), ip: clientIp() }));
  } catch (e) {
    if (e instanceof ErrorDominio) {
      if (e.codigo === "OTP_INCORRECTO") redirect(`/portal/verificar?error=codigo&r=${(e.datos as { restantes: number }).restantes}`);
      redirect("/portal?error=expirado");
    }
    throw e;
  }
  cookies().delete(OTP_COOKIE);
  await createPacSession(pacienteId);
  redirect("/portal/resultados");
}

export async function salirPortal() {
  const s = await getPaciente();
  if (s) audit(pacActor(s.paciente), "LOGOUT_PACIENTE", null);
  await destroyPacSession();
  redirect("/portal");
}
