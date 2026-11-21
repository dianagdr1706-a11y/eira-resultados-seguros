import { NextResponse } from "next/server";
import { requireStaffApi } from "@/lib/auth";
import { getRegistryStats } from "@/lib/registry";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireStaffApi();
  if (auth.response) return auth.response;
  return NextResponse.json(getRegistryStats(), { headers: { "Cache-Control": "no-store" } });
}
