# Payment Banking Demo — Design

**Date:** 2026-08-05
**Status:** Approved
**Scope:** Phase 1 — simple payment only

## 1. Purpose

Demonstrate the use case of an EUDI wallet as a **payment instrument**, using two
purpose-built demo applications plus the existing `foundry` issuer/verifier
service.

The demo narrative, end to end:

1. A user logs into an online banking app.
2. They add their payment card to their EUDI wallet — the bank issues an EMVCo
   Digital Payment Credential (DPC) via `foundry`.
3. They shop in a demo merchant web shop and check out with "Pay with EUDI
   Wallet".
4. The wallet asks them to authorize **this specific amount to this specific
   merchant**, cryptographically binding the approval to those facts.
5. The merchant verifies the presentation via `foundry`, then debits the bank
   account over the bank's REST API.
6. The purchase appears in the bank's transaction list, balance reduced, badged
   as paid with the EUDI wallet.

This is a **closed loop**: money visibly moves as a consequence of a wallet
presentation. That is what makes the demo about payment rather than about
credential plumbing.

## 2. Scope

### In scope (this spec)

- Bank app: password login, dashboard (accounts, balances, cards,
  transactions), issuance of the DPC payment card credential to a wallet,
  credential state display, and a service-to-service debit endpoint.
- Merchant app: product catalogue, cart, checkout, a folded-in EudiPay payment
  screen, DPC presentation request with `transaction_data` amount binding, and
  settlement against the bank.
- Two deployable container images, deployment-agnostic, driven entirely by
  environment variables.

### Deferred to later specs

Each of these is additive and does not require rework of this phase:

- PID issuance and age verification (bank-issued).
- Merchant-issued loyalty credentials.
- Cart-dependent DCQL (age proof demanded only for age-restricted items;
  optional loyalty with discount).
- Same-device Digital Credentials API path.

The bank conceptually owns card + PID + age verification; this phase issues only
the card.

### Explicit non-goals

Named so they are understood as decisions rather than oversights:

- **No revocation at all.** There is no revoke endpoint and no revoked state.
  `foundry` exposes no admin revoke endpoint, so a bank-local flag would stop
  this bank accepting a credential while leaving it cryptographically valid
  everywhere else — a half-measure that misrepresents what revocation means.
  Issued credentials simply expire on `foundry`'s 12-hour DPC lifetime. Real
  status-list revocation requires a `foundry` change and belongs in its own
  spec.
- **No settlement reconciliation.** If a presentation verifies but the debit
  fails, the order stays `pending`, nothing is debited, and the user retries
  with a fresh presentation. A production system would need a reconciliation
  job; a demo does not.
- **No multi-replica support.** SQLite on a single-writer volume pins each app to
  one instance. Running two instances of either app against the same volume is
  unsupported and will corrupt state.
- **No rate limiting.** Passwords are hashed, but there is no lockout, reset, or
  throttling.
- **No component or visual regression tests.** The UI is judged by eye against
  the reference applications.

## 3. Prerequisite: foundry must serve `com.emvco.dpc.card`

**This is a hard blocker and must be resolved before any app code is written
against it.**

`foundry`'s checked-in `config.yaml` currently declares only the `pid`
credential type. `foundry` supports a `com.emvco.dpc.card` type (it ships in
`QUICKSTART_CONFIG`), but the existing config predates it.

Two resolution paths:

1. Re-run `cargo run -p foundry -- quickstart`. This regenerates the dev PKI,
   which invalidates any credential already held by a wallet.
2. **Recommended:** hand-add a `com.emvco.dpc.card` entry to the existing
   `credential_types` list, preserving the current PKI:

```yaml
credential_types:
  # ... existing pid entry ...
  - id: com.emvco.dpc.card
    format: dc+sd-jwt
    vct: com.emvco.dpc.card          # reverse-DNS identifier, not a URL
    cryptographic_holder_binding: true
    validity_seconds: 43200           # 12 hours
    display:
      - { name: "Payment Card", locale: en-US }
    claims:
      - path: [credential_id]
        selectively_disclosable: true
        required: true
      - path: [network]
        selectively_disclosable: true
        required: true
      - path: [card_id]
        selectively_disclosable: true
```

Claim shape is governed by the EMVCo DPC Schema Framework: `credential_id`
(string, required), `network` (string or array of string, required), `card_id`
(string, optional). All three are top-level; the credential has no nested
claims.

Additionally, because the wallet resolves the issuer itself from a phone,
`foundry`'s `issuer.credential_issuer` and
`server.wallet_facing.public_base_url` must be the **public HTTPS URL**, not
`localhost`. A `localhost` value fails the cross-device flow even though the QR
scans correctly — this is the failure mode most often misread as a `foundry`
bug.

### 3.1 Verification steps before app code is written

All three must be confirmed against the running binary, because the admin
OpenAPI schema types several of these fields as untyped JSON and therefore
cannot answer them:

1. **The credential type resolves.** `curl` `POST /admin/issuance/offers` with
   `credential_type_id: com.emvco.dpc.card` and confirm a `credential_offer_uri`
   comes back.
2. **The `transport` value round-trips.** The value is **`request_uri`** — this
   is settled, not a guess. Confirm a `request_uri` and an `openid4vp_uri` come
   back in the response. (`dc_api` is the other supported value and is deferred;
   see §9.5.)
3. **The accepted `transaction_data` entry shape — CONFIRMED 2026-08-05.**
   `foundry` accepts each `transaction_data` entry as a **plain JSON object**,
   not pre-base64url-encoded — confirmed against the running binary with:

   ```json
   {
     "transport": "request_uri",
     "dcql_query": { "credentials": [{ "id": "card", "format": "dc+sd-jwt",
       "meta": { "vct_values": ["com.emvco.dpc.card"] },
       "claims": [{ "path": ["credential_id"] }, { "path": ["network"] }] }] },
     "transaction_data": [{ "type": "payment", "credential_ids": ["card"],
       "amount": "47.98", "currency": "EUR", "merchant": "Demo Shop",
       "order_id": "ord_test" }]
   }
   ```

   → HTTP 200 with a `verification_id`. Decoding the signed request JWT served
   at the returned `request_uri` shows `foundry` does the OpenID4VP 1.0
   base64url-JSON encoding itself — the wire-format `transaction_data` entry is
   `base64url(JSON.stringify(entry))`, and `foundry` also injects
   `transaction_data_hashes_alg: ["sha-256"]` into each entry automatically. The
   caller therefore just POSTs plain JSON; no client-side encoding is needed.
   The possession-only DCQL fallback is not required.

## 4. Architecture

### 4.1 Repository layout

```
payment-banking-demo/
├─ pnpm-workspace.yaml
├─ package.json                  root scripts
├─ apps/
│  ├─ bank/                      Next 15 App Router · port 3001
│  │  ├─ src/app/                UI routes
│  │  ├─ src/app/api/            REST API (route handlers)
│  │  ├─ src/db/                 drizzle schema, migrations, seed
│  │  ├─ Dockerfile
│  │  ├─ .env.example
│  │  └─ next.config.ts
│  └─ merchant/                  Next 15 App Router · port 3000
│     └─ (same shape)
├─ packages/
│  ├─ foundry-client/            typed client for foundry's 4 admin endpoints
│  └─ ui/                        QR component, useStatusPoll, cn()
├─ docs/superpowers/specs/
└─ README.md                     the deployment contract
```

**No deployment artifacts in this repository.** Deployment topology — replicas,
volumes, Services, Ingress, Secrets, hostnames — belongs to whatever deploys
this, not to the applications. What replaces it is the documented contract in
§8.

Dockerfiles **do** stay in-repo: they describe how this source becomes an
artifact, which is the application's own concern, and they carry the pnpm
standalone-output knowledge that must live next to the code.

### 4.2 Runtime topology

Three processes. Only two are new code.

```
                    ┌──────── foundry ────────┐
                    │ :8443 wallet-facing     │◄──── EUDI Wallet (phone)
                    │ :9000 admin (Bearer)    │
                    └────▲───────────────▲────┘
         issuance admin  │               │  verification admin
                    ┌────┴────┐     ┌────┴─────┐
                    │  bank   │◄────│ merchant │
                    │ :3001   │ debit│  :3000   │
                    └─────────┘     └──────────┘
                       SQLite          SQLite
                    (mounted vol)   (mounted vol)
```

### 4.3 Trust boundaries

- **`foundry`'s admin listener is never publicly exposed.** Only the two apps
  reach it. Its admin key is a secret.
- **`foundry`'s wallet-facing listener must be publicly reachable over HTTPS**,
  because the phone talks to it directly during both flows.
- **The merchant→bank debit call is authenticated** with a shared secret
  (`BANK_API_KEY`) presented as `X-API-Key`. It is server-to-server; the browser
  never sees the key.
- **`packages/foundry-client` is the only code that knows `foundry`'s wire
  format.** If that admin API changes, one package changes.

### 4.4 Technology choices

| Choice | Decision | Reasoning |
|---|---|---|
| Framework | Next.js 15, App Router, React 19, TypeScript strict | Matches both reference apps |
| Package manager | pnpm workspaces | Requested; efficient for a small workspace |
| Styling | Tailwind CSS 4 | Both references use it |
| ORM | Drizzle | No codegen step, no binary engine in the container, migrations are readable SQL |
| Database | SQLite, one file per app, on a mounted volume | Durable across restarts; issued cards keep working |
| Validation | zod | Request bodies and environment |
| Auth (bank UI) | signed JWT in an HttpOnly cookie | Stateless; no session table |

**Backends are Next.js route handlers, not separate servers.** Each app's
`/api/*` surface is a real REST API — curl-able and documented — and the
merchant→bank call crosses the network exactly as it would between separate
services. This keeps the deployable count at two. A four-deployable split
(separate frontend and backend per app) was considered and rejected: it doubles
the deployment surface, adds CORS and service-discovery configuration, and
forces client-side fetching for every page, in exchange for a separation no
demo audience can observe.

### 4.5 What is shared and what is not

`packages/ui` holds the QR renderer, the status-polling hook, and `cn()`. The
polling hook earns sharing on its own: abort-on-unmount, consecutive-failure
threshold, timeout cap, and terminal-state detection are subtle enough that two
copies means fixing bugs twice.

**Design tokens are deliberately not shared.** The bank is Sparkasse red; the
merchant is teal with a blue payment overlay. Each app owns its own `globals.css`
theme block. Sharing them would yield one muddled palette instead of two apps
that look like they come from different companies — which is the point of the
demo.

## 5. Data model

### 5.1 Bank (`apps/bank`)

```
users            id, username, password_hash, display_name
accounts         id, user_id→users, iban, currency, balance_cents
cards            id, user_id→users, account_id→accounts,
                 pan_last4, network, card_alias, created_at
credentials      id, user_id→users, card_id→cards,
                 credential_id, foundry_tx_id, state,
                 issued_at
transactions     id, account_id→accounts, amount_cents, currency,
                 counterparty, reference, booked_at, credential_id?,
                 idempotency_key?  UNIQUE
```

`credentials.state`: `offered` → `active`, or `failed` if the `foundry` offer
could not be created at issuance step 4. There is no `revoked` state (§2).

`transactions.idempotency_key` is the column that makes `POST /api/payments`
idempotent: it carries the merchant's payment-session id, is `UNIQUE`, and is
null for seeded history. A repeated debit request finds the existing row by this
key and returns the original result instead of debiting again.

**`credentials.credential_id` is the load-bearing value of the entire system.**
It is a random opaque string the bank mints *before* creating the `foundry`
offer, and it is the only value that travels the full loop: bank → foundry →
wallet → merchant → bank. It is the join key that closes the loop.

**`cards` and `credentials` are separate tables** because they model different
things. `cards` is the physical-card fiction the dashboard displays
(`•••• 4242`, VISA). `credentials` is a digital instance derived from it. One
card can be issued to a wallet more than once — re-issuing after expiry produces
a second `credentials` row while the card itself is unchanged, and the old
credential stops working.

`transactions.credential_id` is nullable: seeded history has none, wallet
purchases carry the credential that authorized them. This is what lets the
dashboard label a row as paid with the EUDI wallet.

### 5.2 Merchant (`apps/merchant`)

```
products         id, name, description, price_cents, image_url, category
orders           id, total_cents, currency, customer_name, customer_email,
                 status, created_at
payment_sessions id, order_id→orders, foundry_verification_id, state,
                 openid4vp_uri, request_uri,
                 disclosed_claims_json, checks_json,
                 bank_tx_id, failure_reason, created_at
```

`orders.status`: `pending` → `paid`, or `cancelled` when the user cancels the
payment screen. A failed presentation or failed settlement leaves the order
`pending` so it can be retried (§6.3) — there is deliberately no `failed` order
status.

`payment_sessions.state`: `pending` → `verified` → `settling` → `completed`,
with `failed` reachable from any state.

**`payment_sessions` exists rather than proxying `foundry`** because it holds
what `foundry` does not: which order this was for, whether the subsequent bank
call succeeded, and a human-readable failure reason. Its state is a superset of
`foundry`'s. The `settling`/`completed` distinction is precisely the gap between
"the wallet proved the card" and "the money actually moved"; collapsing them
would make a failed debit indistinguishable from a failed presentation.

`disclosed_claims_json` and `checks_json` store `foundry`'s verdict verbatim, so
the success screen can display the real check results — including
`transaction_data_binding` — rather than a prettified retelling.

`products` is seeded and never written at runtime.

**Deliberately absent:** no `carts` table (the cart is client-side
`localStorage`, becoming an order only at checkout) and no `sessions` table (the
login cookie is a stateless signed JWT).

### 5.3 Seed data

- Bank: exactly 2 users with known passwords, one checking account each with a
  plausible balance, one card each, and 10 historical transactions each.
- Merchant: 6 products.
- `pnpm seed` resets both databases to these fixtures.

## 6. Flows

### 6.1 Flow A — Issuance (bank → wallet)

```
1. User logs in, clicks "Add to EUDI Wallet" on a card
2. POST /api/cards/{cardId}/credential          (session-authed)
3. Bank mints credential_id = "dpc_" + 24 random chars
   INSERT credentials (credential_id, card_id, state='offered')
4. Bank → foundry admin:
      POST /admin/issuance/offers
      { credential_type_id: "com.emvco.dpc.card",
        claims: { credential_id,
                  network: <cards.network>,
                  card_id: <cards.id> } }
   ← { transaction_id, credential_offer_uri, dc_api_offer }
5. Bank persists foundry_tx_id; returns { sessionId, offerUri }
6. Browser renders QR (desktop) or deep-link button (touch)
7. Wallet scans → talks to foundry :8443 directly → obtains credential
8. Browser polls GET /api/credentials/{id}/status every 2s
   → bank calls GET /admin/issuance/offers/{txId}
   → foundry reports state: offered → issued
9. On 'issued': credentials.state='active', issued_at=now
   Dialog shows success, dashboard refetches, card badged "In Wallet"
```

Two properties worth stating: the bank mints `credential_id` at step 3 **before**
`foundry` is involved, so the database row exists even if offer creation fails;
and at step 7 the wallet talks to `foundry` directly, with the bank entirely out
of that path — which is why `:8443` must be publicly reachable while `:9000`
must not.

### 6.2 Flow B — Payment (merchant → wallet → bank)

```
 1. Cart → checkout form (name, email) → "Pay with EUDI Wallet"
 2. POST /api/orders { items[], customer }
    Merchant recomputes total server-side from its own products table
    INSERT orders (status='pending')
 3. POST /api/payment-sessions { orderId }
    Merchant → foundry admin:
       POST /admin/verification/requests
       { transport: "request_uri",
         dcql_query: { credentials: [{ id: "card", format: "dc+sd-jwt",
                        meta: { vct_values: ["com.emvco.dpc.card"] },
                        claims: [{ path: ["credential_id"] },
                                 { path: ["network"] }] }] },
         transaction_data: [{ type: "payment",   // plain JSON — §3.1(3)
                              credential_ids: ["card"],
                              amount: "47.98", currency: "EUR",
                              merchant: "Demo Shop", order_id: <id> }] }
    ← { verification_id, openid4vp_uri, request_uri }
    INSERT payment_sessions (state='pending')
 4. Redirect to /pay/{sessionId}
 5. QR rendered from openid4vp_uri; wallet scans
    Wallet shows "Authorize €47.98 to Demo Shop" + claims to be shared
 6. User approves → wallet posts the VP directly to foundry :8443
 7. /pay polls GET /api/payment-sessions/{id} every 2s
    → merchant calls GET /admin/verification/requests/{vid}
    ← { state: 'verified',
        result: { verified: true, checks: [...],
                  claims: { credential_id, network } } }
 8. Gate: verified === true AND transaction_data_binding check passed
    → state='settling'
      POST {BANK_API_URL}/api/payments   (X-API-Key: BANK_API_KEY)
        { credential_id, amount_cents, currency,
          merchant: "Demo Shop", reference: "Order #123",
          idempotency_key: <sessionId> }
 9. Bank resolves credential_id → credentials → cards → accounts
    Rejects if: unknown credential · state !== 'active' · insufficient funds
    (credential expiry is enforced by foundry at presentation, not here)
    Else: balance -= amount; INSERT transactions (credential_id set)
    ← { bank_tx_id, new_balance_cents }
10. Merchant: state='completed', orders.status='paid', bank_tx_id stored
11. /pay shows success → redirect /success?orderId=
12. Bank dashboard shows the purchase, reduced balance, row badged "EUDI Wallet"
```

Three deliberate properties:

**The merchant never trusts the browser about money.** Step 2 recomputes the
total from its own `products` rows; the posted cart carries only ids and
quantities. The amount that enters `transaction_data` is the server's number, so
what the wallet asks the user to authorize cannot be tampered with client-side.

**`idempotency_key` is the payment session id.** Polling means step 8 can fire
twice — a slow response, a double render, a refresh. The bank stores the key and
returns the original result for a repeat, so a hiccup cannot double-charge.

**The settle gate checks `verified === true` AND that the
`transaction_data_binding` check passed** — not merely that state is `verified`.
`foundry` reports an honest verdict with a per-check list, and the entire value
of `transaction_data` is lost if the merchant settles without confirming that
specific check.

### 6.3 Failure handling

| Failure | Session state | What the user sees |
|---|---|---|
| Wallet declines / no matching credential | `failed` | "Payment was declined" + Try Again |
| 10 minutes elapsed | `failed` | "This payment request expired" |
| 5 consecutive poll errors | `failed` | "Lost connection to the payment service" |
| `verified: false` | `failed` | "Card could not be verified" + failing check names |
| Bank: insufficient funds | `failed` | "Payment declined by your bank" |
| Bank: unknown or expired credential | `failed` | "This card is no longer valid" |
| Bank unreachable during settle | `failed` | "Could not reach your bank" + Try Again |

The last row is the honest hard case: the presentation succeeded but settlement
did not. The order remains `pending`, nothing was debited, and a retry starts a
fresh presentation.

Polling behaviour, both apps: every 2s, 10-minute cap, error after 5 consecutive
failures, abort on unmount.

## 7. REST APIs

### 7.1 Bank (:3001)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | — | `{username,password}` → sets `bank_session` cookie |
| POST | `/api/auth/logout` | cookie | clears cookie |
| GET | `/api/auth/me` | cookie | `{userId, displayName}` |
| GET | `/api/accounts` | cookie | accounts with balances |
| GET | `/api/cards` | cookie | cards, each with credential state |
| GET | `/api/transactions?limit=&offset=` | cookie | transactions, newest first |
| POST | `/api/cards/{id}/credential` | cookie | start issuance → `{sessionId, offerUri}` |
| GET | `/api/credentials/{id}/status` | cookie | `{state}` — polled |
| POST | `/api/payments` | `X-API-Key` | the debit — merchant→bank |
| GET | `/api/health`, `/api/ready` | — | deployment contract |

`POST /api/payments` is the only endpoint with a different auth scheme, because
it is the only one called by another service rather than a browser.

### 7.2 Merchant (:3000)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/products`, `/api/products/{id}` | catalogue |
| POST | `/api/orders` | `{items[],customer}` → order; total recomputed server-side |
| GET | `/api/orders/{id}` | order with payment state |
| POST | `/api/payment-sessions` | `{orderId}` → foundry verification → `{sessionId, uri}` |
| GET | `/api/payment-sessions/{id}` | `{state, checks?, failureReason?}` — polled |
| POST | `/api/payment-sessions/{id}/cancel` | user cancelled |
| GET | `/api/health`, `/api/ready` | deployment contract |

`GET /api/payment-sessions/{id}` returns **only** `{state, checks?,
failureReason?}` — never the `openid4vp_uri` and never the disclosed claims.
The `/pay/{sessionId}` route obtains the URI once, server-side, when it renders
(it is a server component reading its own database), and passes it to the QR
component as a prop. The polled endpoint then carries state transitions only.
Exposing the presentation URI on a polled endpoint would let a bystander who
learns a session id hijack the request; keeping claims server-side means the
browser never handles disclosed credential data at all.

## 8. Deployment contract

The repository ships no deployment topology. Instead each app honours a contract
any deployment layer can satisfy.

| Contract term | Bank | Merchant |
|---|---|---|
| Listens on | `$PORT` (default 3001) | `$PORT` (default 3000) |
| Liveness | `GET /api/health` | `GET /api/health` |
| Readiness | `GET /api/ready` (verifies DB) | `GET /api/ready` |
| Writable path | `$DATABASE_PATH` — mount a volume at its directory | same |
| Migrations | run at boot, idempotent | same |
| Configuration | environment variables only | same |

### 8.1 Environment variables

**Bank**
```
PORT=3001
DATABASE_PATH=./data/bank.db
BANK_PUBLIC_URL=https://bank.demo.example
FOUNDRY_ADMIN_URL=http://foundry-admin:9000
FOUNDRY_ADMIN_KEY=<secret>
BANK_API_KEY=<secret>
SESSION_SECRET=<secret>
```

**Merchant**
```
PORT=3000
DATABASE_PATH=./data/merchant.db
MERCHANT_PUBLIC_URL=https://shop.demo.example
FOUNDRY_ADMIN_URL=http://foundry-admin:9000
FOUNDRY_ADMIN_KEY=<secret>
BANK_API_URL=http://bank:3001
BANK_API_KEY=<secret>
MERCHANT_NAME="Demo Shop"
```

`BANK_PUBLIC_URL` and `MERCHANT_PUBLIC_URL` are each app's own externally
reachable origin, used only to build absolute URLs in its own UI (redirects after
checkout, links in the issuance dialog). Neither app sends its public URL to
`foundry`; the wallet reaches `foundry` at `foundry`'s own configured
`public_base_url` (§3).

All environment is validated with zod at boot: a missing secret crashes the
process at startup with a named error rather than failing on the first request.
No URL is hardcoded anywhere; only non-secret values have localhost defaults.

### 8.2 Build note

pnpm's symlinked `node_modules` means each app's `next.config.ts` needs
`output: 'standalone'` **and** `outputFileTracingRoot` pointed at the workspace
root, or the resulting image ships without its workspace dependencies.

### 8.3 Root scripts

```jsonc
{
  "scripts": {
    "dev":     "pnpm -r --parallel run dev",
    "build":   "pnpm -r run build",
    "seed":    "pnpm -r run seed",
    "migrate": "pnpm -r run migrate",
    "check":   "pnpm -r --parallel run typecheck && pnpm -r run test"
  }
}
```

`pnpm dev` starts the merchant on :3000 and the bank on :3001 with interleaved,
prefixed output. Each app carries a `.env.example` so first run is copy two
files and go.

## 9. User interface

### 9.1 Bank — design tokens

Sourced from the `banking-frontend` reference.

```css
--primary:            oklch(0.6279 0.2576 29);   /* Sparkasse red */
--primary-foreground: oklch(0.99 0 0);
--background:         oklch(0.99 0.005 240);
--foreground:         oklch(0.18 0.03 250);
--card:               oklch(1 0 0);
--border:             oklch(0.92 0.01 250);
--header:             oklch(0.6279 0.2576 29);
--success:            oklch(0.65 0.17 155);
--destructive:        oklch(0.6 0.22 25);
--muted:              oklch(0.96 0.01 240);
```

Font `Inter`; base radius `0.75rem`; card shadow
`0 8px 32px -4px rgba(0,0,0,0.12), 0 2px 8px -2px rgba(0,0,0,0.06)`. A `.dark`
variant shifts to deep blue-greys with red retained. German UI strings.

### 9.2 Bank — screens

- **`/login`** — centered 420px card on an overlay; full-width red header block
  with the Sparkasse mark, "Sparkasse Musterstadt", and the tagline "Ihr
  verlässlicher Partner"; username and password fields; footer. Seeded
  credentials are displayed in a muted hint box — a demo nobody can log into is
  a bad demo.
- **`/` (dashboard)** — top nav (logo, Übersicht / Umsätze / Karten, Logout;
  hamburger below 640px). Account panel with IBAN and a large balance; card
  tiles showing `•••• 4242`, the network mark, and a state badge (`Nicht im
  Wallet` / `Im Wallet ✓`) with an "Zum EUDI Wallet hinzufügen"
  action; then the five most recent transactions, wallet-paid rows badged.
- **`/transactions`** — full paginated list reusing the same row component.
- **Issuance dialog** — modal with a framed QR on desktop or an "Im Wallet
  öffnen" button on touch devices, a status line, 2s polling; on success it
  becomes a green check and closes after 1.5s.

### 9.3 Merchant — design tokens

Sourced from the `eudipay-merchant-mock` reference.

```
brand      hsl(156 55% 27%)   ≈ #226855
brand-dark hsl(156 55% 20%)
accent     hsl(22 85% 62%)    ≈ #F4A34B
bg         hsl(36 33% 97%)    ≈ #F7F3F1
surface    #ffffff
text       hsl(222 18% 16%)   ≈ #1F2937
muted      hsl(220 9% 46%)    ≈ #6B7280
border     hsl(30 15% 90%)    ≈ #E8DFD7
success    hsl(142 60% 35%)
danger     hsl(0 72% 50%)
```

Font `Inter`; card radius 16px; shadows `0 10px 24px rgba(20,40,30,0.06)` and
`0 16px 32px rgba(20,40,30,0.1)` on hover.

### 9.4 Merchant — screens

- **`/`** — sticky header with wordmark and cart badge; gradient hero
  (`brand/10 → accent/10`); six-product grid; footer. Age-restricted products
  carry an `18+` chip on the shelf ticket.
- **`/cart`** — line items with quantity steppers, running total, checkout CTA.
- **`/checkout`** — two columns: a name/email form and the order summary, then
  the primary CTA "Pay with EUDI Wallet" in EudiPay blue `#004DD7` — the one
  place the merchant palette yields to the payment brand. When the basket holds
  an age-restricted product, a consequence line above the CTA states that the
  wallet will confirm the customer is over 18 and will not share a date of
  birth. **The payment sheet opens here, as a modal over this page**, with the
  form and basket still legible behind it; the session id is mirrored into
  `?session=` so a wallet round trip can re-open it. See
  `2026-08-19-payment-sheet-and-age-marking-design.md` §5.
- **`/pay/{sessionId}`** — the standalone fallback for deep links, reloads and
  shared URLs, which have no client cart to render behind the sheet. It
  server-renders the order's line items as that content. See §9.5.
- **`/success`** — green check, order number, total, and an expandable
  "Verification details" block listing `foundry`'s actual checks
  (`sd_jwt_vc_signature_and_kb_jwt`, `dcql_match`, `status_check`,
  `transaction_data_binding`).

### 9.5 The payment screen

The reference setup rendered this from a separate Vite application inside a
fullscreen iframe, communicating by `postMessage`. **That application is folded
into the merchant app as the route `/pay/{sessionId}`.** The iframe boundary and
all three `postMessage` message types collapse into local state transitions; the
`sessionId` and `gatewayUrl` query parameters become a route parameter plus
server-side configuration.

**The visual contract below was superseded on 2026-08-19.** See
`2026-08-19-payment-sheet-and-age-marking-design.md` §3 for the current design —
a saturated `#003BA8` field whose status indicator is the EU twelve-star ring,
with Archivo for the amount and IBM Plex Mono for machine values.

What that redesign **retained** from this section: `#004DD7`, `#FFCC00` and
`#FFEFB4`; `max-width` 400px; the ≤480px bottom-sheet behaviour with
`safe-area-inset-bottom`; `window.location.href = openid4vpUri` on coarse
pointers; `matchMedia("(pointer: coarse)")` for touch detection; no countdown
timer or progress bar; the auto-advance to `/success` after 1.5s.

What it **dropped**: Inter, the 1.5rem radius, the 6px top border, the 240px QR,
the 1.75rem/800 headline, the fullscreen `min-height: 100dvh` centring, and the
spinner. The `box-shadow` this section asked for had been silently dropped in
implementation and is restored.

States: awaiting-wallet (QR) · redirecting (spinner, touch devices) · success
(EU flag, "Payment Successful", auto-advance after 1.5s) · error (warning glyph,
message, Try Again and Cancel).

On touch devices the original emitted an `EUDIPAY_REDIRECT` message so its parent
window could follow the wallet deep link. With no parent, **this route navigates
to the deep link itself** (`window.location.href = openid4vpUri`) and shows the
redirecting spinner; polling continues when the browser is returned to. Touch
detection uses `matchMedia("(pointer: coarse)")` rather than user-agent sniffing,
matching the `banking-frontend` reference.

Two changes from the original, both consequences of no longer being an iframe:
**the amount and merchant are now displayed on this screen** (previously it had
no knowledge of what was being paid — the parent held that), and the
Digital-Credentials-API button is omitted from this phase, retained as a
documented extension point since `foundry` already returns `dc_api_request`
alongside the QR URIs.

## 10. Testing

Deliberately proportionate. Over-testing a demo is its own failure mode.

**Unit (vitest)** — the places where a bug is silent:

- amount recomputation from cart ids (never trust the client)
- `credential_id` → account resolution and each rejection path (unknown
  credential, credential not `active`, insufficient funds)
- idempotency: the same key twice debits once
- `foundry-client` request and response mapping, against fixtures captured from
  the real API
- the settle gate: `verified === true` **and** `transaction_data_binding` passed

**Integration (vitest, real SQLite in a temp directory)** — each route handler
against a migrated, seeded database with `foundry` stubbed at the HTTP boundary:
login and cookie handling, issuance start, status-poll transitions,
`POST /api/payments` including all rejections, order and payment-session
creation.

**Manual end-to-end**, scripted in the README: the full phone-in-hand
walkthrough. Automating a real wallet is out of scope, and mocking it would
produce tests that skip the only interesting part.

## 11. Implementation sequencing

The plan must sequence work so that a demoable state is reached as early as
possible:

1. **foundry prerequisite** (§3) — add the credential type and complete the
   three verification steps in §3.1. Blocks everything; the outcome of §3.1(3)
   decides whether amount binding is in or out.
2. Workspace scaffold, `foundry-client`, shared `ui`.
3. Bank: schema, seed, login, dashboard.
4. Bank: issuance flow. *First demoable milestone — a card lands in a wallet.*
5. Merchant: schema, seed, shop, cart, checkout.
6. Merchant: payment session, `/pay` screen, verification polling.
7. Settlement: bank `POST /api/payments`, merchant settle step, success screen.
   *Second milestone — the loop closes.*
8. Dockerfiles, README deployment contract, environment validation.