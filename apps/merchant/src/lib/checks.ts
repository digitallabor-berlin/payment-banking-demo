/** The check name foundry reports for amount binding (spec §6.2 step 8). */
const BINDING_CHECK = "transaction_data_binding";

/**
 * The claim each payment format spells its join-key-to-the-bank with, keyed by
 * the DCQL credential query id that answers for it in the `payment` and
 * `payment_av` named queries. Also what `transaction_data.credential_ids` names.
 *
 * A map rather than a fallback chain, and the key order is the resolution
 * preference. Both formats are payable and their claim sets are disjoint — the
 * DPC declares `credential_id`/`network`/`card_id`, the Sparkassen Card
 * declares `sub`/`masked_iban`/`psu_id` — so reading "whichever key is present"
 * would let a claim-name collision pick who gets debited. Each query id may
 * only ever yield the claim its own vct declares.
 */
const PAYMENT_JOIN_KEY_CLAIM = {
 dpc: "credential_id",
 sparkassencard: "psu_id",
} as const;

const PAYMENT_QUERY_IDS = Object.keys(
 PAYMENT_JOIN_KEY_CLAIM,
) as (keyof typeof PAYMENT_JOIN_KEY_CLAIM)[];

/**
 * ISO 18013-5 namespace of the EU Age Verification attestation. An mdoc DCQL
 * claim path is `[namespace, element]`, and foundry nests the disclosed elements
 * under the namespace verbatim — see the `disclosed_claims.insert(ns, ...)` loop
 * in foundry-verifier's verify.rs. So `age_over_18` is never a top-level key.
 */
const AGE_NAMESPACE = "eu.europa.ec.av.1";

const AGE_ELEMENT = "age_over_18";

/**
 * Where `age_over_18` sits, per age format, keyed by the DCQL credential query
 * id that answers for it in `payment_av`. Its second `credential_sets` option
 * list accepts either format, so this gate has to as well.
 *
 * The two nestings are a consequence of the formats, not a guess: a `dc+sd-jwt`
 * disclosure lands at the top level of that credential's own claims object —
 * the same shape the DPC's claims arrive in — while an `mso_mdoc` element is
 * nested under its namespace. Neither is searched for in the other's shape,
 * because accepting both shapes for both formats would make a wallet that put
 * the element in the wrong place pass a check it should fail.
 *
 * Deliberately does NOT include `av`, the id `dpc_av` used. Nothing answers it
 * now, and a verdict stored under the old query must not clear the new gate.
 */
const AGE_QUERY_NESTING = {
 av_sdjwt: "flat",
 av_mdoc: "namespaced",
} as const;

const AGE_QUERY_IDS = Object.keys(
 AGE_QUERY_NESTING,
) as (keyof typeof AGE_QUERY_NESTING)[];

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

/**
 * Resolves the ONE credential that authorized this payment, by a fixed
 * preference order over `PAYMENT_JOIN_KEY_CLAIM`'s keys.
 *
 * Both `payment` and `payment_av` declare two payment options and a
 * `credential_sets` entry that requires exactly one of them, so at most one
 * normally answers — but a wallet holding both may present both, and then the
 * choice has to be made here rather than independently by each caller. That is
 * the load-bearing part: `passedTransactionDataBinding` and
 * `extractCredentialId` both read off THIS entry, so the amount can never be
 * bound to one card while the debit is keyed to another. It also means there is
 * no "try the next payment credential" fallback — a resolved credential whose
 * binding check did not pass fails the gate outright.
 */
function findPaymentCredential(
 credentials: unknown,
): PresentedCredentialLike | null {
 for (const queryId of PAYMENT_QUERY_IDS) {
  const found = findCredential(credentials, queryId);
  if (found !== null) return found;
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
 const payment = findPaymentCredential(credentials);
 return payment !== null && passedCheck(payment.checks, BINDING_CHECK);
}

/**
 * Pulls the join key to the bank out of the payment credential's own disclosed
 * claims — `credential_id` from an EMV DPC, `psu_id` from a Sparkassen Card.
 * Both land in the bank's single `credential_id` column, so the caller does not
 * need to know which format paid.
 *
 * Reads the SAME credential the binding gate did (see `findPaymentCredential`),
 * and only the claim that credential's own vct declares.
 *
 * SD-JWT claims arrive flat (`{ credential_id, network, card_id }`): foundry
 * inserts each disclosed claim at the top level of that credential's own claims
 * object. The nesting is by `query_id` in `credentials[]`, not inside `claims`.
 * This function used to guess between two plausible shapes because the response
 * had never been observed; both the served openapi schema and verify.rs now pin
 * it, so the branch that does not occur is gone.
 */
export function extractCredentialId(credentials: unknown): string | null {
 const payment = findPaymentCredential(credentials);
 if (payment === null || !isObject(payment.claims)) return null;

 const claim =
  PAYMENT_JOIN_KEY_CLAIM[
   payment.query_id as keyof typeof PAYMENT_JOIN_KEY_CLAIM
  ];
 const value = payment.claims[claim];
 return typeof value === "string" ? value : null;
}

/**
 * True only if a Proof of Age credential — in either of the two formats
 * `payment_av` accepts — was actually answered and disclosed
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
 * Only meaningful for a session that presented `payment_av`. The caller decides
 * whether to apply it; this function does not know which query was used and
 * would answer `false` for every ordinary basket.
 */
export function passedAgeVerification(credentials: unknown): boolean {
 return AGE_QUERY_IDS.some((queryId) => {
  const age = findCredential(credentials, queryId);
  if (age === null || !isObject(age.claims)) return false;

  if (AGE_QUERY_NESTING[queryId] === "flat") {
   return age.claims[AGE_ELEMENT] === true;
  }

  const namespace = age.claims[AGE_NAMESPACE];
  return isObject(namespace) && namespace[AGE_ELEMENT] === true;
 });
}
