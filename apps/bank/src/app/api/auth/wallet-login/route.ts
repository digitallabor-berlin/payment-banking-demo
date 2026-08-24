import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/index.js";
import { getFoundry } from "@/lib/foundry.js";
import { startLoginSession } from "@/lib/login-sessions.js";
import { selectTransport } from "@/lib/transport.js";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  /** The browser's DC API detection result. Absent means "no". */
  dcApi: z.boolean().optional(),
});

/**
 * Opens a wallet-login presentation.
 *
 * UNAUTHENTICATED by necessity — the caller is by definition not logged in.
 * The session id it returns is therefore a bearer token; see
 * `LOGIN_SESSION_TTL_MS` and `claimLoginSession` for what keeps that safe.
 *
 * An absent or unparseable body is treated as `{}` rather than a 400. Every
 * field is optional, so there is no request a caller could send that a 400
 * would usefully reject.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  const dcApi = parsed.success ? (parsed.data.dcApi ?? false) : false;

  const result = await startLoginSession(
    getDb(),
    getFoundry(),
    selectTransport(dcApi) === "dc_api",
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 502 });
  }

  return NextResponse.json(
    {
      sessionId: result.sessionId,
      uri: result.uri,
      transport: result.transport,
      dcApiRequest: result.dcApiRequest,
      state: result.state,
    },
    { status: 201 },
  );
}