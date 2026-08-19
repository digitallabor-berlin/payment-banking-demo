/** The check name foundry reports for amount binding (spec §6.2 step 8). */
const BINDING_CHECK = "transaction_data_binding";

/**
 * The DCQL credential query id of the payment credential, in both the `dpc` and
 * `dpc_av` named queries. Also what `transaction_data.credential_ids` names.
 */
const PAYMENT_QUERY_ID = "dpc";

/** The DCQL credential query id of the EU Proof of Age attestation in `dpc_av`. */
const AGE_QUERY_ID = "av";

/**
 * ISO 18013-5 namespace of the EU Age Verification attestation. An mdoc DCQL
 * claim path is `[namespace, element]`, and foundry nests the disclosed elements
 * under the namespace verbatim — see the `disclosed_claims.insert(ns, ...)` loop
 * in foundry-verifier's verify.rs. So `age_over_18` is never a top-level key.
 */
const AGE_NAMESPACE = "eu.europa.ec.av.1";

const AGE_ELEMENT = "age_over_18";

/**
 * One entry of foundry's `VerificationResult.credentials`, narrowed from
 * untrusted input. Everything foundry returns is stored verbatim and re-read
 * later, so it is parsed defensively at every use.
 */
interface PresentedCredentialLike {
 query_id: string;
 claims: unknown;
 checks: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
 return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Finds the entry a named DCQL credential query was answered by.
 *
 * Scoping every read to a `query_id` is the load-bearing part. foundry holds
 * claims and checks per credential and never merges them, because merging is a
 * correctness bug rather than a presentation choice: two credentials disclosing
 * the same claim name collide, and a check reported for one credential would
 * appear to vouch for another. Searching the whole verdict for a passing check
 * would reintroduce exactly that.
 */
function findCredential(
 credentials: unknown,
 queryId: string,
): PresentedCredentialLike | null {
 if (!Array.isArray(credentials)) return null;

 for (const entry of credentials) {
  if (!isObject(entry)) continue;
  if (entry.query_id !== queryId) continue;
  return { query_id: queryId, claims: entry.claims, checks: entry.checks };
 }

 return null;
}

function passedCheck(checks: unknown, name: string): boolean {
 if (!Array.isArray(checks)) return false;
 return checks.some(
  (entry) => isObject(entry) && entry.check === name && entry.passed === true,
 );
}

/**
 * True only if foundry explicitly reported `transaction_data_binding` as passed
 * **on the payment credential**. Absence reads as failure, deliberately: the
 * entire value of transaction_data is lost if the merchant settles without
 * confirming this specific check, so a foundry that stopped reporting it must
 * fail closed.
 *
 * Takes `result.credentials`, not `result.checks`. The top-level `checks` array
 * carries cross-cutting checks only (`jwe_decryption`,
 * `requested_credentials_answered`) and structurally cannot contain this one —
 * an earlier version of this function searched it and would have failed every
 * payment closed.
 */
export function passedTransactionDataBinding(credentials: unknown): boolean {
 const payment = findCredential(credentials, PAYMENT_QUERY_ID);
 return payment !== null && passedCheck(payment.checks, BINDING_CHECK);
}

/**
 * Pulls `credential_id` — the join key to the bank — out of the payment
 * credential's own disclosed claims.
 *
 * SD-JWT claims arrive flat (`{ credential_id, network, card_id }`): foundry
 * inserts each disclosed claim at the top level of that credential's own claims
 * object. The nesting is by `query_id` in `credentials[]`, not inside `claims`.
 * This function used to guess between two plausible shapes because the response
 * had never been observed; both the served openapi schema and verify.rs now pin
 * it, so the branch that does not occur is gone.
 */
export function extractCredentialId(credentials: unknown): string | null {
 const payment = findCredential(credentials, PAYMENT_QUERY_ID);
 if (payment === null || !isObject(payment.claims)) return null;

 const value = payment.claims.credential_id;
 return typeof value === "string" ? value : null;
}

/**
 * True only if the `av` credential was actually answered and disclosed
 * `age_over_18 === true`.
 *
 * Fails closed on absence, for the same reason `passedTransactionDataBinding`
 * does: requesting an age attestation and then settling without one is theatre.
 * A wallet that returns only the card, or returns the attestation with the
 * element withheld, must not clear this gate.
 *
 * Strict `=== true`, never truthiness — `"false"` and `"no"` are both truthy
 * strings, and this is the one boolean the whole escalation exists to learn.
 *
 * Only meaningful for a session that presented `dpc_av`. The caller decides
 * whether to apply it; this function does not know which query was used and
 * would answer `false` for every ordinary basket.
 */
export function passedAgeVerification(credentials: unknown): boolean {
 const age = findCredential(credentials, AGE_QUERY_ID);
 if (age === null || !isObject(age.claims)) return false;

 const namespace = age.claims[AGE_NAMESPACE];
 if (!isObject(namespace)) return false;

 return namespace[AGE_ELEMENT] === true;
}
