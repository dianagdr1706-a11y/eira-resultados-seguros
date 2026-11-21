import { NextResponse } from "next/server";
import { requireStaffApi } from "@/lib/auth";
import { ensureSeedPdfs, getDb } from "@/lib/db";
import type {
  AssistedDelivery,
  AuditLog,
  LoopEvent,
  NotificationRecord,
  Patient,
  Study,
  StudyWithPatient,
} from "@/lib/types";

export const dynamic = "force-dynamic";

type PublicPatient = Omit<Patient, "pin_code">;

interface ReviewRecord {
  id: string;
  study_id: string;
  stage: string;
  decision: string;
  comments: string;
  reviewer_id: string;
  reviewer_name: string;
  created_at: string;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireStaffApi();
  if (auth.response) return auth.response;
  await ensureSeedPdfs();
  const { id } = await context.params;
  const db = getDb();
  const staff = auth.staff;
  const canSeeClinicalNote = staff?.role === "medico";

  const study = db
    .prepare("SELECT * FROM studies WHERE id = ?")
    .get(id) as unknown as Study | undefined;

  if (!study) {
    return NextResponse.json({ error: "Estudio no encontrado." }, { status: 404 });
  }

  let patient: PublicPatient | null = null;
  if (study.patient_id) {
    const row = db
      .prepare(
        "SELECT id, folio, full_name, birth_date, phone, email, preferred_channel, community, kiosk_id, created_at FROM patients WHERE id = ?"
      )
      .get(study.patient_id) as unknown as PublicPatient | undefined;
    patient = row ?? null;
  }

  const studyWithPatient: StudyWithPatient = {
    ...study,
    clinical_note_internal: canSeeClinicalNote ? study.clinical_note_internal : null,
    patient,
  };

  const rawReviews = db
    .prepare("SELECT * FROM reviews WHERE study_id = ? ORDER BY created_at DESC")
    .all(id) as unknown as ReviewRecord[];

  const reviews = rawReviews.map((rev) =>
    rev.stage === "clinica" && !canSeeClinicalNote
      ? { ...rev, comments: "" }
      : rev
  );

  const notifications = db
    .prepare("SELECT * FROM notifications WHERE study_id = ? ORDER BY created_at DESC")
    .all(id) as unknown as NotificationRecord[];

  const loopEvents = db
    .prepare("SELECT * FROM loop_events WHERE study_id = ? ORDER BY created_at DESC, level DESC")
    .all(id) as unknown as LoopEvent[];

  const assistedDeliveries = db
    .prepare("SELECT * FROM assisted_deliveries WHERE study_id = ? ORDER BY delivered_at DESC")
    .all(id) as unknown as AssistedDelivery[];

  const auditLogs = db
    .prepare("SELECT * FROM audit_logs WHERE study_id = ? ORDER BY created_at DESC")
    .all(id) as unknown as AuditLog[];

  return NextResponse.json(
    {
      study: studyWithPatient,
      reviews,
      notifications,
      loopEvents,
      assistedDeliveries,
      auditLogs,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
