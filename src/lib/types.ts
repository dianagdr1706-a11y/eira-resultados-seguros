export type StaffRole = "laboratorio" | "eira_admin" | "medico" | "promotora_kiosco";

export type StudyStatus =
  | "cargado"
  | "asociado"
  | "revision_admin"
  | "pendiente_clinica"
  | "devuelto"
  | "autorizado_digital"
  | "autorizado_acompanado"
  | "notificado"
  | "consultado"
  | "entregado_asistido";

export type StudyPriority = "rutinario" | "prioritario";

export type ContactChannel = "sms" | "correo" | "kiosco_asistido";

export type LoopChannel =
  | "sms_neutro"
  | "correo_neutro"
  | "kiosco_wifi_local"
  | "lora_modulo_comunitario"
  | "nearby_p2p_brigadista"
  | "escalamiento_promotora";

export type LoopStatus = "inactivo" | "activo" | "escalado_promotora" | "cerrado_ack";

export interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  license_number: string | null;
  community: string | null;
}

export interface Patient {
  id: string;
  folio: string;
  full_name: string;
  birth_date: string; // YYYY-MM-DD
  phone: string | null;
  email: string | null;
  preferred_channel: ContactChannel;
  community: string;
  kiosk_id: string | null;
  pin_code: string; // 4-digit fallback PIN printed on clinic slip (never exposed in public lists)
  created_at: string;
  /** Reto 1: entidad de nacimiento (campo 2 del formato en papel). */
  birth_state?: string | null;
  /** Reto 1: optimistic-concurrency version for offline edits. */
  version?: number;
  updated_at?: string | null;
}

// ---------------------------------------------------------------------------
// Reto 1 · Expediente digital único
// ---------------------------------------------------------------------------

export type ServiceCode =
  | "papanicolaou"
  | "prueba_vph"
  | "exploracion_mama"
  | "mastografia"
  | "consejeria";

export const SERVICE_LABELS: Record<ServiceCode, string> = {
  papanicolaou: "Papanicolaou (citología)",
  prueba_vph: "Prueba de VPH",
  exploracion_mama: "Exploración clínica de mama",
  mastografia: "Mastografía",
  consejeria: "Consejería / orientación",
};

/** One attendance of a patient to a jornada / kiosk. Services are recorded per visit. */
export interface Visit {
  id: string;
  patient_id: string;
  visit_date: string; // YYYY-MM-DD
  site_name: string;
  community: string;
  services: ServiceCode[];
  /** Folio of the Pap sample taken in this visit; bridges Reto 1 -> Reto 4 (studies.sample_folio). */
  sample_folio: string | null;
  captured_by: string;
  captured_by_name: string;
  /** Client-generated UUID for idempotent offline sync. */
  client_uuid: string | null;
  captured_offline: boolean;
  created_at: string;
}

/** Data captured at registration time (paper form "Solicitud y Reporte de Citología Cervical"). */
export interface PatientCaptureInput {
  full_name: string;
  birth_date: string; // YYYY-MM-DD
  birth_state?: string | null; // campo 2: entidad de nacimiento
  phone?: string | null;
  email?: string | null;
  community: string;
}

export type MatchLevel = "probable" | "posible";

export interface MatchReason {
  code:
    | "dob_exact"
    | "dob_day_month_swapped"
    | "name_very_similar"
    | "name_similar"
    | "surnames_equal"
    | "phone_equal"
    | "birth_state_equal"
    | "community_equal";
  points: number;
  label: string; // human readable, Spanish
}

export interface MatchCandidate {
  patient: {
    id: string;
    folio: string;
    full_name: string;
    birth_date: string;
    birth_state: string | null;
    community: string;
    phone_masked: string | null;
    visits_count: number;
    last_visit_date: string | null;
  };
  score: number; // 0-115
  level: MatchLevel;
  reasons: MatchReason[];
}

export interface IdentityChecklist {
  name_matches: boolean;
  dob_or_folio_matches: boolean;
  pdf_legible_complete: boolean;
  verified_by: string;
  verified_at: string;
  notes?: string;
}

export interface Study {
  id: string;
  sample_folio: string;
  pseudonym_code: string; // Used in mesh/LoRa/kiosk alerts so zero PII/diagnoses leak
  patient_id: string | null;
  collection_date: string;
  site_name: string;
  community: string;
  status: StudyStatus;
  priority: StudyPriority;
  delivery_mode: "digital" | "acompanado" | null;
  pdf_filename: string | null;
  pdf_original_name: string | null;
  pdf_sha256: string | null;
  pdf_size_bytes: number | null;
  identity_checklist_json: string | null;
  admin_reviewed_by: string | null;
  admin_reviewed_at: string | null;
  clinical_authorized_by: string | null;
  clinical_authorized_at: string | null;
  clinical_note_internal: string | null; // NEVER sent in notifications
  loop_status: LoopStatus;
  loop_level: number; // 0..4
  loop_attempts: number;
  simulated_hours_elapsed: number;
  ack_received_at: string | null;
  ack_method: string | null;
  created_at: string;
  updated_at: string;
}

export interface StudyWithPatient extends Study {
  patient: Omit<Patient, "pin_code"> | null;
}

export interface NotificationRecord {
  id: string;
  study_id: string;
  channel: LoopChannel;
  recipient_masked: string;
  neutral_message: string;
  pseudonym_code: string;
  delivery_status: "simulado" | "enviado" | "fallido";
  is_simulated: number;
  created_at: string;
}

export interface LoopEvent {
  id: string;
  study_id: string;
  level: number;
  channel: LoopChannel;
  pseudonym_code: string;
  payload_preview: string;
  hours_mark: number;
  status: "emitido" | "detenido_ack";
  created_at: string;
}

export interface AssistedDelivery {
  id: string;
  study_id: string;
  kiosk_id: string | null;
  modality: "kiosco_presencial" | "brigadista_offline" | "llamada_verificada" | "orientacion_medica";
  operator_id: string;
  operator_name: string;
  ack_folio: string;
  notes: string;
  synced_from_offline: number;
  delivered_at: string;
}

export interface AuditLog {
  id: string;
  study_id: string | null;
  actor_type: "staff" | "patient" | "system" | "kiosk";
  actor_id: string;
  actor_name: string;
  action: string;
  detail_json: string;
  created_at: string;
}

export interface KioskNode {
  id: string;
  name: string;
  community: string;
  hardware_profile: string;
  hotspot_ssid: string;
  lora_channel: string;
  last_sync_at: string | null;
}

export const STATUS_LABELS: Record<StudyStatus, string> = {
  cargado: "PDF Cargado (Sin asociar)",
  asociado: "Asociado (Por revisar)",
  revision_admin: "En Revisión Admin",
  pendiente_clinica: "Pendiente Autorización Clínica",
  devuelto: "Devuelto a Corrección",
  autorizado_digital: "Autorizado (Entrega Digital)",
  autorizado_acompanado: "Autorizado (Entrega Acompañada)",
  notificado: "Notificado (Sin consultar)",
  consultado: "Consultado / Descargado",
  entregado_asistido: "Entregado (Vía Asistida / Kiosco)",
};
