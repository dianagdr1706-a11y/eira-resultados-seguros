import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { getStaffSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import type { IdentityChecklist, Patient, Study, StudyWithPatient } from "@/lib/types";

export const dynamic = "force-dynamic";

type PublicPatient = Omit<Patient, "pin_code">;

interface AssociateBody {
  patient_id?: unknown;
  checklist?: {
    name_matches?: unknown;
    dob_or_folio_matches?: unknown;
    pdf_legible_complete?: unknown;
    notes?: unknown;
  };
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
  if (staff.role !== "eira_admin" && staff.role !== "laboratorio") {
    return NextResponse.json(
      { error: "Permisos insuficientes: solo administración EIRA o laboratorio pueden asociar estudios." },
      { status: 403 }
    );
  }

  let body: AssociateBody;
  try {
    body = (await request.json()) as AssociateBody;
  } catch {
    return NextResponse.json({ error: "Cuerpo JSON inválido." }, { status: 400 });
  }

  const patientId = typeof body.patient_id === "string" ? body.patient_id.trim() : "";
  if (!patientId) {
    return NextResponse.json(
      { error: "Debe seleccionar una paciente (patient_id) para asociar el estudio." },
      { status: 400 }
    );
  }

  const checklist = body.checklist;
  if (
    !checklist ||
    checklist.name_matches !== true ||
    checklist.dob_or_folio_matches !== true ||
    checklist.pdf_legible_complete !== true
  ) {
    return NextResponse.json(
      {
        error:
          "Verificación anti-homonimia incompleta: los 3 puntos del checklist (nombre, fecha de nacimiento/folio y PDF legible y completo) deben confirmarse en true antes de asociar.",
      },
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

  if (study.clinical_authorized_at !== null) {
    return NextResponse.json(
      { error: "No es posible reasociar un estudio que ya cuenta con autorización clínica." },
      { status: 409 }
    );
  }

  const patient = db
    .prepare(
      "SELECT id, folio, full_name, birth_date, phone, email, preferred_channel, community, kiosk_id, created_at FROM patients WHERE id = ?"
    )
    .get(patientId) as unknown as PublicPatient | undefined;

  if (!patient) {
    return NextResponse.json({ error: "Paciente no encontrada." }, { status: 404 });
  }

  const now = new Date().toISOString();
  const notes =
    typeof checklist.notes === "string" && checklist.notes.trim()
      ? checklist.notes.trim()
      : undefined;

  const checklistRecord: IdentityChecklist = {
    name_matches: true,
    dob_or_folio_matches: true,
    pdf_legible_complete: true,
    verified_by: staff.name,
    verified_at: now,
    ...(notes ? { notes } : {}),
  };

  db.prepare(
    `UPDATE studies
     SET patient_id = ?,
         identity_checklist_json = ?,
         status = 'asociado',
         admin_reviewed_by = NULL,
         admin_reviewed_at = NULL,
         updated_at = ?
     WHERE id = ?`
  ).run(patient.id, JSON.stringify(checklistRecord), now, id);

  const updatedStudy = db
    .prepare("SELECT * FROM studies WHERE id = ?")
    .get(id) as unknown as Study;

  logAudit({
    studyId: id,
    actorType: "staff",
    actorId: staff.id,
    actorName: staff.name,
    action: "IDENTIDAD_ASOCIADA",
    detail: {
      patient_id: patient.id,
      patient_folio: patient.folio,
      checklist: checklistRecord,
    },
  });

  const studyWithPatient: StudyWithPatient = {
    ...updatedStudy,
    patient,
  };

  return NextResponse.json(
    { study: studyWithPatient },
    { headers: { "Cache-Control": "no-store" } }
  );
}
