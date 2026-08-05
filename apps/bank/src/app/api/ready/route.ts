import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    getDb().get<{ ok: number }>(sql`select 1 as ok`);
    return NextResponse.json({ status: "ready" });
  } catch (error) {
    return NextResponse.json(
      { status: "unavailable", reason: error instanceof Error ? error.message : "unknown" },
      { status: 503 },
    );
  }
}