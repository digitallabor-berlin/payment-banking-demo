# AGENTS.md — apps/bank

The online-banking app. Read the root `AGENTS.md` first — every constraint there
applies here. This file covers only what is specific to the bank.

## Role in the demo

The bank is the **credential issuer** and the **money mover**:

1. Issues a `com.emvco.dpc.card` credential into the user's wallet
   (`POST /api/cards/{id}/credential`, polled via
   `GET /api/credentials/{id}/status`).
2. Debits the account when the merchant presents a verified `credential_id`
   (`POST /api/payments`).

It is the **sole owner of credential state**. The merchant has no `credentials`
table and never persists one — it only forwards a `credential_id` string.

## Identity

- Port **3001**. German UI, Sparkasse-styled.
- Package `@demo/bank`.
- The only app with a login, so the only one with `jose` and `SESSION_SECRET`.

## Environment

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | no | `3001` | Listen port |
| `DATABASE_PATH` | no | `./data/bank.db` | SQLite file; directory must be writable |
| `BANK_PUBLIC_URL` | no | `http://localhost:3001` | Own external origin |
| `FOUNDRY_ADMIN_URL` | no | `http://127.0.0.1:9000` | foundry admin listener |
| `FOUNDRY_ADMIN_KEY` | **yes** | — | Bearer token for foundry's admin API |
| `BANK_API_KEY` | **yes** | — | Shared secret the merchant presents on `POST /api/payments`; must match the merchant's own `BANK_API_KEY` |
| `SESSION_SECRET` | **yes** | — | JWT signing key, ≥ 32 chars |

`cp .env.example .env.local` for local work.

## Schema (`src/db/schema.ts`)

`users`, `accounts`, `cards`, `credentials`, `transactions`.

- `credentials.credentialId` is **UNIQUE** — the loop's join key. States:
  `offered | active | failed`.
- `transactions.idempotencyKey` is nullable with a **UNIQUE index**. Nullable so
  seeded history rows can leave it empty (SQLite permits many NULLs under a
  unique index); unique so a replayed settle call cannot double-debit.
- `transactions.amountCents` is **negative for a debit**, positive for a credit.
- `transactions.credentialId` being non-null is what makes the UI render the
  "EUDI Wallet" badge — but via a derived boolean, not the raw value:
  `listTransactions` maps it to `paidWithWallet: row.credentialId !== null`
  (`src/lib/queries.ts`), and `TransactionRow` reads only that. The DTO
  deliberately never exposes the credential id to the browser.

## Seed fixtures (`src/db/seed.ts`)

Two users, password `demo1234` for both:

| User | Account | Balance | Card |
| --- | --- | --- | --- |
| `anna` (`user_anna`) | `acc_anna` | `348712` cents | `card_anna`, girocard 4242 |
| `ben` (`user_ben`) | `acc_ben` | `129540` cents | `card_ben`, girocard 8815 |

Ten booked transactions each (20 total). **No credentials are seeded** — issuing
one requires a real wallet. To exercise a payment path without a device, insert
a synthetic `active` credential with a scratch script (see root `AGENTS.md`).

`seed()` deletes every row first, so `pnpm seed` returns the demo to a known
state.

Two fixture properties are load-bearing for issuance, and `seed.test.ts` asserts
both against the seeded rows rather than the fixture array:

- **Every IBAN must end in four digits.** `lib/display-metadata.ts` derives the
  DPC `card.last_four` from the IBAN — *not* from `panLast4`, which is why
  `card_anna` sends `2051` (from `DE02120300000000202051`) and not `4242`.
  foundry enforces `^[0-9]{4}$` and rejects the entire offer otherwise.
- **Both cards are `girocard`.** It is the only network `NETWORK_LOGOS` has an
  asset for, and the merchant's own fixtures already assumed it — they used to
  disagree with the bank's `VISA`/`Mastercard`. An unknown network still yields a
  valid offer (branding degrades to a name with no logo), so this is a fidelity
  requirement, not a correctness one.

## DPC display metadata (`src/lib/display-metadata.ts`)

Issuance sends foundry two independent display arrays, validated against
*different* rules:

| Field | foundry stage | `last_four` / `alias` / `card_art` |
| --- | --- | --- |
| `offer_display` | `DisplayStage::Offer` | withheld — PII must not appear on an offer |
| `credential_response_display` | `DisplayStage::CredentialResponse` | required |

Validation is all-or-nothing: any deviation kills the offer, so a malformed
member surfaces as a **failed issuance**, not as a card missing its artwork. The
builders are therefore pure functions with their own tests — every vitest project
is `environment: "node"` with `include: ["src/**/*.test.ts"]`, so a decision
embedded in JSX or an inline literal would be uncovered.

Logo URLs (`files.digitallabor.dev`) are module constants on purpose: they are
brand assets, not per-deployment configuration. The card art is the exception —
it lives on the bank's own origin, so it comes from `BANK_PUBLIC_URL` through
`cardArtUrl` and resolves to `public/card-face.webp`, the same artwork the bank's
own UI draws.

**A rejected display is HTTP 500, not 400.** The body is
`{"error": "invalid request: <json path>: <reason>"}` — the error *code* is
`invalid_request` but the status is 500, so `startIssuance` maps it to
`foundry_unavailable`. Measured 2026-08-19.

**A stale foundry binary silently ignores both fields.** The local server had
been running since before the feature landed and returned `200` for a
deliberately invalid display, which makes a bare 200 worthless as evidence. Check
that the offer *echoes* `credential_offer.display`, or send a known-bad payload
and require a rejection, before believing a green result.

## Formatting

`src/lib/format.ts` — `formatEuroCents`, `formatIban`, `formatBookedAt`.

`formatEuroCents` uses **`Intl.NumberFormat("de-DE")`** → `3.487,12 €`. The
merchant's same-named function uses `"en-IE"` → `€3,487.12`. Do not copy one
over the other; the two apps are intentionally different locales.

## Auth

- Cookie `bank_session`, HttpOnly, signed JWT via `jose` (`src/lib/session.ts`).
- `requireSession` throws `UnauthorizedError`; `withSession` (`src/lib/api.ts`)
  wraps simple route handlers.
- **Dynamic-segment route handlers must use `requireSession` /
  `UnauthorizedError` directly, not `withSession`** — Next passes a `context`
  argument the wrapper does not forward. See
  `src/app/api/cards/[id]/credential/route.ts`.

## `POST /api/payments` — the settlement endpoint

The only endpoint authenticated by API key rather than a session cookie, because
it is the only one called by another service.

- `requireApiKey` (`src/lib/apiKey.ts`) compares `X-API-Key` with
  `timingSafeEqual`. **The length check before it is load-bearing** —
  `timingSafeEqual` throws `RangeError` on mismatched lengths rather than
  returning false.
- `processPayment` (`src/lib/payments.ts`) checks `idempotency_key` **first**. A
  repeat with the same key never re-evaluates credential state or balance; it
  replays the original result.
- The debit and the transaction insert happen in one `db.transaction`. The
  `catch` around it handles a genuine concurrent race losing to the UNIQUE
  index — it re-fetches and returns the winner's result rather than throwing.
  Not unit-tested, because single-threaded vitest cannot produce a real race;
  the sequential case is covered by the top-of-function check.
- Status mapping: `402` insufficient funds, `404` for **both**
  `unknown_credential` and `credential_not_active`. Both are 404 deliberately —
  server-to-server behind a shared secret, so existence-leak concerns do not
  apply, and the merchant maps both to one user-facing message.

Verified behaviour: anna at `348712` paying `4798` → `343914`, and a repeat with
the same `idempotency_key` returns the identical `bank_tx_id`.

## Issuance

- `src/lib/issuance.ts` — `startIssuance`, `refreshIssuanceState`,
  `DPC_CREDENTIAL_TYPE_ID`.
- `mintCredentialId` (`src/lib/credential-id.ts`) generates the opaque value
  carried in the credential.
- The credential row is written **before** foundry is called, so a foundry
  outage leaves a visible `failed` row rather than nothing.
- UI: `AddToWalletButton` → `IssuanceDialog` (status polling via `useStatusPoll`
  from `@demo/ui`). QR dark modules are `#ff0000`.
- **Issuance prefers the W3C Digital Credentials API** (`openid4vci-v1` via
  `navigator.credentials.create`), falling back to the deep link on touch or
  the QR on desktop. foundry's `POST /admin/issuance/offers` *always* returns
  `dc_api_offer` beside `credential_offer_uri` — two renderings of one offer,
  no transport parameter — so `dcApiOffer` is passed through the API but
  deliberately **not persisted**: the offer is already recorded by
  `foundryTxId`.
- Because both are renderings of the same offer, a DC API failure reveals the
  QR/deep link **immediately**, with no intermediate button. This is
  deliberately asymmetric with the merchant, where the fallback costs a whole
  new foundry verification request.
- A human testing this needs
  `chrome://flags/#web-identity-digital-credentials-creation` enabled. No
  origin-trial token is embedded in the markup, by design.
- **DC API diagnostic strings are English; all other copy stays German.** A
  browser-capability failure is a technical signal, not customer copy. The two
  strings are `"This browser does not support the Digital Credentials API."`
  and `"The wallet handover was cancelled."`.

## Testing

`pnpm test` → **87 tests**. `pnpm typecheck` must also be clean. (This line read
`77` while the real count was higher; measure rather than trusting it.)

`vitest.config.ts` carries an explicit `test.env` block; `env.ts` validates at
import time, so tests fail without it. `apiKey.test.ts` uses
`vi.mock("../env.js", ...)` plus a dynamic `await import` because of that same
import-time validation.
