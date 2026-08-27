import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/index.js";
import { getFoundry } from "@/lib/foundry.js";
import { startLoginSession } from "@/lib/login-sessions.js";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
 /**
  * The transport the browser resolved (see `lib/transport.ts`). Absent means
  * the cross-device QR flow, which works everywhere — so a caller that cannot
  * decide gets the safe one rather than a DC API call it cannot make.
  *
  * A closed enum rather than a free string: this value is forwarded to foundry
  * verbatim, and an unknown transport there does not fail loudly — it falls
  * through to `direct_post.jwt`.
  */
 transport: z.enum(["request_uri", "dc_api", "dc_api_signed"]).optional(),
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
 const transport = parsed.success
  ? (parsed.data.transport ?? "request_uri")
  : "request_uri";

 const result = await startLoginSession(getDb(), getFoundry(), transport);

 if (!result.ok) {
  return NextResponse.json({ error: result.reason }, { status: 502 });
 }

 return NextResponse.json(
  {
   sessionId: result.sessionId,
   uri: result.uri,
   transport: result.transport,
   dcApiRequest: result.dcApiRequest,
   dcApiProtocol: result.dcApiProtocol,
   state: result.state,
  },
  { status: 201 },
 );
}
