import { NextRequest, NextResponse } from "next/server";
import { requireStaffApi } from "@/lib/auth";
import { ensureSeedPdfs, getDb } from "@/lib/db";
import type { NotificationRecord } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireStaffApi();
  if (auth.response) return auth.response;
  await ensureSeedPdfs();
  const db = getDb();
  const studyId = request.nextUrl.searchParams.get("study_id")?.trim();

  const notifications = studyId
    ? (db
        .prepare(
          "SELECT * FROM notifications WHERE study_id = ? ORDER BY created_at DESC LIMIT 80"
        )
        .all(studyId) as unknown as NotificationRecord[])
    : (db
        .prepare("SELECT * FROM notifications ORDER BY created_at DESC LIMIT 80")
        .all() as unknown as NotificationRecord[]);

  return NextResponse.json({ notifications });
}
