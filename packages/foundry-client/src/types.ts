/** foundry issuance transaction state. Exactly two values — see openapi.json IssuanceState. */
export type IssuanceState = "offered" | "issued";

/** foundry verification transaction state — see openapi.json VerificationState. */
export type VerificationState = "pending" | "verified" | "failed";

export interface CreateOfferRequest {
 credential_type_id: string;
 claims?: Record<string, unknown>;
 tx_code_required?: boolean;
}

export interface CreateOfferResponse {
 transaction_id: string;
 credential_offer_uri: string;
 dc_api_offer?: unknown;
}

export interface AdminIssuanceStatus {
 transaction_id: string;
 credential_type_id: string;
 state: IssuanceState;
 created_at: number;
 status_list_index?: number | null;
 tx_code?: string | null;
}

/**
 * `transport` is "request_uri" (QR / cross-device) or "dc_api".
 * Confirmed against crates/foundry-verifier/src/request.rs.
 */
export interface CreateVerificationRequest {
 transport: "request_uri" | "dc_api";
 dcql_query?: unknown;
 named_query_ref?: string;
 transaction_data?: unknown[];
}

export interface CreateVerificationResponse {
 verification_id: string;
 openid4vp_uri?: string | null;
 request_uri?: string | null;
 dc_api_request?: unknown;
}

export interface CheckResult {
 check: string;
 passed: boolean;
 detail?: string | null;
}

/**
 * Body of POST /admin/verification/requests/{id}/dc-api-response.
 * See openapi.json AdminDcApiResponseBody. The value is the wallet's
 * encrypted JWE, taken verbatim from `DigitalCredential.data.response`.
 */
export interface AdminDcApiResponseBody {
 response: string;
}

/**
 * One credential presented in a `vp_token`, with the checks run against it and
 * the claims it disclosed. See openapi.json PresentedCredential.
 *
 * Claims are held per credential and never merged. foundry's own schema docs
 * call merging a correctness bug rather than a presentation choice: two
 * credentials disclosing the same claim name collide, and `check_status` would
 * run a revocation check against the wrong status list — silently, with a
 * passing `status_check`. This matters here from the moment `dpc_av` is used,
 * since that query returns two credentials.
 */
export interface PresentedCredential {
 /** The DCQL credential query id this presentation answered — `dpc` or `av`. */
 query_id: string;
 /** The format the answered query declared: `dc+sd-jwt` or `mso_mdoc`. */
 format: string;
 /** This credential's disclosed claims only. */
 claims: unknown;
 /**
  * Checks scoped to this credential: its signature check, `dcql_match`,
  * `status_check`, and `transaction_data_binding` when the request carried
  * `transaction_data`. Note that `transaction_data_binding` lives HERE and not
  * in the top-level `checks` array.
  */
 checks: CheckResult[];
}

/**
 * Matches openapi.json VerificationResult as served by the deployed foundry —
 * verified 2026-08-19 against https://foundry-admin.digitallabor.dev.
 *
 * There is no top-level `claims` member, and `checks` is deliberately narrow.
 * An earlier version of this interface declared `{ verified, checks, claims }`,
 * which made `checks.some(c => c.check === "transaction_data_binding")` search
 * an array that structurally cannot contain it.
 */
export interface VerificationResult {
 verified: boolean;
 /**
  * Cross-cutting checks ONLY — `jwe_decryption` and
  * `requested_credentials_answered`. Per-credential checks, including
  * `transaction_data_binding`, live in `credentials[i].checks`.
  */
 checks: CheckResult[];
 /** One entry per credential the `vp_token` answered, in DCQL declaration order. */
 credentials: PresentedCredential[];
}

export interface VerificationTransaction {
 id: string;
 state: VerificationState;
 created_at: number;
 result?: VerificationResult | null;
}
