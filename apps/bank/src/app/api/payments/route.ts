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
  /**
   * PaSO Proof/Verify §4.1, member names verbatim from the spec.
   *
   * `.optional()` rather than `.nullable()`: the merchant omits the key when it
   * has no package (see `BankClient.pay`), and accepting an explicit null too
   * would admit a second spelling of the same fact.
   *
   * `vp_token` is `z.unknown()` — its shape is the wallet's, not ours, and
   * narrowing it here would reject a conformant token from a wallet we have
   * never seen. It is stored verbatim and decoded only for display.
   */
  proof_package: z
    .object({ signed_request: z.string().min(1), vp_token: z.unknown() })
    .optional(),
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
    ...(parsed.data.proof_package
      ? {
          proofPackage: {
            signedRequest: parsed.data.proof_package.signed_request,
            vpToken: parsed.data.proof_package.vp_token,
          },
        }
      : {}),
  });

  if (!result.ok) {
    const status = result.reason === "insufficient_funds" ? 402 : 404;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json({
    bank_tx_id: result.bankTxId,
    new_balance_cents: result.newBalanceCents,
  });
}
