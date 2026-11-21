import crypto from "node:crypto";
import { getDb } from "./db";

const FORBIDDEN_CLINICAL_TERMS = [
  "cancer",
  "cáncer",
  "carcinoma",
  "lesion",
  "lesión",
  "displasia",
  "positivo",
  "anormal",
  "maligno",
  "malignidad",
  "hsil",
  "lsil",
  "asc-us",
  "nic ",
  "colposcop",
];

/**
 * Privacy-by-design guard: prevents accidental leakage of clinical findings
 * in SMS, email, kiosk Wi-Fi, or LoRa/Mesh notifications.
 */
export function assertNoClinicalLeak(message: string): void {
  const lower = message.toLowerCase();
  for (const term of FORBIDDEN_CLINICAL_TERMS) {
    if (lower.includes(term)) {
      throw new Error(`Violación de privacidad: la notificación contiene término clínico prohibido ("${term}").`);
    }
  }
}

export function maskContact(phone: string | null, email: string | null): string {
  if (phone) {
    const clean = phone.replace(/\s+/g, "");
    return clean.length > 4 ? `${clean.slice(0, 3)}*****${clean.slice(-4)}` : "****";
  }
  if (email && email.includes("@")) {
    const [u, domain] = email.split("@");
    return `${u.slice(0, 2)}***@${domain}`;
  }
  return "Sin teléfono/correo (Vía Kiosco Asistido)";
}

export function logAudit(params: {
  studyId: string | null;
  actorType: "staff" | "patient" | "system" | "kiosk";
  actorId: string;
  actorName: string;
  action: string;
  detail: Record<string, unknown>;
}): void {
  const db = getDb();
  db.prepare(
    "INSERT INTO audit_logs (id, study_id, actor_type, actor_id, actor_name, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    `aud-${crypto.randomUUID().slice(0, 8)}`,
    params.studyId,
    params.actorType,
    params.actorId,
    params.actorName,
    params.action,
    JSON.stringify(params.detail),
    new Date().toISOString()
  );
}
