import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { requireStaffApi } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { parseCaptureInput } from "@/lib/matching";
import { createPatient, createVisit, RegistryError, updatePatient, type VisitInput } from "@/lib/registry";

export const dynamic = "force-dynamic";

const MAX_ITEMS = 200;

type SyncStatus =
  | "creado"
  | "visita_registrada"
  | "actualizado"
  | "ya_sincronizado"
  | "conflicto"
  | "error";

interface SyncResult {
  client_uuid: string;
  status: SyncStatus;
  message: string;
  patient_id?: string;
  folio?: string;
  visit_id?: string;
  conflict?: Record<string, unknown>;
}

/** Looks up a previous sync of the same item (idempotency by client_uuid). */
function findAlreadySynced(clientUuid: string): SyncResult | null {
  const db = getDb();
  const visit = db
    .prepare("SELECT id, patient_id FROM visits WHERE client_uuid = ? OR client_uuid = ?")
    .get(clientUuid, `${clientUuid}:v1`) as { id: string; patient_id: string } | undefined;
  if (visit) {
    const p = db.prepare("SELECT folio FROM patients WHERE id = ?").get(visit.patient_id) as
      | { folio: string }
      | undefined;
    return {
      client_uuid: clientUuid,
      status: "ya_sincronizado",
      message: "Este registro ya se había sincronizado; no se duplicó.",
      patient_id: visit.patient_id,
      folio: p?.folio,
      visit_id: visit.id,
    };
  }
  const audit = db
    .prepare(
      `SELECT detail_json FROM audit_logs
       WHERE action IN ('PACIENTE_ALTA', 'PACIENTE_ALTA_CON_COINCIDENCIAS', 'PACIENTE_ACTUALIZADO_OFFLINE')
         AND detail_json LIKE ? LIMIT 1`
    )
    .get(`%"client_uuid":"${clientUuid.replace(/[%_"]/g, "")}"%`) as { detail_json: string } | undefined;
  if (audit) {
    const detail = JSON.parse(audit.detail_json) as { patient_id?: string; folio?: string };
    return {
      client_uuid: clientUuid,
      status: "ya_sincronizado",
      message: "Este registro ya se había sincronizado; no se duplicó.",
      patient_id: detail.patient_id,
      folio: detail.folio,
    };
  }
  return null;
}

/**
 * Reto 1 · Store-and-forward sync of registrations captured without connectivity.
 * - Re-runs the multi-attribute matcher server-side: an offline "new patient" that may already
 *   exist becomes a CONFLICT for human confirmation — it is never created nor merged automatically.
 * - Idempotent by client_uuid: re-sending the same batch never duplicates.
 * - Contact updates use optimistic concurrency (base_version) → VERSION_CONFLICT.
 */
export async function POST(request: Request) {
  const auth = await requireStaffApi(["promotora_kiosco", "eira_admin"]);
  if (auth.response) return auth.response;
  const staff = auth.staff;

  let body: { device_id?: unknown; items?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Cuerpo JSON inválido." }, { status: 400 });
  }
  if (!Array.isArray(body.items)) {
    return NextResponse.json({ error: "Se esperaba items: []." }, { status: 400 });
  }
  if (body.items.length > MAX_ITEMS) {
    return NextResponse.json({ error: `Máximo ${MAX_ITEMS} registros por lote.` }, { status: 400 });
  }
  const deviceId = typeof body.device_id === "string" ? body.device_id.slice(0, 80) : "desconocido";

  const results: SyncResult[] = [];
  for (const raw of body.items as Array<Record<string, unknown>>) {
    const clientUuid = typeof raw?.client_uuid === "string" ? raw.client_uuid.trim().slice(0, 80) : "";
    if (!clientUuid) {
      results.push({ client_uuid: "", status: "error", message: "Registro sin client_uuid." });
      continue;
    }

    const previous = raw.kind === "update" ? null : findAlreadySynced(clientUuid);
    if (previous) {
      results.push(previous);
      continue;
    }

    try {
      if (raw.kind === "new_patient") {
        const data = (raw.data ?? {}) as Record<string, unknown>;
        const input = parseCaptureInput(data);
        if (typeof input === "string") {
          results.push({ client_uuid: clientUuid, status: "error", message: input });
          continue;
        }
        const created = createPatient(input, staff, {
          confirmNewReason: typeof raw.confirm_new_reason === "string" ? raw.confirm_new_reason : null,
          firstVisit: (raw.first_visit as VisitInput) ?? null,
          offline: true,
          clientUuid,
        });
        results.push({
          client_uuid: clientUuid,
          status: "creado",
          message: `Expediente ${created.patient.folio} creado desde captura sin conexión.`,
          patient_id: created.patient.id,
          folio: created.patient.folio,
          visit_id: created.visit?.id,
        });
      } else if (raw.kind === "visit") {
        const patientId = typeof raw.patient_id === "string" ? raw.patient_id : "";
        const visitInput = { ...((raw.visit ?? {}) as VisitInput), client_uuid: clientUuid };
        const { visit, duplicate } = createVisit(patientId, visitInput, staff, { offline: true });
        results.push({
          client_uuid: clientUuid,
          status: duplicate ? "ya_sincronizado" : "visita_registrada",
          message: duplicate ? "La visita ya estaba sincronizada." : `Visita del ${visit.visit_date} registrada.`,
          patient_id: patientId,
          visit_id: visit.id,
        });
      } else if (raw.kind === "update") {
        const patientId = typeof raw.patient_id === "string" ? raw.patient_id : "";
        const updated = updatePatient(patientId, raw.base_version, raw.changes, staff, { offline: true });
        results.push({
          client_uuid: clientUuid,
          status: "actualizado",
          message:
            updated.changed_fields.length > 0
              ? `Campos actualizados: ${updated.changed_fields.join(", ")}.`
              : "Sin cambios respecto al expediente actual.",
          patient_id: patientId,
          folio: updated.patient.folio,
        });
      } else {
        results.push({ client_uuid: clientUuid, status: "error", message: "Tipo de registro desconocido." });
      }
    } catch (err) {
      if (err instanceof RegistryError && (err.code === "POSSIBLE_DUPLICATE" || err.code === "VERSION_CONFLICT")) {
        results.push({
          client_uuid: clientUuid,
          status: "conflicto",
          message:
            err.code === "POSSIBLE_DUPLICATE"
              ? "Posible paciente ya registrada: requiere confirmación humana (no se creó ni se fusionó)."
              : "El expediente cambió en el servidor mientras estabas sin conexión: revisa los datos actuales.",
          patient_id: typeof raw.patient_id === "string" ? raw.patient_id : undefined,
          conflict: { type: err.code, ...(err.payload ?? {}) },
        });
      } else if (err instanceof RegistryError) {
        results.push({ client_uuid: clientUuid, status: "error", message: err.message });
      } else {
        console.error("[sync] unexpected error", err);
        results.push({ client_uuid: clientUuid, status: "error", message: "Error interno al sincronizar." });
      }
    }
  }

  const summary = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  logAudit({
    studyId: null,
    actorType: "staff",
    actorId: staff.id,
    actorName: staff.name,
    action: "SYNC_OFFLINE_LOTE",
    detail: { device_id: deviceId, items: results.length, summary },
  });

  return NextResponse.json({ results, summary }, { headers: { "Cache-Control": "no-store" } });
}
