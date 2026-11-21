import crypto from "node:crypto";
import { logAudit, maskContact } from "./audit";
import { getDb } from "./db";
import { findCandidates, maskPhone, MATCH_POSSIBLE_THRESHOLD } from "./matching";
import {
  SERVICE_LABELS,
  STATUS_LABELS,
  type ContactChannel,
  type MatchCandidate,
  type PatientCaptureInput,
  type ServiceCode,
  type StaffUser,
  type StudyStatus,
  type Visit,
} from "./types";

/**
 * Reto 1 · Expediente digital único — shared domain logic used by the REST routes
 * and by the offline sync endpoint, so both paths enforce exactly the same rules.
 */

export const VALID_SERVICES = Object.keys(SERVICE_LABELS) as ServiceCode[];
const VALID_CHANNELS: ContactChannel[] = ["sms", "correo", "kiosco_asistido"];
const MIN_REASON_LENGTH = 10;

export class RegistryError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public payload?: Record<string, unknown>
  ) {
    super(message);
  }
}

interface PatientRow {
  id: string;
  folio: string;
  full_name: string;
  birth_date: string;
  birth_state: string | null;
  phone: string | null;
  email: string | null;
  preferred_channel: ContactChannel;
  community: string;
  kiosk_id: string | null;
  version: number;
  created_at: string;
  updated_at: string | null;
}

interface VisitRow {
  id: string;
  patient_id: string;
  visit_date: string;
  site_name: string;
  community: string;
  services_json: string;
  sample_folio: string | null;
  captured_by: string;
  captured_by_name: string;
  client_uuid: string | null;
  captured_offline: number;
  created_at: string;
}

export function toVisit(row: VisitRow): Visit {
  let services: ServiceCode[] = [];
  try {
    services = JSON.parse(row.services_json) as ServiceCode[];
  } catch {
    services = [];
  }
  return {
    id: row.id,
    patient_id: row.patient_id,
    visit_date: row.visit_date,
    site_name: row.site_name,
    community: row.community,
    services,
    sample_folio: row.sample_folio,
    captured_by: row.captured_by,
    captured_by_name: row.captured_by_name,
    client_uuid: row.client_uuid,
    captured_offline: row.captured_offline === 1,
    created_at: row.created_at,
  };
}

function getPatientRow(id: string): PatientRow | undefined {
  return getDb()
    .prepare(
      `SELECT id, folio, full_name, birth_date, birth_state, phone, email, preferred_channel, community,
              kiosk_id, version, created_at, updated_at
       FROM patients WHERE id = ?`
    )
    .get(id) as unknown as PatientRow | undefined;
}

export function publicPatient(row: PatientRow) {
  return {
    id: row.id,
    folio: row.folio,
    full_name: row.full_name,
    birth_date: row.birth_date,
    birth_state: row.birth_state,
    community: row.community,
    phone_masked: maskPhone(row.phone),
    email_masked: row.email ? maskContact(null, row.email) : null,
    preferred_channel: row.preferred_channel,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function nextPatientFolio(): string {
  const db = getDb();
  const year = new Date().getFullYear();
  const prefix = `PAC-${year}-`;
  const rows = db
    .prepare("SELECT folio FROM patients WHERE folio LIKE ?")
    .all(`${prefix}%`) as unknown as Array<{ folio: string }>;
  let max = 0;
  for (const r of rows) {
    const n = parseInt(r.folio.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

export interface VisitInput {
  visit_date?: string;
  site_name?: string;
  community?: string;
  services?: unknown;
  sample_folio?: string | null;
  client_uuid?: string | null;
}

function parseVisitInput(input: VisitInput, fallbackCommunity: string) {
  const services = Array.isArray(input.services)
    ? (input.services.filter((s) => VALID_SERVICES.includes(s as ServiceCode)) as ServiceCode[])
    : [];
  if (services.length === 0) {
    throw new RegistryError("Selecciona al menos un servicio válido para la visita.", 400);
  }
  const visitDate =
    typeof input.visit_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.visit_date)
      ? input.visit_date
      : new Date().toISOString().slice(0, 10);
  const siteName =
    typeof input.site_name === "string" && input.site_name.trim() ? input.site_name.trim() : "Jornada EIRA";
  const community =
    typeof input.community === "string" && input.community.trim() ? input.community.trim() : fallbackCommunity;
  const sampleFolio =
    typeof input.sample_folio === "string" && input.sample_folio.trim()
      ? input.sample_folio.trim().toUpperCase()
      : null;
  const clientUuid =
    typeof input.client_uuid === "string" && input.client_uuid.trim() ? input.client_uuid.trim() : null;
  return { services: Array.from(new Set(services)), visitDate, siteName, community, sampleFolio, clientUuid };
}

/** Registers a visit. Idempotent by client_uuid. */
export function createVisit(
  patientId: string,
  input: VisitInput,
  staff: StaffUser,
  opts: { offline?: boolean; fromMatch?: boolean; matchScore?: number } = {}
): { visit: Visit; duplicate: boolean } {
  const db = getDb();
  const patient = getPatientRow(patientId);
  if (!patient) throw new RegistryError("Paciente no encontrada.", 404);

  const v = parseVisitInput(input, patient.community);

  if (v.clientUuid) {
    const existing = db.prepare("SELECT * FROM visits WHERE client_uuid = ?").get(v.clientUuid) as
      | VisitRow
      | undefined;
    if (existing) return { visit: toVisit(existing), duplicate: true };
  }
  if (v.sampleFolio) {
    const used = db
      .prepare("SELECT patient_id FROM visits WHERE sample_folio = ?")
      .get(v.sampleFolio) as { patient_id: string } | undefined;
    if (used) {
      throw new RegistryError(
        `El folio de muestra ${v.sampleFolio} ya está registrado en otra visita.`,
        400,
        "SAMPLE_FOLIO_IN_USE"
      );
    }
  }

  const id = `vis-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO visits (id, patient_id, visit_date, site_name, community, services_json, sample_folio,
       captured_by, captured_by_name, client_uuid, captured_offline, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    patientId,
    v.visitDate,
    v.siteName,
    v.community,
    JSON.stringify(v.services),
    v.sampleFolio,
    staff.id,
    staff.name,
    v.clientUuid,
    opts.offline ? 1 : 0,
    now
  );

  logAudit({
    studyId: null,
    actorType: "staff",
    actorId: staff.id,
    actorName: staff.name,
    action: "VISITA_REGISTRADA",
    detail: {
      patient_id: patientId,
      folio: patient.folio,
      visit_id: id,
      visit_date: v.visitDate,
      services: v.services,
      sample_folio: v.sampleFolio,
      captured_offline: Boolean(opts.offline),
    },
  });
  if (opts.fromMatch) {
    logAudit({
      studyId: null,
      actorType: "staff",
      actorId: staff.id,
      actorName: staff.name,
      action: "DUPLICADO_EVITADO",
      detail: {
        patient_id: patientId,
        folio: patient.folio,
        visit_id: id,
        match_score: opts.matchScore ?? null,
        note: "Operador confirmó que es la misma paciente: se registró visita en su expediente en lugar de crear uno nuevo.",
      },
    });
  }

  const row = db.prepare("SELECT * FROM visits WHERE id = ?").get(id) as unknown as VisitRow;
  return { visit: toVisit(row), duplicate: false };
}

export interface CreatePatientResult {
  patient: ReturnType<typeof publicPatient>;
  pin_code: string;
  visit: Visit | null;
}

/**
 * Creates a patient record. NEVER silently duplicates: if candidates exist and no
 * explicit human justification is given, throws a 409 POSSIBLE_DUPLICATE with them.
 */
export function createPatient(
  input: PatientCaptureInput,
  staff: StaffUser,
  opts: {
    confirmNewReason?: string | null;
    firstVisit?: VisitInput | null;
    offline?: boolean;
    clientUuid?: string | null;
  } = {}
): CreatePatientResult {
  const db = getDb();
  const candidates = findCandidates(input);
  const reason = (opts.confirmNewReason ?? "").trim();
  if (candidates.length > 0 && reason.length < MIN_REASON_LENGTH) {
    throw new RegistryError(
      "Hay expedientes que podrían ser de la misma paciente. Confírmalo antes de crear uno nuevo.",
      409,
      "POSSIBLE_DUPLICATE",
      { candidates }
    );
  }

  // Validate the first visit BEFORE inserting anything, so a failing visit never leaves
  // a half-created record behind (patient without its visit).
  if (opts.firstVisit) {
    const fv = parseVisitInput(opts.firstVisit, input.community);
    if (fv.sampleFolio && db.prepare("SELECT 1 FROM visits WHERE sample_folio = ?").get(fv.sampleFolio)) {
      throw new RegistryError(
        `El folio de muestra ${fv.sampleFolio} ya está registrado en otra visita.`,
        400,
        "SAMPLE_FOLIO_IN_USE"
      );
    }
  }

  const channel: ContactChannel = input.phone ? "sms" : input.email ? "correo" : "kiosco_asistido";
  if (!VALID_CHANNELS.includes(channel)) throw new RegistryError("Canal inválido.", 400);

  const id = `pat-${crypto.randomUUID().slice(0, 8)}`;
  const folio = nextPatientFolio();
  const pin = String(crypto.randomInt(1000, 10000));
  const now = new Date().toISOString();

  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO patients (id, folio, full_name, birth_date, phone, email, preferred_channel, community,
         kiosk_id, pin_code, created_at, birth_state, version, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 1, ?)`
    ).run(
      id,
      folio,
      input.full_name,
      input.birth_date,
      input.phone ?? null,
      input.email ?? null,
      channel,
      input.community,
      pin,
      now,
      input.birth_state ?? null,
      now
    );

  logAudit({
    studyId: null,
    actorType: "staff",
    actorId: staff.id,
    actorName: staff.name,
    action: candidates.length > 0 ? "PACIENTE_ALTA_CON_COINCIDENCIAS" : "PACIENTE_ALTA",
    detail: {
      patient_id: id,
      folio,
      community: input.community,
      captured_offline: Boolean(opts.offline),
      client_uuid: opts.clientUuid ?? null,
      ...(candidates.length > 0
        ? {
            confirm_new_reason: reason,
            candidates_reviewed: candidates.map((c) => ({ folio: c.patient.folio, score: c.score })),
          }
        : {}),
    },
  });

  let visit: Visit | null = null;
  if (opts.firstVisit) {
    visit = createVisit(
      id,
      { ...opts.firstVisit, client_uuid: opts.clientUuid ? `${opts.clientUuid}:v1` : opts.firstVisit.client_uuid },
      staff,
      { offline: opts.offline }
    ).visit;
  }

    db.exec("COMMIT");
    return { patient: publicPatient(getPatientRow(id)!), pin_code: pin, visit };
  } catch (err) {
    // Patient, audit entry and first visit are atomic: all or nothing.
    db.exec("ROLLBACK");
    throw err;
  }
}

const EDITABLE_FIELDS = ["phone", "email", "community", "birth_state", "preferred_channel"] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];

/** Updates only the provided contact fields with optimistic concurrency + field-level audit. */
export function updatePatient(
  patientId: string,
  baseVersion: unknown,
  changes: unknown,
  staff: StaffUser,
  opts: { offline?: boolean } = {}
) {
  const db = getDb();
  const row = getPatientRow(patientId);
  if (!row) throw new RegistryError("Paciente no encontrada.", 404);
  if (typeof baseVersion !== "number") {
    throw new RegistryError("Falta base_version (versión del expediente que editaste).", 400);
  }
  if (baseVersion !== row.version) {
    throw new RegistryError(
      "Otro dispositivo modificó este expediente después de que lo abriste.",
      409,
      "VERSION_CONFLICT",
      { current: publicPatient(row) }
    );
  }
  if (!changes || typeof changes !== "object") throw new RegistryError("Sin cambios.", 400);

  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (!(field in (changes as Record<string, unknown>))) continue;
    const raw = (changes as Record<string, unknown>)[field];
    const value = typeof raw === "string" && raw.trim() ? raw.trim() : null;
    if (field === "community" && !value) throw new RegistryError("La comunidad no puede quedar vacía.", 400);
    if (field === "preferred_channel" && !VALID_CHANNELS.includes(value as ContactChannel)) {
      throw new RegistryError("Canal de contacto inválido.", 400);
    }
    const current = (row as unknown as Record<EditableField, unknown>)[field] ?? null;
    if (current === value) continue;
    before[field] = field === "phone" ? maskPhone(current as string | null) : current;
    after[field] = field === "phone" ? maskPhone(value) : value;
    db.prepare(`UPDATE patients SET ${field} = ? WHERE id = ?`).run(value, patientId);
  }

  const changed = Object.keys(after);
  if (changed.length > 0) {
    db.prepare("UPDATE patients SET version = version + 1, updated_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      patientId
    );
    logAudit({
      studyId: null,
      actorType: "staff",
      actorId: staff.id,
      actorName: staff.name,
      action: "PACIENTE_ACTUALIZADO",
      detail: { patient_id: patientId, folio: row.folio, before, after, captured_offline: Boolean(opts.offline) },
    });
  }
  return { patient: publicPatient(getPatientRow(patientId)!), changed_fields: changed };
}

interface StudyRowForHistory {
  id: string;
  sample_folio: string;
  pseudonym_code: string;
  status: StudyStatus;
  collection_date: string;
  site_name: string;
  priority: string;
  delivery_mode: string | null;
  clinical_note_internal: string | null;
}

export function getPatientHistory(patientId: string, staff: StaffUser) {
  const db = getDb();
  const row = getPatientRow(patientId);
  if (!row) throw new RegistryError("Paciente no encontrada.", 404);

  const visits = (
    db
      .prepare("SELECT * FROM visits WHERE patient_id = ? ORDER BY visit_date DESC, created_at DESC")
      .all(patientId) as unknown as VisitRow[]
  ).map(toVisit);

  const canSeeClinical = staff.role === "medico";
  const studies = (
    db
      .prepare(
        `SELECT id, sample_folio, pseudonym_code, status, collection_date, site_name, priority, delivery_mode,
                clinical_note_internal
         FROM studies WHERE patient_id = ? ORDER BY collection_date DESC`
      )
      .all(patientId) as unknown as StudyRowForHistory[]
  ).map((s) => ({
    ...s,
    status_label: STATUS_LABELS[s.status] ?? s.status,
    clinical_note_internal: canSeeClinical ? s.clinical_note_internal : null,
  }));

  const audit = (
    db
      .prepare(
        `SELECT id, action, actor_name, created_at, detail_json FROM audit_logs
         WHERE detail_json LIKE ? ORDER BY created_at DESC LIMIT 50`
      )
      .all(`%"patient_id":"${patientId.replace(/[%_"]/g, "")}"%`) as unknown as Array<{
      id: string;
      action: string;
      actor_name: string;
      created_at: string;
      detail_json: string;
    }>
  ).map((a) => {
    let detail: Record<string, unknown> = {};
    try {
      detail = JSON.parse(a.detail_json) as Record<string, unknown>;
    } catch {
      detail = {};
    }
    return { id: a.id, action: a.action, actor_name: a.actor_name, created_at: a.created_at, detail };
  });

  return { patient: publicPatient(row), visits, studies, audit };
}

export function suggestPatientForStudy(studyId: string) {
  const db = getDb();
  const study = db.prepare("SELECT sample_folio FROM studies WHERE id = ?").get(studyId) as
    | { sample_folio: string }
    | undefined;
  if (!study) throw new RegistryError("Estudio no encontrado.", 404);
  const visitRow = db
    .prepare("SELECT * FROM visits WHERE sample_folio = ? ORDER BY created_at DESC LIMIT 1")
    .get(study.sample_folio) as VisitRow | undefined;
  if (!visitRow) return null;
  const patient = getPatientRow(visitRow.patient_id);
  if (!patient) return null;
  const visit = toVisit(visitRow);
  return {
    patient: {
      id: patient.id,
      folio: patient.folio,
      full_name: patient.full_name,
      birth_date: patient.birth_date,
      community: patient.community,
    },
    visit,
    reason: `Folio de muestra ${study.sample_folio} registrado en la visita del ${visit.visit_date} (${visit.site_name}).`,
  };
}

export function getRegistryStats() {
  const db = getDb();
  const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    unique_patients: one("SELECT COUNT(*) AS n FROM patients"),
    total_visits: one("SELECT COUNT(*) AS n FROM visits"),
    recurrent_patients: one(
      "SELECT COUNT(*) AS n FROM (SELECT patient_id FROM visits GROUP BY patient_id HAVING COUNT(*) >= 2)"
    ),
    duplicates_prevented: one("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'DUPLICADO_EVITADO'"),
    offline_synced_visits: one("SELECT COUNT(*) AS n FROM visits WHERE captured_offline = 1"),
  };
}

export type { MatchCandidate };
export { MATCH_POSSIBLE_THRESHOLD };

/** Maps a RegistryError (or unexpected error) to a JSON response. */
export function registryErrorResponse(err: unknown): Response {
  if (err instanceof RegistryError) {
    return Response.json(
      { error: err.message, ...(err.code ? { code: err.code } : {}), ...(err.payload ?? {}) },
      { status: err.status, headers: { "Cache-Control": "no-store" } }
    );
  }
  console.error("[registry] unexpected error", err);
  return Response.json(
    { error: "Error interno al procesar el expediente." },
    { status: 500, headers: { "Cache-Control": "no-store" } }
  );
}
