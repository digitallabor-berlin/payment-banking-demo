# PaSO Proof Package — Design

**Date:** 2026-08-28
**Status:** Approved, not implemented
**Spec source:** `../payments-and-sca-for-openid/docs/specifications/proof/paso-proof-verify.md`
**Upstream dependency:** `../foundry/docs/superpowers/plans/2026-08-28-verifier-artifact-webhook.md`

## 1. Goal

The merchant forwards a PaSO proof package to the bank; the bank stores it
against the debited transaction; the bank's transaction list offers an
affordance that opens a viewer showing the package's content.

The package is PaSO Proof/Verify §4.1:

```json
{
  "signed_request": "<compact-serialised Authorization Request JWT>",
  "vp_token": "<vp_token as received from the Wallet>"
}
```

Both members are REQUIRED by the spec. Nothing in this design synthesises,
normalises, or re-serialises either artefact — they are stored and displayed
verbatim.

## 2. Why this needs foundry to change

Neither member of the package exists on our side of the wire today.

`vp_token`: `foundry-verifier/src/verify.rs` decrypts the wallet's JWE,
extracts `vp_token`, verifies it, and persists only
`VerificationResult { verified, checks, credentials[] }`. The raw token appears
nowhere in `VerificationTransaction` and nowhere in `openapi.json`. Under the DC
API transports the merchant does relay the wallet's response, but that is a JWE
encrypted to foundry's ephemeral key.

`signed_request`: partially available. Under `dc_api_signed` the merchant
already persists `payment_sessions.dc_api_request_json`, which is literally
`{ request: "<compact JWS>" }`. Under `request_uri` the JWS is served to the
wallet and never to us. Under unsigned `dc_api` no signed request exists at all.

foundry's answer is the verification-artifact webhook. This design consumes it.

### 2.1 What the webhook delivers

Two events, POSTed to one operator-configured URL, `content-type:
application/json`, with `X-Foundry-Event` naming the type and
`X-Foundry-Signature: sha256=<hex>` carrying an HMAC-SHA256 over the exact
transmitted bytes.

```
presentation_request_delivered  { event, tx_id, transport,
                                  request_object_jws?, dc_api_request? }
verification_completed          { event, tx_id, state, result, vp_token? }
```

`tx_id` is foundry's `verification_id`. `request_object_jws` is the PaSO
`signed_request`. `vp_token` is the PaSO `vp_token`.

### 2.2 Five properties of that feed that shape this design

1. **`include_raw_artifacts` is a second gate, off by default.** With the
   webhook on but artifacts off, both events still fire and both carry *neither*
   the JWS nor the `vp_token`. It is the setting that authorises holder PII to
   leave foundry. This is an operator dependency on the deployed
   `foundry_config.yml`, the same class as the named queries and credential
   types AGENTS.md already tracks.

2. **Delivery is best-effort and at-most-once.** Fire-and-forget
   `tokio::spawn`, no retry; a failed POST is a `warn` in foundry's log and
   nothing else. A package can simply never arrive.

3. **`presentation_request_delivered` fires per delivery, not per
   transaction.** For `request_uri` it fires on every `GET /vp/request/:id`, and
   ECDSA signing is randomised, so each copy is genuinely different bytes —
   foundry's own test asserts two fetches differ. Nothing tells us which copy
   the wallet consumed.

4. **It can arrive before we know the `tx_id`.** For the DC API transports the
   event is dispatched inside `create_verification_request`, i.e. while the
   merchant is still awaiting that call's HTTP response and has not yet written
   `foundry_verification_id` to its session row.

5. **One URL per foundry instance.** The bank and the merchant share one
   deployed foundry, and the bank verifies too (wallet login). Whichever app owns
   the endpoint receives the other's verification events.

## 3. Decisions

| # | Decision | Alternative rejected |
| --- | --- | --- |
| D1 | The **merchant** owns the webhook endpoint and forwards to the bank. | Foundry POSTing to the bank directly. PaSO §2 says the Relying Party *forwards*; a bank that pulls its own evidence from the RP's verifier verifies nothing independent. |
| D2 | The package rides on the existing `POST /api/payments` debit. | A separate PaSO §4 ingestion endpoint. One round trip; package and debit are atomic; no window where money moves before proof lands. |
| D3 | When the debit is ready but no package has arrived, **wait up to 6s**, then debit without one. | Debit immediately (loses packages on a lost race); late-attach (reintroduces the second call D2 rejected). |
| D4 | The bank **stores only**. It runs none of PaSO §3's checks. | Store-and-verify. That needs JOSE verification, foundry's signing chain as a trust anchor and a replay cache in the bank, and re-runs checks foundry already ran. The UI must therefore never claim the bank verified anything. |
| D5 | The viewer decodes by default with a raw toggle. | Raw only (illegible in a demo); decoded only (hides the artefact behind our interpretation of it). |
| D6 | On `request_uri`, the **latest** `request_object_jws` received before `verification_completed` wins, and the transport is recorded so the caveat is visible. | Storing every delivered JWS. Property 3 makes certainty impossible either way; an array moves the ambiguity into the viewer without resolving it. |
| D7 | Events land in an **inbox table**, not directly on the session row. | Direct write. Property 4 makes arrival order unsafe; the inbox also absorbs property 3's multiplicity and gives D3's wait something to poll. |
| D8 | A `verification_completed` is stored only when its `tx_id` matches a known payment session. | Storing everything. Property 5 means unmatched completions are the *bank's* wallet-login `vp_token`s, which the merchant has no business holding. |

## 4. Architecture

```
foundry ──presentation_request_delivered──┐
        ──verification_completed──────────┤
                                          ▼
                        merchant  POST /api/verifier-events   (HMAC-verified)
                                          │  inbox row
                                          ▼
                        refreshPaymentSessionState: gate passes
                                          │  package present? ──no──► wait (≤6s)
                                          ▼ yes / grace expired
                        POST /api/payments  { …, proof_package? }
                                          ▼
                        bank: debit + proof row, one SQL transaction
                                          ▼
                        ledger row shows a proof affordance → dialog
```

### 4.1 Merchant — webhook receiver

**Route:** `POST /api/verifier-events`, public (no session; foundry is not a
browser).

**Authentication.** HMAC-SHA256 over the raw body, compared in constant time
against `FOUNDRY_WEBHOOK_SECRET`. The handler MUST read `await request.text()`
and verify before `JSON.parse` — `request.json()` re-serialises, and the
signature covers the bytes foundry transmitted, not a round-trip of them. This
mirrors foundry's own constraint that its sink calls `.body(..)` and never
`.json(..)`.

`FOUNDRY_WEBHOOK_SECRET` is a new **required** env var in the merchant's
`env.ts`. Required rather than optional, and therefore also a new line in the
Dockerfile's build-stage `ENV` block: an optional secret degrades to an
unauthenticated endpoint that accepts holder PII from anyone, and this project's
convention is that a missing secret crashes at boot with a named error.

**Response.** Always 2xx, fast, on every path including a rejected signature
being the one exception (401). foundry never retries and a non-2xx is only a
`warn` in its log, so there is nothing to gain by reporting a storage failure —
but an unsigned or wrongly-signed request must be refused rather than stored.

**Decision logic** lives in `lib/verifier-events.ts` as pure functions, not in
the route:

- `verifyWebhookSignature(rawBody, header, secret): boolean`
- `parseWebhookEvent(json): VerifierEvent | null` — a discriminated union over
  `event`; unknown `event` values return `null` and are ignored, not errors.

**Storage.** New table `verifier_events`:

| column | type | note |
| --- | --- | --- |
| `id` | integer PK autoincrement | |
| `tx_id` | text NOT NULL | foundry's `verification_id` |
| `event` | text NOT NULL | `presentation_request_delivered` \| `verification_completed` |
| `transport` | text | from the request event |
| `signed_request` | text | `request_object_jws`, NULL when artifacts are off |
| `vp_token_json` | text | `JSON.stringify(vp_token)`, NULL when artifacts are off |
| `received_at` | integer NOT NULL | |

Per D8, a `verification_completed` row is written only when a
`payment_sessions` row with that `foundry_verification_id` exists.
`presentation_request_delivered` rows are written unconditionally — a request
object carries no holder data.

**Reader:** `proofPackageFor(db, verificationId): ProofPackage | null` in
`lib/proof-package.ts`. Returns non-null only when **both** members are present,
per PaSO §4.1 where both are REQUIRED:

- `signed_request` — the newest `presentation_request_delivered` row for this
  `tx_id` with a non-NULL `signed_request` (D6).
- `vp_token` — the `verification_completed` row's `vp_token_json`, parsed.

### 4.2 Merchant — the grace period

`payment_sessions` gains `verified_at integer`, written in the same update that
sets `state: "verified"`.

`refreshPaymentSessionState` is unchanged up to and including its existing
gates. After `credentialId` is resolved and the row is `verified`, and before
the `settling` write:

```ts
const pkg = proofPackageFor(db, row.foundryVerificationId);
if (shouldWaitForProof(pkg !== null, verifiedAt, now)) {
  return { ok: true, status: getPaymentSessionStatus(db, sessionId)! };
}
```

`shouldWaitForProof(hasPackage, verifiedAt, now)` is a pure function in
`lib/proof-wait.ts`: `false` when `hasPackage`, `false` when `verifiedAt` is
null (nothing to measure from — fail forward, never stall a payment),
`false` when `now - verifiedAt >= PROOF_GRACE_MS`, else `true`.
`PROOF_GRACE_MS = 6000`.

Returning while still `verified` reuses the browser's existing ~2s poll; no new
polling machinery, and the resume branch already handles re-entering with a
`verified` row. The window is bounded by three polls, which is invisible in a
demo and cannot deadlock: the grace expires on wall-clock, not on an event.

The package is passed to `bank.pay(...)`. It is **not** persisted on the
session row — the inbox is already the durable copy, and a second copy would be
a second source of truth.

### 4.3 The merchant → bank wire

`POST /api/payments` body gains:

```jsonc
"proof_package": {            // optional
  "signed_request": "<string>",
  "vp_token": {}              // unknown; stored verbatim
}
```

zod: `z.object({ signed_request: z.string().min(1), vp_token: z.unknown() }).optional()`.

`BankPayInput` gains `proofPackage?: ProofPackage`. Optional rather than
required: a foundry with `include_raw_artifacts` off never produces one, and the
debit must still work. `ProcessPaymentInput` likewise.

### 4.4 Bank — storage

New table `transaction_proofs`:

| column | type | note |
| --- | --- | --- |
| `transaction_id` | text PK → `transactions.id` | one package per transaction |
| `signed_request` | text NOT NULL | |
| `vp_token_json` | text NOT NULL | |
| `received_at` | integer NOT NULL | |

Separate from `transactions` rather than two more columns on it, because a
`vp_token` is kilobytes and `listTransactions` reads a page of twenty rows for
every dashboard render.

Written inside `processPayment`'s existing `db.transaction((tx) => …)`, so a
transaction can never exist without its package or a package without its
transaction. The idempotency short-circuit at the top of `processPayment` is
untouched: a replayed debit returns the original result and writes nothing, so a
second call carrying a package cannot rewrite the first one's.

### 4.5 Bank — read path

`TransactionDto` gains `hasProof: boolean`, resolved in `listTransactions` by a
single `IN` query over the page's transaction ids rather than a per-row lookup.

New route `GET /api/transactions/[id]/proof`, wrapped in `withSession`. It
resolves the transaction, checks its `accountId` belongs to an account owned by
`session.userId`, and 404s otherwise — the same shape `listTransactions`
already uses to scope by owner. Returns
`{ signed_request, vp_token, received_at }`.

Note this is the seam AGENTS.md records losing members in. The handler returns a
named, annotated projection function's result, not a bare object literal, and
its test asserts the **exact key set** of the JSON body — a type cannot catch a
member `JSON.stringify` drops.

### 4.6 Bank — the viewer

`TransactionRow` gains a `ProofButton` when `transaction.hasProof`. The row
stays a server component; the button and dialog are the client boundary.

`ProofDialog` is modelled on `IssuanceDialog`. It fetches
`/api/transactions/{id}/proof` on open (not before — the ledger payload stays
small), shows a decoded view by default, and a "Show raw" toggle revealing the
verbatim `{ signed_request, vp_token }` JSON. Both views are copyable.

**Decoding lives in `lib/proof-decode.ts`** — pure, `.ts`, tested. All four
vitest projects are `environment: "node"` with `include: ["src/**/*.test.ts"]`,
so a decoder written inline in `.tsx` is untested by construction.

```ts
decodeJwsCompact(s: string): JwsParts | DecodeFailure
// { header: unknown, payload: unknown, signature: string }

decodeVpToken(v: unknown): VpTokenView | DecodeFailure
// per DCQL query id, per presentation:
//   dc+sd-jwt → { issuerJwt: JwsParts, disclosures: unknown[], kbJwt: JwsParts | null }
//   otherwise → { opaque: string }   // mso_mdoc is CBOR; we do not guess
```

Every function returns a result type. A malformed artefact renders as "could
not decode" beside its raw bytes; nothing throws, because the artefact came from
a wallet and the viewer must survive anything a wallet sends.

**Copy** is a new `proof` block in both catalogs (`en.ts`, `de.ts`) declared on
the `Messages` interface, so a missing key is a compile error. It must not claim
verification (D4): the dialog states plainly that the bank stored this package
as received and did not validate it. en `Payment proof` / de `Zahlungsnachweis`.
The button's accessible name is a catalog entry, not an icon alone.

## 5. Data flow, end to end

1. `startPaymentSession` creates the verification. For a DC API transport,
   foundry dispatches `presentation_request_delivered` immediately — possibly
   before step 2 completes.
2. The merchant writes `foundry_verification_id` onto the session row.
3. The webhook lands; the inbox row is written regardless of step 2's ordering.
4. The wallet responds. foundry verifies and dispatches
   `verification_completed`, carrying the `vp_token`.
5. The merchant's poll sees `verified`, passes the binding and age gates, writes
   `state: "verified"` and `verified_at`.
6. `proofPackageFor` is consulted. Present → step 7. Absent and inside the
   grace window → return; the next poll retries. Absent and expired → step 7
   with no package.
7. `state: "settling"`, then `bank.pay({ …, proofPackage })`.
8. `processPayment` debits and writes `transaction_proofs` in one SQL
   transaction.
9. The bank's ledger renders a proof affordance on that row.

## 6. Error handling

| Situation | Behaviour |
| --- | --- |
| Webhook signature absent or wrong | 401, nothing stored. |
| Unknown `event` value | 204, ignored. Forward compatibility with a later foundry. |
| `verification_completed` for an unknown `tx_id` | 204, **not stored** (D8). This is the normal case for the bank's wallet logins. |
| Artifacts gated off — events with no JWS / no token | Rows written with NULL artefact columns; `proofPackageFor` returns null; every payment takes the full grace period and settles without a package. |
| Package never arrives | Debit proceeds after 6s. The ledger row has no affordance. Not an error state and not surfaced as one. |
| Package arrives after the debit | Dropped. D2 chose one round trip; late-attach was rejected. The inbox row survives, so the loss is diagnosable. |
| Malformed artefact in the viewer | Rendered as "could not decode" beside its raw bytes. |
| Bank receives a `proof_package` for an already-idempotent debit | Ignored; the original row's package stands. |

## 7. Testing

TDD throughout, per this project's convention: failing test, confirm it fails
for the right reason, implement.

**Merchant**

- `verifier-events.test.ts` — signature verification (valid, wrong secret,
  absent header, tampered body, constant-time path); event parsing including
  unknown `event`, absent optional artefacts, and the null-vs-absent
  distinction foundry's `skip_serializing_if` produces.
- `proof-package.test.ts` — both members required; newest signed request wins
  across multiple `presentation_request_delivered` rows (D6); a completion with
  no matching session is never stored (D8).
- `proof-wait.test.ts` — the four branches of `shouldWaitForProof`, including
  the null `verified_at` fail-forward.
- `payment-sessions.test.ts` — a session that waits and then settles with a
  package; one that exhausts the grace and settles without; the resume branch
  re-entering on a `verified` row.
- `schema.test.ts` — the new columns and table.
- A route test for `POST /api/verifier-events`, asserting the row it writes.

**Bank**

- `payments.test.ts` — package written atomically with the debit; a debit with
  no package; an idempotent replay carrying a package leaves the original
  untouched.
- `queries.test.ts` — `hasProof` on both branches; ownership scoping.
- `proof-decode.test.ts` — the largest new suite. Valid compact JWS; a
  two-segment string; non-base64url; base64url that is not JSON; an SD-JWT with
  and without a KB-JWT; disclosures; an `mso_mdoc` presentation rendered opaque;
  an empty `vp_token`.
- A route test for `GET /api/transactions/[id]/proof` asserting the **exact**
  key set of the body (§4.5) and the ownership 404.
- `messages.test.ts` needs no new cases — its invariants cover new leaves, and a
  key present in one catalog and missing from the other is a compile error.

No test count is projected here. This project's record is that every plan that
projected one was wrong. Measure both ends: the per-file `it()` deltas and the
run's own total.

## 8. Operator dependencies

Stated plainly because none of this is exercisable without them.

1. **foundry's webhook does not exist yet.** It is a plan
   (`2026-08-28-verifier-artifact-webhook.md`), not shipped code. Nothing
   dispatches these events today.
2. **The deployed `foundry_config.yml` must set
   `verifier.webhook.url`** to the merchant's `/api/verifier-events`, with a
   `secret`/`secret_env` matching the merchant's `FOUNDRY_WEBHOOK_SECRET`.
3. **It must also set `include_raw_artifacts: true`.** This is off by default
   and is the gate authorising holder PII to leave foundry. Without it the
   events fire but carry neither artefact.
4. **The merchant must be reachable from foundry.** Both are on public HTTPS
   origins in the deployed environment. Locally, foundry's own URL validation
   permits `http` to a loopback host, so `http://localhost:3000/api/verifier-events`
   is acceptable for `pnpm dev`.

Until 1–3 land, the feature is fully implemented, fully tested, and demos
empty: every payment takes the grace period, times out, and debits with no
package. That is the correct degraded behaviour, and it is also indistinguishable
from a bug unless you know to look — so the change record must say so.

## 9. Known-unverifiable

Everything in `AGENTS.md`'s Known-unverifiable section still applies, and this
feature adds to it.

No wallet has ever produced a `vp_token` this repository has observed. The
`decodeVpToken` shapes are pinned by the OpenID4VP and SD-JWT-VC specifications
and by foundry's `select_presentations`, not by observation. The first real
package will be the first test of the decoder against reality, and the
result-type discipline in §4.6 exists precisely because that first encounter
should degrade to "could not decode" rather than a 500.

The HMAC scheme is pinned by foundry's plan, not by a running implementation.
If that plan's header names or signature format change before it ships, §4.1
changes with them.

Property 3's ambiguity is unresolvable by design: on `request_uri` we cannot
know which signed request the wallet consumed, so a bank that ran PaSO §3's
`request_integrity` check against our stored copy could legitimately fail. D4
means we do not run that check — but a future implementer who adds it must read
this paragraph first.

## 10. Out of scope

- PaSO §3 verification in the bank (D4).
- PaSO §4.3 JWE encryption of the package in transit. The merchant→bank hop is
  already a shared-secret server-to-server call inside the demo's trust
  boundary; a JWE here would demonstrate nothing the shared secret does not.
- A PaSO §4 ingestion endpoint on the bank (D2).
- Retry or replay of missed webhook deliveries. foundry is at-most-once by
  design and this design does not paper over it.
- `jti` replay caching. It belongs with §3 verification.
