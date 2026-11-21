import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { assertNoClinicalLeak, logAudit, maskContact } from "@/lib/audit";
import { isDemoMode } from "@/lib/auth";
import { ensureSeedPdfs, getDb } from "@/lib/db";
import type { LoopChannel, Patient } from "@/lib/types";
import { ttlIncrementRateLimit, ttlSet } from "@/lib/valkey";

interface RequestOtpBody {
  folio?: string;
  birth_date?: string;
}

function maskPatientName(fullName: string): string {
  return fullName
    .trim()
    .split(/\s+/)
    .map((word) => {
      if (word.length <= 2) return `${word[0] ?? "*"}*`;
      return `${word.slice(0, 2)}${"*".repeat(Math.min(4, word.length - 2))}`;
    })
    .join(" ");
}

export async function POST(request: NextRequest) {
  await ensureSeedPdfs();

  let body: RequestOtpBody;
  try {
    body = (await request.json()) as RequestOtpBody;
  } catch {
    return NextResponse.json({ error: "Cuerpo JSON inválido." }, { status: 400 });
  }

  const folio = typeof body.folio === "string" ? body.folio.trim().toUpperCase() : "";
  const birthDate = typeof body.birth_date === "string" ? body.birth_date.trim() : "";

  if (!folio || !birthDate) {
    return NextResponse.json(
      { error: "Ingresa tu folio y fecha de nacimiento (AAAA-MM-DD)." },
      { status: 400 }
    );
  }

  const rateLimit = await ttlIncrementRateLimit(`rl:otp:${folio}`, 10, 300);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Demasiadas solicitudes de código OTP. Espera unos minutos antes de reintentar." },
      { status: 429 }
    );
  }

  const db = getDb();
  const patient = db
    .prepare("SELECT * FROM patients WHERE UPPER(folio) = ? AND birth_date = ?")
    .get(folio, birthDate) as Patient | undefined;

  if (!patient) {
    return NextResponse.json(
      { error: "No encontramos un expediente con ese folio y fecha de nacimiento." },
      { status: 404 }
    );
  }

  const otp = String(crypto.randomInt(100000, 1000000));
  const ttlSeconds = 600;
  await ttlSet(`otp:${patient.id}`, otp, ttlSeconds);

  const neutralMessage = `EIRA: Tu código temporal de acceso es ${otp} (vigente 10 min) para consultar tu documento del folio ${patient.folio}. No compartas este código.`;
  const maskedLogMessage = `EIRA: Código temporal de acceso (******) emitido con vigencia de 10 min para el folio ${patient.folio}. Sin datos clínicos.`;
  assertNoClinicalLeak(neutralMessage);
  assertNoClinicalLeak(maskedLogMessage);

  const latestStudy = db
    .prepare(
      `SELECT id, pseudonym_code FROM studies
       WHERE patient_id = ? AND clinical_authorized_at IS NOT NULL
       ORDER BY updated_at DESC LIMIT 1`
    )
    .get(patient.id) as { id: string; pseudonym_code: string } | undefined;

  const notifChannel: LoopChannel =
    patient.preferred_channel === "correo"
      ? "correo_neutro"
      : patient.preferred_channel === "kiosco_asistido"
        ? "kiosco_wifi_local"
        : "sms_neutro";

  if (latestStudy) {
    db.prepare(
      `INSERT INTO notifications
        (id, study_id, channel, recipient_masked, neutral_message, pseudonym_code, delivery_status, is_simulated, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      `notif-${crypto.randomUUID().slice(0, 8)}`,
      latestStudy.id,
      notifChannel,
      maskContact(patient.phone, patient.email),
      maskedLogMessage,
      latestStudy.pseudonym_code,
      "simulado",
      1,
      new Date().toISOString()
    );
  }

  logAudit({
    studyId: latestStudy?.id ?? null,
    actorType: "patient",
    actorId: patient.id,
    actorName: patient.full_name,
    action: "OTP_SOLICITADO",
    detail: {
      folio: patient.folio,
      channel: patient.preferred_channel,
      ttl_seconds: ttlSeconds,
      recipient_masked: maskContact(patient.phone, patient.email),
    },
  });

  return NextResponse.json(
    {
      ok: true,
      patient_name_masked: maskPatientName(patient.full_name),
      channel: patient.preferred_channel,
      ttl_seconds: ttlSeconds,
      // Only exposed in demo mode (no real SMS/email gateway). Never in production.
      ...(isDemoMode() ? { simulated_otp_for_demo: otp } : {}),
      pin_fallback_hint:
        "También puedes usar tu PIN impreso de 4 dígitos si no tienes celular ni correo.",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
