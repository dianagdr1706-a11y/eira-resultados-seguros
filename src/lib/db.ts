import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), "data"));
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

const g = globalThis as unknown as { __db?: Database.Database };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY, nombre TEXT NOT NULL, usuario TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL, rol TEXT NOT NULL, cedula TEXT, activo INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS pacientes (
  id TEXT PRIMARY KEY, id_eira TEXT UNIQUE NOT NULL, nombre TEXT NOT NULL, fecha_nacimiento TEXT NOT NULL,
  telefono TEXT, correo TEXT, canal_preferido TEXT NOT NULL DEFAULT 'sms', municipio TEXT, sede_ultima TEXT,
  pin_hash TEXT, pin_expira TEXT, tercero_autorizado TEXT,
  curp TEXT, version INTEGER NOT NULL DEFAULT 1, creado_en TEXT, actualizado_en TEXT
);
CREATE TABLE IF NOT EXISTS visitas (
  id TEXT PRIMARY KEY, paciente_id TEXT NOT NULL REFERENCES pacientes(id), fecha TEXT NOT NULL,
  sede TEXT, municipio TEXT, motivo TEXT, capturado_por TEXT, origen TEXT NOT NULL DEFAULT 'en_linea', creado_en TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS servicios (
  id TEXT PRIMARY KEY, visita_id TEXT NOT NULL REFERENCES visitas(id), tipo TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'realizado', notas TEXT, creado_en TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS decisiones_coincidencia (
  id INTEGER PRIMARY KEY AUTOINCREMENT, datos_capturados TEXT NOT NULL, candidatos TEXT NOT NULL,
  decision TEXT NOT NULL, paciente_id TEXT, motivo TEXT, usuario_id TEXT NOT NULL, creado_en TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_ops (
  op_id TEXT PRIMARY KEY, dispositivo TEXT NOT NULL, tipo TEXT NOT NULL, datos TEXT NOT NULL,
  capturado_en TEXT, estado TEXT NOT NULL, detalle TEXT, resultado_id TEXT, usuario_id TEXT,
  recibido_en TEXT NOT NULL, resuelto_en TEXT, resuelto_por TEXT
);
CREATE TABLE IF NOT EXISTS estudios (
  id TEXT PRIMARY KEY, folio_muestra TEXT NOT NULL, paciente_id TEXT REFERENCES pacientes(id),
  fecha_toma TEXT, sede_jornada TEXT, estado TEXT NOT NULL, prioridad TEXT DEFAULT 'rutinario',
  bethesda TEXT, autorizado_por TEXT, autorizado_en TEXT, notificado_en TEXT, consultado_en TEXT,
  cerrado_en TEXT, requiere_asistida INTEGER DEFAULT 0, creado_en TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS documentos (
  id TEXT PRIMARY KEY, estudio_id TEXT NOT NULL REFERENCES estudios(id), ruta TEXT NOT NULL,
  nombre_original TEXT, sha256 TEXT NOT NULL, tamano INTEGER, vigente INTEGER DEFAULT 1,
  subido_por TEXT, subido_en TEXT, verificacion_json TEXT
);
CREATE TABLE IF NOT EXISTS revisiones (
  id INTEGER PRIMARY KEY AUTOINCREMENT, estudio_id TEXT NOT NULL, etapa TEXT NOT NULL, decision TEXT NOT NULL,
  comentarios TEXT, revisor_id TEXT, creado_en TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notificaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT, estudio_id TEXT, paciente_id TEXT, canal TEXT NOT NULL,
  destino_enmascarado TEXT, asunto TEXT, mensaje TEXT NOT NULL, estado TEXT NOT NULL, tipo TEXT, creado_en TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entregas (
  id INTEGER PRIMARY KEY AUTOINCREMENT, estudio_id TEXT NOT NULL, modalidad TEXT NOT NULL, operador_id TEXT,
  resultado TEXT, observaciones TEXT, acuse TEXT, creado_en TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bitacora (
  id INTEGER PRIMARY KEY AUTOINCREMENT, estudio_id TEXT, actor_tipo TEXT NOT NULL, actor_id TEXT,
  actor_nombre TEXT, accion TEXT NOT NULL, detalle TEXT, ip TEXT, creado_en TEXT NOT NULL,
  prev_hash TEXT NOT NULL, hash TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS bitacora_no_update BEFORE UPDATE ON bitacora
BEGIN SELECT RAISE(ABORT, 'bitacora es solo de insercion'); END;
CREATE TRIGGER IF NOT EXISTS bitacora_no_delete BEFORE DELETE ON bitacora
BEGIN SELECT RAISE(ABORT, 'bitacora es solo de insercion'); END;
`;

export function db(): Database.Database {
  if (g.__db) return g.__db;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const d = new Database(path.join(DATA_DIR, "eira.db"));
  d.pragma("journal_mode = WAL");
  d.pragma("foreign_keys = ON");
  d.exec(SCHEMA);
  const cols = (d.prepare("PRAGMA table_info(pacientes)").all() as { name: string }[]).map((c) => c.name);
  for (const [c, def] of [["curp", "TEXT"], ["version", "INTEGER NOT NULL DEFAULT 1"], ["creado_en", "TEXT"], ["actualizado_en", "TEXT"]])
    if (!cols.includes(c)) d.exec(`ALTER TABLE pacientes ADD COLUMN ${c} ${def}`);
  g.__db = d;
  return d;
}

export function getSetting(key: string): string | null {
  const r = db().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return r?.value ?? null;
}

export function setSetting(key: string, value: string) {
  db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

export type Paciente = {
  id: string; id_eira: string; nombre: string; fecha_nacimiento: string; telefono: string | null;
  correo: string | null; canal_preferido: string; municipio: string | null; sede_ultima: string | null;
  pin_hash: string | null; pin_expira: string | null; tercero_autorizado: string | null;
  curp: string | null; version: number; creado_en: string | null; actualizado_en: string | null;
};

export type Visita = {
  id: string; paciente_id: string; fecha: string; sede: string | null; municipio: string | null; motivo: string | null;
  capturado_por: string | null; origen: string; creado_en: string;
};

export type Servicio = { id: string; visita_id: string; tipo: string; estado: string; notas: string | null; creado_en: string };

export type SyncOp = {
  op_id: string; dispositivo: string; tipo: string; datos: string; capturado_en: string | null; estado: string;
  detalle: string | null; resultado_id: string | null; usuario_id: string | null; recibido_en: string;
  resuelto_en: string | null; resuelto_por: string | null;
};

export type Estudio = {
  id: string; folio_muestra: string; paciente_id: string | null; fecha_toma: string | null; sede_jornada: string | null;
  estado: string; prioridad: string; bethesda: string | null; autorizado_por: string | null; autorizado_en: string | null;
  notificado_en: string | null; consultado_en: string | null; cerrado_en: string | null; requiere_asistida: number; creado_en: string;
};

export type Usuario = { id: string; nombre: string; usuario: string; password_hash: string; rol: string; cedula: string | null };

export type Documento = {
  id: string; estudio_id: string; ruta: string; nombre_original: string; sha256: string; tamano: number;
  vigente: number; subido_por: string; subido_en: string; verificacion_json: string | null;
};
