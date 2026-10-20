import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import { withSession } from "@/lib/api.js";
import { getFoundry } from "@/lib/foundry.js";
import { refreshTransferState } from "@/lib/transfer-sessions.js";
import { fromPoll } from "../segments.js";

export const dynamic = "force-dynamic";

/**
 * Polled by the dialog roughly every 2s. Drives `pending → verified | failed`.
 *
 * NEVER moves money — that is the apply route's job, on a POST, because a GET
 * with a side effect gets fired twice by a prefetch or a double-poll and here
 * the side effect debits an account.
 *
 * Unowned, wrong-account and nonexistent all answer the same 404. The session
 * id is guessable and this flow ends in a debit, so "this is not yours" must
 * not be distinguishable from "this does not exist". That check lives in
 * `refreshTransferState`, not here, for the reason `getTransactionProof` owns
 * its own: a route is one caller of many.
 */
export const GET = withSession(async (session, request) => {
  const { accountId, sessionId } = fromPoll(request);
  const result = await refreshTransferState(getDb(), getFoundry(), {
    userId: session.userId,
    accountId,
    sessionId,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 404 });
  }

  return NextResponse.json(result.status);
});