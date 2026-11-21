import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db, type Paciente, type Usuario } from "./db";
import { kv } from "./kv";
import { randomToken } from "./ids";

export const STAFF_COOKIE = "eira_staff";
export const PAC_COOKIE = "eira_pac";
export const STAFF_TTL = 8 * 60 * 60;
export const PAC_TTL = 15 * 60;

const cookieOpts = (maxAge: number) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
  path: "/",
  maxAge,
});

export function clientIp() {
  const h = headers();
  return (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "local";
}

export async function createStaffSession(userId: string) {
  const t = randomToken();
  await (await kv()).set(`ss:${t}`, userId, STAFF_TTL);
  cookies().set(STAFF_COOKIE, t, cookieOpts(STAFF_TTL));
}

export async function destroyStaffSession() {
  const t = cookies().get(STAFF_COOKIE)?.value;
  if (t) await (await kv()).del(`ss:${t}`);
  cookies().delete(STAFF_COOKIE);
}

export async function getStaff(): Promise<Usuario | null> {
  const t = cookies().get(STAFF_COOKIE)?.value;
  if (!t) return null;
  const id = await (await kv()).get(`ss:${t}`);
  if (!id) return null;
  return (db().prepare("SELECT * FROM usuarios WHERE id = ? AND activo = 1").get(id) as Usuario) ?? null;
}

export async function requireStaff(roles?: string[]): Promise<Usuario> {
  const u = await getStaff();
  if (!u) redirect("/staff/login");
  if (roles && !roles.includes(u.rol)) redirect("/staff?error=permiso");
  return u;
}

export async function createPacSession(pacienteId: string) {
  const t = randomToken();
  await (await kv()).set(`ps:${t}`, pacienteId, PAC_TTL);
  cookies().set(PAC_COOKIE, t, cookieOpts(PAC_TTL));
}

export async function destroyPacSession() {
  const t = cookies().get(PAC_COOKIE)?.value;
  if (t) await (await kv()).del(`ps:${t}`);
  cookies().delete(PAC_COOKIE);
}

export async function getPaciente(): Promise<{ paciente: Paciente; token: string } | null> {
  const t = cookies().get(PAC_COOKIE)?.value;
  if (!t) return null;
  const store = await kv();
  const id = await store.get(`ps:${t}`);
  if (!id) return null;
  await store.set(`ps:${t}`, id, PAC_TTL);
  const p = db().prepare("SELECT * FROM pacientes WHERE id = ?").get(id) as Paciente | undefined;
  return p ? { paciente: p, token: t } : null;
}
