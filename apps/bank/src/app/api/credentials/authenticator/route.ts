import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import { withSession } from "@/lib/api.js";
import { startAuthenticatorIssuance } from "@/lib/authenticator-issuance.js";
import { getFoundry } from "@/lib/foundry.js";

export const dynamic = "force-dynamic";

/**
 * Starts a Sparkassen Authenticator issuance.
 *
 * Deliberately has NO body parser, unlike the card and age routes. Those two
 * credentials each come in two formats, so a request has to be able to name
 * one and an unknown name has to be a 400; this credential is offered for the
 * EUDI Wallet alone, so there is nothing to name. Adding a parser would create
 * a 400 branch no caller can reach and a parameter no caller can vary.
 *
 * Uses `withSession`, like the age route and unlike the card route — that one
 * must call `requireSession` directly because Next passes a `context` argument
 * for its dynamic segment which the wrapper does not forward. There is no
 * segment here.
 *
 * The status poll is `GET /api/credentials/[id]/status`, shared verbatim with
 * every other credential: `refreshIssuanceState` reads only `foundryTxId` and
 * `state`, so it is already credential-type agnostic.
 */
export const POST = withSession(async (session) => {
  const result = await startAuthenticatorIssuance(
    getDb(),
    getFoundry(),
    session.userId,
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
