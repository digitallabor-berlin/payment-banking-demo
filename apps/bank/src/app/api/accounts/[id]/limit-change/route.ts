import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/index.js";
import { withSession } from "@/lib/api.js";
import { getFoundry } from "@/lib/foundry.js";
import { startLimitChange } from "@/lib/limit-change-sessions.js";
import { accountIdFromStart } from "./segments.js";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  /**
   * Validated as a NUMBER here and as a selectable preset in
   * `isValidNewLimit`. Zod cannot express the second check — it depends on the
   * account's current limit — so the two are deliberately split rather than
   * duplicated.
   */
  newLimitCents: z.number(),
  /**
   * The transport the browser resolved (see `lib/transport.ts`). Absent means
   * the cross-device QR flow, which works everywhere.
   *
   * A closed enum rather than a free string: this value is forwarded to
   * foundry verbatim, and an unknown transport there does not fail loudly — it
   * falls through to `direct_post.jwt`.
   */
  transport: z.enum(["request_uri", "dc_api", "dc_api_signed"]).optional(),
});

/**
 * Opens a limit-change presentation.
 *
 * AUTHENTICATED, unlike every wallet-login route — the caller is by definition
 * signed in, and the session this creates is scoped to them.
 *
 * The 201 body **is** a `LimitChangeSessionDto`, passed straight through and
 * never re-assembled from its members. `startLimitChange` carries the
 * written-out return annotation; that annotation is the guard. This repo lost
 * `dcApiProtocol` at exactly this seam once (6e997da), from an object literal
 * no type could check.
 *
 * A missing or unparseable body is a 400, unlike the wallet-login route's `{}`.
 * Every field here is required, so there IS a request a 400 usefully rejects.
 */
export const POST = withSession(async (session, request) => {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await startLimitChange(getDb(), getFoundry(), {
    userId: session.userId,
    accountId: accountIdFromStart(request),
    newLimitCents: parsed.data.newLimitCents,
    transport: parsed.data.transport,
  });

  if (!result.ok) {
    const status =
      result.reason === "not_found"
        ? 404
        : result.reason === "invalid_limit"
          ? 400
          : 502;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json(result.session, { status: 201 });
});