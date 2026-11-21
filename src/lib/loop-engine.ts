import crypto from "node:crypto";
import { assertNoClinicalLeak, logAudit, maskContact } from "./audit";
import { getDb } from "./db";
import type {
  LoopChannel,
  LoopEvent,
  LoopStatus,
  Patient,
  Study,
  StudyWithPatient,
} from "./types";

export interface LoraPseudonymPayload {
  pseudonym_code: string;
  kiosk_id: string;
  priority_flag: boolean;
  action: "ACUDIR_MODULO_EIRA";
}

export interface EscalationDecision {
  level: number;
  channel: LoopChannel;
  nextLoopStatus: LoopStatus;
  recipientMasked: string;
  neutralMessage: string;
  payloadPreview: string;
  loraPayload?: LoraPseudonymPayload;
}

export interface AdvanceLoopResult {
  updated_count: number;
  new_events: LoopEvent[];
  studies: StudyWithPatient[];
}

type SafePatient = Omit<Patient, "pin_code">;

function toSafePatient(row: Patient | undefined): SafePatient | null {
  if (!row) return null;
  const { pin_code: _omitted, ...safe } = row;
  void _omitted;
  return safe;
}

export function getStudyWithPatient(studyId: string): StudyWithPatient | null {
  const db = getDb();
  const study = db.prepare("SELECT * FROM studies WHERE id = ?").get(studyId) as Study | undefined;
  if (!study) return null;

  let patient: SafePatient | null = null;
  if (study.patient_id) {
    const pRow = db.prepare("SELECT * FROM patients WHERE id = ?").get(study.patient_id) as
      | Patient
      | undefined;
    patient = toSafePatient(pRow);
  }
  return { ...study, clinical_note_internal: null, patient };
}

export function getLoopTrackedStudies(): StudyWithPatient[] {
  const db = getDb();
  const studies = db
    .prepare(
      `SELECT * FROM studies
       WHERE loop_status != 'inactivo' OR clinical_authorized_at IS NOT NULL
       ORDER BY
         CASE WHEN priority = 'prioritario' THEN 0 ELSE 1 END,
         updated_at DESC`
    )
    .all() as unknown as Study[];

  const patients = db.prepare("SELECT * FROM patients").all() as unknown as Patient[];
  const patientMap = new Map<string, SafePatient>();
  for (const p of patients) {
    const safe = toSafePatient(p);
    if (safe) patientMap.set(p.id, safe);
  }

  return studies.map((s) => ({
    ...s,
    clinical_note_internal: null,
    patient: s.patient_id ? (patientMap.get(s.patient_id) ?? null) : null,
  }));
}

/**
 * Computes the next closed-loop escalation channel, level, and privacy-safe neutral payload.
 * Guarantees ZERO clinical findings or diagnoses leak in any channel.
 */
export function computeNextEscalation(
  study: Study,
  patient: SafePatient | Patient | null,
  newHoursElapsed: number
): EscalationDecision {
  const isPriority = study.priority === "prioritario";
  const hasPhone = Boolean(patient?.phone);
  const hasEmail = Boolean(patient?.email);
  const isRuralOrOffline =
    (!hasPhone && !hasEmail) || patient?.preferred_channel === "kiosco_asistido";
  const kioskId = patient?.kiosk_id || "KIOSK-SIERRA-01";
  const pseudo = study.pseudonym_code;
  const community = study.community || patient?.community || "Comunidad EIRA";

  // Level 4: >= 72h rutinario, or >= 48h prioritario -> Human Promotora Escalation
  if ((isPriority && newHoursElapsed >= 48) || newHoursElapsed >= 72) {
    const neutralMessage = `Escalamiento a promotora comunitaria EIRA (${community}) para código ${pseudo}: dar seguimiento humano respetuoso para entrega de documento. Sin datos clínicos.`;
    const payloadPreview = `[Nivel 4 · Escalamiento Promotora] Código ${pseudo} (${isPriority ? "PRIORITARIO" : "RUTINARIO"}, +${newHoursElapsed}h sin acuse) asignado a promotora en ${community}.`;
    assertNoClinicalLeak(neutralMessage);
    assertNoClinicalLeak(payloadPreview);

    return {
      level: 4,
      channel: "escalamiento_promotora",
      nextLoopStatus: "escalado_promotora",
      recipientMasked: `Promotora Comunitaria (${community})`,
      neutralMessage,
      payloadPreview,
    };
  }

  // Level 3: 48..71h rutinario, or >= 24h prioritario -> LoRa / Community Module (strictly pseudonymized JSON)
  if ((isPriority && newHoursElapsed >= 24) || newHoursElapsed >= 48) {
    const loraPayload: LoraPseudonymPayload = {
      pseudonym_code: pseudo,
      kiosk_id: kioskId,
      priority_flag: isPriority,
      action: "ACUDIR_MODULO_EIRA",
    };
    const payloadPreview = JSON.stringify(loraPayload);
    const neutralMessage = `Aviso comunitario LoRa pseudonimizado para código ${pseudo}: acudir al módulo ${kioskId} (${community}) para atención EIRA.`;
    assertNoClinicalLeak(neutralMessage);
    assertNoClinicalLeak(payloadPreview);

    return {
      level: 3,
      channel: "lora_modulo_comunitario",
      nextLoopStatus: "activo",
      recipientMasked: `Módulo LoRa ${kioskId} (Pseudonimizado)`,
      neutralMessage,
      payloadPreview,
      loraPayload,
    };
  }

  // Level 2: 24..47h -> Kiosk Wi-Fi Local or Nearby P2P Brigadista (if rural/no phone)
  if (newHoursElapsed >= 24) {
    const channel: LoopChannel = isRuralOrOffline
      ? "nearby_p2p_brigadista"
      : "kiosco_wifi_local";
    const recipientMasked =
      channel === "nearby_p2p_brigadista"
        ? `Brigadista P2P · ${community} (${kioskId})`
        : `Nodo ${kioskId} (Wi-Fi Local)`;
    const neutralMessage =
      channel === "nearby_p2p_brigadista"
        ? `Aviso P2P offline para código ${pseudo}: tu documento EIRA está disponible mediante brigadista o módulo ${kioskId}.`
        : `Recordatorio en kiosco Wi-Fi local para código ${pseudo}: puedes consultar tu documento EIRA en ${kioskId} o en el portal seguro.`;
    const payloadPreview =
      channel === "nearby_p2p_brigadista"
        ? `[Nivel 2 · Brigadista P2P Offline] Código ${pseudo} en cola cifrada de brigada comunitaria (${community}, +${newHoursElapsed}h).`
        : `[Nivel 2 · Kiosco Wi-Fi Local] Código ${pseudo} disponible en caché cifrada de ${kioskId} (+${newHoursElapsed}h).`;
    assertNoClinicalLeak(neutralMessage);
    assertNoClinicalLeak(payloadPreview);

    return {
      level: 2,
      channel,
      nextLoopStatus: "activo",
      recipientMasked,
      neutralMessage,
      payloadPreview,
    };
  }

  // Level 1: 0..23h -> SMS neutro (if phone), correo neutro (if email), else kiosco_wifi_local
  let channel: LoopChannel;
  let recipientMasked: string;
  if (hasPhone) {
    channel = "sms_neutro";
    recipientMasked = maskContact(patient?.phone ?? null, null);
  } else if (hasEmail) {
    channel = "correo_neutro";
    recipientMasked = maskContact(null, patient?.email ?? null);
  } else {
    channel = "kiosco_wifi_local";
    recipientMasked = `Nodo ${kioskId} (Sin celular)`;
  }

  const neutralMessage =
    channel === "kiosco_wifi_local"
      ? `Aviso comunitario para código ${pseudo}: tu documento EIRA ya se encuentra disponible en el módulo ${kioskId} con tu folio o tarjeta QR.`
      : `EIRA: Tu documento de estudio ya está disponible en el portal seguro usando tu folio y fecha de nacimiento. Sin enlaces públicos.`;
  const payloadPreview = `[Nivel 1 · ${channel}] Código ${pseudo}: aviso neutro emitido (+${newHoursElapsed}h, cero datos clínicos).`;

  assertNoClinicalLeak(neutralMessage);
  assertNoClinicalLeak(payloadPreview);

  return {
    level: 1,
    channel,
    nextLoopStatus: "activo",
    recipientMasked,
    neutralMessage,
    payloadPreview,
  };
}

/**
 * Advances the closed-loop time simulation (+hoursToAdd) for one or all active unacknowledged studies.
 * Studies with ACK (loop_status === 'cerrado_ack' or ack_received_at IS NOT NULL) are strictly ignored.
 */
export function advanceLoopForStudies(
  studyId?: string,
  hoursToAdd = 24
): AdvanceLoopResult {
  const db = getDb();
  const safeHours = Number.isFinite(hoursToAdd) && hoursToAdd > 0 ? Math.round(hoursToAdd) : 24;

  let targets: Study[];
  if (studyId) {
    const row = db
      .prepare(
        `SELECT * FROM studies
         WHERE id = ?
           AND clinical_authorized_at IS NOT NULL
           AND loop_status != 'cerrado_ack'
           AND ack_received_at IS NULL`
      )
      .get(studyId) as Study | undefined;
    targets = row ? [row] : [];
  } else {
    targets = db
      .prepare(
        `SELECT * FROM studies
         WHERE loop_status IN ('activo', 'escalado_promotora')
           AND ack_received_at IS NULL
         ORDER BY
           CASE WHEN priority = 'prioritario' THEN 0 ELSE 1 END,
           updated_at DESC`
      )
      .all() as unknown as Study[];
  }

  const now = new Date().toISOString();
  const newEvents: LoopEvent[] = [];

  const insertEvent = db.prepare(
    `INSERT INTO loop_events
      (id, study_id, level, channel, pseudonym_code, payload_preview, hours_mark, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertNotif = db.prepare(
    `INSERT INTO notifications
      (id, study_id, channel, recipient_masked, neutral_message, pseudonym_code, delivery_status, is_simulated, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const updateStudy = db.prepare(
    `UPDATE studies
     SET loop_status = ?,
         loop_level = ?,
         loop_attempts = loop_attempts + 1,
         simulated_hours_elapsed = ?,
         updated_at = ?
     WHERE id = ?`
  );
  const getPatient = db.prepare("SELECT * FROM patients WHERE id = ?");

  for (const study of targets) {
    const newHoursElapsed = study.simulated_hours_elapsed + safeHours;
    const patientRow = study.patient_id
      ? (getPatient.get(study.patient_id) as Patient | undefined)
      : undefined;
    const decision = computeNextEscalation(study, toSafePatient(patientRow), newHoursElapsed);

    // Final privacy guard before persisting
    assertNoClinicalLeak(decision.neutralMessage);
    assertNoClinicalLeak(decision.payloadPreview);

    const eventId = `loop-${crypto.randomUUID().slice(0, 8)}`;
    const notifId = `notif-${crypto.randomUUID().slice(0, 8)}`;

    insertEvent.run(
      eventId,
      study.id,
      decision.level,
      decision.channel,
      study.pseudonym_code,
      decision.payloadPreview,
      newHoursElapsed,
      "emitido",
      now
    );

    insertNotif.run(
      notifId,
      study.id,
      decision.channel,
      decision.recipientMasked,
      decision.neutralMessage,
      study.pseudonym_code,
      "simulado",
      1,
      now
    );

    updateStudy.run(
      decision.nextLoopStatus,
      decision.level,
      newHoursElapsed,
      now,
      study.id
    );

    newEvents.push({
      id: eventId,
      study_id: study.id,
      level: decision.level,
      channel: decision.channel,
      pseudonym_code: study.pseudonym_code,
      payload_preview: decision.payloadPreview,
      hours_mark: newHoursElapsed,
      status: "emitido",
      created_at: now,
    });
  }

  return {
    updated_count: targets.length,
    new_events: newEvents,
    studies: getLoopTrackedStudies(),
  };
}

/**
 * Immediately stops all closed-loop alerts for a study upon receipt of ACK.
 */
export function stopLoopWithAck(
  studyId: string,
  ackMethod: string,
  actorId: string,
  actorName: string,
  notes?: string,
  actorType: "staff" | "patient" | "system" | "kiosk" = "staff"
): StudyWithPatient | null {
  const db = getDb();
  const study = db.prepare("SELECT * FROM studies WHERE id = ?").get(studyId) as Study | undefined;
  if (!study) return null;

  const now = new Date().toISOString();
  const cleanMethod = ackMethod.trim() || "acuse_confirmado";

  db.prepare(
    `UPDATE studies
     SET loop_status = 'cerrado_ack',
         ack_received_at = COALESCE(ack_received_at, ?),
         ack_method = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(now, cleanMethod, now, study.id);

  const lastEvent = db
    .prepare(
      "SELECT channel FROM loop_events WHERE study_id = ? ORDER BY created_at DESC LIMIT 1"
    )
    .get(study.id) as { channel: LoopChannel } | undefined;

  const ackChannel: LoopChannel = lastEvent?.channel ?? "kiosco_wifi_local";
  const payloadPreview = `[ACK Recibido · Ciclo Cerrado] Código ${study.pseudonym_code} confirmado vía ${cleanMethod}. Alertas detenidas inmediatamente.`;
  assertNoClinicalLeak(payloadPreview);

  db.prepare(
    `INSERT INTO loop_events
      (id, study_id, level, channel, pseudonym_code, payload_preview, hours_mark, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `loop-${crypto.randomUUID().slice(0, 8)}`,
    study.id,
    study.loop_level,
    ackChannel,
    study.pseudonym_code,
    payloadPreview,
    study.simulated_hours_elapsed,
    "detenido_ack",
    now
  );

  logAudit({
    studyId: study.id,
    actorType,
    actorId,
    actorName,
    action: "LOOP_CERRADO_ACK",
    detail: {
      pseudonym_code: study.pseudonym_code,
      ack_method: cleanMethod,
      previous_loop_status: study.loop_status,
      previous_level: study.loop_level,
      notes: notes ?? null,
    },
  });

  return getStudyWithPatient(study.id);
}
