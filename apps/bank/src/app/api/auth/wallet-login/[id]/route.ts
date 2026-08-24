import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import { getFoundry } from "@/lib/foundry.js";
import { refreshLoginSessionState } from "@/lib/login-sessions.js";

export const dynamic = "force-dynamic";

/**
 * The login poll. Drives the session's state and returns it.
 *
 * A GET rather than a POST even though it performs I/O, because it does not
 * mint anything: the cookie comes from `/claim`. That split is deliberate —
 * a GET that mints an authenticated session would be consumed by a prefetch,
 * a double-poll, or React StrictMode, with no user action at all.
 *
 * The response body is exactly `{ state, failureReason? }`. Never the URI,
 * never the disclosed claims, never the resolved user — the browser learns who
 * it is only by successfully claiming.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const result = await refreshLoginSessionState(getDb(), getFoundry(), id);

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 404 });
  }
  return NextResponse.json(result.status);
}