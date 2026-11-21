import { NextResponse } from "next/server";
import { requireStaffApi } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { parseCaptureInput } from "@/lib/matching";
import { createPatient, registryErrorResponse, type VisitInput } from "@/lib/registry";
import type { Patient } from "@/lib/types";

export const dynamic = "force-dynamic";

type PublicPatient = Omit<Patient, "pin_code">;

function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export async function GET(request: Request) {
  const auth = await requireStaffApi(["laboratorio", "eira_admin"]);
  if (auth.response) return auth.response;
  const db = getDb();
  const { searchParams } = new URL(request.url);
  const rawQuery = (searchParams.get("q") || "").trim();

  const allPatients = db
    .prepare(
      "SELECT id, folio, full_name, birth_date, phone, email, preferred_channel, community, kiosk_id, created_at FROM patients ORDER BY created_at DESC, folio ASC"
    )
    .all() as unknown as PublicPatient[];

  if (!rawQuery) {
    return NextResponse.json(
      { patients: allPatients },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const needle = normalizeSearch(rawQuery);
  const patients = allPatients.filter((p) => {
    const haystack = [p.full_name, p.folio, p.birth_date, p.community, p.phone ?? ""]
      .map(normalizeSearch)
      .join(" ");
    return haystack.includes(needle);
  });

  return NextResponse.json(
    { patients },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/**
 * Reto 1 · Alta de paciente. Never silently duplicates: if the multi-attribute matcher finds
 * candidates (score >= 40) the caller must send an explicit human justification
 * (confirm_new_reason), otherwise 409 POSSIBLE_DUPLICATE is returned with the candidates.
 */
export async function POST(request: Request) {
  const auth = await requireStaffApi(["promotora_kiosco", "eira_admin", "laboratorio"]);
  if (auth.response) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Cuerpo JSON inválido." }, { status: 400 });
  }

  const input = parseCaptureInput(body);
  if (typeof input === "string") {
    return NextResponse.json({ error: input }, { status: 400 });
  }

  try {
    const result = createPatient(input, auth.staff, {
      confirmNewReason: typeof body.confirm_new_reason === "string" ? body.confirm_new_reason : null,
      firstVisit:
        body.first_visit && typeof body.first_visit === "object" ? (body.first_visit as VisitInput) : null,
    });
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return registryErrorResponse(err);
  }
}
