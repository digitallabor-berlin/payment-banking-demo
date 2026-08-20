import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import { withSession } from "@/lib/api.js";
import { startAvIssuance } from "@/lib/av-issuance.js";
import { getFoundry } from "@/lib/foundry.js";

export const dynamic = "force-dynamic";

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
export const POST = withSession(async (session) => {
  const result = await startAvIssuance(getDb(), getFoundry(), session.userId);

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 502 });
  }

  return NextResponse.json({
    sessionId: result.sessionId,
    offerUri: result.offerUri,
    dcApiOffer: result.dcApiOffer,
  });
});