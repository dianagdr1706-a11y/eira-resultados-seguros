import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { createPatientSessionToken, isHttpsRequest, PATIENT_COOKIE } from "@/lib/auth";
import { ensureSeedPdfs, getDb } from "@/lib/db";
import type { Patient } from "@/lib/types";
import { ttlDelete, ttlGet, ttlIncrementRateLimit } from "@/lib/valkey";

interface VerifyOtpBody {
  folio?: string;
  birth_date?: string;
  code?: string;
}

function safeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export async function POST(request: NextRequest) {
  await ensureSeedPdfs();

  let body: VerifyOtpBody;
  try {
    body = (await request.json()) as VerifyOtpBody;
  } catch {
    return NextResponse.json({ error: "Cuerpo JSON inválido." }, { status: 400 });
  }

  const folio = typeof body.folio === "string" ? body.folio.trim().toUpperCase() : "";
  const birthDate = typeof body.birth_date === "string" ? body.birth_date.trim() : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";

  if (!folio || !birthDate || !code) {
    return NextResponse.json(
      { error: "Ingresa folio, fecha de nacimiento y código OTP o PIN." },
      { status: 400 }
    );
  }

  const rateLimit = await ttlIncrementRateLimit(`rl:verify:${folio}`, 10, 300);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Demasiados intentos de verificación. Intenta nuevamente en unos minutos." },
      { status: 429 }
    );
  }

  const db = getDb();
  const patient = db
    .prepare("SELECT * FROM patients WHERE UPPER(folio) = ? AND birth_date = ?")
    .get(folio, birthDate) as Patient | undefined;

  if (!patient) {
    return NextResponse.json(
      { error: "Código OTP o PIN incorrecto o expirado." },
      { status: 401 }
    );
  }

  const storedOtp = await ttlGet(`otp:${patient.id}`);
  const matchedOtp = storedOtp !== null && safeEqualString(code, storedOtp);
  const matchedPin = Boolean(patient.pin_code) && safeEqualString(code, patient.pin_code);

  if (!matchedOtp && !matchedPin) {
    return NextResponse.json(
      { error: "Código OTP o PIN incorrecto o expirado." },
      { status: 401 }
    );
  }

  await ttlDelete(`otp:${patient.id}`);

  const sessionToken = createPatientSessionToken(patient.id, patient.folio);

  logAudit({
    studyId: null,
    actorType: "patient",
    actorId: patient.id,
    actorName: patient.full_name,
    action: "PACIENTE_AUTENTICADO",
    detail: {
      folio: patient.folio,
      auth_method: matchedOtp ? "otp_valkey" : "pin_impreso_fallback",
      community: patient.community,
    },
  });

  const response = NextResponse.json({
    ok: true,
    patient: {
      id: patient.id,
      folio: patient.folio,
      full_name: patient.full_name,
      community: patient.community,
    },
  });

  response.cookies.set(PATIENT_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 900,
    secure: isHttpsRequest(request),
  });

  return response;
}
