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
 * `transport` is "request_uri" (QR / cross-device) or one of the two W3C
 * Digital Credentials API forms. Confirmed against
 * crates/foundry-verifier/src/request.rs.
 *
 * The two DC API values are separate transports rather than a flag on one,
 * because they produce genuinely different wire artifacts: `dc_api` inlines a
 * bare, unsigned parameter object, while `dc_api_signed` inlines a Request
 * Object signed as a JWS Compact Serialization (OpenID4VP 1.0 §A.2). Both use
 * `response_mode: dc_api.jwt` and both return their response through
 * POST /admin/verification/requests/{id}/dc-api-response.
 *
 * `dc_api_signed` is REJECTED outright when foundry's
 * `verifier.dc_api_expected_origins` is empty (OpenID4VP 1.0 L2442) — foundry
 * refuses to sign an assertion about which Origins are legitimate rather than
 * guess one from its `public_base_url`, which is what the verify side does.
 *
 * A foundry too old to know `dc_api_signed` does NOT reject it: unknown
 * transport strings fall through to `response_mode: direct_post.jwt`, so such a
 * build answers with `openid4vp_uri`/`request_uri` and no `dc_api_request`.
 * Callers must therefore trust the RESPONSE rather than their own request when
 * deciding which transport they actually got.
 */
export interface CreateVerificationRequest {
 transport: "request_uri" | "dc_api" | "dc_api_signed";
 dcql_query?: unknown;
 named_query_ref?: string;
 transaction_data?: unknown[];
}

export interface CreateVerificationResponse {
 verification_id: string;
 openid4vp_uri?: string | null;
 request_uri?: string | null;
 /**
  * Under `dc_api` a bare Authorization Request parameter object; under
  * `dc_api_signed` the single-member `{ request: "<compact JWS>" }` wrapper of
  * OpenID4VP 1.0 L2476. Either way it is passed verbatim as the DC API
  * request's `data` element.
  */
 dc_api_request?: unknown;
 /**
  * The DC API exchange protocol identifier the calling page MUST pair with
  * `dc_api_request` (OpenID4VP 1.0 L2395-L2402): `openid4vp-v1-signed` or
  * `openid4vp-v1-unsigned`. `null` for `request_uri`, which performs no DC API
  * invocation and therefore has no identifier to report — not the empty
  * string.
  *
  * foundry emits this rather than leaving the page to derive it because the
  * identifier and the `data` shape are two halves of one wire contract and
  * foundry decides the shape. Pairing a signed payload with the unsigned
  * identifier is a wallet-side failure with no server-side trace, so this
  * value is persisted and replayed verbatim rather than recomputed.
  *
  * Measured 2026-08-27 against https://foundry.digitallabor.dev: present for
  * both DC API transports with exactly those two values. Absent from a build
  * that predates the field, which is why it is optional.
  */
 protocol?: string | null;
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

/**
 * A PaSO Proof Metadata §5 ad-hoc transaction data metadata mint request.
 *
 * ADMIN-ONLY, and on the ADMIN LISTENER specifically. The public wallet-facing
 * host answers 404 for *every* `/admin/*` path, including ones that certainly
 * exist, so a 404 there reads as "endpoint missing" and is not: probe
 * `foundry-admin.digitallabor.dev`, never `foundry.digitallabor.dev/admin/…`.
 *
 * What this buys: §5.4 says a transaction data type covered by a valid ad-hoc
 * JWT is "considered supported … even if it is absent from the signed
 * credential metadata", and foundry implements exactly that — with an override
 * present it never consults the credential type's configured
 * `transaction_data_types`. So a new transaction data type needs NO foundry
 * config change. Without the override foundry 400s with "does not declare
 * transaction data type … and no metadata override was supplied".
 */
export interface AdHocMetadataRequest {
 /** The credential type the metadata describes, e.g. `sparkassen_auth`. */
 credential_type_id: string;
 /** Must equal the `type` of the `transaction_data` entry it will ride in. */
 transaction_data_type: string;
 /**
  * The `claims` / `ui_labels` block, forwarded verbatim.
  *
  * Typed `unknown` for the reason `offer_display` is `unknown[]`: foundry
  * validates a shape this package should not re-declare — claim paths, locale
  * tags, a per-key grapheme limit on every `ui_labels` value — and a closed
  * interface here would be a second, drifting copy of that contract. The
  * caller owns the shape and its tests.
  */
 metadata?: unknown;
 /**
  * Lifetime in seconds. Omitted means foundry's configured default, which on
  * the deployed instance is 300 — exactly the bank's own limit-change session
  * TTL, so a holder approving near the end of a session would hand the wallet
  * a JWT with seconds left. State it rather than inherit it.
  */
 ttl_secs?: number;
}

/** `{ jwt, exp }` — the compact `adhoc-transaction-metadata+jwt` and its expiry. */
export interface AdHocMetadataResponse {
 /**
  * Goes verbatim into the `transaction_data` entry's `metadata` member.
  * Never re-encoded: foundry performs the OpenID4VP §8.4 base64url encoding of
  * the whole entry itself.
  */
 jwt: string;
 /** Seconds since the epoch. Echoes the `exp` inside the signed JWT. */
 exp: number;
}
