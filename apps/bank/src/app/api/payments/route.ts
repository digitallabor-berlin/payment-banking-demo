import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/index.js";
import { InvalidApiKeyError, requireApiKey } from "@/lib/apiKey.js";
import { processPayment } from "@/lib/payments.js";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  credential_id: z.string().min(1),
  amount_cents: z.number().int().positive(),
  currency: z.string().length(3),
  merchant: z.string().min(1),
  reference: z.string().min(1),
  idempotency_key: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    requireApiKey(request);
  } catch (error) {
    if (error instanceof InvalidApiKeyError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    throw error;
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = processPayment(getDb(), {
    credentialId: parsed.data.credential_id,
    amountCents: parsed.data.amount_cents,
    currency: parsed.data.currency,
    merchant: parsed.data.merchant,
    reference: parsed.data.reference,
    idempotencyKey: parsed.data.idempotency_key,
  });

  if (!result.ok) {
    const status = result.reason === "insufficient_funds" ? 402 : 404;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json({ bank_tx_id: result.bankTxId, new_balance_cents: result.newBalanceCents });
}