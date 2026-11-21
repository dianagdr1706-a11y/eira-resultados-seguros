/**
 * RETO 4 · Malla sin internet (Briar / Bridgefy / Nearby).
 * La plataforma no habla Bluetooth: prepara el aviso neutro que una "mula" (voluntaria con celular) lleva a la
 * comunidad con una app de malla, y registra quién lo entregó. Por la malla nunca viaja el PDF ni el diagnóstico.
 */
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { sha256 } from "@/lib/ids";
import { PORTAL_URL, esNeutro } from "@/lib/notify";
import { nowIso } from "@/sim/reloj";
import { ErrorDominio, noEncontrado } from "../errores";
import { actorDe, exigir, type Ctx } from "../permisos";

export const APPS_MALLA = ["briar", "bridgefy", "nearby"] as const;
export type AppMalla = (typeof APPS_MALLA)[number];

export type AvisoMalla = {
  intento_id: number; estudio_id: string; folio: string; id_eira: string; punto: string; ref: string; mensaje: string;
  creado_en: string; consultado: boolean; entrega: { portador: string; app: AppMalla; en: string } | null;
};

/** Referencia opaca del aviso: no revela folio, paciente ni resultado. */
const refDe = (estudioId: string) => sha256(`malla:${estudioId}`).slice(0, 8).toUpperCase();

/** Texto que la mula copia a Briar/Bridgefy o pasa por QR. */
export function mensajeMalla(estudioId: string, portalUrl: string = PORTAL_URL): string {
  const m = `EIRA: Tienes un documento disponible. Consulta en ${portalUrl}, acerca tu llavero en el punto EIRA o llama al 341 410 8111. Ref ${refDe(estudioId)}`;
  if (!esNeutro(m)) throw new Error("Aviso con términos clínicos bloqueado");
  return m;
}

type Fila = { id: number; estudio_id: string; detalle: string | null; creado_en: string; folio_muestra: string; estado_estudio: string; id_eira: string };

/** Cola de avisos que el ciclo de contacto mandó a la malla, con su entrega si ya se confirmó. */
export function listarAvisosMalla(ctx: Ctx, portalUrl?: string): AvisoMalla[] {
  exigir(ctx, "reto4.malla");
  const filas = db().prepare(
    `SELECT i.id, i.estudio_id, i.detalle, i.creado_en, e.folio_muestra, e.estado AS estado_estudio, p.id_eira
     FROM intentos_contacto i JOIN estudios e ON e.id = i.estudio_id JOIN pacientes p ON p.id = e.paciente_id
     WHERE i.canal = 'malla' AND i.estado = 'enviado' ORDER BY i.id DESC`,
  ).all() as Fila[];
  const entregas = db().prepare("SELECT detalle, creado_en FROM intentos_contacto WHERE canal = 'malla' AND estado = 'entregado'").all() as { detalle: string; creado_en: string }[];
  const porIntento = new Map(entregas.map((x) => {
    const d = JSON.parse(x.detalle) as { intento_id: number; portador: string; app: AppMalla };
    return [d.intento_id, { portador: d.portador, app: d.app, en: x.creado_en }];
  }));
  return filas.map((f) => ({
    intento_id: f.id, estudio_id: f.estudio_id, folio: f.folio_muestra, id_eira: f.id_eira,
    punto: (JSON.parse(f.detalle ?? "{}") as { destino?: string }).destino ?? "Punto comunitario",
    ref: refDe(f.estudio_id), mensaje: mensajeMalla(f.estudio_id, portalUrl), creado_en: f.creado_en,
    consultado: ["consultado", "entregado_asistido"].includes(f.estado_estudio), entrega: porIntento.get(f.id) ?? null,
  }));
}

/** La mula confirma que entregó el aviso en el punto comunitario. No detiene el ciclo: solo la consulta lo hace. */
export function confirmarEntregaMalla(ctx: Ctx, d: { intentoId: number; portador: string; app: string }) {
  exigir(ctx, "reto4.malla");
  const portador = d.portador.trim();
  if (portador.length < 3) throw new ErrorDominio("DATOS_INCOMPLETOS", "Escribe el nombre de quien llevó el aviso");
  if (!APPS_MALLA.includes(d.app as AppMalla)) throw new ErrorDominio("DATOS_INVALIDOS", "App de malla no reconocida");
  const i = db().prepare("SELECT id, estudio_id FROM intentos_contacto WHERE id = ? AND canal = 'malla' AND estado = 'enviado'").get(d.intentoId) as { id: number; estudio_id: string } | undefined;
  if (!i) throw noEncontrado("El aviso de malla");
  const ya = (db().prepare("SELECT detalle FROM intentos_contacto WHERE estudio_id = ? AND canal = 'malla' AND estado = 'entregado'").all(i.estudio_id) as { detalle: string }[])
    .some((x) => (JSON.parse(x.detalle) as { intento_id: number }).intento_id === i.id);
  if (ya) throw new ErrorDominio("YA_ENTREGADO", "Este aviso ya tiene una entrega registrada", 409);
  db().transaction(() => {
    db().prepare("INSERT INTO intentos_contacto (estudio_id, canal, estado, detalle, creado_en) VALUES (?, 'malla', 'entregado', ?, ?)")
      .run(i.estudio_id, JSON.stringify({ intento_id: i.id, portador, app: d.app }), nowIso());
    audit(actorDe(ctx), "MALLA_ENTREGA_CONFIRMADA", i.estudio_id, { portador, app: d.app, ref: refDe(i.estudio_id) }, ctx.ip);
  })();
  return { intento_id: i.id, ref: refDe(i.estudio_id) };
}

export type RutaMalla = { punto: string; avisos: { ref: string; id_eira: string }[]; mensaje: string };

/**
 * Ruta por Briar: un solo mensaje por punto comunitario con todos los avisos pendientes. Va a la promotora, que
 * identifica a cada persona por su ID EIRA (el de su talón); no lleva nombres, folios de muestra ni términos clínicos.
 */
export function rutasMalla(ctx: Ctx, portalUrl: string = PORTAL_URL): RutaMalla[] {
  const pendientes = listarAvisosMalla(ctx, portalUrl).filter((a) => !a.entrega && !a.consultado);
  const porPunto = new Map<string, AvisoMalla[]>();
  for (const a of pendientes) porPunto.set(a.punto, [...(porPunto.get(a.punto) ?? []), a]);
  return Array.from(porPunto.entries()).map(([punto, avisos]) => {
    const mensaje = [
      `EIRA · Ruta: ${punto} · ${avisos.length} aviso${avisos.length === 1 ? "" : "s"}`,
      `Avisa a cada persona: "Tienes un documento disponible. Consulta en ${portalUrl}, acerca tu llavero en el punto EIRA o llama al 341 410 8111."`,
      ...avisos.map((a) => `- ${a.id_eira} · clave ${a.ref}`),
      "Cuando le avises, responde aquí con la palabra RECIBIDO seguida de la clave de esa persona.",
    ].join("\n");
    if (!esNeutro(mensaje)) throw new Error("Ruta con términos clínicos bloqueada");
    return { punto, avisos: avisos.map((a) => ({ ref: a.ref, id_eira: a.id_eira })), mensaje };
  });
}

/**
 * Acuse de regreso: se pega la respuesta que la promotora escribió en Briar ("RECIBIDO 4CAAF237 ...") y se
 * registran solo los avisos cuya clave aparece. Las claves desconocidas o ya registradas se reportan, no fallan.
 */
export function registrarAcuseMalla(ctx: Ctx, d: { texto: string; portador: string }) {
  exigir(ctx, "reto4.malla");
  if (d.portador.trim().length < 3) throw new ErrorDominio("DATOS_INCOMPLETOS", "Escribe el nombre de quien trajo el acuse");
  // Solo claves exactas de 8 caracteres tras RECIBIDO; "NO RECIBIDO ..." no cuenta.
  const claves = Array.from(new Set(Array.from(d.texto.toUpperCase().matchAll(/(?<!\bNO\s+)\bRECIBID[OA]S?\b[\s:,]*((?:\b[0-9A-F]{8}\b[\s,;Y]*)+)/g))
    .flatMap((m) => m[1].match(/\b[0-9A-F]{8}\b/g) ?? [])));
  if (!claves.length) throw new ErrorDominio("SIN_CLAVES", "No se encontró ninguna clave con la palabra RECIBIDO");
  const avisos = listarAvisosMalla(ctx);
  const r = { confirmados: [] as string[], ya_registrados: [] as string[], desconocidas: [] as string[] };
  db().transaction(() => {
    for (const c of claves) {
      const a = avisos.find((x) => x.ref === c);
      if (!a) r.desconocidas.push(c);
      else if (a.entrega) r.ya_registrados.push(c);
      else {
        confirmarEntregaMalla(ctx, { intentoId: a.intento_id, portador: d.portador, app: "briar" });
        r.confirmados.push(c);
      }
    }
  })();
  return r;
}
