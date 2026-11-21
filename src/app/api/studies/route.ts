import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { getStaffSession, requireStaffApi } from "@/lib/auth";
import { ensureSeedPdfs, getDb, PRIVATE_PDF_DIR } from "@/lib/db";
import { generateSyntheticPapPdf, sha256Buffer } from "@/lib/pdf-utils";
import type { Patient, Study, StudyPriority, StudyWithPatient } from "@/lib/types";

export const dynamic = "force-dynamic";

type PublicPatient = Omit<Patient, "pin_code">;

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export async function GET(request: Request) {
  const auth = await requireStaffApi();
  if (auth.response) return auth.response;
  await ensureSeedPdfs();
  const db = getDb();
  const staff = auth.staff;
  const canSeeClinicalNote = staff?.role === "medico";

  const { searchParams } = new URL(request.url);
  const statusFilter = (searchParams.get("status") || "").trim();
  const communityFilter = (searchParams.get("community") || "").trim();

  const allStudies = db
    .prepare("SELECT * FROM studies ORDER BY created_at DESC, id ASC")
    .all() as unknown as Study[];

  const allPatients = db
    .prepare(
      "SELECT id, folio, full_name, birth_date, phone, email, preferred_channel, community, kiosk_id, created_at FROM patients"
    )
    .all() as unknown as PublicPatient[];

  const patientMap = new Map<string, PublicPatient>();
  for (const p of allPatients) {
    patientMap.set(p.id, p);
  }

  const allWithPatient: StudyWithPatient[] = allStudies.map((study) => ({
    ...study,
    clinical_note_internal: canSeeClinicalNote ? study.clinical_note_internal : null,
    patient: study.patient_id ? patientMap.get(study.patient_id) ?? null : null,
  }));

  const stats = {
    total: allWithPatient.length,
    cargado: allWithPatient.filter((s) => s.status === "cargado").length,
    pendiente_admin: allWithPatient.filter(
      (s) => s.status === "asociado" || s.status === "revision_admin"
    ).length,
    pendiente_clinica: allWithPatient.filter((s) => s.status === "pendiente_clinica").length,
    notificado: allWithPatient.filter(
      (s) =>
        s.status === "notificado" ||
        s.status === "autorizado_digital" ||
        s.status === "autorizado_acompanado"
    ).length,
    consultado: allWithPatient.filter((s) => s.status === "consultado").length,
    entregado_asistido: allWithPatient.filter((s) => s.status === "entregado_asistido").length,
    loop_activo: allWithPatient.filter(
      (s) => s.loop_status === "activo" || s.loop_status === "escalado_promotora"
    ).length,
    prioritarios: allWithPatient.filter((s) => s.priority === "prioritario").length,
  };

  let filtered = allWithPatient;
  if (statusFilter && statusFilter !== "all") {
    filtered = filtered.filter((s) => s.status === statusFilter);
  }
  if (communityFilter && communityFilter !== "all") {
    const targetCommunity = normalizeText(communityFilter);
    filtered = filtered.filter((s) => normalizeText(s.community) === targetCommunity);
  }

  return NextResponse.json(
    { studies: filtered, stats },
    { headers: { "Cache-Control": "no-store" } }
  );
}

const MAX_PDF_BYTES = 15 * 1024 * 1024; // 15 MB

function generateUniqueSampleFolio(requested: string | null): string {
  const db = getDb();
  if (requested) {
    const cleaned = requested.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
    if (cleaned.length >= 3) {
      const exists = db.prepare("SELECT id FROM studies WHERE sample_folio = ?").get(cleaned);
      if (!exists) return cleaned;
      return `${cleaned}-${crypto.randomInt(100, 999)}`;
    }
  }

  const existing = db
    .prepare("SELECT sample_folio FROM studies WHERE sample_folio LIKE 'PAP-2026-%'")
    .all() as unknown as Array<{ sample_folio: string }>;

  let maxNum = 105;
  for (const row of existing) {
    const match = /^PAP-2026-(\d+)$/.exec(row.sample_folio);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }

  let seq = maxNum + 1;
  while (true) {
    const candidate = `PAP-2026-${seq}`;
    const exists = db.prepare("SELECT id FROM studies WHERE sample_folio = ?").get(candidate);
    if (!exists) return candidate;
    seq += 1;
  }
}

function generateUniquePseudonymCode(): string {
  const db = getDb();
  for (let i = 0; i < 30; i += 1) {
    const candidate = `EIRA-ALR-${crypto.randomInt(1000, 10000)}`;
    const exists = db.prepare("SELECT id FROM studies WHERE pseudonym_code = ?").get(candidate);
    if (!exists) return candidate;
  }
  return `EIRA-ALR-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

export async function POST(request: Request) {
  const staff = await getStaffSession();
  if (!staff) {
    return NextResponse.json(
      { error: "Autenticación de personal requerida." },
      { status: 401 }
    );
  }
  if (staff.role !== "laboratorio" && staff.role !== "eira_admin") {
    return NextResponse.json(
      { error: "Permisos insuficientes: solo laboratorio o administración EIRA pueden cargar estudios." },
      { status: 403 }
    );
  }

  const contentType = request.headers.get("content-type") || "";
  const today = new Date().toISOString().slice(0, 10);

  let requestedFolio: string | null = null;
  let collectionDate = today;
  let siteName = "Laboratorio Colaborador EIRA";
  let community = "San Juan Teotihuacán";
  let priority: StudyPriority = "rutinario";
  let generateSynthetic = false;
  let syntheticPatientName = "Paciente Sintetica Demo";
  let syntheticBirthDate = "1988-05-14";
  let syntheticLabNote =
    "Muestra satisfactoria para evaluacion citologica. Documento sintetico generado para demostracion.";
  let uploadedFile: File | null = null;

  if (contentType.includes("multipart/form-data")) {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { error: "Error al leer el formulario multipart/form-data." },
        { status: 400 }
      );
    }

    const str = (key: string): string => {
      const val = formData.get(key);
      return typeof val === "string" ? val.trim() : "";
    };

    if (str("sample_folio")) requestedFolio = str("sample_folio");
    if (str("collection_date")) collectionDate = str("collection_date");
    if (str("site_name")) siteName = str("site_name");
    if (str("community")) community = str("community");
    if (str("priority") === "prioritario") priority = "prioritario";
    generateSynthetic = str("generate_synthetic").toLowerCase() === "true";

    const nameVal = str("patient_name") || str("pdf_patient_name");
    if (nameVal) syntheticPatientName = nameVal;
    const dobVal = str("birth_date") || str("pdf_birth_date");
    if (dobVal) syntheticBirthDate = dobVal;
    const noteVal = str("lab_note");
    if (noteVal) syntheticLabNote = noteVal;

    const rawFile = formData.get("file") ?? formData.get("pdf");
    if (rawFile instanceof File && rawFile.size > 0) {
      uploadedFile = rawFile;
    }
  } else if (contentType.includes("application/json")) {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Cuerpo JSON inválido." }, { status: 400 });
    }

    const str = (key: string): string =>
      typeof body[key] === "string" ? (body[key] as string).trim() : "";

    if (str("sample_folio")) requestedFolio = str("sample_folio");
    if (str("collection_date")) collectionDate = str("collection_date");
    if (str("site_name")) siteName = str("site_name");
    if (str("community")) community = str("community");
    if (str("priority") === "prioritario") priority = "prioritario";
    generateSynthetic =
      body.generate_synthetic === true || str("generate_synthetic").toLowerCase() === "true";

    const nameVal = str("patient_name") || str("pdf_patient_name");
    if (nameVal) syntheticPatientName = nameVal;
    const dobVal = str("birth_date") || str("pdf_birth_date");
    if (dobVal) syntheticBirthDate = dobVal;
    const noteVal = str("lab_note");
    if (noteVal) syntheticLabNote = noteVal;
  } else {
    return NextResponse.json(
      { error: "Tipo de contenido no soportado. Use multipart/form-data o application/json." },
      { status: 415 }
    );
  }

  if (!uploadedFile && !generateSynthetic) {
    return NextResponse.json(
      { error: "Debe adjuntar un archivo PDF válido o activar generate_synthetic." },
      { status: 400 }
    );
  }

  const sampleFolio = generateUniqueSampleFolio(requestedFolio);
  const pseudonymCode = generateUniquePseudonymCode();

  let pdfBuffer: Buffer;
  let originalName: string;

  if (uploadedFile) {
    if (uploadedFile.size > MAX_PDF_BYTES) {
      return NextResponse.json(
        { error: "El archivo PDF excede el tamaño máximo permitido (15 MB)." },
        { status: 400 }
      );
    }

    const arrayBuf = await uploadedFile.arrayBuffer();
    pdfBuffer = Buffer.from(arrayBuf);

    // Validate PDF magic bytes (%PDF-)
    if (pdfBuffer.length < 5 || pdfBuffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
      return NextResponse.json(
        { error: "El archivo cargado no es un PDF válido (encabezado %PDF- ausente)." },
        { status: 400 }
      );
    }

    originalName = path.basename(uploadedFile.name || `${sampleFolio}.pdf`);
  } else {
    const resultCategory =
      priority === "prioritario"
        ? ("Hallazgo que requiere seguimiento médico prioritario (Acompañado)" as const)
        : ("Negativo para lesión intraepitelial o malignidad (Rutinario)" as const);

    pdfBuffer = await generateSyntheticPapPdf({
      sampleFolio,
      patientName: syntheticPatientName,
      birthDate: syntheticBirthDate,
      collectionDate,
      siteName,
      labNote: syntheticLabNote,
      resultCategory,
    });
    originalName = `lab_synthetic_${sampleFolio}.pdf`;
  }

  if (!fs.existsSync(PRIVATE_PDF_DIR)) {
    fs.mkdirSync(PRIVATE_PDF_DIR, { recursive: true });
  }

  const safeStoredFilename = `${sampleFolio.replace(/[^A-Za-z0-9_-]/g, "_")}-${crypto
    .randomUUID()
    .slice(0, 6)}.pdf`;
  const resolvedRoot = path.resolve(PRIVATE_PDF_DIR);
  const targetPath = path.resolve(resolvedRoot, safeStoredFilename);

  if (!targetPath.startsWith(resolvedRoot + path.sep)) {
    return NextResponse.json({ error: "Ruta de almacenamiento inválida." }, { status: 400 });
  }

  fs.writeFileSync(targetPath, pdfBuffer);

  const pdfSha256 = sha256Buffer(pdfBuffer);
  const pdfSizeBytes = pdfBuffer.length;
  const studyId = `std-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  const db = getDb();
  db.prepare(
    `INSERT INTO studies (
      id, sample_folio, pseudonym_code, patient_id, collection_date, site_name, community,
      status, priority, delivery_mode, pdf_filename, pdf_original_name, pdf_sha256, pdf_size_bytes,
      identity_checklist_json, admin_reviewed_by, admin_reviewed_at, clinical_authorized_by,
      clinical_authorized_at, clinical_note_internal, loop_status, loop_level, loop_attempts,
      simulated_hours_elapsed, ack_received_at, ack_method, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    studyId,
    sampleFolio,
    pseudonymCode,
    null,
    collectionDate,
    siteName,
    community,
    "cargado",
    priority,
    null,
    safeStoredFilename,
    originalName,
    pdfSha256,
    pdfSizeBytes,
    null,
    null,
    null,
    null,
    null,
    null,
    "inactivo",
    0,
    0,
    0,
    null,
    null,
    now,
    now
  );

  const createdStudy = db
    .prepare("SELECT * FROM studies WHERE id = ?")
    .get(studyId) as unknown as Study;

  logAudit({
    studyId,
    actorType: "staff",
    actorId: staff.id,
    actorName: staff.name,
    action: "PDF_CARGADO",
    detail: {
      sample_folio: sampleFolio,
      pseudonym_code: pseudonymCode,
      pdf_original_name: originalName,
      pdf_sha256: pdfSha256,
      pdf_size_bytes: pdfSizeBytes,
      synthetic: !uploadedFile,
    },
  });

  const studyWithPatient: StudyWithPatient = {
    ...createdStudy,
    patient: null,
  };

  return NextResponse.json(
    { study: studyWithPatient },
    {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
