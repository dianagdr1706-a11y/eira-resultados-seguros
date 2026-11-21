import { NextResponse } from "next/server";
import { requireStaffApi } from "@/lib/auth";
import { getDb } from "@/lib/db";
import type { AuditLog } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireStaffApi();
  if (auth.response) return auth.response;
  const db = getDb();
  const { searchParams } = new URL(request.url);
  const studyId = (searchParams.get("study_id") || "").trim();

  let logs: AuditLog[];
  if (studyId) {
    logs = db
      .prepare(
        "SELECT id, study_id, actor_type, actor_id, actor_name, action, detail_json, created_at FROM audit_logs WHERE study_id = ? ORDER BY created_at DESC LIMIT 100"
      )
      .all(studyId) as unknown as AuditLog[];
  } else {
    logs = db
      .prepare(
        "SELECT id, study_id, actor_type, actor_id, actor_name, action, detail_json, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 100"
      )
      .all() as unknown as AuditLog[];
  }

  return NextResponse.json(
    { logs },
    { headers: { "Cache-Control": "no-store" } }
  );
}
