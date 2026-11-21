import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, UPLOAD_DIR, db, getSetting, setSetting, type Paciente } from "@/lib/db";
import { hashSecret, newId, sha256 } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { samplePdf } from "@/sim/pdf-muestra";

const DAY = 86400000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();

export const PACIENTES_DEMO = [
  { id_eira: "EIRA-00121", nombre: "María Guadalupe Hernández López", fecha_nacimiento: "1985-03-12", telefono: "3411234567", correo: "mghl85@example.com", canal_preferido: "sms", municipio: "Zapotlán el Grande", sede_ultima: "Jornada Cd. Guzmán (oct 2026)" },
  { id_eira: "EIRA-00348", nombre: "María Guadalupe Hernández López", fecha_nacimiento: "1991-07-30", telefono: "3417654321", correo: null, canal_preferido: "sms", municipio: "Tuxpan", sede_ultima: "Jornada Tuxpan (nov 2026)" },
  { id_eira: "EIRA-00412", nombre: "Ana Sofía Ramírez Torres", fecha_nacimiento: "1978-11-02", telefono: null, correo: "anasofia.rt@example.com", canal_preferido: "correo", municipio: "Gómez Farías", sede_ultima: "Jornada Gómez Farías (oct 2026)" },
  { id_eira: "EIRA-00507", nombre: "Rosa Elena Martínez Cruz", fecha_nacimiento: "1962-05-21", telefono: null, correo: null, canal_preferido: "asistido", municipio: "Tamazula", sede_ultima: "Jornada Tamazula (oct 2026)" },
  { id_eira: "EIRA-00533", nombre: "Lucía Fernanda Gómez Ruiz", fecha_nacimiento: "1995-01-15", telefono: "3419988776", correo: "lucia.gr@example.com", canal_preferido: "sms", municipio: "Zapotiltic", sede_ultima: "Jornada Zapotiltic (oct 2026)" },
];

export const USUARIOS_DEMO = [
  { usuario: "laboratorio", nombre: "Laboratorio Citológico (demo)", rol: "laboratorio", cedula: null },
  { usuario: "admin", nombre: "Carmen Ruiz (EIRA)", rol: "eira_admin", cedula: null },
  { usuario: "medico", nombre: "Dra. Patricia Vázquez", rol: "medico", cedula: "12345678" },
  { usuario: "auditoria", nombre: "Auditoría EIRA", rol: "auditoria", cedula: null },
  { usuario: "captura", nombre: "Brigadista de jornada (captura)", rol: "captura", cedula: null },
];

export const DEMO_PASSWORD = "demo";

let seeding: Promise<void> | null = null;

export function ensureSeeded() {
  if (getSetting("seeded") === "1") return Promise.resolve();
  if (!seeding)
    seeding = seed()
      .catch((err) => {
        wipeData();
        throw err;
      })
      .finally(() => (seeding = null));
  return seeding;
}

async function guardarPdf(estudioId: string, buf: Buffer, nombre: string, subidoPor: string, at: string) {
  const docId = newId("DOC");
  const ruta = `${docId}.pdf`;
  fs.writeFileSync(path.join(UPLOAD_DIR, ruta), buf);
  db().prepare(
    `INSERT INTO documentos (id, estudio_id, ruta, nombre_original, sha256, tamano, subido_por, subido_en, verificacion_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(docId, estudioId, ruta, nombre, sha256(buf), buf.length, subidoPor, at,
    JSON.stringify({ nombre: true, fecha_nacimiento: true, folio: true, legible: true }));
}

async function seed() {
  const d = db();
  const users: Record<string, string> = {};
  for (const u of USUARIOS_DEMO) {
    const id = newId("USR");
    users[u.rol] = id;
    d.prepare("INSERT INTO usuarios (id, nombre, usuario, password_hash, rol, cedula) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, u.nombre, u.usuario, hashSecret(DEMO_PASSWORD), u.rol, u.cedula);
  }
  const pac: Paciente[] = [];
  for (const p of PACIENTES_DEMO) {
    const id = newId("PAC");
    d.prepare(
      `INSERT INTO pacientes (id, id_eira, nombre, fecha_nacimiento, telefono, correo, canal_preferido, municipio, sede_ultima)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, p.id_eira, p.nombre, p.fecha_nacimiento, p.telefono, p.correo, p.canal_preferido, p.municipio, p.sede_ultima);
    if (p.id_eira === "EIRA-00533") d.prepare("UPDATE pacientes SET telegram = '@lucia_demo' WHERE id = ?").run(id);
    pac.push(d.prepare("SELECT * FROM pacientes WHERE id = ?").get(id) as Paciente);
  }
  const sistema = { tipo: "sistema" as const, nombre: "Datos sintéticos de demo" };
  const historicos = [
    { p: pac[4], folio: "CIT-2026-0981", estado: "notificado", bethesda: "1", prioridad: "rutinario", dias: 12, notif: 9 },
    { p: pac[2], folio: "CIT-2026-0975", estado: "autorizado_acompanado", bethesda: "5", prioridad: "prioritario", dias: 6, notif: 3 },
    { p: pac[0], folio: "CIT-2026-0960", estado: "consultado", bethesda: "1", prioridad: "rutinario", dias: 20, notif: 15 },
    { p: pac[3], folio: "CIT-2026-0990", estado: "autorizado_digital", bethesda: "1", prioridad: "rutinario", dias: 5, notif: 2 },
  ];
  for (const h of historicos) {
    const id = newId("EST");
    const toma = ago(h.dias + 10).slice(0, 10);
    d.prepare(
      `INSERT INTO estudios (id, folio_muestra, paciente_id, fecha_toma, sede_jornada, estado, prioridad, bethesda, autorizado_por,
        autorizado_en, notificado_en, consultado_en, requiere_asistida, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, h.folio, h.p.id, toma, h.p.sede_ultima, h.estado, h.prioridad, h.bethesda, users.medico, ago(h.notif),
      h.estado === "notificado" || h.estado === "consultado" ? ago(h.notif) : null,
      h.estado === "consultado" ? ago(h.notif - 1) : null,
      h.estado === "autorizado_digital" ? 1 : 0, ago(h.dias));
    await guardarPdf(id, await samplePdf({ ...h.p, folio: h.folio, fecha_toma: toma, bethesda: h.bethesda }), `${h.folio}.pdf`, users.laboratorio, ago(h.dias));
    audit(sistema, "ESTUDIO_HISTORICO_CARGADO", id, { estado: h.estado }, null, ago(h.dias));
    if (h.estado === "autorizado_digital") audit(sistema, "SIN_CANAL_DIGITAL: requiere entrega asistida", id, null, null, ago(h.notif));
  }
  fs.mkdirSync(path.join(DATA_DIR, "samples"), { recursive: true });
  setSetting("seeded", "1");
}

function wipeData() {
  const g = globalThis as unknown as { __db?: { close(): void } };
  g.__db?.close();
  g.__db = undefined;
  for (const f of ["eira.db", "eira.db-wal", "eira.db-shm"]) fs.rmSync(path.join(DATA_DIR, f), { force: true });
  fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
}

export async function resetDemo() {
  wipeData();
  db();
  await ensureSeeded();
}
