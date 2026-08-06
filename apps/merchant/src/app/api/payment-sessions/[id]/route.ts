import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import { getBankClient } from "@/lib/bank.js";
import { getFoundry } from "@/lib/foundry.js";
import { refreshPaymentSessionState } from "@/lib/payment-sessions.js";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const result = await refreshPaymentSessionState(
    getDb(),
    getFoundry(),
    getBankClient(),
    id,
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 404 });
  }
  return NextResponse.json(result.status);
}