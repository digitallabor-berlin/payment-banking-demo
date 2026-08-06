import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/index.js";
import { env } from "@/env.js";
import { getFoundry } from "@/lib/foundry.js";
import { startPaymentSession } from "@/lib/payment-sessions.js";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ orderId: z.string().min(1) });

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await startPaymentSession(
    getDb(),
    getFoundry(),
    parsed.data.orderId,
    env.MERCHANT_NAME,
  );

  if (!result.ok) {
    const status =
      result.reason === "order_not_found" ? 404 : result.reason === "order_not_pending" ? 409 : 502;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json({ sessionId: result.sessionId, uri: result.uri }, { status: 201 });
}