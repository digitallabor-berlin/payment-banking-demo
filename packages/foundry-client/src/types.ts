/** foundry issuance transaction state. Exactly two values — see openapi.json IssuanceState. */
export type IssuanceState = "offered" | "issued";

/** foundry verification transaction state — see openapi.json VerificationState. */
export type VerificationState = "pending" | "verified" | "failed";

export interface CreateOfferRequest {
  credential_type_id: string;
  claims?: Record<string, unknown>;
  tx_code_required?: boolean;
  /**
   * EMVCo DPC display metadata for the Credential *Offer*. foundry validates it
   * with `DisplayStage::Offer`, which treats `card.last_four` and
   * `card.card_art` as OPTIONAL — the governing annex says PII-type data should
   * not appear on an offer, so this array deliberately omits them.
   *
   * Accepted only when `credential_type_id` resolves to `com.emvco.dpc.card`;
   * any other type is rejected outright rather than silently dropped. Note the
   * status: the admin route answers a rejected display with **HTTP 500** and a
   * body of `{"error": "invalid request: <json path>: <reason>"}` — the error
   * *code* is `invalid_request` but the status is not 400 (measured 2026-08-19
   * against a local foundry). `FoundryError.status` will therefore read 500, and
   * `startIssuance` maps that to `reason: "foundry_unavailable"`.
   *
   * Typed `unknown[]` rather than a modelled shape because foundry accepts
   * unknown members at every depth (a documented divergence from A.5.1's
   * `additionalProperties: false`), so a closed TS interface here would be
   * narrower than the wire contract.
   */
  offer_display?: unknown[];
  /**
   * EMVCo DPC display metadata for the Credential *Response*. Validated with
   * `DisplayStage::CredentialResponse`, which REQUIRES `card.last_four`
   * (`^[0-9]{4}$`) and a non-empty `card.card_art`. Persisted on foundry's
   * issuance transaction and echoed at `/credential`.
   *
   * Unlike `offer_display`, the echo is NOT observable from the admin API:
   * `AdminIssuanceStatus` deliberately omits it, and `/credential` requires the
   * wallet leg (token + key-bound proof). Its acceptance is verified; its
   * round-trip to a wallet is not.
   */
  credential_response_display?: unknown[];
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
