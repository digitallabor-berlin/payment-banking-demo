import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import { getPaymentSessionStatus } from "@/lib/payment-sessions.js";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const status = getPaymentSessionStatus(getDb(), id);
  if (!status) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(status);
}