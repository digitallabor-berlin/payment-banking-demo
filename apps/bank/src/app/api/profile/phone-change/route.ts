import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/index.js";
import { withSession } from "@/lib/api.js";
import { getFoundry } from "@/lib/foundry.js";
import { startPhoneChange } from "@/lib/phone-change-sessions.js";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  /**
   * A STRING here and `unknown` into `startPhoneChange`. The deep check is
   * `isValidPhoneNumber`, which owns the shape, the digit count and the
   * leading `+`; this layer only rejects a caller that sent the wrong JSON
   * type. Restating the pattern here would give the bank two definitions of
   * what a telephone number is.
   */
  phoneNumber: z.string(),
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
 * Opens a phone-change presentation.
 *
 * `/api/profile/…` rather than `/api/accounts/[id]/…` because there is no
 * account in this flow — a mobile number belongs to the customer.
 *
 * The 201 body **is** a `PhoneChangeSessionDto`, passed straight through and
 * never re-assembled from its members. `startPhoneChange` carries the
 * written-out return annotation; that annotation is the guard. This repo lost
 * `dcApiProtocol` at exactly this seam once (6e997da), from an object literal
 * no type could check.
 */
export const POST = withSession(async (session, request) => {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await startPhoneChange(getDb(), getFoundry(), {
    userId: session.userId,
    phoneNumber: parsed.data.phoneNumber,
    transport: parsed.data.transport,
  });

  if (!result.ok) {
    // `phone_unchanged` is a 409 rather than a 400: the number is a perfectly
    // good one, it just conflicts with the row's current state and would
    // succeed if that state were different. That is what a 409 means.
    const status =
      result.reason === "not_found"
        ? 404
        : result.reason === "invalid_phone"
          ? 400
          : result.reason === "phone_unchanged"
            ? 409
            : 502;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json(result.session, { status: 201 });
});