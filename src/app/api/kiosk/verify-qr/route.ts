import { NextRequest, NextResponse } from "next/server";
import { assertNoClinicalLeak } from "@/lib/audit";
import { requireStaffApi } from "@/lib/auth";
import { ensureSeedPdfs, getDb } from "@/lib/db";
import type { LoopStatus, StudyPriority, StudyStatus } from "@/lib/types";

interface VerifyQrBody {
  folio?: string;
  pseudonym_code?: string;
  birth_date?: string;
}

interface LookupRow {
  id: string;
  sample_folio: string;
  pseudonym_code: string;
  community: string;
  status: StudyStatus;
  priority: StudyPriority;
  delivery_mode: "digital" | "acompanado" | null;
  clinical_authorized_at: string | null;
  loop_status: LoopStatus;
  patient_folio: string | null;
  patient_birth_date: string | null;
}

interface TrafficLightResult {
  color: "rojo" | "verde" | "gris" | "ambar";
  label: string;
}

export async function POST(request: NextRequest) {
  const auth = await requireStaffApi(["promotora_kiosco", "eira_admin", "medico"]);
  if (auth.response) return auth.response;
  await ensureSeedPdfs();

  let body: VerifyQrBody;
  try {
    body = (await request.json()) as VerifyQrBody;
  } catch {
    return NextResponse.json({ error: "Cuerpo JSON inválido." }, { status: 400 });
  }

  const folio = typeof body.folio === "string" ? body.folio.trim().toUpperCase() : "";
  const pseudonymCode =
    typeof body.pseudonym_code === "string" ? body.pseudonym_code.trim().toUpperCase() : "";
  const birthDate = typeof body.birth_date === "string" ? body.birth_date.trim() : "";

  if (!folio && !pseudonymCode) {
    return NextResponse.json(
      { error: "Proporciona folio o pseudonym_code para consultar el semáforo." },
      { status: 400 }
    );
  }

  const db = getDb();
  let row: LookupRow | undefined;

  if (pseudonymCode) {
    row = db
      .prepare(
        `SELECT
           s.id,
           s.sample_folio,
           s.pseudonym_code,
           s.community,
           s.status,
           s.priority,
           s.delivery_mode,
           s.clinical_authorized_at,
           s.loop_status,
           p.folio AS patient_folio,
           p.birth_date AS patient_birth_date
         FROM studies s
         LEFT JOIN patients p ON s.patient_id = p.id
         WHERE UPPER(s.pseudonym_code) = ?
         LIMIT 1`
      )
      .get(pseudonymCode) as LookupRow | undefined;
  } else {
    row = db
      .prepare(
        `SELECT
           s.id,
           s.sample_folio,
           s.pseudonym_code,
           s.community,
           s.status,
           s.priority,
           s.delivery_mode,
           s.clinical_authorized_at,
           s.loop_status,
           p.folio AS patient_folio,
           p.birth_date AS patient_birth_date
         FROM studies s
         LEFT JOIN patients p ON s.patient_id = p.id
         WHERE UPPER(p.folio) = ? OR UPPER(s.sample_folio) = ?
         ORDER BY s.updated_at DESC
         LIMIT 1`
      )
      .get(folio, folio) as LookupRow | undefined;
  }

  if (!row) {
    return NextResponse.json({
      found: false,
      traffic_light: null,
      study_public_meta: null,
    });
  }

  const isClosed =
    row.status === "entregado_asistido" ||
    row.status === "consultado" ||
    row.loop_status === "cerrado_ack";

  let trafficLight: TrafficLightResult;
  if (isClosed) {
    trafficLight = {
      color: "gris",
      label: "Resultado ya entregado y ciclo cerrado",
    };
  } else if (
    row.clinical_authorized_at !== null &&
    (row.priority === "prioritario" || row.delivery_mode === "acompanado")
  ) {
    trafficLight = {
      color: "rojo",
      label:
        "Atención prioritaria: requiere entrega acompañada con personal médico/promotora EIRA",
    };
  } else if (row.clinical_authorized_at !== null && row.delivery_mode === "digital") {
    trafficLight = {
      color: "verde",
      label:
        "Documento disponible para consulta segura (requiere verificación de fecha de nacimiento)",
    };
  } else {
    trafficLight = {
      color: "ambar",
      label: "Estudio en proceso de revisión clínica",
    };
  }

  assertNoClinicalLeak(trafficLight.label);

  const birthDateVerified =
    birthDate.length > 0 && row.patient_birth_date !== null
      ? row.patient_birth_date === birthDate
      : null;

  return NextResponse.json({
    found: true,
    traffic_light: trafficLight,
    study_public_meta: {
      study_id: row.id,
      folio: row.patient_folio,
      pseudonym_code: row.pseudonym_code,
      status: row.status,
      delivery_mode: row.delivery_mode,
      community: row.community,
      sample_folio: row.sample_folio,
      loop_status: row.loop_status,
      birth_date_verified: birthDateVerified,
    },
  });
}
