/**
 * RETO 4 · Llavero NFC (o QR) para pacientes sin celular.
 * El llavero guarda SOLO un enlace con un código al azar; ningún dato personal ni resultado.
 * Quien lo encuentre no puede ver nada: hace falta además la fecha de nacimiento (dos factores:
 * algo que la paciente TIENE, el llavero, y algo que SABE). Se usa en un kiosco o en el celular del voluntario.
 */
import { db, type Estudio, type Paciente } from "@/lib/db";
import { audit } from "@/lib/audit";
import { kv } from "@/lib/kv";
import { newId, randomToken, sha256 } from "@/lib/ids";
import { nowIso } from "@/sim/reloj";
import { ErrorDominio, noEncontrado } from "../errores";
import { actorDe, exigir, type Ctx } from "../permisos";

export type EstadoLlavero = "sin_documentos" | "en_proceso" | "listo" | "entrega_en_persona";

/** Emite un llavero nuevo para la paciente y desactiva los anteriores. El código solo se muestra aquí. */
export function emitirLlavero(ctx: Ctx, pacienteId: string): { token: string; ruta: string; id_eira: string } {
  exigir(ctx, "reto4.emitirLlavero");
  const p = db().prepare("SELECT * FROM pacientes WHERE id = ? OR id_eira = ?").get(pacienteId, pacienteId.toUpperCase()) as Paciente | undefined;
  if (!p) throw noEncontrado("La paciente");
  const token = randomToken(12);
  db().prepare("UPDATE llaveros SET activo = 0 WHERE paciente_id = ?").run(p.id);
  db().prepare("INSERT INTO llaveros (id, paciente_id, token_hash, emitido_por, creado_en) VALUES (?, ?, ?, ?, ?)")
    .run(newId("LLV"), p.id, sha256(token), ctx.usuario.id, nowIso());
  audit(actorDe(ctx), "LLAVERO_NFC_EMITIDO", null, { paciente: p.id_eira }, ctx.ip);
  return { token, ruta: `/t/${token}`, id_eira: p.id_eira };
}

function pacienteDeLlavero(token: string): Paciente {
  const r = db().prepare(
    "SELECT p.* FROM llaveros l JOIN pacientes p ON p.id = l.paciente_id WHERE l.token_hash = ? AND l.activo = 1",
  ).get(sha256(token ?? "")) as Paciente | undefined;
  if (!r) throw new ErrorDominio("LLAVERO_INVALIDO", "Este llavero no está activo. Acude a EIRA para reponerlo.", 404);
  return r;
}

/** Al acercar el llavero: dice solo si hay algo listo (sin nombre completo ni diagnóstico). */
export async function leerLlavero(token: string, ip?: string | null): Promise<{ saludo: string; estado: EstadoLlavero }> {
  if ((await (await kv()).incr(`rl:llavero:${ip ?? "local"}`, 600)) > 60) throw new ErrorDominio("LIMITE", "Demasiados intentos. Espera unos minutos.", 429);
  const p = pacienteDeLlavero(token);
  const es = db().prepare("SELECT estado FROM estudios WHERE paciente_id = ?").all(p.id) as Pick<Estudio, "estado">[];
  const hay = (...x: string[]) => es.some((e) => x.includes(e.estado));
  const estado: EstadoLlavero = hay("autorizado_digital", "notificado") ? "listo"
    : hay("autorizado_acompanado") ? "entrega_en_persona"
    : hay("cargado", "revision_admin", "pendiente_clinica", "devuelto") ? "en_proceso"
    : hay("consultado") ? "listo" : "sin_documentos";
  db().prepare("UPDATE llaveros SET ultimo_uso = ? WHERE token_hash = ?").run(nowIso(), sha256(token));
  return { saludo: p.nombre.split(" ")[0], estado };
}

/** Llavero + fecha de nacimiento = sesión de la paciente (5 intentos, luego se bloquea 15 min). */
export async function accederConLlavero(d: { token: string; fechaNacimiento: string; ip?: string | null }): Promise<{ pacienteId: string }> {
  const p = pacienteDeLlavero(d.token);
  const store = await kv();
  if ((await store.incr(`llvatt:${p.id}`, 900)) > 5) throw new ErrorDominio("LIMITE", "Demasiados intentos. Espera 15 minutos o llama a EIRA.", 429);
  if (d.fechaNacimiento !== p.fecha_nacimiento) {
    audit({ tipo: "paciente", id: p.id, nombre: `Paciente ${p.id_eira}` }, "LLAVERO_FECHA_INCORRECTA", null, null, d.ip);
    throw new ErrorDominio("DATOS_NO_COINCIDEN", "La fecha de nacimiento no coincide.", 401);
  }
  await store.del(`llvatt:${p.id}`);
  audit({ tipo: "paciente", id: p.id, nombre: `Paciente ${p.id_eira}` }, "LOGIN_PACIENTE_LLAVERO_NFC", null, null, d.ip);
  return { pacienteId: p.id };
}
