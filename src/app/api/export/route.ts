import { NextResponse } from "next/server";
import { requireStaffApi } from "@/lib/auth";
import { ensureSeedPdfs, getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

interface ExportStudyRow {
  sample_folio: string;
  pseudonym_code: string;
  community: string;
  status: string;
  priority: string;
  delivery_mode: string | null;
  loop_status: string;
  loop_level: number;
  loop_attempts: number;
  ack_method: string | null;
  ack_received_at: string | null;
  created_at: string;
}

const EXPORT_COLUMNS: Array<keyof ExportStudyRow> = [
  "sample_folio",
  "pseudonym_code",
  "community",
  "status",
  "priority",
  "delivery_mode",
  "loop_status",
  "loop_level",
  "loop_attempts",
  "ack_method",
  "ack_received_at",
  "created_at",
];

function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET(request: Request) {
  const auth = await requireStaffApi();
  if (auth.response) return auth.response;
  await ensureSeedPdfs();
  const db = getDb();

  const { searchParams } = new URL(request.url);
  const format = (searchParams.get("format") || "json").trim().toLowerCase();

  if (format !== "csv" && format !== "json") {
    return NextResponse.json(
      { error: "Formato inválido. Use format=csv o format=json." },
      { status: 400 }
    );
  }

  // Strictly select only sanitized operational columns (NEVER clinical_note_internal or patient pin_code)
  const rows = db
    .prepare(
      `SELECT
        sample_folio,
        pseudonym_code,
        community,
        status,
        priority,
        delivery_mode,
        loop_status,
        loop_level,
        loop_attempts,
        ack_method,
        ack_received_at,
        created_at
      FROM studies
      ORDER BY created_at DESC, id ASC`
    )
    .all() as unknown as ExportStudyRow[];

  if (format === "csv") {
    const headerLine = EXPORT_COLUMNS.join(",");
    const dataLines = rows.map((row) =>
      EXPORT_COLUMNS.map((col) => escapeCsvCell(row[col])).join(",")
    );
    const csvContent = [headerLine, ...dataLines].join("\r\n");

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="eira-reporte-abierto.csv"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const jsonPayload = JSON.stringify(
    {
      exported_at: new Date().toISOString(),
      schema_version: "1.0",
      sanitized: true,
      count: rows.length,
      studies: rows,
    },
    null,
    2
  );

  return new NextResponse(jsonPayload, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="eira-reporte-abierto.json"',
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
