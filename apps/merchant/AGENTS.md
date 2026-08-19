# AGENTS.md — apps/merchant

The web shop and the folded-in payment screen. Read the root `AGENTS.md` first —
every constraint there applies here. This file covers only what is specific to
the merchant.

## Role in the demo

The merchant is the **verifier** and the **payment initiator**:

1. Creates an order with a **server-recomputed** total and **persisted line
   items**.
2. Opens a foundry verification request by **named query reference**, carrying
   `transaction_data` amount binding.
3. Polls foundry, applies the settle gate, then debits the bank over REST.
4. Shows foundry's real check results on the success screen.

## Identity

- Port **3000**. **English** UI (only the bank is German).
- Package `@demo/merchant`.
- **No login, so no `SESSION_SECRET` and no `jose`.** The shop is anonymous
  until checkout.

## Environment

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | no | `3000` | Listen port |
| `DATABASE_PATH` | no | `./data/merchant.db` | SQLite file; directory must be writable |
| `MERCHANT_PUBLIC_URL` | no | `http://localhost:3000` | Own external origin |
| `FOUNDRY_ADMIN_URL` | no | `http://127.0.0.1:9000` | foundry admin listener |
| `FOUNDRY_ADMIN_KEY` | **yes** | — | Bearer token for foundry's admin API |
| `BANK_API_URL` | no | `http://localhost:3001` | The bank's REST API |
| `BANK_API_KEY` | **yes** | — | Shared secret sent as `X-API-Key`; must match the bank's own `BANK_API_KEY` |
| `MERCHANT_NAME` | no | `Demo Shop` | Shown in the wallet prompt and on the bank statement; also `transaction_data.payload.payee.name` |
| `MERCHANT_PAYEE_ID` | **yes** | — | `transaction_data.payload.payee.id`. Required with no default on purpose: it is hashed into `transaction_data_hashes` and shown to the holder, so a placeholder would ship an untrue identifier inside a signed authorization |

## Schema (`src/db/schema.ts`)

`products`, `orders`, `order_items`, `payment_sessions`. Two tables are
**deliberately absent**:

- **No `credentials` table** — the bank owns credential state entirely.
- **No cart table** — the cart is client-side `localStorage` only. `order_items`
  is not one: it is written at checkout from server-side prices, never from the
  browser's cart.

`order_items` exists because the *composition* of a basket is load-bearing at
payment time, not just its total — see "Named queries" below. `unit_price_cents`
is a snapshot of what was charged; the age-restriction decision deliberately is
**not** snapshotted, and is re-derived from `product_id` every time a session
starts.

`payment_sessions.named_query_ref` (`dpc` | `dpc_av`) records which foundry
named query the session asked for. Recorded rather than recomputed, for the same
reason `transport` is: the settle gate must know whether an age attestation was
actually *requested* before it can treat a missing one as a failure, and
re-deriving it at poll time would silently change the verdict if the restricted
set were edited mid-session.

State machines:

- `orders.status`: `pending → paid`, or `pending → cancelled`. **There is no
  `failed`.** A failed presentation or failed settlement leaves the order
  `pending` so it can be retried. Only an explicit user cancel makes it
  `cancelled`.
- `payment_sessions.state`: `pending → verified → settling → completed`, with
  `failed` reachable from any of the first three.

**`payment_sessions` has no UNIQUE index on `order_id`, on purpose.** Spec §6.3
requires a retry to "start a fresh presentation" for the same order, so a
one-to-one constraint would contradict the retry semantics. The invariant that
matters — at most one *live* session per order — is enforced in code by
`startPaymentSession` requiring `order.status === "pending"`. A schema test pins
the permissive behaviour so a future "tidy-up" that adds the index fails loudly.

Accepted limitation: concurrent sessions for one pending order are possible.
Double-charging is prevented by the bank's `idempotency_key`, not by the schema.

## Named queries — `src/lib/dcql.ts`

The merchant sends **`named_query_ref`, never an inline `dcql_query`**. foundry
prefers an inline query when both are present, so sending both would silently
ignore the named one.

- `dpc` — the DPC card alone (`network`, `card_id`, `credential_id`).
- `dpc_av` — the same card **plus** an `av` credential: an ISO mdoc EU Proof of
  Age (`eu.europa.ec.av.1`) whose only requested element is `age_over_18`. So
  the escalation asks for one extra boolean and never a birthdate.

`selectNamedQuery` escalates to `dpc_av` when the basket contains any of
`AGE_RESTRICTED_PRODUCT_IDS` = `beer`, `wine`, `aperitif` — **ids, not
categories**: the whole `Drinks` aisle is not restricted (mineral water lives
there). It takes product ids rather than an order id so the decision is pure and
testable; the caller reads them from `order_items`, never from the browser.

Both queries declare a credential with `id: dpc`, so `transaction_data`'s
`credential_ids` is `["dpc"]` in both cases — the money binds to the card, never
to the age attestation. **foundry validates this**: verified 2026-08-19 against
the deployed instance, `credential_ids: ["card"]` (this app's old value) is a
hard `400 transaction_data[0] references credential id 'card' which is not
present in the DCQL query`.

Both named queries live in foundry's config, not here. They are absent from
`../foundry/config.yaml` (which has only `over18`) and present in the deployed
`dl-infra-k8s/foundry/foundry_config.yml`, so **the age path cannot be exercised
against a stock local foundry.**

That deployed config carries a loud warning that `dpc_av` "CANNOT be fully
verified" because foundry accepts one credential per `vp_token`. **That warning
is stale.** The deployed openapi serves `VerificationResult.credentials[]` and
`verify.rs` has `select_presentations` (plural) with a test named *"several
credential queries is the point, not an error"*.

## Money handling

- `formatEuroCents` uses `Intl` (`en-IE`) — for display.
- `centsToDecimalString` uses **`toFixed`, never `Intl`** — its output is the
  numeric half of `transaction_data.payload.amount_display` (`"€ 47.98"`), which
  is hashed into `transaction_data_hashes` and compared byte-for-byte. An
  `Intl`-formatted `"1.000,00"` or `"1,000.00"` would silently break the amount
  binding on a differently-configured host.
- The symbol-first `€` form is deliberate, not German `47,98 €` — it mirrors the
  shape of the reference `transaction_data` example and keeps the string a pure
  `toFixed` concatenation.
- **`OrderItemInput` structurally cannot carry a price** — it has only
  `productId` and `quantity`. There is no client-supplied number to forget to
  ignore. The zod schema on `POST /api/orders` accepts the same two fields only.
  Demonstrated: posting `priceCents: 1` and `totalCents: 1` still yields the
  correct server-computed total.

## The settle gate — `src/lib/payment-sessions.ts`

`refreshPaymentSessionState` is the heart of the app. Order of operations is the
whole point:

1. Terminal states short-circuit — no re-polling, no double-charge.
2. Poll foundry.
3. Gate: `verified === true` **AND** `transaction_data_binding` passed on the
   `dpc` credential. Reaching `verified` only means foundry finished checking.
4. Age gate, **only when the row says `named_query_ref === "dpc_av"`**:
   `age_over_18 === true` on the `av` credential, else
   `age_verification_failed`.
5. Extract `credential_id`.
6. Write `verified`, then `settling`, then call the bank.

**Everything in `src/lib/checks.ts` reads `result.credentials`, never
`result.checks`.** foundry's top-level `checks` array carries cross-cutting
checks only (`jwe_decryption`, `requested_credentials_answered`) and
structurally cannot contain `transaction_data_binding`, which lives on the
credential it was bound to. An earlier version of this app searched the
top-level array and would have failed every payment closed.

Every read is scoped to a `query_id`. That is load-bearing: foundry holds claims
and checks per credential and never merges them, because merging is a
correctness bug rather than a presentation choice — two credentials disclosing
the same claim name collide, and a check reported for one would appear to vouch
for another. Searching the whole verdict for a passing check reintroduces
exactly that.

`passedTransactionDataBinding` and `passedAgeVerification` both **fail closed
when the check or claim is absent**. A foundry that silently stopped enforcing
amount binding would report every other check as passing; and requesting
`age_over_18` then settling without it would make the escalation decorative.

`age_over_18` is read at `claims["eu.europa.ec.av.1"]["age_over_18"]`, not
flat: an mdoc DCQL claim path is `[namespace, element]` and foundry nests
disclosed mdoc elements under the namespace verbatim (the
`disclosed_claims.insert(ns, ...)` loop in `verify.rs`). Comparison is strict
`=== true`, never truthiness — `"false"` is a truthy string.

`checks_json` stores the cross-cutting checks **and** every per-credential one,
flattened, for display only. The gates read the structured verdict.

`verified` and `settling` are distinct states so that a crash between them is
diagnosable: `verified` means nothing was sent to the bank, `settling` means a
debit may be in flight. The resume path re-reads the stored credentials instead
of re-polling foundry, so it stays correct even if foundry's record has expired.

`disclosed_claims_json` holds foundry's **`credentials[]` array verbatim**, not
a merged claims object — the column name predates the shape. A row written
before that change parses to the old shape, yields no credential id, and fails
closed, which is the right direction for a mid-flight schema change.

`idempotencyKey` is always the **session id**.

On any failure only the *session* becomes terminal — the order stays `pending`
for retry.

### Resolved: the disclosed-claims shape

`extractCredentialId` used to keep two plausible branches because the response
had never been observed. That is settled: the deployed foundry's openapi and
`verify.rs` both pin it. Nesting is by `query_id` in `credentials[]`; SD-JWT
claims sit **flat** inside that credential's own `claims` object. The dead
branch is gone.

Still unobserved — and this is the part a wallet is needed for: no real
presentation has ever been verified, so the *values* have never been seen, only
the schema. In particular an `av` credential has never actually been returned.

## The payment sheet — a modal on `/checkout`, plus `/pay/{sessionId}`

The reference implementation was a separate Vite app in a fullscreen iframe
talking `postMessage`. Here it is **a modal inside this app**; the three message
types collapse into local state, and `EUDIPAY_REDIRECT` becomes a plain
`window.location.href` navigation (there is no parent frame to message).

- **The sheet opens over `/checkout` and does not navigate.** `CheckoutPanel`
  owns both the form and the sheet, marks the page behind it `inert`, and
  mirrors the session id into `?session=` with `replace` — so a wallet round
  trip that leaves the tab can rebuild the sheet from the URL alone.
  `/pay/{sessionId}` remains for deep links, reloads and shared URLs, which have
  no client cart; there it renders the order's own line items behind the sheet
  so the scrim has something real to dim.
- **`loadCheckoutSession` is the single place the sheet's props are assembled.**
  Both `/checkout` and `/pay/[sessionId]` call it. Adding a second assembler is
  exactly how the two routes drift — the standalone route used to build the
  props itself and had already fallen behind by one prop.
- **The rendering decision is `lib/sheet-state.ts`, not JSX.** `selectSheetView`
  maps state + transport + poll outcome onto one `SheetView`, and
  `PaymentScreen` only renders it. Every vitest project is `environment:
  "node"` with `include: ["src/**/*.test.ts"]`, so a `.tsx` file is never
  covered; keeping the branching in a `.ts` module is the only way these six
  states are testable at all.
- **The cart is cleared on completion, in `PaymentScreen`** — not when the form
  is submitted. The basket is what the sheet sits over, and a declined payment
  has to leave it intact.
- `app/pay/[sessionId]/page.tsx` is a **server component and the only place the
  presentation URI leaves the database**. The polled status endpoint must never
  carry it, so a bystander who guesses a session id cannot hijack the request.
  Being a server component is also why it passes no `onClose`: it cannot hand a
  function across the boundary, so the sheet falls back to navigating home,
  which is right — there is no page underneath to return to.
- `.eudipay-*` classes in `globals.css` use **literal hex values, not theme
  tokens** — this screen is EudiPay-branded, not merchant-branded, and must not
  drift when the shop palette changes. Brand blue `#004DD7` (also the QR's dark
  modules), accents `#FFEFB4` / `#FFCC00`.
- **The DC API wins wherever it is available — touch and desktop alike.** The
  deep link is now only the *touch fallback*, and the QR only the desktop
  fallback. On a `dc_api` session the screen shows a "Pay with your wallet"
  button and the auto-redirect effect returns early; there is no URI to follow
  and `credentials.get()` requires a user gesture anyway, so the zero-click
  Android redirect is deliberately given up.
- **Transport is fixed when the session is created**, because it changes the
  OpenID4VP wire. Detection therefore lives in `CheckoutForm`, not here, and
  travels in the `POST /api/payment-sessions` body as `dcApi: boolean`.
  `PaymentScreen` never calls `useDcApiSupport` and has no `null` phase — by
  the time it renders, `transport` is a fact on the row.
- On failure the screen shows an explicit **"Show QR code"** button rather than
  silently swapping in a QR: a user who just dismissed a wallet sheet would not
  understand a QR appearing on its own. It mints a fresh `request_uri` session
  for the same still-pending order. `tryAgain` in contrast *preserves*
  `dc_api`, since the session existing at all proves the browser supports it.
- **No countdown timer or progress bar.** The 10-minute cap lives in
  `useStatusPoll` and surfaces only if reached.
- **The status indicator is `EudiPayRing`, inline SVG — no binary asset.** It
  draws the EU twelve stars and a centre glyph, and replaced both `EudiPayLogo`
  and `StatusMark` (deleted 2026-08-19; the **bank** keeps its own separate
  `StatusMark.tsx`). A spinner cannot express "eleven of twelve, the last one
  belongs to the bank", and cannot express "declined" at all.
- **The `18+` chip is `18+`, never `+18`**, and it uses Larder's palette rather
  than EudiPay's — an age restriction is the grocer's obligation, not the
  payment brand's. `AGE_RESTRICTED_PRODUCT_IDS` in `lib/dcql.ts` is the single
  source of truth, read through `isAgeRestricted`, which `selectNamedQuery` also
  calls — so the shelf tag and the `dpc` → `dpc_av` escalation cannot disagree.
  There is no `products` column for this.

## API surface

Response contract for `GET /api/payment-sessions/{id}` is exactly
`{ state, checks?, failureReason? }` — never the URI, never the disclosed claims.

`POST /api/payment-sessions/{id}/cancel` is the one failure that marks the
**order** cancelled rather than leaving it retryable.

`POST /api/payment-sessions/{id}/dc-api-response` relays the wallet's encrypted
JWE to foundry. It exists **only** because foundry's `dc-api-response` endpoint
is admin-authenticated and the admin key must never reach a browser. It returns
**204 and discards foundry's `VerificationResult`** on purpose: the verdict
reaches the UI through the poll that is already running, so there is one state
path rather than two.

`GET /api/orders/{id}` exists and is curl-able, but there is no "my orders"
page — the demo's narrative ends at the success screen and continues in the
bank's transaction list.

## UI notes

- **No product images.** `products.imageUrl` stays in the schema because the
  spec's data model lists it, but `ProductCard` renders a deterministic
  category-coloured monogram tile instead, so nothing depends on asset files
  that do not exist. `ProductDto` omits the field, and a test pins the key set.
- Pages that read the database do so **directly as server components**. The
  `/api/*` routes exist because the spec requires a real curl-able REST surface,
  not because the pages need them.
- `useCart` dispatches a custom `demo-shop-cart-change` event after every write.
  The native `storage` event only fires in *other* tabs, so without it the
  header badge would not update when the cart page mutates the cart in the same
  tab. Both listeners are registered.

## Seed fixtures (`src/db/seed.ts`)

Six products, `prod_1` … `prod_6`, across Electronics / Home / Accessories:

| id | name | cents |
| --- | --- | --- |
| `prod_1` | Wireless Headphones | `12999` |
| `prod_2` | Mechanical Keyboard | `8999` |
| `prod_3` | Ceramic Pour-Over Set | `4499` |
| `prod_4` | Canvas Tote Bag | `2999` |
| `prod_5` | Desk Plant — Monstera | `3499` |
| `prod_6` | Notebook, Dot Grid | `1799` |

`seed()` touches **only `products`** — orders and payment sessions are runtime
data, and re-seeding mid-demo must not erase an in-progress order.

## Testing

`pnpm test` → **131 tests**, measured 2026-08-19. `pnpm typecheck` must also be
clean. (The `71` that stood here was stale by 60 — measure, never trust a number
in a doc.)

`useCart` is not unit-tested (no DOM in this vitest environment) — it is verified
in a real browser via `tools/cdp/cdp.mjs`, as are the cart, checkout, payment,
and success screens.
