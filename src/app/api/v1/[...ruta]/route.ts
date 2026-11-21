import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { RUTAS, buscarRuta, type Peticion } from "@/api/rutas";
import { ErrorDominio } from "@/core/errores";
import { SECURE_COOKIES, clientIp, createPacSession, createStaffSession, destroyPacSession, destroyStaffSession, getPaciente, getStaff } from "@/lib/auth";
import { ensureSeeded } from "@/sim/datos-demo";

export const dynamic = "force-dynamic";
const OTP_COOKIE = "eira_otp_api";
const json = (datos: unknown, status = 200) => NextResponse.json(datos, { status, headers: { "Cache-Control": "no-store" } });

async function manejar(req: Request, { params }: { params: { ruta: string[] } }) {
  await ensureSeeded();
  if (req.method === "GET" && params.ruta.join("/") === "rutas")
    return json(RUTAS.map((r) => ({ metodo: r.metodo, ruta: `/api/v1${r.ruta}`, acceso: r.acceso, descripcion: r.desc })));
  const hallada = buscarRuta(req.method, params.ruta);
  if (!hallada) return json({ error: { codigo: "RUTA_NO_ENCONTRADA", mensaje: "Consulta GET /api/v1/rutas" } }, 404);
  try {
    const p: Peticion = { params: hallada.params, query: new URL(req.url).searchParams, body: {}, ip: clientIp() };
    if (req.method !== "GET") {
      const tipo = req.headers.get("content-type") ?? "";
      if (tipo.includes("multipart/form-data")) {
        const fd = await req.formData();
        for (const [k, v] of Array.from(fd.entries())) {
          if (typeof v === "string") p.body[k] = v;
          else p.archivo = { buf: Buffer.from(await v.arrayBuffer()), nombre: v.name };
        }
      } else if (tipo.includes("json")) p.body = (await req.json().catch(() => ({}))) ?? {};
    }
    if (hallada.ruta.acceso === "personal") {
      const u = await getStaff();
      if (!u) throw new ErrorDominio("SIN_SESION", "Inicia sesión como personal de EIRA", 401);
      p.ctx = { usuario: u, ip: p.ip };
    }
    if (hallada.ruta.acceso === "paciente") {
      const s = await getPaciente();
      if (!s) throw new ErrorDominio("SIN_SESION", "Tu sesión terminó. Vuelve a entrar.", 401);
      p.paciente = { id: s.paciente.id, sesion: s.token };
    }
    if (hallada.ruta.ruta === "/reto4/portal/otp") p.body.__reto = cookies().get(OTP_COOKIE)?.value ?? "";
    const r = await hallada.ruta.fn(p);
    const e = r.efecto;
    if (e?.abrirSesionPersonal) await createStaffSession(e.abrirSesionPersonal);
    if (e?.cerrarSesionPersonal) await destroyStaffSession();
    if (e?.abrirSesionPaciente) await createPacSession(e.abrirSesionPaciente);
    if (e?.cerrarSesionPaciente) await destroyPacSession();
    if (e?.retoOtp) cookies().set(OTP_COOKIE, e.retoOtp, { httpOnly: true, sameSite: "lax", secure: SECURE_COOKIES, path: "/api/v1/reto4/portal", maxAge: 600 });
    if (e?.retoOtp === null) cookies().delete({ name: OTP_COOKIE, path: "/api/v1/reto4/portal" });
    return json(r.datos, r.estado ?? 200);
  } catch (err) {
    if (err instanceof ErrorDominio) return json({ error: { codigo: err.codigo, mensaje: err.message, datos: err.datos ?? null } }, err.http);
    console.error(err);
    return json({ error: { codigo: "ERROR_INTERNO", mensaje: "Error inesperado" } }, 500);
  }
}

export { manejar as GET, manejar as POST, manejar as PATCH };
