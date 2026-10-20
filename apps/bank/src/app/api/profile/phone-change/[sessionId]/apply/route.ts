import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import { withSession } from "@/lib/api.js";
import { applyPhoneChange } from "@/lib/phone-change-sessions.js";
import { sessionIdFromAction } from "../../segments.js";

export const dynamic = "force-dynamic";

/**
 * Writes the approved number.
 *
 * A POST and not the poll, for the reason the login flow uses a POST to mint
 * its cookie: a GET with a side effect gets fired twice by a prefetch or a
 * double-poll, and here the side effect writes to a customer's row. Idempotent
 * via the `applied` state, so a retry is a 410 rather than a second write.
 *
 * `already_applied` is 410 and `not_verified` is 409 deliberately: an applied
 * session is gone for good, a pending one might yet arrive. `phone_changed` is
 * also 409 — the request conflicts with the customer's current row and would
 * succeed again if that state were restored, which is exactly what a 409 means.
 */
export const POST = withSession(async (session, request) => {
  const result = applyPhoneChange(getDb(), {
    userId: session.userId,
    sessionId: sessionIdFromAction(request),
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

  return NextResponse.json({ phoneNumber: result.phoneNumber });
});