# AGENTS.md — apps/merchant

The web shop and the folded-in payment screen. Read the root `AGENTS.md` first —
every constraint there applies here. This file covers only what is specific to
the merchant.

## Role in the demo

The merchant is the **verifier** and the **payment initiator**:

1. Creates an order with a **server-recomputed** total.
2. Opens a foundry verification request carrying `transaction_data` amount
   binding.
3. Polls foundry, applies the settle gate, then debits the bank over REST.
4. Shows foundry's real check results on the success screen.

## Identity

- Port **3000**. **English** UI (only the bank is German).
- Package `@demo/merchant`.
- **No login, so no `SESSION_SECRET` and no `jose`.** The shop is anonymous
  until checkout.

## Environment

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | no | `3000` | Listen port |
| `DATABASE_PATH` | no | `./data/merchant.db` | SQLite file; directory must be writable |
| `MERCHANT_PUBLIC_URL` | no | `http://localhost:3000` | Own external origin |
| `FOUNDRY_ADMIN_URL` | no | `http://127.0.0.1:9000` | foundry admin listener |
| `FOUNDRY_ADMIN_KEY` | **yes** | — | Bearer token for foundry's admin API |
| `BANK_API_URL` | no | `http://localhost:3001` | The bank's REST API |
| `BANK_API_KEY` | **yes** | — | Shared secret sent as `X-API-Key`; must match the bank's own `BANK_API_KEY` |
| `MERCHANT_NAME` | no | `Demo Shop` | Shown in the wallet prompt and on the bank statement |

## Schema (`src/db/schema.ts`)

`products`, `orders`, `payment_sessions`. Two tables are **deliberately absent**:

- **No `credentials` table** — the bank owns credential state entirely.
- **No cart table** — the cart is client-side `localStorage` only.

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

## Money handling

- `formatEuroCents` uses `Intl` (`en-IE`) — for display.
- `centsToDecimalString` uses **`toFixed`, never `Intl`** — its output is
  `transaction_data.amount`, which foundry machine-reads. An `Intl`-formatted
  `"1,000.00"` would silently break the amount binding.
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
3. Gate: `verified === true` **AND** `transaction_data_binding` passed. Reaching
   `verified` only means foundry finished checking.
4. Extract `credential_id`.
5. Write `verified`, then `settling`, then call the bank.

`passedTransactionDataBinding` (`src/lib/checks.ts`) **fails closed when the
check is absent**. A foundry that silently stopped enforcing amount binding
would report every other check as passing, so absence must never read as
success.

`verified` and `settling` are distinct states so that a crash between them is
diagnosable: `verified` means nothing was sent to the bank, `settling` means a
debit may be in flight. The resume path re-reads the stored claims instead of
re-polling foundry, so it stays correct even if foundry's record has expired.

`idempotencyKey` is always the **session id**.

On any failure only the *session* becomes terminal — the order stays `pending`
for retry.

### Open question

`extractCredentialId` handles **both** a claims shape nested under the DCQL query
id (`{ card: { credential_id } }`) and a flat one. Which is real has never been
observed — issuance was confirmed against live foundry, verification claims were
not. Both branches are kept deliberately. When a real wallet presentation
happens, dump `disclosed_claims_json`, delete the dead branch, and drop the
corresponding test.

## The payment screen — `/pay/{sessionId}`

The reference implementation was a separate Vite app in a fullscreen iframe
talking `postMessage`. Here it is **one route in this app**; the three message
types collapse into local state, and `EUDIPAY_REDIRECT` becomes a plain
`window.location.href` navigation (there is no parent frame to message).

- `app/pay/[sessionId]/page.tsx` is a **server component and the only place the
  presentation URI leaves the database**. The polled status endpoint must never
  carry it, so a bystander who guesses a session id cannot hijack the request.
- `.eudipay-*` classes in `globals.css` use **literal hex values, not theme
  tokens** — this screen is EudiPay-branded, not merchant-branded, and must not
  drift when the shop palette changes. Brand blue `#004DD7` (also the QR's dark
  modules), accents `#FFEFB4` / `#FFCC00`.
- On a touch device it follows the `openid4vp://` deep link instead of rendering
  a QR nobody can scan.
- **No countdown timer or progress bar.** The 10-minute cap lives in
  `useStatusPoll` and surfaces only if reached.
- `EudiPayLogo.tsx` is inline SVG — no binary asset.

## API surface

Response contract for `GET /api/payment-sessions/{id}` is exactly
`{ state, checks?, failureReason? }` — never the URI, never the disclosed claims.

`POST /api/payment-sessions/{id}/cancel` is the one failure that marks the
**order** cancelled rather than leaving it retryable.

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
|---|---|---|
| `prod_1` | Wireless Headphones | `12999` |
| `prod_2` | Mechanical Keyboard | `8999` |
| `prod_3` | Ceramic Pour-Over Set | `4499` |
| `prod_4` | Canvas Tote Bag | `2999` |
| `prod_5` | Desk Plant — Monstera | `3499` |
| `prod_6` | Notebook, Dot Grid | `1799` |

`seed()` touches **only `products`** — orders and payment sessions are runtime
data, and re-seeding mid-demo must not erase an in-progress order.

## Testing

`pnpm test` → **71 tests**. `pnpm typecheck` must also be clean.

`useCart` is not unit-tested (no DOM in this vitest environment) — it is verified
in a real browser via `tools/cdp/cdp.mjs`, as are the cart, checkout, payment,
and success screens.