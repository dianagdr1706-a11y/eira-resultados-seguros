import { NextResponse } from "next/server";
import { requireStaffApi } from "@/lib/auth";
import { ensureSeedPdfs, getDb } from "@/lib/db";
import { getLoopTrackedStudies } from "@/lib/loop-engine";
import type { LoopEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireStaffApi();
  if (auth.response) return auth.response;
  await ensureSeedPdfs();
  const db = getDb();

  const studies = getLoopTrackedStudies();
  const events = db
    .prepare("SELECT * FROM loop_events ORDER BY created_at DESC LIMIT 80")
    .all() as unknown as LoopEvent[];

  let active = 0;
  let escalated = 0;
  let closed_ack = 0;
  let total_attempts = 0;

  for (const s of studies) {
    if (s.loop_status === "activo") active += 1;
    else if (s.loop_status === "escalado_promotora") escalated += 1;
    else if (s.loop_status === "cerrado_ack") closed_ack += 1;
    total_attempts += s.loop_attempts;
  }

  return NextResponse.json({
    studies,
    events,
    summary: {
      active,
      escalated,
      closed_ack,
      total_attempts,
    },
  });
}
