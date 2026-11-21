import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { getPatientSession, getStaffSession } from "@/lib/auth";
import { ensureSeedPdfs, getDb, PRIVATE_PDF_DIR } from "@/lib/db";
import { watermarkPdfBuffer } from "@/lib/pdf-utils";
import type { StaffRole, Study } from "@/lib/types";
import { ttlGet } from "@/lib/valkey";

export const dynamic = "force-dynamic";

const STAFF_PDF_ROLES: ReadonlyArray<StaffRole> = ["laboratorio", "eira_admin", "medico"];

interface EphemeralTokenPayload {
  studyId: string;
  patientId?: string;
}

function parseTokenPayload(raw: string | null): EphemeralTokenPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.studyId !== "string" || !parsed.studyId) return null;
    return {
      studyId: parsed.studyId,
      patientId: typeof parsed.patientId === "string" ? parsed.patientId : undefined,
    };
  } catch {
    return null;
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  await ensureSeedPdfs();
  const { id } = await context.params;
  const { searchParams } = new URL(request.url);
  const tokenParam = (searchParams.get("token") || "").trim();
  const forceDownload = searchParams.get("download") === "1";

  const [staff, patient, rawToken] = await Promise.all([
    getStaffSession(),
    getPatientSession(),
    tokenParam ? ttlGet(`pdf_token:${tokenParam}`) : Promise.resolve(null),
  ]);

  const tokenPayload = parseTokenPayload(rawToken);

  // SECURITY GATE 1: Deny all unauthenticated requests (zero permanent public links)
  if (!staff && !patient && !tokenPayload) {
    return NextResponse.json(
      {
        error:
          "Acceso denegado: no existen enlaces públicos permanentes. Autentíquese para consultar este documento.",
      },
      {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      }
    );
  }

  const db = getDb();
  const study = db
    .prepare("SELECT * FROM studies WHERE id = ?")
    .get(id) as unknown as Study | undefined;

  if (!study) {
    return NextResponse.json(
      { error: "Estudio no encontrado." },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  // When an explicit valid ephemeral token is presented (e.g., from Patient Portal),
  // enforce patient-side rules, watermarking, and ACK closure even if a staff cookie exists in the same browser.
  // Also enforce RBAC: promotora_kiosco operates only with pseudonymous traffic-light QR, never full clinical PDFs.
  const staffCanViewPdf = Boolean(staff && STAFF_PDF_ROLES.includes(staff.role));
  if (staff && !staffCanViewPdf && !patient && !tokenPayload) {
    return NextResponse.json(
      {
        error:
          "Acceso denegado: tu rol (promotora_kiosco) opera con semáforo pseudonimizado y no tiene permiso para descargar PDFs clínicos.",
      },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }
  const actingAsPatient = !staffCanViewPdf || Boolean(tokenPayload);

  // SECURITY GATE 2: Strict patient & ephemeral token authorization checks
  if (actingAsPatient) {
    let authorizedByPatient = false;
    let authorizedByToken = false;

    if (patient && study.patient_id === patient.patientId) {
      authorizedByPatient = true;
    }

    if (
      tokenPayload &&
      tokenPayload.studyId === id &&
      (!tokenPayload.patientId || study.patient_id === tokenPayload.patientId)
    ) {
      authorizedByToken = true;
    }

    if (!authorizedByPatient && !authorizedByToken) {
      return NextResponse.json(
        {
          error:
            "Acceso denegado: sus credenciales o token efímero no corresponden a este estudio.",
        },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (study.clinical_authorized_at === null) {
      return NextResponse.json(
        {
          error:
            "Este estudio aún no cuenta con autorización clínica para su consulta por paciente.",
        },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (study.delivery_mode === "acompanado") {
      return NextResponse.json(
        {
          error:
            "Este resultado requiere entrega acompañada con personal médico de EIRA. Por favor acude al Kiosco o agenda orientación.",
        },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (!authorizedByPatient && authorizedByToken && study.delivery_mode !== "digital") {
      return NextResponse.json(
        {
          error:
            "El token efímero solo permite descargar resultados autorizados para entrega digital.",
        },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      );
    }
  }

  // Read PDF from private_storage/pdfs (never public/)
  if (!study.pdf_filename) {
    return NextResponse.json(
      { error: "El estudio no tiene un archivo PDF asociado." },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  const safeName = path.basename(study.pdf_filename);
  const resolvedRoot = path.resolve(PRIVATE_PDF_DIR);
  const fullPath = path.resolve(resolvedRoot, safeName);

  if (!fullPath.startsWith(resolvedRoot + path.sep) || !fs.existsSync(fullPath)) {
    return NextResponse.json(
      { error: "Archivo PDF no disponible en almacenamiento privado." },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  let pdfBytes: Buffer = fs.readFileSync(fullPath);
  const now = new Date().toISOString();

  if (actingAsPatient) {
    const watermarkText = `CONFIDENCIAL EIRA · Folio ${study.sample_folio} · Descargado ${now.slice(0, 16)} UTC`;
    pdfBytes = await watermarkPdfBuffer(pdfBytes, watermarkText);

    const isClosed =
      study.loop_status === "cerrado_ack" &&
      (study.status === "consultado" || study.status === "entregado_asistido");

    if (!isClosed) {
      db.prepare(
        `UPDATE studies
         SET status = 'consultado',
             loop_status = 'cerrado_ack',
             ack_received_at = ?,
             ack_method = 'descarga_autenticada_paciente',
             updated_at = ?
         WHERE id = ?`
      ).run(now, now, id);

      const loopId = `loop-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(
        `INSERT INTO loop_events (
          id, study_id, level, channel, pseudonym_code, payload_preview, hours_mark, status, created_at
        ) VALUES (?, ?, ?, 'sms_neutro', ?, ?, ?, 'detenido_ack', ?)`
      ).run(
        loopId,
        id,
        study.loop_level,
        study.pseudonym_code,
        `[ACK Recibido] Loop cerrado automáticamente tras descarga autenticada para ${study.pseudonym_code}.`,
        study.simulated_hours_elapsed,
        now
      );
    }

    logAudit({
      studyId: id,
      actorType: "patient",
      actorId: patient?.patientId || tokenPayload?.patientId || study.patient_id || "paciente",
      actorName: patient?.folio || study.sample_folio,
      action: "PDF_DESCARGADO_PACIENTE",
      detail: {
        via: tokenPayload ? "token_efimero_valkey" : "sesion_paciente",
        watermark_applied: true,
        ack_closed: !isClosed,
        download_mode: forceDownload ? "attachment" : "inline",
      },
    });
  } else if (staff) {
    logAudit({
      studyId: id,
      actorType: "staff",
      actorId: staff.id,
      actorName: staff.name,
      action: "PDF_CONSULTADO_STAFF",
      detail: {
        role: staff.role,
        sample_folio: study.sample_folio,
        download_mode: forceDownload ? "attachment" : "inline",
      },
    });
  }

  const dispositionType = forceDownload ? "attachment" : "inline";
  const downloadFilename = `${study.sample_folio.replace(/[^A-Za-z0-9_-]/g, "_")}.pdf`;

  return new NextResponse(new Uint8Array(pdfBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${dispositionType}; filename="${downloadFilename}"`,
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
