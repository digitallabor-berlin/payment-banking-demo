import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { verifierEvents } from "../db/schema.js";

/**
 * The PaSO Proof/Verify §4.1 package, in this app's internal casing.
 *
 * The spec's wire names (`signed_request`, `vp_token`) appear only where the
 * package is actually serialised — see `BankClient.pay`. Both members are
 * REQUIRED by the spec, which is why this type has no optionals and why
 * `proofPackageFor` returns null rather than a half-filled object.
 */
export interface ProofPackage {
 /** The signed Authorization Request, compact JWS, verbatim. */
 signedRequest: string;
 /** The `vp_token` exactly as the wallet produced it. */
 vpToken: unknown;
}

/**
 * Assembles the package for one foundry verification from the event inbox, or
 * `null` if it is not complete.
 *
 * The two members come from two different events that arrive independently and
 * may never both arrive at all: foundry's delivery is best-effort and
 * at-most-once, and its `include_raw_artifacts` gate — off by default — makes
 * both artefacts NULL while still firing both events. "No package" is an
 * ordinary outcome, not an error.
 *
 * The signed request is the NEWEST non-NULL one (design D6). On `request_uri`
 * foundry re-signs per fetch, so several genuinely different JWSs may exist for
 * one transaction and nothing records which the wallet consumed. The newest is
 * the closest available answer; a future implementer of PaSO §3
 * `request_integrity` must read the design's §9 before trusting this value.
 */
export function proofPackageFor(
 db: Db,
 verificationId: string,
): ProofPackage | null {
 const request = db
  .select({ signedRequest: verifierEvents.signedRequest })
  .from(verifierEvents)
  .where(
   and(
    eq(verifierEvents.txId, verificationId),
    eq(verifierEvents.event, "presentation_request_delivered"),
    isNotNull(verifierEvents.signedRequest),
   ),
  )
  .orderBy(desc(verifierEvents.receivedAt), desc(verifierEvents.id))
  .get();
 if (!request?.signedRequest) return null;

 const completion = db
  .select({ vpTokenJson: verifierEvents.vpTokenJson })
  .from(verifierEvents)
  .where(
   and(
    eq(verifierEvents.txId, verificationId),
    eq(verifierEvents.event, "verification_completed"),
    isNotNull(verifierEvents.vpTokenJson),
   ),
  )
  .orderBy(desc(verifierEvents.receivedAt), desc(verifierEvents.id))
  .get();
 if (!completion?.vpTokenJson) return null;

 // The stored text came from our own JSON.stringify, so this cannot fail in
 // practice — but it is read back from a database that outlives the process
 // that wrote it, and a throw here would abort a payment that is otherwise
 // fine. No package is the correct degradation.
 let vpToken: unknown;
 try {
  vpToken = JSON.parse(completion.vpTokenJson);
 } catch {
  return null;
 }

 return { signedRequest: request.signedRequest, vpToken };
}
