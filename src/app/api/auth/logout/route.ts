import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import {
  getPatientSession,
  getStaffSession,
  isHttpsRequest,
  PATIENT_COOKIE,
  STAFF_COOKIE,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let scope: "all" | "staff" | "patient" = "all";
  try {
    const body = (await request.json()) as { scope?: string };
    if (body?.scope === "staff" || body?.scope === "patient") {
      scope = body.scope;
    }
  } catch {
    // Default to clearing all cookies if no JSON body provided
  }

  const [staff, patient] = await Promise.all([getStaffSession(), getPatientSession()]);

  if (staff && (scope === "all" || scope === "staff")) {
    logAudit({
      studyId: null,
      actorType: "staff",
      actorId: staff.id,
      actorName: staff.name,
      action: "STAFF_LOGOUT",
      detail: { role: staff.role },
    });
  }

  if (patient && (scope === "all" || scope === "patient")) {
    logAudit({
      studyId: null,
      actorType: "patient",
      actorId: patient.patientId,
      actorName: patient.folio,
      action: "PATIENT_LOGOUT",
      detail: { folio: patient.folio },
    });
  }

  const response = NextResponse.json(
    { ok: true, scope },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );

  const useSecure = isHttpsRequest(request);

  if (scope === "all" || scope === "staff") {
    response.cookies.set(STAFF_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: useSecure,
      path: "/",
      maxAge: 0,
    });
  }

  if (scope === "all" || scope === "patient") {
    response.cookies.set(PATIENT_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: useSecure,
      path: "/",
      maxAge: 0,
    });
  }

  return response;
}
