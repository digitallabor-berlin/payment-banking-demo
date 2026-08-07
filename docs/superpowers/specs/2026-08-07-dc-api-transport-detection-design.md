# DC API transport detection

Date: 2026-08-07
Status: Approved

## Problem

The demo must use the W3C Digital Credentials API (DC API) whenever the
browser can actually perform it, and fall back to the QR / deep-link transport
only when it cannot. Today it never uses the DC API at all:

- `apps/bank/src/lib/issuance.ts:70` returns only `offer.credential_offer_uri`
  and discards foundry's `dc_api_offer`.
- `apps/merchant/src/lib/payment-sessions.ts:49` hardcodes
  `transport: "request_uri"`.

Both apps branch solely on `useIsTouch()` — touch follows the deep link,
desktop renders a QR.

## What already exists

**foundry implements both halves.** Nothing in `../foundry` needs code changes.

| Concern | foundry surface |
|---|---|
| Issuance | `POST /admin/issuance/offers` always returns `dc_api_offer` alongside `credential_offer_uri`. No transport parameter — the offer, the pre-authorized code, `/token` and `/credential` are byte-identical; the two fields are two renderings of one offer. |
| Verification | `CreateVerificationRequest.transport` is `"request_uri" \| "dc_api"`. Under `dc_api` the response carries `dc_api_request` (inline, unsigned) and no `openid4vp_uri` / `request_uri`, because `response_mode` becomes `dc_api.jwt`. |
| Response relay | `POST /admin/verification/requests/{id}/dc-api-response`, body `AdminDcApiResponseBody` = `{ response: <string> }`, returns a `VerificationResult` synchronously. **Admin-authenticated.** |

`packages/foundry-client` already types `dc_api_offer`, `dc_api_request`, and
the `transport` union. Only `submitDcApiResponse` is missing.

**Detection is already written twice**, identically, in
`../foundry/crates/foundry/assets/console.html` (~L2900-2960) and
`../eudipay-frontend/src/dcApi.js`. This spec ports that proven code; it does
not invent a detection scheme.

## Constraints discovered

1. **Transient activation.** Chrome consumes the click's transient activation
   if any `await` lands between the click handler starting and
   `navigator.credentials.get()` / `.create()`. The DC API payload must
   therefore already be in the browser before the user clicks. No
   fetch-then-invoke.
2. **Verification transport is fixed at create time.** It changes the OpenID4VP
   wire. Availability is only knowable in the browser, so the detection result
   must travel *into* the session-creation call; it cannot be applied after.
3. **Issuance has no such fork.** Transport is chosen at click time.
4. **The admin key can never reach the browser.** The DC API response relay
   must be proxied server-side by the merchant.
5. **No jsdom, no React Testing Library.** All three vitest projects use
   `environment: "node"` and `include: ["src/**/*.test.ts"]`. `.tsx` files are
   not matched. Component branching is invisible to the test suite.

## Decisions

| # | Decision |
|---|---|
| D1 | When DC API is available it is the **only** affordance. The QR / deep link appears **only after a failure**. |
| D2 | On merchant DC API failure, recovery is **explicit**: an error line plus a "Show QR code" button that creates a fresh `request_uri` session. Not automatic. |
| D3 | DC API wins wherever available, on touch and desktop alike. `useIsTouch` is demoted to selecting the *fallback* (deep link on touch, QR on desktop). |
| D4 | The `create` gate is **lenient** (skips the protocol probe); the `get` gate is **strict**. A lenient gate is made safe by the D1/D2 recovery path. |
| D5 | DC API **diagnostic** strings in the bank are English; all other bank copy stays German. |

### Why D3 costs the merchant's zero-click flow

Today an Android user landing on `/pay/<id>` is auto-navigated into their
wallet by `PaymentScreen.tsx:104-107`. After this change they tap "Pay with
your wallet" first. This is unavoidable: `credentials.get()` requires a user
gesture, so DC API can never be an on-mount action. In exchange the handoff
becomes a same-page browser call with no app-switch.

### Why D4's two gates differ

`../foundry`'s console runs the full check for both methods;
`../eudipay-frontend` returns `true` early for `create`. The divergence is not
sloppiness. `userAgentAllowsProtocol` is specified around *presentation*;
`openid4vci-v1` is a Chrome **origin-trial identifier** behind
`chrome://flags/#web-identity-digital-credentials-creation`, not a shipped
protocol. A browser that can perform issuance may still answer `false` or
throw for that string.

For a demo whose purpose is to *show* the DC API, a false negative (feature
silently never appears) is worse than a false positive (one visible click,
then the fallback). For `get`, `openid4vp-v1-unsigned` is well-defined, and a
wrong answer costs a wasted foundry verification request bound to the wrong
transport — so that gate stays strict.

## Design

### 1. Shared detection primitive — `packages/ui/src/dcApi.ts`

Behaviour, not design tokens, so `packages/ui` is the correct home. Exported
from `packages/ui/src/index.ts`.

```ts
export type DcApiMethod = "get" | "create";

export interface DcApiGlobals {
  isSecureContext?: boolean;
  DigitalCredential?: { userAgentAllowsProtocol?: (protocol: string) => boolean };
  navigator?: { credentials?: Record<string, unknown> };
}

export function supportsDcApi(
  method: DcApiMethod,
  protocol: string,
  globals?: DcApiGlobals,   // defaults to globalThis
): boolean;

export function isDcApiNotSupportedError(error: unknown): boolean;

export function prepareDcApiRequest(data: unknown, protocol: string): {
  digital: { requests: Array<{ protocol: string; data: unknown }> };
};

export async function invokeDcGet(req: unknown): Promise<{ response: string }>;
export async function invokeDcCreate(req: unknown): Promise<void>;

export function useDcApiSupport(method: DcApiMethod, protocol: string): boolean | null;
```

`supportsDcApi` logic:

1. `globals.isSecureContext` must be truthy.
2. `globals.DigitalCredential` must exist.
3. `typeof globals.navigator.credentials[method] === "function"`.
4. `method === "create"` → return `true` here (D4, lenient).
5. `method === "get"` → return `Boolean(DigitalCredential.userAgentAllowsProtocol(protocol))`,
   wrapped in `try/catch` returning `false`. If `userAgentAllowsProtocol` is
   absent, return `true`.

`globals` is **injected, defaulting to `globalThis`** — nothing is read at
module scope. This is what makes the function testable under
`environment: "node"`.

`invokeDcGet` asserts `credentialResponse.constructor?.name === "DigitalCredential"`
and returns `.data`. `invokeDcCreate` deliberately does **not** assert a return
shape — Chrome's documented issuance example ignores `create()`'s return value,
so asserting would manufacture failures on a successful handoff. **Non-throw is
the success signal.**

`isDcApiNotSupportedError` classifies three branches, verbatim from the two
reference implementations: `name === "NotSupportedError"`, or
`name === "TypeError"` with `/not supported/i` in the message, or
`/CredentialContainer/i` in the message.

`useDcApiSupport` is a thin `useState` + one `useEffect` wrapper. It returns
`null` during SSR and first client render, then a boolean. **`null` is
load-bearing**: it means "not yet known", distinct from "known unavailable".
The UI must render neither the DC API button nor the QR while it is `null`, or
a QR will flash on Android before disappearing.

Explicitly **not** in this module: no user-agent sniffing, and no probe call to
`navigator.credentials.get()`. Support is answered by feature detection;
capability is answered by invoking and catching.

### 2. Bank issuance

The offer already exists before the dialog mounts — `AddToWalletButton` POSTs
`/api/cards/[id]/credential`, then renders `IssuanceDialog` with `offerUri` as
a prop. The DC API payload rides the same path, satisfying constraint 1 with no
restructuring.

Server changes, all pass-through:

- `packages/foundry-client`: no change. `CreateOfferResponse.dc_api_offer` is
  already typed.
- `apps/bank/src/lib/issuance.ts`: `StartIssuanceResult` gains
  `dcApiOffer: unknown` from `offer.dc_api_offer`. **Not persisted** — it is a
  second rendering of an offer already recorded by `foundryTxId`; a column
  would duplicate state and add a migration for nothing.
- `apps/bank/src/app/api/cards/[id]/credential/route.ts`: returns `dcApiOffer`
  alongside `sessionId` and `offerUri`.
- `AddToWalletButton`: widen the `Session` interface, pass the value down.

`IssuanceDialog`'s `waiting` phase becomes three-way. With
`const dcSupported = useDcApiSupport("create", "openid4vci-v1")` and local
`dcFailed` state:

| Condition | Render |
|---|---|
| `dcSupported === null` | Existing "Wird vorbereitet…" line only. No QR, no deep link. Flash-guard. |
| `dcSupported && !dcFailed` | **Only** the DC API button (`Zum EUDI Wallet hinzufügen`). |
| `!dcSupported \|\| dcFailed` | Today's `isTouch` split, untouched: deep link on touch, `QrCanvas` on desktop. |

Click handler, with no `await` before the invoke:

```ts
try {
  await invokeDcCreate(prepareDcApiRequest(dcApiOffer, "openid4vci-v1"));
} catch (err) {
  setDcFailed(true);
  setDcMessage(isDcApiNotSupportedError(err)
    ? "This browser does not support the Digital Credentials API."
    : "The wallet handover was cancelled.");
}
```

English per D5; button labels, the waiting line, and the success/error headings
stay German.

Failure reveals the fallback **immediately**, with no intermediate button —
deliberately diverging from the merchant. Here the fallback costs nothing:
`offerUri` and `dcApiOffer` are two renderings of one offer that already
exists. On the merchant side the fallback requires a whole new foundry
verification request, which is why that one gets an explicit button. Same
decision (D1/D2), different cost.

The poll is untouched. Success still arrives as `offered → active` from
`/api/credentials/[id]/status`; foundry's issuance state machine does not know
which transport delivered the credential.

### 3. Merchant verification

Detection must happen in `CheckoutForm`, before the session exists
(constraint 2).

1. `CheckoutForm` computes `useDcApiSupport("get", "openid4vp-v1-unsigned")`.
2. It POSTs `/api/payment-sessions` with `{ orderId, dcApi: boolean }`. A
   `null` support value resolves to `false`.
3. `startPaymentSession` takes a `useDcApi` argument and passes
   `transport: useDcApi ? "dc_api" : "request_uri"`.
4. Under `dc_api`, foundry returns `dc_api_request` and no
   `openid4vp_uri` / `request_uri`. That object is persisted on the session row
   and rendered into `PaymentScreen` by the pay page — in the browser before
   the click, satisfying constraint 1.

**Schema.** `payment_sessions` gains two columns, one migration generated by
`pnpm --filter @demo/merchant db:generate`:

- `transport TEXT NOT NULL DEFAULT 'request_uri'` — the row must know how it
  was created. It cannot be inferred from `openid4vp_uri IS NULL`, which is
  ambiguous against a foundry failure.
- `dc_api_request_json TEXT` — foundry's inline unsigned request object, stored
  verbatim.

The default keeps every existing row valid, so `pnpm migrate` is
non-destructive.

**Relay route.** `POST /api/payment-sessions/[id]/dc-api-response`, body
`{ response: string }`. (The merchant's dynamic segment is `[id]`, not
`[sessionId]` — see the sibling `[id]/cancel/route.ts`.) Looks up `foundryVerificationId`, calls a new
`FoundryClient.submitDcApiResponse(id, response)` →
`POST /admin/verification/requests/:id/dc-api-response`. Server-side only
(constraint 4). foundry returns a `VerificationResult` synchronously; the route
**discards it and returns 204**. The verdict reaches the UI through the poll
that is already running — one state path, not two.

**`PaymentScreen`.** The `useIsTouch` auto-redirect (`PaymentScreen.tsx:104-107`)
becomes conditional on `transport === "request_uri"`. Under `dc_api` there is
nothing to navigate to, and constraint 1 forbids an on-mount action anyway.

| Condition | Behaviour |
|---|---|
| `transport === "dc_api"`, not failed | A **Pay with your wallet** button. Click → `invokeDcGet(prepareDcApiRequest(dcApiRequest, "openid4vp-v1-unsigned"))` with no preceding await → POST the returned `response` to the relay. |
| DC API threw | Error line + a **Show QR code** button (D2). It POSTs `/api/payment-sessions` with `{ orderId, dcApi: false }` and `router.replace('/pay/<newSessionId>')`, reusing `tryAgain()`'s machinery. The old `dc_api` session is left `pending` and expires. |
| `transport === "request_uri"` | Today's behaviour, byte for byte. |

`PaymentScreen` does **not** call `useDcApiSupport`, and therefore has no
`null` phase and needs no flash-guard. By the time it renders, the transport is
already a fact on the session row. Detection happens once, in `CheckoutForm`.
The `null` handling described in section 1 applies there (resolved to `false`
at submit time) and in `IssuanceDialog` (rendered as the waiting line).

Nothing settles twice: settlement gates on the session that actually verified.

## Prerequisites outside this repo

**`dc_api_expected_origins` must list the merchant origin.** Over the DC API
transport the KB-JWT audience MUST be the browsing-context Origin prefixed
`origin:` (OpenID4VP L2543 / SD-JWT VC Presentation Response L3179). Left unset
— today's state; it is commented out in `../foundry/config.yaml` — foundry
accepts only a single origin derived from its own `public_base_url`, which is
`foundry.digitallabor.dev`, not `larder-shop.digitallabor.dev`.

```yaml
verifier:
  dc_api_expected_origins: ["https://larder-shop.digitallabor.dev"]
```

This is not optional polish. Until a human makes that change and restarts
foundry, a merchant DC API attempt **will not fail in the browser** — it will
succeed at the handoff, relay fine, and then fail `transaction_data_binding`
inside foundry. That surfaces as a *payment decline*, not a transport error,
and the "Show QR code" recovery will **not** be offered because
`credentials.get()` never threw.

`config.yaml` is gitignored in `../foundry`. Validate with
`foundry config validate`.

**Chrome flag for issuance.** `chrome://flags/#web-identity-digital-credentials-creation`
must be enabled for `openid4vci-v1`. Documented in `apps/bank/AGENTS.md`, not
embedded as an origin-trial token in markup.

## Testing

Every decision lives in a pure `.ts` function; `.tsx` files keep only
rendering. jsdom and React Testing Library are **not** added — new deps and a
new test environment are scope creep on a transport feature (constraint 5).

`packages/ui`:

- `supportsDcApi` — no secure context; missing `DigitalCredential`; missing
  `navigator.credentials[method]`; `userAgentAllowsProtocol` returning `false`;
  `userAgentAllowsProtocol` throwing; `userAgentAllowsProtocol` absent;
  `create` skipping the probe where `get` does not.
- `isDcApiNotSupportedError` — all three branches plus non-`Error` inputs.
- `prepareDcApiRequest` — exact `{digital:{requests:[{protocol,data}]}}` shape.

`apps/merchant`:

- `selectTransport(dcApiSupported)` → `"dc_api" | "request_uri"`.
- `startPaymentSession` calls `createVerificationRequest` with
  `transport: "dc_api"` when asked, and persists `transport` and
  `dc_api_request_json`.
- Relay route: 404 on unknown session, 502 on foundry error, 204 on success.

`packages/foundry-client`:

- `submitDcApiResponse` posts to the correct admin path with the bearer token
  and the `{ response }` body.

`useDcApiSupport` is **not** unit-tested. It is a thin wrapper whose logic all
lives in `supportsDcApi`.

**Browser verification** via `tools/cdp/cdp.mjs`. Headless Chrome exposes no
`window.DigitalCredential`, so it verifies one half — the half most likely to
regress: both apps still render the QR / deep-link path unchanged, and no QR
flashes during the `null` phase.

`pnpm check` must be green. Baseline before this work: **186 tests** (85 bank +
87 merchant + 7 foundry-client + 7 ui) — measured, not quoted from a plan.

## Known-unverifiable

Same category as the existing wallet-leg gap in the root `AGENTS.md`.

1. No `navigator.credentials.create()` or `.get()` call will be executed in
   this environment. Success of the actual handoff is **unverified**.
2. Whether Chrome's `userAgentAllowsProtocol('openid4vp-v1-unsigned')` answers
   `true` on a real Android device with the EUDI wallet installed is
   **unverified** — and that is the entire premise of the strict `get` gate.
3. The `dc_api_expected_origins` change is to a gitignored file in another
   repo and will not be made by this work.

Commit messages state what was verified and what was not.

## Non-goals

- No change to the QR, the deep link, or the `request_uri` transport when DC
  API is unavailable. They keep working exactly as today.
- No origin-trial token embedded in either app.
- No jsdom / React Testing Library.
- No persistence of `dc_api_offer` on the bank side.
- No pre-creation of both transports per checkout. It would double foundry
  traffic on every checkout and leave two live verification requests for one
  payment.
- No revocation. Unchanged: foundry exposes no revoke endpoint.

## Follow-ups

- A human with an Android device and the EUDI wallet runs both flows against
  `https://sparkasse-musterstadt.digitallabor.dev` and
  `https://larder-shop.digitallabor.dev`, after the foundry config change.
- If item 2 above turns out `false` on real hardware, revisit D4 and make the
  `get` gate lenient too.