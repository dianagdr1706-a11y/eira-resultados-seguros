import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { assertNoClinicalLeak, logAudit, maskContact } from "@/lib/audit";
import { getStaffSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import type {
  LoopChannel,
  Patient,
  Study,
  StudyPriority,
  StudyStatus,
  StudyWithPatient,
} from "@/lib/types";

export const dynamic = "force-dynamic";

type PublicPatient = Omit<Patient, "pin_code">;

interface ReviewBody {
  stage?: unknown;
  decision?: unknown;
  comments?: unknown;
  delivery_mode?: unknown;
  priority?: unknown;
}

function selectNotificationChannel(patient: PublicPatient): LoopChannel {
  if (patient.preferred_channel === "kiosco_asistido") {
    return "kiosco_wifi_local";
  }
  if (patient.preferred_channel === "sms" && patient.phone) {
    return "sms_neutro";
  }
  if (patient.preferred_channel === "correo" && patient.email) {
    return "correo_neutro";
  }
  if (patient.phone) {
    return "sms_neutro";
  }
  if (patient.email) {
    return "correo_neutro";
  }
  return "kiosco_wifi_local";
}

function buildNeutralNotification(
  channel: LoopChannel,
  patient: PublicPatient,
  study: Study,
  deliveryMode: "digital" | "acompanado"
): { recipientMasked: string; neutralMessage: string; loopPreview: string } {
  let recipientMasked: string;
  let neutralMessage: string;
  let loopPreview: string;

  if (channel === "kiosco_wifi_local") {
    const nodeLabel = patient.kiosk_id || `Módulo ${patient.community}`;
    recipientMasked = patient.kiosk_id
      ? `Nodo ${patient.kiosk_id} (Sin celular)`
      : `Módulo Comunitario ${patient.community}`;

    neutralMessage =
      deliveryMode === "acompanado"
        ? `Aviso comunitario pseudonimizado para código ${study.pseudonym_code}: acudir al módulo comunitario de ${patient.community} o contactar a la promotora EIRA para entrega acompañada.`
        : `Aviso comunitario pseudonimizado para código ${study.pseudonym_code}: documento disponible en el módulo comunitario de ${patient.community} con tarjeta QR o folio.`;

    loopPreview = `[Nivel 1 · Kiosco RPi Wi-Fi Local] Paquete cifrado sincronizado en ${nodeLabel} para ${study.pseudonym_code} (0 datos clínicos).`;
  } else if (channel === "sms_neutro") {
    recipientMasked = maskContact(patient.phone, null);
    neutralMessage =
      deliveryMode === "acompanado"
        ? `EIRA: Tu documento de estudio ya está listo para orientación acompañada. Ingresa al portal seguro con tu folio ${patient.folio} y fecha de nacimiento o acude a tu módulo EIRA. Sin enlaces públicos.`
        : `EIRA: Tu documento de estudio ya está disponible en el portal seguro usando tu folio ${patient.folio} y fecha de nacimiento. Sin enlaces públicos.`;

    loopPreview = `[Nivel 1 · SMS Neutro] Código ${study.pseudonym_code}: documento listo en portal seguro EIRA (0 datos clínicos).`;
  } else {
    recipientMasked = maskContact(null, patient.email);
    neutralMessage =
      deliveryMode === "acompanado"
        ? `EIRA: Tu documento de estudio ya está listo para orientación acompañada. Ingresa al portal seguro con tu folio ${patient.folio} y fecha de nacimiento o acude a tu módulo EIRA. Sin enlaces públicos.`
        : `EIRA: Tu documento de estudio ya está disponible en el portal seguro usando tu folio ${patient.folio} y fecha de nacimiento. Sin enlaces públicos.`;

    loopPreview = `[Nivel 1 · Correo Neutro] Código ${study.pseudonym_code}: documento listo en portal seguro EIRA (0 datos clínicos).`;
  }

  // Privacy-by-design assertion: guarantee zero clinical terms leak
  assertNoClinicalLeak(neutralMessage);
  assertNoClinicalLeak(loopPreview);

  return { recipientMasked, neutralMessage, loopPreview };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const staff = await getStaffSession();
  if (!staff) {
    return NextResponse.json(
      { error: "Autenticación de personal requerida." },
      { status: 401 }
    );
  }

  let body: ReviewBody;
  try {
    body = (await request.json()) as ReviewBody;
  } catch {
    return NextResponse.json({ error: "Cuerpo JSON inválido." }, { status: 400 });
  }

  const stage = body.stage;
  const decision = body.decision;
  const comments = typeof body.comments === "string" ? body.comments.trim() : "";

  if (stage !== "administrativa" && stage !== "clinica") {
    return NextResponse.json(
      { error: "Etapa inválida: debe ser 'administrativa' o 'clinica'." },
      { status: 400 }
    );
  }

  if (decision !== "aprobado" && decision !== "rechazado") {
    return NextResponse.json(
      { error: "Decisión inválida: debe ser 'aprobado' o 'rechazado'." },
      { status: 400 }
    );
  }

  const { id } = await context.params;
  const db = getDb();

  const study = db
    .prepare("SELECT * FROM studies WHERE id = ?")
    .get(id) as unknown as Study | undefined;

  if (!study) {
    return NextResponse.json({ error: "Estudio no encontrado." }, { status: 404 });
  }

  const now = new Date().toISOString();

  // GATE 1: ADMINISTRATIVE REVIEW
  if (stage === "administrativa") {
    if (staff.role !== "eira_admin") {
      return NextResponse.json(
        { error: "Permisos insuficientes: la revisión administrativa solo puede realizarla personal eira_admin." },
        { status: 403 }
      );
    }

    if (!study.patient_id || !study.identity_checklist_json) {
      return NextResponse.json(
        { error: "El estudio debe estar asociado a una paciente con checklist anti-homonimia antes de la revisión administrativa." },
        { status: 400 }
      );
    }

    if (study.clinical_authorized_at !== null) {
      return NextResponse.json(
        { error: "Este estudio ya cuenta con autorización clínica y no puede volver a revisión administrativa." },
        { status: 409 }
      );
    }

    const reviewId = `rev-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      "INSERT INTO reviews (id, study_id, stage, decision, comments, reviewer_id, reviewer_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(reviewId, id, "administrativa", decision, comments, staff.id, staff.name, now);

    if (decision === "aprobado") {
      db.prepare(
        `UPDATE studies
         SET status = 'pendiente_clinica',
             admin_reviewed_by = ?,
             admin_reviewed_at = ?,
             updated_at = ?
         WHERE id = ?`
      ).run(staff.name, now, now, id);
    } else {
      db.prepare(
        `UPDATE studies
         SET status = 'devuelto',
             admin_reviewed_by = NULL,
             admin_reviewed_at = NULL,
             updated_at = ?
         WHERE id = ?`
      ).run(now, id);
    }

    logAudit({
      studyId: id,
      actorType: "staff",
      actorId: staff.id,
      actorName: staff.name,
      action: "REVISION_ADMINISTRATIVA",
      detail: {
        review_id: reviewId,
        decision,
        new_status: decision === "aprobado" ? "pendiente_clinica" : "devuelto",
        comments,
      },
    });
  } else {
    // GATE 2: CLINICAL AUTHORIZATION
    if (staff.role !== "medico") {
      return NextResponse.json(
        { error: "Permisos insuficientes: la autorización clínica solo puede realizarla personal con rol medico." },
        { status: 403 }
      );
    }

    if (!study.patient_id) {
      return NextResponse.json(
        { error: "El estudio no tiene paciente asociada." },
        { status: 400 }
      );
    }

    if (study.admin_reviewed_at === null) {
      return NextResponse.json(
        {
          error:
            "Doble candado activo: el estudio debe aprobar primero la revisión administrativa antes de la autorización clínica.",
        },
        { status: 400 }
      );
    }

    if (study.clinical_authorized_at !== null) {
      return NextResponse.json(
        { error: "Este estudio ya cuenta con autorización clínica registrada." },
        { status: 409 }
      );
    }

    const patient = db
      .prepare(
        "SELECT id, folio, full_name, birth_date, phone, email, preferred_channel, community, kiosk_id, created_at FROM patients WHERE id = ?"
      )
      .get(study.patient_id) as unknown as PublicPatient | undefined;

    if (!patient) {
      return NextResponse.json(
        { error: "La paciente asociada al estudio no existe." },
        { status: 404 }
      );
    }

    const reviewId = `rev-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      "INSERT INTO reviews (id, study_id, stage, decision, comments, reviewer_id, reviewer_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(reviewId, id, "clinica", decision, comments, staff.id, staff.name, now);

    if (decision === "rechazado") {
      db.prepare(
        `UPDATE studies
         SET status = 'devuelto',
             admin_reviewed_by = NULL,
             admin_reviewed_at = NULL,
             updated_at = ?
         WHERE id = ?`
      ).run(now, id);

      logAudit({
        studyId: id,
        actorType: "staff",
        actorId: staff.id,
        actorName: staff.name,
        action: "AUTORIZACION_CLINICA",
        detail: {
          review_id: reviewId,
          decision: "rechazado",
          new_status: "devuelto",
        },
      });
    } else {
      const priority: StudyPriority =
        body.priority === "prioritario"
          ? "prioritario"
          : body.priority === "rutinario"
            ? "rutinario"
            : study.priority;

      let deliveryMode: "digital" | "acompanado";
      if (body.delivery_mode === "digital" || body.delivery_mode === "acompanado") {
        deliveryMode = body.delivery_mode;
      } else {
        deliveryMode = priority === "prioritario" ? "acompanado" : "digital";
      }

      const newStatus: StudyStatus =
        deliveryMode === "acompanado" ? "autorizado_acompanado" : "notificado";

      const clinicalAuthorizedBy = `${staff.name}${
        staff.license_number ? ` (${staff.license_number})` : ""
      }`;

      const channel = selectNotificationChannel(patient);
      const { recipientMasked, neutralMessage, loopPreview } = buildNeutralNotification(
        channel,
        patient,
        study,
        deliveryMode
      );

      db.prepare(
        `UPDATE studies
         SET status = ?,
             priority = ?,
             delivery_mode = ?,
             clinical_authorized_by = ?,
             clinical_authorized_at = ?,
             clinical_note_internal = ?,
             loop_status = 'activo',
             loop_level = 1,
             loop_attempts = 1,
             simulated_hours_elapsed = 0,
             updated_at = ?
         WHERE id = ?`
      ).run(
        newStatus,
        priority,
        deliveryMode,
        clinicalAuthorizedBy,
        now,
        comments || null,
        now,
        id
      );

      const notifId = `notif-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(
        `INSERT INTO notifications (
          id, study_id, channel, recipient_masked, neutral_message, pseudonym_code, delivery_status, is_simulated, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'simulado', 1, ?)`
      ).run(notifId, id, channel, recipientMasked, neutralMessage, study.pseudonym_code, now);

      const loopId = `loop-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(
        `INSERT INTO loop_events (
          id, study_id, level, channel, pseudonym_code, payload_preview, hours_mark, status, created_at
        ) VALUES (?, ?, 1, ?, ?, ?, 0, 'emitido', ?)`
      ).run(loopId, id, channel, study.pseudonym_code, loopPreview, now);

      logAudit({
        studyId: id,
        actorType: "staff",
        actorId: staff.id,
        actorName: staff.name,
        action: "AUTORIZACION_CLINICA",
        detail: {
          review_id: reviewId,
          decision: "aprobado",
          delivery_mode: deliveryMode,
          priority,
          new_status: newStatus,
          clinical_authorized_by: clinicalAuthorizedBy,
          loop_started: true,
        },
      });

      logAudit({
        studyId: id,
        actorType: "system",
        actorId: "eira-notifier",
        actorName: "Motor de Notificación Neutra EIRA",
        action: "NOTIFICACION_NEUTRA_EMITIDA",
        detail: {
          notification_id: notifId,
          loop_event_id: loopId,
          channel,
          recipient_masked: recipientMasked,
          pseudonym_code: study.pseudonym_code,
          zero_clinical_leak_verified: true,
        },
      });
    }
  }

  const updatedStudy = db
    .prepare("SELECT * FROM studies WHERE id = ?")
    .get(id) as unknown as Study;

  let patient: PublicPatient | null = null;
  if (updatedStudy.patient_id) {
    const row = db
      .prepare(
        "SELECT id, folio, full_name, birth_date, phone, email, preferred_channel, community, kiosk_id, created_at FROM patients WHERE id = ?"
      )
      .get(updatedStudy.patient_id) as unknown as PublicPatient | undefined;
    patient = row ?? null;
  }

  const studyWithPatient: StudyWithPatient = {
    ...updatedStudy,
    patient,
  };

  return NextResponse.json(
    { study: studyWithPatient },
    { headers: { "Cache-Control": "no-store" } }
  );
}
