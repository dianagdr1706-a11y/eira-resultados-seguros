import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { getStaffSession, requireStaffRoles } from "@/lib/auth";
import { ensureSeedPdfs, getDb } from "@/lib/db";
import { stopLoopWithAck } from "@/lib/loop-engine";
import type { AssistedDelivery, Study } from "@/lib/types";

const ALLOWED_MODALITIES: ReadonlyArray<AssistedDelivery["modality"]> = [
  "kiosco_presencial",
  "brigadista_offline",
  "llamada_verificada",
  "orientacion_medica",
];

interface AssistedDeliveryBody {
  study_id?: string;
  kiosk_id?: string | null;
  modality?: string;
  notes?: string;
  synced_from_offline?: boolean;
  delivered_at?: string;
}

export async function POST(request: NextRequest) {
  await ensureSeedPdfs();

  const currentStaff = await getStaffSession();
  if (!currentStaff) {
    return NextResponse.json(
      { error: "Sesión de personal requerida." },
      { status: 401 }
    );
  }

  const staff = await requireStaffRoles(["eira_admin", "medico", "promotora_kiosco"]);
  if (!staff) {
    return NextResponse.json(
      { error: "Tu rol no tiene permiso para registrar entregas asistidas." },
      { status: 403 }
    );
  }

  let body: AssistedDeliveryBody;
  try {
    body = (await request.json()) as AssistedDeliveryBody;
  } catch {
    return NextResponse.json({ error: "Cuerpo JSON inválido." }, { status: 400 });
  }

  const studyId = typeof body.study_id === "string" ? body.study_id.trim() : "";
  if (!studyId) {
    return NextResponse.json({ error: "El campo study_id es obligatorio." }, { status: 400 });
  }

  const modalityRaw = typeof body.modality === "string" ? body.modality.trim() : "";
  if (!ALLOWED_MODALITIES.includes(modalityRaw as AssistedDelivery["modality"])) {
    return NextResponse.json(
      {
        error: `Modalidad inválida. Valores permitidos: ${ALLOWED_MODALITIES.join(", ")}.`,
      },
      { status: 400 }
    );
  }
  const modality = modalityRaw as AssistedDelivery["modality"];

  const db = getDb();
  const study = db.prepare("SELECT * FROM studies WHERE id = ?").get(studyId) as Study | undefined;
  if (!study) {
    return NextResponse.json({ error: "Estudio no encontrado." }, { status: 404 });
  }

  if (!study.clinical_authorized_at) {
    return NextResponse.json(
      { error: "El estudio aún no cuenta con autorización clínica para entrega." },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const deliveredAt =
    typeof body.delivered_at === "string" && body.delivered_at.trim().length > 0
      ? body.delivered_at.trim()
      : now;
  const kioskId =
    typeof body.kiosk_id === "string" && body.kiosk_id.trim().length > 0
      ? body.kiosk_id.trim()
      : null;
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  const syncedFromOffline = body.synced_from_offline ? 1 : 0;

  const dateCompact = now.slice(0, 10).replace(/-/g, "");
  const ackFolio = `ACK-${dateCompact}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const deliveryId = `del-${crypto.randomUUID().slice(0, 8)}`;

  db.prepare(
    `INSERT INTO assisted_deliveries
      (id, study_id, kiosk_id, modality, operator_id, operator_name, ack_folio, notes, synced_from_offline, delivered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    deliveryId,
    study.id,
    kioskId,
    modality,
    staff.id,
    staff.name,
    ackFolio,
    notes,
    syncedFromOffline,
    deliveredAt
  );

  db.prepare("UPDATE studies SET status = 'entregado_asistido', updated_at = ? WHERE id = ?").run(
    now,
    study.id
  );

  const updatedStudy = stopLoopWithAck(
    study.id,
    `entrega_asistida:${modality}`,
    staff.id,
    staff.name,
    notes,
    "staff"
  );

  logAudit({
    studyId: study.id,
    actorType: "staff",
    actorId: staff.id,
    actorName: staff.name,
    action: "ENTREGA_ASISTIDA_REGISTRADA",
    detail: {
      delivery_id: deliveryId,
      ack_folio: ackFolio,
      kiosk_id: kioskId,
      modality,
      synced_from_offline: Boolean(syncedFromOffline),
      delivered_at: deliveredAt,
    },
  });

  const delivery: AssistedDelivery = {
    id: deliveryId,
    study_id: study.id,
    kiosk_id: kioskId,
    modality,
    operator_id: staff.id,
    operator_name: staff.name,
    ack_folio: ackFolio,
    notes,
    synced_from_offline: syncedFromOffline,
    delivered_at: deliveredAt,
  };

  return NextResponse.json({
    ok: true,
    delivery,
    study: updatedStudy,
  });
}
