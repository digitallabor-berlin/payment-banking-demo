import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import { withSession } from "@/lib/api.js";
import { startAvIssuance } from "@/lib/av-issuance.js";
import {
 AV_CREDENTIAL_TYPE_ID,
 isAgeCredentialType,
 type AgeCredentialTypeId,
} from "@/lib/credential-types.js";
import { getFoundry } from "@/lib/foundry.js";

export const dynamic = "force-dynamic";

/**
 * Which age format this request asks for.
 *
 * The same shape as the card route's parser, for the same reasons. An absent or
 * unreadable body means the EUDI format, which keeps this route's original
 * contract — a bare POST with no body — valid. A body that *names* a type is
 * taken literally: an unknown one is a 400 rather than a silent fallback,
 * because a caller that asked for the Google Wallet profile and quietly got the
 * EUDI one would only find out when the wallet refused the handover.
 *
 * The decision itself is `isAgeCredentialType`, which has its own tests — this
 * route file, like every route file here, has none.
 */
async function requestedCredentialType(
 request: Request,
): Promise<AgeCredentialTypeId | "invalid"> {
 let body: unknown;
 try {
  body = await request.json();
 } catch {
  return AV_CREDENTIAL_TYPE_ID;
 }

 const requested =
  body && typeof body === "object"
   ? (body as Record<string, unknown>).credentialTypeId
   : undefined;

 if (requested === undefined) return AV_CREDENTIAL_TYPE_ID;
 if (typeof requested !== "string" || !isAgeCredentialType(requested)) {
  return "invalid";
 }
 return requested;
}

/**
 * Starts an age-credential issuance.
 *
 * Uses `withSession`, unlike the card route, which must call `requireSession`
 * directly because Next passes a `context` argument for its dynamic segment
 * that the wrapper does not forward. There is no segment here.
 *
 * The status poll is `GET /api/credentials/[id]/status`, shared verbatim with
 * the card: `refreshIssuanceState` reads only `foundryTxId` and `state`, so it
 * is already credential-type agnostic.
 */
export const POST = withSession(async (session, request) => {
 const credentialTypeId = await requestedCredentialType(request);
 if (credentialTypeId === "invalid") {
  return NextResponse.json(
   { error: "unknown_credential_type" },
   { status: 400 },
  );
 }

 const result = await startAvIssuance(
  getDb(),
  getFoundry(),
  session.userId,
  credentialTypeId,
 );

 if (!result.ok) {
  return NextResponse.json({ error: result.reason }, { status: 502 });
 }

 return NextResponse.json({
  sessionId: result.sessionId,
  offerUri: result.offerUri,
  dcApiOffer: result.dcApiOffer,
 });
});
