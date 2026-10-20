import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/index.js";
import { withSession } from "@/lib/api.js";
import { getFoundry } from "@/lib/foundry.js";
import { relayTransferDcApiResponse } from "@/lib/transfer-sessions.js";
import { fromSessionAction } from "../../segments.js";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ response: z.string().min(1) });

/**
 * Relays the wallet's encrypted JWE to foundry.
 *
 * Exists only because foundry's `dc-api-response` endpoint is admin
 * authenticated and the admin key must never reach a browser.
 *
 * Returns 204 and discards foundry's verdict: the verdict reaches the UI
 * through the poll that is already running, so there is one state path rather
 * than two. The client must still check `!response.ok` — `fetch` does not
 * throw on a non-2xx, and without that guard a 500 counts as success and
 * strands the dialog on "Confirming your transfer…" until the session expires.
 */
export const POST = withSession(async (session, request) => {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { accountId, sessionId } = fromSessionAction(request);
  const result = await relayTransferDcApiResponse(getDb(), getFoundry(), {
    userId: session.userId,
    accountId,
    sessionId,
    response: parsed.data.response,
  });

  if (!result.ok) {
    const status = result.reason === "foundry_unavailable" ? 502 : 404;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return new NextResponse(null, { status: 204 });
});