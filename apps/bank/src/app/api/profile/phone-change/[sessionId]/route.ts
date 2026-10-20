import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import { withSession } from "@/lib/api.js";
import { getFoundry } from "@/lib/foundry.js";
import { refreshPhoneChangeState } from "@/lib/phone-change-sessions.js";
import { sessionIdFromPoll } from "../segments.js";

export const dynamic = "force-dynamic";

/**
 * Polled by the dialog roughly every 2s. Drives `pending → verified | failed`.
 *
 * NEVER writes the number — that is the apply route's job, on a POST, because
 * a GET with a side effect gets fired twice by a prefetch or a double-poll and
 * here the side effect writes to a customer's row.
 *
 * Unowned and nonexistent answer the same 404. The session id is guessable, so
 * "this is not yours" must not be distinguishable from "this does not exist".
 * That check lives in `refreshPhoneChangeState`, not here, for the reason
 * `getTransactionProof` owns its own: a route is one caller of many.
 */
export const GET = withSession(async (session, request) => {
  const result = await refreshPhoneChangeState(getDb(), getFoundry(), {
    userId: session.userId,
    sessionId: sessionIdFromPoll(request),
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 404 });
  }

  return NextResponse.json(result.status);
});