import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { logAudit } from "@/lib/audit";
import { requireStaffApi } from "@/lib/auth";
import { encryptJsonBundle } from "@/lib/crypto-pack";
import { ensureSeedPdfs, getDb } from "@/lib/db";
import type { KioskNode, LoopStatus, StudyPriority, StudyStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

interface KioskJoinedRow {
  id: string;
  sample_folio: string;
  pseudonym_code: string;
  collection_date: string;
  site_name: string;
  community: string;
  status: StudyStatus;
  priority: StudyPriority;
  delivery_mode: "digital" | "acompanado" | null;
  pdf_sha256: string | null;
  loop_status: LoopStatus;
  loop_level: number;
  ack_received_at: string | null;
  patient_id: string;
  patient_folio: string;
  patient_full_name: string;
  patient_birth_date: string;
  patient_community: string;
  patient_kiosk_id: string | null;
}

export interface KioskLocalCacheRecord {
  study_id: string;
  sample_folio: string;
  pseudonym_code: string;
  patient_folio: string;
  patient_name: string;
  birth_date: string;
  community: string;
  collection_date: string;
  site_name: string;
  status: StudyStatus;
  priority: StudyPriority;
  delivery_mode: "digital" | "acompanado" | null;
  loop_status: LoopStatus;
  loop_level: number;
  ack_received_at: string | null;
  pdf_sha256: string | null;
  qr_payload: {
    v: 1;
    folio: string;
    pseudo: string;
    mode: "digital" | "acompanado" | null;
    portal: "/kiosco";
  };
  qr_data_url: string;
}

export async function GET(request: NextRequest) {
  const auth = await requireStaffApi(["promotora_kiosco", "eira_admin", "medico"]);
  if (auth.response) return auth.response;
  await ensureSeedPdfs();
  const db = getDb();

  const kioskId =
    request.nextUrl.searchParams.get("kiosk_id")?.trim() || "KIOSK-SIERRA-01";

  const node = db
    .prepare("SELECT * FROM kiosk_nodes WHERE id = ?")
    .get(kioskId) as KioskNode | undefined;

  if (!node) {
    return NextResponse.json(
      { error: `Nodo kiosco "${kioskId}" no encontrado.` },
      { status: 404 }
    );
  }

  const rows = db
    .prepare(
      `SELECT
         s.id,
         s.sample_folio,
         s.pseudonym_code,
         s.collection_date,
         s.site_name,
         s.community,
         s.status,
         s.priority,
         s.delivery_mode,
         s.pdf_sha256,
         s.loop_status,
         s.loop_level,
         s.ack_received_at,
         p.id AS patient_id,
         p.folio AS patient_folio,
         p.full_name AS patient_full_name,
         p.birth_date AS patient_birth_date,
         p.community AS patient_community,
         p.kiosk_id AS patient_kiosk_id
       FROM studies s
       INNER JOIN patients p ON s.patient_id = p.id
       WHERE s.clinical_authorized_at IS NOT NULL
         AND (s.community = ? OR p.kiosk_id = ?)
       ORDER BY
         CASE WHEN s.priority = 'prioritario' THEN 0 ELSE 1 END,
         s.updated_at DESC`
    )
    .all(node.community, node.id) as unknown as KioskJoinedRow[];

  const localCacheRecords: KioskLocalCacheRecord[] = await Promise.all(
    rows.map(async (row) => {
      const qrPayload = {
        v: 1 as const,
        folio: row.patient_folio,
        pseudo: row.pseudonym_code,
        mode: row.delivery_mode,
        portal: "/kiosco" as const,
      };
      const qrDataUrl = await QRCode.toDataURL(JSON.stringify(qrPayload), {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 220,
      });

      return {
        study_id: row.id,
        sample_folio: row.sample_folio,
        pseudonym_code: row.pseudonym_code,
        patient_folio: row.patient_folio,
        patient_name: row.patient_full_name,
        birth_date: row.patient_birth_date,
        community: row.community,
        collection_date: row.collection_date,
        site_name: row.site_name,
        status: row.status,
        priority: row.priority,
        delivery_mode: row.delivery_mode,
        loop_status: row.loop_status,
        loop_level: row.loop_level,
        ack_received_at: row.ack_received_at,
        pdf_sha256: row.pdf_sha256,
        qr_payload: qrPayload,
        qr_data_url: qrDataUrl,
      };
    })
  );

  const syncedAt = new Date().toISOString();
  const bundlePayload = {
    schema_version: 1,
    kiosk_id: node.id,
    kiosk_name: node.name,
    community: node.community,
    synced_at: syncedAt,
    count: localCacheRecords.length,
    records: localCacheRecords,
  };

  const encryptedBundle = encryptJsonBundle(bundlePayload);

  db.prepare("UPDATE kiosk_nodes SET last_sync_at = ? WHERE id = ?").run(
    syncedAt,
    node.id
  );

  const updatedNode: KioskNode = {
    ...node,
    last_sync_at: syncedAt,
  };

  logAudit({
    studyId: null,
    actorType: "kiosk",
    actorId: node.id,
    actorName: node.name,
    action: "KIOSKO_SYNC_DOWNLINK",
    detail: {
      kiosk_id: node.id,
      community: node.community,
      count: localCacheRecords.length,
      algorithm: encryptedBundle.algorithm,
      bundle_sha256: encryptedBundle.sha256,
    },
  });

  return NextResponse.json(
    {
      node: updatedNode,
      synced_at: syncedAt,
      count: localCacheRecords.length,
      encrypted_bundle: encryptedBundle,
      local_cache_records: localCacheRecords,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
