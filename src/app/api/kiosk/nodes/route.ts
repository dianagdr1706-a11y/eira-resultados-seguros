import { NextResponse } from "next/server";
import { ensureSeedPdfs, getDb } from "@/lib/db";
import type { KioskNode } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSeedPdfs();
  const db = getDb();
  const nodes = db
    .prepare("SELECT * FROM kiosk_nodes ORDER BY id ASC")
    .all() as unknown as KioskNode[];

  return NextResponse.json({ nodes });
}
