import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "./db";
import type { StaffRole, StaffUser } from "./types";

const SESSION_SECRET = process.env.EIRA_SESSION_SECRET || "eira-vibeathon-2026-dev-secret-key-change-in-prod";
export const STAFF_COOKIE = "eira_staff_session";
export const PATIENT_COOKIE = "eira_patient_session";

function signPayload(payload: string): string {
  const b64 = Buffer.from(payload, "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

function verifyPayload(token: string | undefined): Record<string, unknown> | null {
  if (!token || !token.includes(".")) return null;
  const [b64, sig] = token.split(".");
  if (!b64 || !sig) return null;
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(b64).digest("base64url");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const parsed = JSON.parse(Buffer.from(b64, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof parsed.exp === "number" && Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function createStaffSessionToken(user: StaffUser): string {
  return signPayload(
    JSON.stringify({
      type: "staff",
      userId: user.id,
      role: user.role,
      exp: Date.now() + 8 * 60 * 60 * 1000, // 8 hours
    })
  );
}

export function createPatientSessionToken(patientId: string, folio: string): string {
  return signPayload(
    JSON.stringify({
      type: "patient",
      patientId,
      folio,
      exp: Date.now() + 15 * 60 * 1000, // 15 minutes strict patient session
    })
  );
}

export async function getStaffSession(): Promise<StaffUser | null> {
  const store = await cookies();
  const token = store.get(STAFF_COOKIE)?.value;
  const parsed = verifyPayload(token);
  if (!parsed || parsed.type !== "staff" || typeof parsed.userId !== "string") return null;

  const db = getDb();
  const user = db
    .prepare("SELECT id, name, email, role, license_number, community FROM users WHERE id = ?")
    .get(parsed.userId) as StaffUser | undefined;
  return user ?? null;
}

export async function getPatientSession(): Promise<{ patientId: string; folio: string } | null> {
  const store = await cookies();
  const token = store.get(PATIENT_COOKIE)?.value;
  const parsed = verifyPayload(token);
  if (
    !parsed ||
    parsed.type !== "patient" ||
    typeof parsed.patientId !== "string" ||
    typeof parsed.folio !== "string"
  ) {
    return null;
  }
  return { patientId: parsed.patientId, folio: parsed.folio };
}

export async function requireStaffRoles(allowedRoles: StaffRole[]): Promise<StaffUser | null> {
  const staff = await getStaffSession();
  if (!staff) return null;
  if (!allowedRoles.includes(staff.role)) return null;
  return staff;
}

export const ALL_STAFF_ROLES: StaffRole[] = ["laboratorio", "eira_admin", "medico", "promotora_kiosco"];

/**
 * Guard for staff-only API routes. Returns either the authenticated staff user
 * or a ready-to-return 401/403 JSON response.
 */
export async function requireStaffApi(
  allowedRoles: StaffRole[] = ALL_STAFF_ROLES
): Promise<{ staff: StaffUser; response?: undefined } | { staff?: undefined; response: NextResponse }> {
  const staff = await getStaffSession();
  if (!staff) {
    return {
      response: NextResponse.json(
        { error: "Autenticación de personal requerida." },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      ),
    };
  }
  if (!allowedRoles.includes(staff.role)) {
    return {
      response: NextResponse.json(
        { error: `Permisos insuficientes para el rol ${staff.role}.` },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      ),
    };
  }
  return { staff };
}

/**
 * Demo mode exposes conveniences that must never exist in a real deployment
 * (e.g. returning the OTP in the API response because no SMS gateway exists).
 * On by default in development; in production it must be enabled explicitly
 * with EIRA_DEMO_MODE=1.
 */
export function isDemoMode(): boolean {
  const flag = process.env.EIRA_DEMO_MODE;
  if (flag === "1" || flag === "true") return true;
  if (flag === "0" || flag === "false") return false;
  return process.env.NODE_ENV !== "production";
}

export function isHttpsRequest(request: Request): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto) {
    return forwardedProto.split(",")[0].trim().toLowerCase() === "https";
  }
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}
