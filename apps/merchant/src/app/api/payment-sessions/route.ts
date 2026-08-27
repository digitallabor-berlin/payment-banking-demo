import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/index.js";
import { env } from "@/env.js";
import { sheetSessionFromStart } from "@/lib/checkout-session.js";
import { getFoundry } from "@/lib/foundry.js";
import { startPaymentSession } from "@/lib/payment-sessions.js";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
 orderId: z.string().min(1),
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

export async function POST(request: Request) {
 const parsed = bodySchema.safeParse(await request.json().catch(() => null));
 if (!parsed.success) {
  return NextResponse.json({ error: "invalid_request" }, { status: 400 });
 }

 const result = await startPaymentSession(
  getDb(),
  getFoundry(),
  parsed.data.orderId,
  env.MERCHANT_NAME,
  env.MERCHANT_PAYEE_ID,
  parsed.data.transport ?? "request_uri",
 );

 if (!result.ok) {
  const status =
   result.reason === "order_not_found"
    ? 404
    : result.reason === "order_not_pending"
      ? 409
      : 502;
  return NextResponse.json({ error: result.reason }, { status });
 }

 // The body IS a `SheetSession`, under the sheet's own prop names, built by the
 // same module that rebuilds one from a row on reload. Deliberately NOT a
 // hand-written literal here: this used to be one, under the names `uri` and
 // `state`, which forced a third re-map in CheckoutForm — and one of those
 // three copies lost `dcApiProtocol`, breaking every DC API payment on its
 // first attempt. `sheetSessionFromStart`'s return annotation is what makes an
 // omission a compile error instead.
 return NextResponse.json(sheetSessionFromStart(result), { status: 201 });
}
