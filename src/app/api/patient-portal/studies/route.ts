import crypto from "node:crypto";
import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { getPatientSession } from "@/lib/auth";
import { ensureSeedPdfs, getDb } from "@/lib/db";
import type { Patient, Study } from "@/lib/types";
import { ttlSet } from "@/lib/valkey";

export const dynamic = "force-dynamic";

interface NonClinicalQrPayload {
  v: 1;
  folio: string;
  pseudo: string;
  mode: "digital" | "acompanado" | null;
  portal: "/kiosco";
}

export async function GET() {
  await ensureSeedPdfs();

  const session = await getPatientSession();
  if (!session) {
    return NextResponse.json(
      { error: "Sesión de paciente no activa. Autentícate con tu folio y OTP/PIN." },
      { status: 401 }
    );
  }

  const db = getDb();
  const patientRow = db
    .prepare("SELECT * FROM patients WHERE id = ?")
    .get(session.patientId) as Patient | undefined;

  if (!patientRow) {
    return NextResponse.json({ error: "Expediente de paciente no encontrado." }, { status: 401 });
  }

  const { pin_code: _omittedPin, ...safePatient } = patientRow;
  void _omittedPin;

  const rawStudies = db
    .prepare(
      `SELECT * FROM studies
       WHERE patient_id = ? AND clinical_authorized_at IS NOT NULL
       ORDER BY collection_date DESC, updated_at DESC`
    )
    .all(patientRow.id) as unknown as Study[];

  const ephemeralTtlSeconds = 60;

  const enrichedStudies = await Promise.all(
    rawStudies.map(async (study) => {
      const { clinical_note_internal: _omittedNote, ...publicStudy } = study;
      void _omittedNote;

      let ephemeral_download_token: string | null = null;
      let download_url: string | null = null;

      if (study.delivery_mode === "digital") {
        const token = crypto.randomBytes(24).toString("base64url");
        await ttlSet(
          `pdf_token:${token}`,
          JSON.stringify({ studyId: study.id, patientId: patientRow.id }),
          ephemeralTtlSeconds
        );
        ephemeral_download_token = token;
        download_url = `/api/studies/${study.id}/pdf?token=${token}`;
      }

      const qrPayload: NonClinicalQrPayload = {
        v: 1,
        folio: patientRow.folio,
        pseudo: study.pseudonym_code,
        mode: study.delivery_mode,
        portal: "/kiosco",
      };

      const qr_data_url = await QRCode.toDataURL(JSON.stringify(qrPayload), {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 220,
      });

      return {
        ...publicStudy,
        ephemeral_download_token,
        download_url,
        qr_payload: qrPayload,
        qr_data_url,
      };
    })
  );

  return NextResponse.json(
    {
      patient: safePatient,
      studies: enrichedStudies,
      ephemeral_ttl_seconds: ephemeralTtlSeconds,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
