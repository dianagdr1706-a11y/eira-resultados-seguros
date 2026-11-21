import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { generateSyntheticPapPdf, sha256Buffer } from "./pdf-utils";

const DATA_DIR = path.join(process.cwd(), "data");
export const PRIVATE_PDF_DIR = path.join(process.cwd(), "private_storage", "pdfs");
const DB_PATH = path.join(DATA_DIR, "eira.db");

declare global {
  // eslint-disable-next-line no-var
  var __eiraDb: DatabaseSync | undefined;
  // eslint-disable-next-line no-var
  var __eiraPdfsReady: Promise<void> | undefined;
}

function ensureDirectories() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PRIVATE_PDF_DIR)) fs.mkdirSync(PRIVATE_PDF_DIR, { recursive: true });
}

function initSchema(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      license_number TEXT,
      community TEXT
    );

    CREATE TABLE IF NOT EXISTS kiosk_nodes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      community TEXT NOT NULL,
      hardware_profile TEXT NOT NULL,
      hotspot_ssid TEXT NOT NULL,
      lora_channel TEXT NOT NULL,
      last_sync_at TEXT
    );

    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      folio TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      birth_date TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      preferred_channel TEXT NOT NULL,
      community TEXT NOT NULL,
      kiosk_id TEXT,
      pin_code TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS studies (
      id TEXT PRIMARY KEY,
      sample_folio TEXT NOT NULL UNIQUE,
      pseudonym_code TEXT NOT NULL UNIQUE,
      patient_id TEXT,
      collection_date TEXT NOT NULL,
      site_name TEXT NOT NULL,
      community TEXT NOT NULL,
      status TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'rutinario',
      delivery_mode TEXT,
      pdf_filename TEXT,
      pdf_original_name TEXT,
      pdf_sha256 TEXT,
      pdf_size_bytes INTEGER,
      identity_checklist_json TEXT,
      admin_reviewed_by TEXT,
      admin_reviewed_at TEXT,
      clinical_authorized_by TEXT,
      clinical_authorized_at TEXT,
      clinical_note_internal TEXT,
      loop_status TEXT NOT NULL DEFAULT 'inactivo',
      loop_level INTEGER NOT NULL DEFAULT 0,
      loop_attempts INTEGER NOT NULL DEFAULT 0,
      simulated_hours_elapsed INTEGER NOT NULL DEFAULT 0,
      ack_received_at TEXT,
      ack_method TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (patient_id) REFERENCES patients(id)
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      study_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      decision TEXT NOT NULL,
      comments TEXT NOT NULL,
      reviewer_id TEXT NOT NULL,
      reviewer_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (study_id) REFERENCES studies(id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      study_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      recipient_masked TEXT NOT NULL,
      neutral_message TEXT NOT NULL,
      pseudonym_code TEXT NOT NULL,
      delivery_status TEXT NOT NULL,
      is_simulated INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (study_id) REFERENCES studies(id)
    );

    CREATE TABLE IF NOT EXISTS loop_events (
      id TEXT PRIMARY KEY,
      study_id TEXT NOT NULL,
      level INTEGER NOT NULL,
      channel TEXT NOT NULL,
      pseudonym_code TEXT NOT NULL,
      payload_preview TEXT NOT NULL,
      hours_mark INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (study_id) REFERENCES studies(id)
    );

    CREATE TABLE IF NOT EXISTS assisted_deliveries (
      id TEXT PRIMARY KEY,
      study_id TEXT NOT NULL,
      kiosk_id TEXT,
      modality TEXT NOT NULL,
      operator_id TEXT NOT NULL,
      operator_name TEXT NOT NULL,
      ack_folio TEXT NOT NULL,
      notes TEXT NOT NULL,
      synced_from_offline INTEGER NOT NULL DEFAULT 0,
      delivered_at TEXT NOT NULL,
      FOREIGN KEY (study_id) REFERENCES studies(id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      study_id TEXT,
      actor_type TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      action TEXT NOT NULL,
      detail_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kv_ttl_store (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);
}

function seedDatabase(db: DatabaseSync) {
  const countRow = db.prepare("SELECT COUNT(*) as cnt FROM users").get() as { cnt: number };
  if (countRow.cnt > 0) return;

  const now = new Date().toISOString();

  // 1. Staff Users
  const insertUser = db.prepare(
    "INSERT INTO users (id, name, email, role, license_number, community) VALUES (?, ?, ?, ?, ?, ?)"
  );
  insertUser.run("lab-1", "QFB Sofía Méndez", "sofia.lab@eira.org", "laboratorio", null, null);
  insertUser.run("eira-1", "Lic. Mariana López", "mariana.admin@eira.org", "eira_admin", null, null);
  insertUser.run("med-1", "Dra. Elena Ramírez", "elena.medica@eira.org", "medico", "CED-8472910", null);
  insertUser.run("prom-1", "Rosa Hernández", "rosa.promotora@eira.org", "promotora_kiosco", null, "Sierra Norte");

  // 2. Kiosk Nodes (Raspberry Pi)
  const insertKiosk = db.prepare(
    "INSERT INTO kiosk_nodes (id, name, community, hardware_profile, hotspot_ssid, lora_channel, last_sync_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  insertKiosk.run(
    "KIOSK-SIERRA-01",
    "Kiosco Comunitario Sierra Norte",
    "Sierra Norte",
    "Raspberry Pi 5 (4GB) + Pantalla Táctil 7\" + Módulo LoRa 433MHz SX1278",
    "EIRA-Kiosco-Sierra",
    "LoRa-433MHz-CH1",
    now
  );
  insertKiosk.run(
    "KIOSK-OTUMBA-02",
    "Módulo Comunitario Otumba",
    "Otumba",
    "Raspberry Pi 4 (4GB) + Lector QR/NFC + Impresora Térmica",
    "EIRA-Kiosco-Otumba",
    "LoRa-433MHz-CH2",
    now
  );

  // 3. Synthetic Patients (including near-homonyms & zero-connectivity rural patients)
  const insertPatient = db.prepare(
    "INSERT INTO patients (id, folio, full_name, birth_date, phone, email, preferred_channel, community, kiosk_id, pin_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  insertPatient.run(
    "pat-1",
    "PAC-2026-001",
    "María Guadalupe Hernández Pérez",
    "1988-05-14",
    "+525510001001",
    "maria.hernandez88@ejemplo.org",
    "sms",
    "San Juan Teotihuacán",
    "KIOSK-OTUMBA-02",
    "4821",
    now
  );
  insertPatient.run(
    "pat-2",
    "PAC-2026-002",
    "María Guadalupe Hernández Peralta",
    "1979-11-02",
    "+525510002002",
    null,
    "sms",
    "Otumba",
    "KIOSK-OTUMBA-02",
    "7392",
    now
  );
  insertPatient.run(
    "pat-3",
    "PAC-2026-003",
    "Juana Morales Cruz",
    "1972-03-22",
    null,
    null,
    "kiosco_asistido",
    "Sierra Norte",
    "KIOSK-SIERRA-01",
    "9154",
    now
  );
  insertPatient.run(
    "pat-4",
    "PAC-2026-004",
    "Lucía Bautista Romero",
    "1991-08-30",
    "+525510004004",
    "lucia.bautista@ejemplo.org",
    "correo",
    "Texcoco",
    null,
    "6208",
    now
  );
  insertPatient.run(
    "pat-5",
    "PAC-2026-005",
    "Carmen Flores Mendoza",
    "1984-01-19",
    null,
    null,
    "kiosco_asistido",
    "Sierra Norte",
    "KIOSK-SIERRA-01",
    "3047",
    now
  );
  insertPatient.run(
    "pat-6",
    "PAC-2026-006",
    "Patricia Reyes Vázquez",
    "1995-07-08",
    "+525510006006",
    "paty.reyes@ejemplo.org",
    "sms",
    "Acolman",
    null,
    "5519",
    now
  );

  // 4. Synthetic Studies across all workflow stages
  const insertStudy = db.prepare(`
    INSERT INTO studies (
      id, sample_folio, pseudonym_code, patient_id, collection_date, site_name, community,
      status, priority, delivery_mode, pdf_filename, pdf_original_name, pdf_sha256, pdf_size_bytes,
      identity_checklist_json, admin_reviewed_by, admin_reviewed_at, clinical_authorized_by,
      clinical_authorized_at, clinical_note_internal, loop_status, loop_level, loop_attempts,
      simulated_hours_elapsed, ack_received_at, ack_method, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Study 1: Unassociated PDF (for live anti-homonym side-by-side demo!)
  insertStudy.run(
    "std-101",
    "PAP-2026-101",
    "EIRA-ALR-4101",
    null,
    "2026-11-10",
    "Jornada Municipal Teotihuacán",
    "San Juan Teotihuacán",
    "cargado",
    "rutinario",
    null,
    "PAP-2026-101.pdf",
    "lab_scan_PAP-2026-101.pdf",
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    "inactivo",
    0,
    0,
    0,
    null,
    null,
    now,
    now
  );

  // Study 2: Ready for Clinical Authorization (Admin reviewed already)
  insertStudy.run(
    "std-102",
    "PAP-2026-102",
    "EIRA-ALR-4102",
    "pat-4",
    "2026-11-08",
    "Jornada Salud Texcoco",
    "Texcoco",
    "pendiente_clinica",
    "rutinario",
    null,
    "PAP-2026-102.pdf",
    "lab_scan_PAP-2026-102.pdf",
    null,
    null,
    JSON.stringify({
      name_matches: true,
      dob_or_folio_matches: true,
      pdf_legible_complete: true,
      verified_by: "Lic. Mariana López",
      verified_at: now,
    }),
    "Lic. Mariana López",
    now,
    null,
    null,
    null,
    "inactivo",
    0,
    0,
    0,
    null,
    null,
    now,
    now
  );

  // Study 3: Authorized Digital & Notified (ready for Patient Portal OTP + 401 proof!)
  insertStudy.run(
    "std-103",
    "PAP-2026-103",
    "EIRA-ALR-4103",
    "pat-6",
    "2026-11-05",
    "Jornada Municipal Acolman",
    "Acolman",
    "notificado",
    "rutinario",
    "digital",
    "PAP-2026-103.pdf",
    "lab_scan_PAP-2026-103.pdf",
    null,
    null,
    JSON.stringify({
      name_matches: true,
      dob_or_folio_matches: true,
      pdf_legible_complete: true,
      verified_by: "Lic. Mariana López",
      verified_at: now,
    }),
    "Lic. Mariana López",
    now,
    "Dra. Elena Ramírez (CED-8472910)",
    now,
    "Citología rutinaria sin alteraciones. Liberación digital autorizada.",
    "activo",
    1,
    1,
    12,
    null,
    null,
    now,
    now
  );

  // Study 4: Priority Accompanied Delivery in Sierra Norte (No phone/email -> Kiosk + LoRa Loop!)
  insertStudy.run(
    "std-104",
    "PAP-2026-104",
    "EIRA-ALR-4104",
    "pat-5",
    "2026-11-04",
    "Brigada Rural Sierra Norte",
    "Sierra Norte",
    "autorizado_acompanado",
    "prioritario",
    "acompanado",
    "PAP-2026-104.pdf",
    "lab_scan_PAP-2026-104.pdf",
    null,
    null,
    JSON.stringify({
      name_matches: true,
      dob_or_folio_matches: true,
      pdf_legible_complete: true,
      verified_by: "Lic. Mariana López",
      verified_at: now,
    }),
    "Lic. Mariana López",
    now,
    "Dra. Elena Ramírez (CED-8472910)",
    now,
    "Requiere orientación médica acompañada antes de entrega. Activado seguimiento prioritario en Kiosco Sierra Norte.",
    "activo",
    2,
    2,
    24,
    null,
    null,
    now,
    now
  );

  // Study 5: Rural patient without phone/email ready at Raspberry Pi Kiosk for QR assisted delivery
  insertStudy.run(
    "std-105",
    "PAP-2026-105",
    "EIRA-ALR-4105",
    "pat-3",
    "2026-11-03",
    "Brigada Rural Sierra Norte",
    "Sierra Norte",
    "notificado",
    "rutinario",
    "digital",
    "PAP-2026-105.pdf",
    "lab_scan_PAP-2026-105.pdf",
    null,
    null,
    JSON.stringify({
      name_matches: true,
      dob_or_folio_matches: true,
      pdf_legible_complete: true,
      verified_by: "Lic. Mariana López",
      verified_at: now,
    }),
    "Lic. Mariana López",
    now,
    "Dra. Elena Ramírez (CED-8472910)",
    now,
    "Resultado rutinario listo en Nodo Kiosco Sierra Norte (paciente sin celular ni correo).",
    "activo",
    2,
    2,
    36,
    null,
    null,
    now,
    now
  );

  // Initial neutral notifications
  const insertNotif = db.prepare(
    "INSERT INTO notifications (id, study_id, channel, recipient_masked, neutral_message, pseudonym_code, delivery_status, is_simulated, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  insertNotif.run(
    "notif-1",
    "std-103",
    "sms_neutro",
    "+52*****6006",
    "EIRA: Tu documento de estudio ya está disponible en el portal seguro usando tu folio PAC-2026-006 y fecha de nacimiento. Sin enlaces públicos.",
    "EIRA-ALR-4103",
    "simulado",
    1,
    now
  );
  insertNotif.run(
    "notif-2",
    "std-104",
    "kiosco_wifi_local",
    "Nodo KIOSK-SIERRA-01 (Sin celular)",
    "Aviso comunitario pseudonimizado para código EIRA-ALR-4104: acudir al Kiosco Comunitario Sierra Norte o contactar a la promotora EIRA para entrega acompañada.",
    "EIRA-ALR-4104",
    "simulado",
    1,
    now
  );
  insertNotif.run(
    "notif-3",
    "std-105",
    "kiosco_wifi_local",
    "Nodo KIOSK-SIERRA-01 (Sin celular)",
    "Aviso comunitario pseudonimizado para código EIRA-ALR-4105: documento disponible en el Kiosco Comunitario Sierra Norte con tarjeta QR o folio.",
    "EIRA-ALR-4105",
    "simulado",
    1,
    now
  );

  // Initial Loop Events
  const insertLoop = db.prepare(
    "INSERT INTO loop_events (id, study_id, level, channel, pseudonym_code, payload_preview, hours_mark, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  insertLoop.run(
    "loop-1",
    "std-103",
    1,
    "sms_neutro",
    "EIRA-ALR-4103",
    "[Nivel 1 · SMS Neutro] Código EIRA-ALR-4103: documento listo en portal seguro EIRA (0 datos clínicos).",
    0,
    "emitido",
    now
  );
  insertLoop.run(
    "loop-2",
    "std-104",
    1,
    "kiosco_wifi_local",
    "EIRA-ALR-4104",
    "[Nivel 1 · Kiosco RPi Wi-Fi Local] Paquete cifrado sincronizado en KIOSK-SIERRA-01 para EIRA-ALR-4104.",
    0,
    "emitido",
    now
  );
  insertLoop.run(
    "loop-3",
    "std-104",
    2,
    "lora_modulo_comunitario",
    "EIRA-ALR-4104",
    "[Nivel 2 · LoRa 433MHz Pseudonimizado] PING PRIORITARIO folio EIRA-ALR-4104 -> Receptor comunitario Sierra Norte (sin diagnóstico, sin nombre).",
    24,
    "emitido",
    now
  );
  insertLoop.run(
    "loop-4",
    "std-105",
    2,
    "kiosco_wifi_local",
    "EIRA-ALR-4105",
    "[Nivel 2 · Kiosco RPi] Reintento respetuoso para código EIRA-ALR-4105 en módulo comunitario Sierra Norte.",
    24,
    "emitido",
    now
  );

  // Initial Audit Logs
  const insertAudit = db.prepare(
    "INSERT INTO audit_logs (id, study_id, actor_type, actor_id, actor_name, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  insertAudit.run(
    "aud-1",
    "std-101",
    "staff",
    "lab-1",
    "QFB Sofía Méndez",
    "PDF_CARGADO",
    JSON.stringify({ sample_folio: "PAP-2026-101", note: "PDF escaneado cargado; pendiente asociación verificada." }),
    now
  );
  insertAudit.run(
    "aud-2",
    "std-103",
    "staff",
    "med-1",
    "Dra. Elena Ramírez",
    "AUTORIZACION_CLINICA",
    JSON.stringify({ delivery_mode: "digital", priority: "rutinario", loop_started: true }),
    now
  );
  insertAudit.run(
    "aud-3",
    "std-104",
    "staff",
    "med-1",
    "Dra. Elena Ramírez",
    "AUTORIZACION_CLINICA",
    JSON.stringify({ delivery_mode: "acompanado", priority: "prioritario", kiosk_target: "KIOSK-SIERRA-01" }),
    now
  );
}

/**
 * Reto 1 · Expediente digital único (additive, idempotent migration).
 * - patients.birth_state / version / updated_at
 * - visits: one row per attendance, services recorded separately, sample_folio bridges to studies (Reto 4)
 * - seeds demo visits (history for María Guadalupe Hernández Pérez + one visit per seeded study)
 */
function migrateReto1(db: DatabaseSync) {
  const cols = (db.prepare("PRAGMA table_info(patients)").all() as Array<{ name: string }>).map((c) => c.name);
  if (!cols.includes("birth_state")) db.exec("ALTER TABLE patients ADD COLUMN birth_state TEXT");
  if (!cols.includes("version")) db.exec("ALTER TABLE patients ADD COLUMN version INTEGER NOT NULL DEFAULT 1");
  if (!cols.includes("updated_at")) db.exec("ALTER TABLE patients ADD COLUMN updated_at TEXT");

  db.exec(`
    CREATE TABLE IF NOT EXISTS visits (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      visit_date TEXT NOT NULL,
      site_name TEXT NOT NULL,
      community TEXT NOT NULL,
      services_json TEXT NOT NULL,
      sample_folio TEXT,
      captured_by TEXT NOT NULL,
      captured_by_name TEXT NOT NULL,
      client_uuid TEXT UNIQUE,
      captured_offline INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (patient_id) REFERENCES patients(id)
    );
    CREATE INDEX IF NOT EXISTS idx_visits_patient ON visits(patient_id, visit_date);
    CREATE INDEX IF NOT EXISTS idx_visits_sample ON visits(sample_folio);
  `);

  const birthStates: Record<string, string> = {
    "pat-1": "Estado de México",
    "pat-2": "Estado de México",
    "pat-3": "Puebla",
    "pat-4": "Estado de México",
    "pat-5": "Puebla",
    "pat-6": "Ciudad de México",
  };
  const setState = db.prepare("UPDATE patients SET birth_state = ? WHERE id = ? AND birth_state IS NULL");
  for (const [id, state] of Object.entries(birthStates)) setState.run(state, id);

  const visitCount = (db.prepare("SELECT COUNT(*) AS cnt FROM visits").get() as { cnt: number }).cnt;
  const hasSeedPatient = db.prepare("SELECT id FROM patients WHERE id = 'pat-1'").get();
  if (visitCount > 0 || !hasSeedPatient) return;

  const insertVisit = db.prepare(
    `INSERT INTO visits (id, patient_id, visit_date, site_name, community, services_json, sample_folio,
       captured_by, captured_by_name, client_uuid, captured_offline, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)`
  );
  const seedVisits: Array<[string, string, string, string, string, string[], string | null]> = [
    // Recurrent patient: two previous jornadas + the current one whose Pap sample is PAP-2026-101
    ["vis-seed-01", "pat-1", "2025-11-08", "Jornada Municipal Teotihuacán", "San Juan Teotihuacán", ["papanicolaou", "exploracion_mama"], "PAP-2025-044"],
    ["vis-seed-02", "pat-1", "2026-05-16", "Jornada Municipal Teotihuacán", "San Juan Teotihuacán", ["exploracion_mama", "consejeria"], null],
    ["vis-seed-03", "pat-1", "2026-11-10", "Jornada Municipal Teotihuacán", "San Juan Teotihuacán", ["papanicolaou", "prueba_vph"], "PAP-2026-101"],
    ["vis-seed-04", "pat-4", "2026-11-08", "Jornada Salud Texcoco", "Texcoco", ["papanicolaou"], "PAP-2026-102"],
    ["vis-seed-05", "pat-6", "2026-11-05", "Jornada Municipal Acolman", "Acolman", ["papanicolaou", "exploracion_mama"], "PAP-2026-103"],
    ["vis-seed-06", "pat-5", "2026-11-04", "Brigada Rural Sierra Norte", "Sierra Norte", ["papanicolaou"], "PAP-2026-104"],
    ["vis-seed-07", "pat-3", "2026-11-03", "Brigada Rural Sierra Norte", "Sierra Norte", ["papanicolaou", "consejeria"], "PAP-2026-105"],
    ["vis-seed-08", "pat-2", "2026-03-14", "Jornada Municipal Otumba", "Otumba", ["exploracion_mama"], null],
  ];
  for (const [id, patientId, date, site, community, services, sampleFolio] of seedVisits) {
    insertVisit.run(
      id, patientId, date, site, community, JSON.stringify(services), sampleFolio,
      "prom-1", "Rosa Hernández", `${date}T15:00:00.000Z`
    );
  }
}

export function getDb(): DatabaseSync {
  ensureDirectories();
  if (!global.__eiraDb) {
    const db = new DatabaseSync(DB_PATH);
    initSchema(db);
    seedDatabase(db);
    migrateReto1(db);
    global.__eiraDb = db;
  }
  return global.__eiraDb;
}

export async function ensureSeedPdfs(): Promise<void> {
  if (!global.__eiraPdfsReady) {
    global.__eiraPdfsReady = (async () => {
      const db = getDb();
      const seedSpecs = [
        {
          id: "std-101",
          filename: "PAP-2026-101.pdf",
          sampleFolio: "PAP-2026-101",
          patientName: "Maria Guadalupe Hernandez Perez",
          birthDate: "1988-05-14",
          collectionDate: "2026-11-10",
          siteName: "Jornada Municipal Teotihuacan",
          labNote: "Muestra satisfactoria para evaluacion. Flora bacteriana habitual. Control anual recomendado.",
          resultCategory: "Negativo para lesión intraepitelial o malignidad (Rutinario)" as const,
        },
        {
          id: "std-102",
          filename: "PAP-2026-102.pdf",
          sampleFolio: "PAP-2026-102",
          patientName: "Lucia Bautista Romero",
          birthDate: "1991-08-30",
          collectionDate: "2026-11-08",
          siteName: "Jornada Salud Texcoco",
          labNote: "Muestra adecuada. Citologia cervical dentro de limites normales.",
          resultCategory: "Negativo para lesión intraepitelial o malignidad (Rutinario)" as const,
        },
        {
          id: "std-103",
          filename: "PAP-2026-103.pdf",
          sampleFolio: "PAP-2026-103",
          patientName: "Patricia Reyes Vazquez",
          birthDate: "1995-07-08",
          collectionDate: "2026-11-05",
          siteName: "Jornada Municipal Acolman",
          labNote: "Muestra satisfactoria. Sin cambios celulares atipicos. Mantener tamizaje periodico.",
          resultCategory: "Negativo para lesión intraepitelial o malignidad (Rutinario)" as const,
        },
        {
          id: "std-104",
          filename: "PAP-2026-104.pdf",
          sampleFolio: "PAP-2026-104",
          patientName: "Carmen Flores Mendoza",
          birthDate: "1984-01-19",
          collectionDate: "2026-11-04",
          siteName: "Brigada Rural Sierra Norte",
          labNote: "Hallazgos celulares que ameritan valoracion colposcopica y orientacion medica acompanada con EIRA.",
          resultCategory: "Hallazgo que requiere seguimiento médico prioritario (Acompañado)" as const,
        },
        {
          id: "std-105",
          filename: "PAP-2026-105.pdf",
          sampleFolio: "PAP-2026-105",
          patientName: "Juana Morales Cruz",
          birthDate: "1972-03-22",
          collectionDate: "2026-11-03",
          siteName: "Brigada Rural Sierra Norte",
          labNote: "Muestra satisfactoria. Sin hallazgos de alarma. Entrega asistida programada en Kiosco Sierra Norte.",
          resultCategory: "Negativo para lesión intraepitelial o malignidad (Rutinario)" as const,
        },
      ];

      const updatePdf = db.prepare(
        "UPDATE studies SET pdf_sha256 = ?, pdf_size_bytes = ? WHERE id = ? AND (pdf_sha256 IS NULL OR pdf_size_bytes IS NULL)"
      );

      for (const spec of seedSpecs) {
        const fullPath = path.join(PRIVATE_PDF_DIR, spec.filename);
        let buf: Buffer;
        if (!fs.existsSync(fullPath)) {
          buf = await generateSyntheticPapPdf(spec);
          fs.writeFileSync(fullPath, buf);
        } else {
          buf = fs.readFileSync(fullPath);
        }
        updatePdf.run(sha256Buffer(buf), buf.length, spec.id);
      }
    })();
  }
  await global.__eiraPdfsReady;
}
