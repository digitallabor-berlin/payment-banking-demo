# Payment Banking Demo

Two demo applications showing an EUDI wallet used as a **payment instrument**,
built against the [`foundry`](../foundry) issuer/verifier service.

- **`apps/bank`** — online banking. Issues an EMVCo Digital Payment Credential
  (`com.emvco.dpc.card`) into a user's EUDI wallet.
- **`apps/merchant`** — web shop. Requests that credential at checkout with
  `transaction_data` amount binding, verifies it through `foundry`, then
  settles by debiting the bank over its REST API.

Design: [`docs/superpowers/specs/2026-08-05-payment-banking-demo-design.md`](docs/superpowers/specs/2026-08-05-payment-banking-demo-design.md)

## Prerequisites

- Node ≥ 22, pnpm 10
- A running `foundry` with the `com.emvco.dpc.card` credential type configured
  (see the design doc §3). Its **wallet-facing** listener must be reachable from
  the phone running the wallet — a `localhost` URL will not work cross-device.
- For end-to-end testing: a phone with an EUDI wallet app.

## Quick start

```bash
pnpm install
cp apps/bank/.env.example apps/bank/.env.local
cp apps/merchant/.env.example apps/merchant/.env.local
pnpm migrate
pnpm seed
pnpm dev          # bank on :3001, merchant on :3000
```

Sign in at <http://localhost:3001/login> with **anna / demo1234** or
**ben / demo1234**.

`pnpm seed` is idempotent and destructive: it resets both databases to the
fixtures, which is how you return the demo to a clean state between runs.

## Scripts

| Command | Effect |
|---|---|
| `pnpm dev` | Every app in parallel, prefixed output |
| `pnpm build` | Production build of every app |
| `pnpm migrate` | Apply migrations to every app's database |
| `pnpm seed` | Reset every app's database to fixtures |
| `pnpm check` | Typecheck plus tests across the workspace |

## Deployment contract

This repository ships **no deployment topology** — no manifests, no Compose, no
Helm. Deployment belongs to whatever deploys it. Each app instead honours the
contract below, which any orchestrator can satisfy.

| Term | Bank | Merchant |
|---|---|---|
| Listens on | `$PORT` (default 3001) | `$PORT` (default 3000) |
| Liveness probe | `GET /api/health` | `GET /api/health` |
| Readiness probe | `GET /api/ready` (verifies the database) | same |
| Writable path | `$DATABASE_PATH` — mount a volume at its directory | same |
| Migrations | applied at first database access, idempotent | same |
| Configuration | environment variables only | same |
| Replicas | **exactly 1** — SQLite is single-writer | same |

### Bank environment

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | no | `3001` | Listen port |
| `DATABASE_PATH` | no | `./data/bank.db` | SQLite file; its directory must be writable |
| `BANK_PUBLIC_URL` | no | `http://localhost:3001` | Own external origin, for absolute links |
| `FOUNDRY_ADMIN_URL` | no | `http://127.0.0.1:9000` | foundry's **admin** listener — never expose publicly |
| `FOUNDRY_ADMIN_KEY` | **yes** | — | Bearer token for foundry's admin API |
| `BANK_API_KEY` | **yes** | — | Shared secret the merchant must present on `POST /api/payments` |
| `SESSION_SECRET` | **yes** | — | JWT signing key, ≥ 32 chars (`openssl rand -hex 32`) |

Every variable is validated with zod at boot. A missing secret **crashes the
process at startup** with a named error rather than failing on a later request.
This is enforced by `apps/bank/src/instrumentation.ts`, which Next.js runs once
when the server process starts; it must call `process.exit(1)` on failure
itself rather than letting the error propagate, or the container silently
degrades to every route 500ing forever without ever exiting — verified against
a real podman container while building this deployment contract.

### Merchant environment

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | no | `3000` | Listen port |
| `DATABASE_PATH` | no | `./data/merchant.db` | SQLite file; its directory must be writable |
| `MERCHANT_PUBLIC_URL` | no | `http://localhost:3000` | Own external origin |
| `FOUNDRY_ADMIN_URL` | no | `http://127.0.0.1:9000` | foundry's **admin** listener — never expose publicly |
| `FOUNDRY_ADMIN_KEY` | **yes** | — | Bearer token for foundry's admin API |
| `BANK_API_URL` | no | `http://localhost:3001` | The bank's REST API |
| `BANK_API_KEY` | **yes** | — | Shared secret sent as `X-API-Key` on `POST /api/payments`; **must match the bank's own `BANK_API_KEY`** |
| `MERCHANT_NAME` | no | `Demo Shop` | Shown in the wallet's authorization prompt and on the bank statement |

The merchant has no `SESSION_SECRET` because it has no login — the shop is
anonymous until checkout, and the cart lives in the browser's `localStorage`.

### Building the image

There is **one** `Dockerfile`, at the repository root, and it produces **one**
image containing both apps. The entrypoint argument selects which one a
container runs. The build context is the repository root, because a pnpm
workspace build needs the root manifests and the `packages/` sources. Use
`podman` (docker is not installed here); the CLIs are drop-in for this
Dockerfile.

```bash
podman build -t payment-demo:dev .

podman run -d --name pbd-bank -p 3001:3001 \
  -e FOUNDRY_ADMIN_KEY=x -e BANK_API_KEY=x \
  -e SESSION_SECRET=0123456789012345678901234567890123456789 \
  payment-demo:dev bank

podman run -d --name pbd-merchant -p 3000:3000 \
  -e FOUNDRY_ADMIN_KEY=x -e BANK_API_KEY=x -e MERCHANT_NAME=Larder \
  payment-demo:dev merchant
```

The entrypoint defaults `PORT` (bank 3001, merchant 3000) and `DATABASE_PATH`
(`/data/<app>.db`, the image's declared `VOLUME`) per app, so the two commands
above need no further configuration. `env.ts` defaults `DATABASE_PATH` to a
*relative* `./data/<app>.db`, which resolves under the app directory — owned by
root and unwritable by the image's non-root user. An explicit value still wins,
and the Kubernetes manifest sets both.

Anything other than `bank` or `merchant` exits `64` (`EX_USAGE`) with a usage
message, rather than silently starting the wrong app.

A local build on Apple Silicon produces an `arm64` image, useful for checking
layout and startup but **not** runnable on the cluster. The deployed
`linux/amd64` image is built in-cluster — see
`~/dev/dl-infra-k8s/payment-banking-demo/README.md`.

### Seeding a deployed instance

Nothing to do. Each app seeds itself at boot when its database is empty
(`src/instrumentation.ts` → `seedIfEmpty`), so a fresh volume comes up
demoable. A populated database is never touched — the guard is an empty-table
check, and the underlying `seed()` deletes rows before inserting.

To force a re-seed, destroy the volume. In Kubernetes that is `make reset` in
`~/dev/dl-infra-k8s/payment-banking-demo/`; locally, delete the SQLite file and
restart.

`pnpm seed` still exists for local development and resets to the fixtures
unconditionally.

## End-to-end walkthrough

This is the demo. It needs a phone with an EUDI wallet app, and a `foundry`
whose **wallet-facing** listener is reachable from that phone over HTTPS — a
`localhost` URL will not work cross-device.

    pnpm install
    cp apps/bank/.env.example apps/bank/.env.local
    cp apps/merchant/.env.example apps/merchant/.env.local
    pnpm migrate && pnpm seed
    pnpm dev            # bank :3001, merchant :3000

1. **Issue the card.** Open <http://localhost:3001/login>, sign in as
   **anna / demo1234**, and click "Zum EUDI Wallet hinzufügen" on the card
   tile. Scan the QR with the wallet and accept. The tile turns
   "Im Wallet ✓". Note the balance — **3.487,12 €**.
2. **Shop.** Open <http://localhost:3000>, add something to the cart, then go
   to checkout, fill in a name and email, and press "Pay with EUDI Wallet".
3. **Pay.** The `/pay` screen shows the amount, the merchant, and a QR with
   blue modules. Scan it. **The wallet prompt must show the same amount** —
   that is the `transaction_data` binding doing its job. Approve it.
4. **Watch it settle.** Within a few seconds the screen becomes "Payment
   Successful" and redirects to the success page, which lists `foundry`'s
   real checks including `transaction_data_binding`.
5. **See the money move.** Back at <http://localhost:3001>, the balance is
   reduced by the order total and the newest transaction is badged
   "EUDI Wallet".

To run it again from a clean state: `pnpm seed`.

### Trying the failure paths

- **Declined by the wallet** — reject the prompt instead of approving. The
  screen shows "Your card could not be verified" with a Try Again button.
- **Insufficient funds** — order more than the account holds. The
  presentation succeeds, the debit does not, and the order stays `pending`,
  so Try Again starts a fresh presentation.
- **Bank unreachable** — stop the bank's dev process before approving. The
  screen reports "Could not reach your bank. Nothing was charged." Nothing is
  debited and the order stays `pending`.

## Security notes

- foundry's **admin** listener must never be publicly reachable. Only the two
  apps call it.
- foundry's **wallet-facing** listener must be publicly reachable over HTTPS —
  the wallet talks to it directly.
- `POST /api/payments` is the only bank endpoint authenticated by API key rather
  than a session cookie, because it is the only one called by another service.

## Known limitations

Deliberate, documented in the design doc §2:

- **No revocation.** foundry exposes no admin revoke endpoint, so credentials
  simply expire on their 12-hour lifetime.
- **No settlement reconciliation.** If a presentation verifies but the debit
  fails, the order stays pending and nothing is debited; the user retries.
- **Single replica only.** SQLite on a single-writer volume.
- **No rate limiting**, no account lockout, no password reset.
- **Concurrent payment sessions per order are possible.** Nothing prevents
  opening several sessions for one `pending` order; whichever the user
  completes wins and the rest expire in `foundry`. Double-charging is
  prevented by the bank's `idempotency_key`, not by a schema constraint.