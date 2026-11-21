import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { createStaffSessionToken, isHttpsRequest, STAFF_COOKIE } from "@/lib/auth";
import { getDb } from "@/lib/db";
import type { StaffUser } from "@/lib/types";

export const dynamic = "force-dynamic";

interface StaffLoginBody {
  userId?: unknown;
}

export async function POST(request: Request) {
  let body: StaffLoginBody;
  try {
    body = (await request.json()) as StaffLoginBody;
  } catch {
    return NextResponse.json({ error: "Cuerpo JSON inválido." }, { status: 400 });
  }

  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  if (!userId) {
    return NextResponse.json({ error: "El campo userId es obligatorio." }, { status: 400 });
  }

  const db = getDb();
  const user = db
    .prepare("SELECT id, name, email, role, license_number, community FROM users WHERE id = ?")
    .get(userId) as unknown as StaffUser | undefined;

  if (!user) {
    return NextResponse.json({ error: "Usuario de personal no encontrado." }, { status: 404 });
  }

  const token = createStaffSessionToken(user);

  logAudit({
    studyId: null,
    actorType: "staff",
    actorId: user.id,
    actorName: user.name,
    action: "STAFF_LOGIN",
    detail: {
      role: user.role,
      email: user.email,
    },
  });

  const response = NextResponse.json(
    { staff: user },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );

  response.cookies.set(STAFF_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttpsRequest(request),
    path: "/",
    maxAge: 8 * 60 * 60,
  });

  return response;
}
