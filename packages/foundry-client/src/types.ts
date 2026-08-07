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

export interface VerificationResult {
  verified: boolean;
  checks: CheckResult[];
  claims: unknown;
}

export interface VerificationTransaction {
  id: string;
  state: VerificationState;
  created_at: number;
  result?: VerificationResult | null;
}