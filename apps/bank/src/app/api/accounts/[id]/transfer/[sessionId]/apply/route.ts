import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import { withSession } from "@/lib/api.js";
import { applyTransfer } from "@/lib/transfer-sessions.js";
import { fromSessionAction } from "../../segments.js";

export const dynamic = "force-dynamic";

/**
 * Moves the money.
 *
 * A POST and not the poll, for the reason the login flow uses a POST to mint
 * its cookie: a GET with a side effect gets fired twice by a prefetch or a
 * double-poll, and here the side effect DEBITS AN ACCOUNT. Idempotent via the
 * `applied` state and, independently, via the unique index on
 * `idempotency_key`, so a retry is a 410 rather than a second debit.
 *
 * `already_applied` and `expired` are 410 and everything else short of a 404
 * is 409, deliberately: an applied or expired session is gone for good, while
 * `not_verified`, `limit_exceeded` and `insufficient_funds` all describe a
 * request that conflicts with current state and would succeed again if that
 * state changed — which is exactly what a 409 means. The last two leave the
 * session claimable, so that 409 is a real invitation to retry.
 */
export const POST = withSession(async (session, request) => {
  const { accountId, sessionId } = fromSessionAction(request);
  const result = applyTransfer(getDb(), {
    userId: session.userId,
    accountId,
    sessionId,
  });

  if (!result.ok) {
    const status =
      result.reason === "not_found"
        ? 404
        : result.reason === "already_applied" || result.reason === "expired"
          ? 410
          : 409;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json({
    transactionId: result.transactionId,
    newBalanceCents: result.newBalanceCents,
  });
});