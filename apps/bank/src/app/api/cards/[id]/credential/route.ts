import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import {
  DPC_CREDENTIAL_TYPE_ID,
  isPaymentCredentialType,
  type PaymentCredentialTypeId,
} from "@/lib/credential-types.js";
import { getFoundry } from "@/lib/foundry.js";
import { startIssuance } from "@/lib/issuance.js";
import { requireSession, UnauthorizedError } from "@/lib/session.js";

export const dynamic = "force-dynamic";

/**
 * Which card format this request asks for.
 *
 * An absent or unreadable body means the EMVCo DPC, which keeps the route's
 * original contract — a bare POST with no body — valid. A body that *names* a
 * type is taken literally: an unknown one is a 400 rather than a silent
 * fallback, because a caller that asked for one format and quietly received
 * another would only discover it at a checkout that could not be completed.
 */
async function requestedCredentialType(
  request: Request,
): Promise<PaymentCredentialTypeId | "invalid"> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return DPC_CREDENTIAL_TYPE_ID;
  }

  const requested =
    body && typeof body === "object"
      ? (body as Record<string, unknown>).credentialTypeId
      : undefined;

  if (requested === undefined) return DPC_CREDENTIAL_TYPE_ID;
  if (typeof requested !== "string" || !isPaymentCredentialType(requested)) {
    return "invalid";
  }
  return requested;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let userId: string;
  try {
    userId = (await requireSession()).userId;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    throw error;
  }

  const credentialTypeId = await requestedCredentialType(request);
  if (credentialTypeId === "invalid") {
    return NextResponse.json(
      { error: "unknown_credential_type" },
      { status: 400 },
    );
  }

  const { id: cardId } = await context.params;
  const result = await startIssuance(
    getDb(),
    getFoundry(),
    userId,
    cardId,
    credentialTypeId,
  );

  if (!result.ok) {
    const status = result.reason === "card_not_found" ? 404 : 502;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json({
    sessionId: result.sessionId,
    offerUri: result.offerUri,
    dcApiOffer: result.dcApiOffer,
  });
}
