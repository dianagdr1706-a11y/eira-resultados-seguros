import { NextRequest, NextResponse } from "next/server";
import { requireStaffApi } from "@/lib/auth";
import { ensureSeedPdfs } from "@/lib/db";
import { stopLoopWithAck } from "@/lib/loop-engine";

interface LoopAckBody {
  study_id?: string;
  ack_method?: string;
  notes?: string;
}

export async function POST(request: NextRequest) {
  const auth = await requireStaffApi(["eira_admin", "medico", "promotora_kiosco"]);
  if (auth.response) return auth.response;
  await ensureSeedPdfs();

  let body: LoopAckBody;
  try {
    body = (await request.json()) as LoopAckBody;
  } catch {
    return NextResponse.json({ error: "Cuerpo JSON inválido." }, { status: 400 });
  }

  const studyId = typeof body.study_id === "string" ? body.study_id.trim() : "";
  if (!studyId) {
    return NextResponse.json({ error: "El campo study_id es obligatorio." }, { status: 400 });
  }

  const ackMethod =
    typeof body.ack_method === "string" && body.ack_method.trim().length > 0
      ? body.ack_method.trim()
      : "acuse_manual_staff";
  const notes = typeof body.notes === "string" ? body.notes.trim() : undefined;

  const staff = auth.staff;
  const actorId = staff ? staff.id : "staff-operador";
  const actorName = staff ? staff.name : "Operador EIRA";
  const actorType = staff ? "staff" : "system";

  const study = stopLoopWithAck(studyId, ackMethod, actorId, actorName, notes, actorType);
  if (!study) {
    return NextResponse.json({ error: "Estudio no encontrado." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, study });
}
