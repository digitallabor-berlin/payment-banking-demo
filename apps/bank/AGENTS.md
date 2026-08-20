# AGENTS.md — apps/bank

The online-banking app. Read the root `AGENTS.md` first — every constraint there
applies here. This file covers only what is specific to the bank.

## Role in the demo

The bank is the **credential issuer** and the **money mover**:

1. Issues a `com.emvco.dpc.card` credential into the user's wallet
   (`POST /api/cards/{id}/credential`, polled via
   `GET /api/credentials/{id}/status`). It also issues an age-verification
   attestation (`POST /api/credentials/av`) — see **Age-verification
   credential** below; that path's happy case has never run.
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

- `credentials.credentialTypeId` is the type discriminator:
  `com.emvco.dpc.card | av`, **defaulting to the DPC**. The default is what made
  migration `0001`'s backfill automatic and kept the eight pre-existing
  `insert(credentials)` sites compiling. The cost is real: an insert that
  *forgets* the field silently becomes a payment credential, so `startAvIssuance`
  names `av` explicitly and a test asserts it. Constants live in
  `src/lib/credential-types.ts`, bound to the schema enum with `satisfies`, in
  their own module so `payments.ts` can name the DPC type without importing the
  issuance path (which would drag in the foundry client, `env`, and the display
  builders).
- `credentials.cardId` and `credentials.credentialId` are both **nullable**. An
  age credential has neither: it attests a property of the person, and it
  discloses no join key at all. SQLite treats NULLs as distinct under a UNIQUE
  index, so the DPC uniqueness invariant survives.
- `credentials.credentialId` is **UNIQUE** — the loop's join key. States:
  `offered | active | failed`.
- **Three independent reasons an age credential cannot move money.**
  `processPayment` rejects a non-DPC `credentialTypeId`, rejects a null `cardId`
  (compiler-forced by the nullable column), and its lookup is
  `where credential_id = <string>`, which SQL never matches against NULL.
- **`drizzle-kit generate` emitted a broken `0001`.** The table rebuild's
  `INSERT … SELECT` listed `credential_type_id` on *both* sides, selecting a
  column the old table does not have (`no such column: "credential_type_id"`),
  which made the migration unrunnable and failed every test in
  `schema.test.ts`. The committed SQL is hand-edited to omit it so the column
  DEFAULT backfills. **Read generated migration SQL; do not assume it runs.**
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

## Age-verification credential

A second credential type, issued to the *person* rather than to a card.

- `src/lib/av-issuance.ts` — `startAvIssuance`, a deliberate **sibling** of
  `startIssuance`, not a branch inside it. The DPC path joins `accounts` for an
  IBAN, derives `card.last_four`, builds two display arrays and can fail
  `card_not_found`; none of that exists here.
- The request is exactly `{"credential_type_id": "av", "claims":
  {"age_over_16": true, "age_over_18": true}}`. Booleans. No birthdate, no name,
  no `credential_id` — an age attestation carrying a birthdate defeats its own
  purpose.
- **`credential_type_id` is `av`, never `eu.europa.ec.av.1`.** That second
  string is the mdoc docType configured on foundry's side.
- **Never send `offer_display` or `credential_response_display` for a non-DPC
  type.** `foundry-issuer/src/create_offer.rs` gates both on
  `ct.vct == "com.emvco.dpc.card"` and rejects them outright, so sending them
  would turn every AV issuance into a `failed` row. Consequence: the wallet's
  rendering of this credential comes entirely from foundry's static `display:`
  config, and `public/av-face.svg` is the bank's *own* UI artwork that the
  wallet never sees.
- `POST /api/credentials/av` uses `withSession` (no dynamic segment, so the
  wrapper's missing `context` forwarding does not bite). The status poll,
  `GET /api/credentials/[id]/status`, and `refreshIssuanceState` are reused
  **verbatim** — they read only `foundryTxId` and `state`, so they were already
  type-agnostic.
- `getAgeCredentialState` (`src/lib/queries.ts`) mirrors `listCards`'
  newest-non-failed-wins rule, scoped to the user. `listCards` needed no change:
  its inner lookup is `eq(credentials.cardId, card.id)`, a NULL comparison for
  every AV row.
- **The happy path has never run.** No foundry config declares an `av`
  credential type — the local `../foundry/config.yaml` has only `pid` and
  `com.emvco.dpc.card`, though its *named queries* already reference `av`.
  Adding it is the operator's task. Verified 2026-08-20 against a freshly
  restarted local foundry: a real `POST` answers **HTTP 400**
  `{"error":"unknown credential_type_id 'av'"}`, `startAvIssuance` returns
  `foundry_unavailable`, and the row lands `failed` with a null card and a null
  join key. That rejection is the whole of what has been exercised.
- **The AV issuance dialog's copy is unverified in a browser, and cannot be
  reached here.** `IssuanceDialog` only mounts once a `session` exists, i.e.
  after a 2xx offer. Its `failureBody` covers a *polling* failure after a
  successful offer — not an offer rejection. On a 502 the tile shows its own
  inline `Angebot konnte nicht erstellt werden.` and no dialog appears. The
  plan for this work expected the dialog's failure panel here; that expectation
  was unreachable by construction.

### Copy (`src/lib/credential-copy.ts`)

`FACE_COPY[type][faceState]` and `DIALOG_COPY[type]`, both keyed by credential
type id, both in `.ts` because every vitest project is `environment: "node"`
with `include: ["src/**/*.test.ts"]` — a string decided in a `.tsx` file is
never covered.

`IssuanceDialog` takes a `copy: IssuanceCopy` prop rather than a noun to
substitute: German gender differs (`die Karte` against `der Altersnachweis`), so
the article and possessive change with the noun, not just the noun.
`card-state.ts` still exports `STATE_COPY`, now as an alias of
`FACE_COPY[DPC_CREDENTIAL_TYPE_ID]`, so `CardTile` and its tests are untouched.

The `offered` explanation is **deliberately identical** for both types
(`Bestätigen Sie das Angebot in Ihrer Wallet-App.`) — the instruction genuinely
does not depend on what is being offered. A test pins it, because the plan's
original assertion that all three states differ was unsatisfiable against the
plan's own copy table.

The AV face is `.card-object-av`, overriding only `background-image` and
`background-color`. The fallback is `#ff0000`, the artwork's own red, *not*
Sparkasse `--color-primary` (`#EA0016`). Nothing is drawn over it and it gets no
`EuStars`: `.card-stars` is positioned top-right, exactly where the artwork
prints its wordmark.

## Testing

`pnpm test` → **148 tests**. `pnpm typecheck` must also be clean. (This line
read `87` before the age-credential work, which added 61 — 5 schema, 2 payment
guards, 7 queries, 7 av-issuance, 7 copy, and 33 that had accumulated
uncounted before it. Measure rather than trusting it; it has been wrong twice.)

`vitest.config.ts` carries an explicit `test.env` block; `env.ts` validates at
import time, so tests fail without it. `apiKey.test.ts` uses
`vi.mock("../env.js", ...)` plus a dynamic `await import` because of that same
import-time validation.
