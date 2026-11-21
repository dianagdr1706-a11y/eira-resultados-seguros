import { db } from "./db";
import { sha256 } from "./ids";
import { nowIso } from "./clock";

export type Actor = { tipo: "usuario" | "paciente" | "sistema"; id?: string | null; nombre?: string | null };

export type BitacoraRow = {
  id: number; estudio_id: string | null; actor_tipo: string; actor_id: string | null; actor_nombre: string | null;
  accion: string; detalle: string | null; ip: string | null; creado_en: string; prev_hash: string; hash: string;
};

const GENESIS = "0".repeat(64);

function rowHash(prev: string, r: Omit<BitacoraRow, "id" | "prev_hash" | "hash">) {
  return sha256(
    prev + "|" + JSON.stringify([r.estudio_id, r.actor_tipo, r.actor_id, r.actor_nombre, r.accion, r.detalle, r.ip, r.creado_en]),
  );
}

export function audit(actor: Actor, accion: string, estudioId: string | null, detalle?: unknown, ip?: string | null, at?: string) {
  const d = db();
  const tx = d.transaction(() => {
    const last = d.prepare("SELECT hash FROM bitacora ORDER BY id DESC LIMIT 1").get() as { hash: string } | undefined;
    const prev = last?.hash ?? GENESIS;
    const r = {
      estudio_id: estudioId,
      actor_tipo: actor.tipo,
      actor_id: actor.id ?? null,
      actor_nombre: actor.nombre ?? null,
      accion,
      detalle: detalle === undefined ? null : typeof detalle === "string" ? detalle : JSON.stringify(detalle),
      ip: ip ?? null,
      creado_en: at ?? nowIso(),
    };
    d.prepare(
      `INSERT INTO bitacora (estudio_id, actor_tipo, actor_id, actor_nombre, accion, detalle, ip, creado_en, prev_hash, hash)
       VALUES (@estudio_id, @actor_tipo, @actor_id, @actor_nombre, @accion, @detalle, @ip, @creado_en, @prev, @hash)`,
    ).run({ ...r, prev, hash: rowHash(prev, r) });
  });
  tx();
}

export function verifyChain(): { ok: boolean; total: number; rotoEn?: number } {
  const rows = db().prepare("SELECT * FROM bitacora ORDER BY id").all() as BitacoraRow[];
  let prev = GENESIS;
  for (const r of rows) {
    if (r.prev_hash !== prev || rowHash(prev, r) !== r.hash) return { ok: false, total: rows.length, rotoEn: r.id };
    prev = r.hash;
  }
  return { ok: true, total: rows.length };
}

export function bitacoraDe(estudioId: string) {
  return db().prepare("SELECT * FROM bitacora WHERE estudio_id = ? ORDER BY id").all(estudioId) as BitacoraRow[];
}
