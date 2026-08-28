import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import { env } from "@/env.js";
import {
 parseVerifierEvent,
 recordVerifierEvent,
 verifyWebhookSignature,
} from "@/lib/verifier-events.js";

export const dynamic = "force-dynamic";

/**
 * foundry's verification-artifact webhook.
 *
 * Public: foundry is a server, not a browser, and carries no session. The HMAC
 * IS the authentication.
 *
 * `request.text()` and never `request.json()`. foundry signs the exact bytes it
 * transmits — its own sink calls `.body(..)` for precisely this reason — and
 * parse-then-stringify is not byte-preserving. Verifying a re-serialised body
 * would reject every legitimate delivery whose key order or number formatting
 * differs from ours.
 *
 * Every path but a failed signature answers 2xx. foundry is fire-and-forget and
 * at-most-once: it never retries, and a non-2xx becomes a `warn` in its log and
 * nothing else. There is nothing to gain by reporting "I chose not to store
 * that" as a failure — but an unauthenticated caller offering us holder
 * credentials must be refused rather than believed.
 */
export async function POST(request: Request) {
 const raw = await request.text();
 const signature = request.headers.get("x-foundry-signature");

 if (!verifyWebhookSignature(raw, signature, env.FOUNDRY_WEBHOOK_SECRET)) {
  return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
 }

 let body: unknown;
 try {
  body = JSON.parse(raw);
 } catch {
  // Authenticated but unreadable. Nothing to store and nothing to say.
  return new NextResponse(null, { status: 204 });
 }

 const event = parseVerifierEvent(body);
 if (event) recordVerifierEvent(getDb(), event, Date.now());

 return new NextResponse(null, { status: 204 });
}
