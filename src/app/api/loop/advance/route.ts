import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { requireStaffApi } from "@/lib/auth";
import { ensureSeedPdfs } from "@/lib/db";
import { advanceLoopForStudies } from "@/lib/loop-engine";

interface AdvanceLoopBody {
  study_id?: string;
  hours?: number;
}

export async function POST(request: NextRequest) {
  const auth = await requireStaffApi(["eira_admin", "medico"]);
  if (auth.response) return auth.response;
  await ensureSeedPdfs();

  let body: AdvanceLoopBody = {};
  try {
    const raw = await request.text();
    if (raw.trim().length > 0) {
      body = JSON.parse(raw) as AdvanceLoopBody;
    }
  } catch {
    return NextResponse.json({ error: "Cuerpo JSON inválido." }, { status: 400 });
  }

  const studyId =
    typeof body.study_id === "string" && body.study_id.trim().length > 0
      ? body.study_id.trim()
      : undefined;
  const hours =
    typeof body.hours === "number" && Number.isFinite(body.hours) && body.hours > 0
      ? Math.min(Math.round(body.hours), 168)
      : 24;

  const result = advanceLoopForStudies(studyId, hours);
  const staff = auth.staff;

  logAudit({
    studyId: studyId ?? null,
    actorType: staff ? "staff" : "system",
    actorId: staff ? staff.id : "loop-engine",
    actorName: staff ? staff.name : "Motor de Escalación EIRA",
    action: "LOOP_ESCALAMIENTO_AVANZADO",
    detail: {
      target_study_id: studyId ?? "ALL_ACTIVE",
      hours_added: hours,
      updated_count: result.updated_count,
      emitted_events: result.new_events.map((e) => ({
        id: e.id,
        study_id: e.study_id,
        level: e.level,
        channel: e.channel,
        hours_mark: e.hours_mark,
      })),
    },
  });

  return NextResponse.json(result);
}
