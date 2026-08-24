import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import { claimLoginSession } from "@/lib/login-sessions.js";
import { SESSION_COOKIE, signSession } from "@/lib/session.js";

export const dynamic = "force-dynamic";

/**
 * Exchanges a verified login session for a `bank_session` cookie, once.
 *
 * The cookie options are copied from `/api/auth/login` deliberately and must
 * stay identical: a session minted here is indistinguishable from a password
 * session by design, so anything that differed would be a way to tell them
 * apart.
 *
 * The status codes carry the distinction `claimLoginSession` draws: 410 for a
 * session that is gone for good, 409 for one that might yet arrive. Neither
 * says WHY — the reason reaches the UI through the poll, which is the one path
 * that carries `failureReason`. This route's 409 exists to close the race
 * where the state changed after the poll read it; it is a guard, not a
 * channel.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const result = claimLoginSession(getDb(), id);

  if (!result.ok) {
    const status =
      result.reason === "not_found"
        ? 404
        : result.reason === "already_consumed"
          ? 410
          : 409;
    return NextResponse.json({ error: result.reason }, { status });
  }

  const token = await signSession({
    userId: result.userId,
    displayName: result.displayName,
  });

  const response = NextResponse.json({
    userId: result.userId,
    displayName: result.displayName,
  });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
  return response;
}