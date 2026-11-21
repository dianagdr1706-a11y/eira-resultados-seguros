import { NextRequest, NextResponse } from "next/server";
import { getPatientSession } from "@/lib/auth";
import { ensureSeedPdfs, getDb } from "@/lib/db";
import { stopLoopWithAck } from "@/lib/loop-engine";
import type { Patient, Study } from "@/lib/types";

interface PatientAckBody {
  study_id?: string;
  method?: string;
}

export async function POST(request: NextRequest) {
  await ensureSeedPdfs();

  const session = await getPatientSession();
  if (!session) {
    return NextResponse.json(
      { error: "Sesión de paciente requerida para confirmar recepción." },
      { status: 401 }
    );
  }

  let body: PatientAckBody;
  try {
    body = (await request.json()) as PatientAckBody;
  } catch {
    return NextResponse.json({ error: "Cuerpo JSON inválido." }, { status: 400 });
  }

  const studyId = typeof body.study_id === "string" ? body.study_id.trim() : "";
  if (!studyId) {
    return NextResponse.json({ error: "El campo study_id es obligatorio." }, { status: 400 });
  }

  const db = getDb();
  const study = db.prepare("SELECT * FROM studies WHERE id = ?").get(studyId) as Study | undefined;
  if (!study || study.patient_id !== session.patientId) {
    return NextResponse.json(
      { error: "Estudio no encontrado o no pertenece a tu expediente." },
      { status: 404 }
    );
  }

  const patient = db
    .prepare("SELECT full_name FROM patients WHERE id = ?")
    .get(session.patientId) as Pick<Patient, "full_name"> | undefined;

  const ackMethod =
    typeof body.method === "string" && body.method.trim().length > 0
      ? body.method.trim()
      : "portal_paciente_ack";

  if (study.status === "notificado" || study.status === "autorizado_digital") {
    db.prepare("UPDATE studies SET status = 'consultado', updated_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      study.id
    );
  }

  const updatedStudy = stopLoopWithAck(
    study.id,
    ackMethod,
    session.patientId,
    patient?.full_name ?? session.folio,
    undefined,
    "patient"
  );

  return NextResponse.json({ ok: true, study: updatedStudy });
}
