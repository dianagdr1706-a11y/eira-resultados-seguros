import { NextResponse } from "next/server";
import { getPatientSession, getStaffSession } from "@/lib/auth";
import { ensureSeedPdfs, getDb } from "@/lib/db";
import type { ContactChannel, StaffUser } from "@/lib/types";
import { getValkeyBackendInfo } from "@/lib/valkey";

export const dynamic = "force-dynamic";

interface PatientSessionRow {
  id: string;
  folio: string;
  full_name: string;
  birth_date: string;
  community: string;
  preferred_channel: ContactChannel;
  kiosk_id: string | null;
}

export async function GET() {
  await ensureSeedPdfs();
  const db = getDb();

  const staff = await getStaffSession();
  const patientSession = await getPatientSession();

  let patient: (PatientSessionRow & { patientId: string }) | null = null;
  if (patientSession) {
    const row = db
      .prepare(
        "SELECT id, folio, full_name, birth_date, community, preferred_channel, kiosk_id FROM patients WHERE id = ?"
      )
      .get(patientSession.patientId) as unknown as PatientSessionRow | undefined;

    if (row) {
      patient = {
        ...row,
        patientId: row.id,
      };
    }
  }

  const users = db
    .prepare("SELECT id, name, email, role, license_number, community FROM users ORDER BY id ASC")
    .all() as unknown as StaffUser[];

  return NextResponse.json(
    {
      staff,
      patient,
      users,
      valkey: getValkeyBackendInfo(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
