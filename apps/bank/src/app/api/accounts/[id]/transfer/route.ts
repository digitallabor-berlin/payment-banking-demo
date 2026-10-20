import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/index.js";
import { withSession } from "@/lib/api.js";
import { getFoundry } from "@/lib/foundry.js";
import { startTransfer } from "@/lib/transfer-sessions.js";
import { accountIdFromStart } from "./segments.js";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  /**
   * All four arrive as STRINGS and are validated for meaning by
   * `validateTransferInput`. Zod checks the wire shape only — it cannot
   * express a mod-97 checksum or a two-decimal amount with either separator,
   * and duplicating half of those rules here would create a second place for
   * them to drift. The same split `newLimitCents` and `isValidNewLimit`
   * already use.
   *
   * The amount is a string rather than a number on purpose: a German UI is
   * typed `250,00`, and a float is the wrong carrier for money anyway.
   */
  payeeName: z.string(),
  payeeIban: z.string(),
  amount: z.string(),
  purpose: z.string(),
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
 * Opens a transfer presentation.
 *
 * AUTHENTICATED — the caller is by definition signed in, and the session this
 * creates is scoped to them.
 *
 * The 201 body **is** a `TransferSessionDto`, passed straight through and
 * never re-assembled from its members. `startTransfer` carries the written-out
 * return annotation; that annotation is the guard. This repo lost
 * `dcApiProtocol` at exactly this seam once (6e997da), from an object literal
 * no type could check.
 *
 * `limit_exceeded` and `insufficient_funds` are 409 rather than 400: the
 * request is well formed and conflicts with the account's CURRENT state, and
 * would succeed again if that state changed. `metadata_unavailable` is a 502
 * beside `foundry_unavailable` because both are the upstream failing to do its
 * job — they are separate reasons so an operator can tell a PaSO config
 * problem from an outage.
 */
export const POST = withSession(async (session, request) => {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await startTransfer(getDb(), getFoundry(), {
    userId: session.userId,
    accountId: accountIdFromStart(request),
    payeeName: parsed.data.payeeName,
    payeeIban: parsed.data.payeeIban,
    amount: parsed.data.amount,
    purpose: parsed.data.purpose,
    transport: parsed.data.transport,
  });

  if (!result.ok) {
    const status =
      result.reason === "not_found"
        ? 404
        : result.reason === "invalid_request"
          ? 400
          : result.reason === "limit_exceeded" ||
              result.reason === "insufficient_funds"
            ? 409
            : 502;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json(result.session, { status: 201 });
});