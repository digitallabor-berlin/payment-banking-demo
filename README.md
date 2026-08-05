# Payment Banking Demo

Two demo applications showing an EUDI wallet used as a **payment instrument**,
built against the [`foundry`](../foundry) issuer/verifier service.

- **`apps/bank`** — online banking. Issues an EMVCo Digital Payment Credential
  (`com.emvco.dpc.card`) into a user's EUDI wallet.
- **`apps/merchant`** — web shop. Requests that credential at checkout with
  `transaction_data` amount binding, then settles against the bank. *(Plan 2 —
  not yet implemented.)*

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
pnpm migrate
pnpm seed
pnpm dev          # bank on :3001, merchant on :3000 once it exists
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

### Building the image

The build context is the repository root, because a pnpm workspace build needs
the root manifests and the `packages/` sources. `docker` and `podman` are both
drop-in for this Dockerfile:

```bash
podman build -f apps/bank/Dockerfile -t payment-demo-bank:latest .
```

### Seeding a deployed instance

The runtime image carries only Next's standalone output plus the migrations — no
`src/` and no `tsx` — so the seed script **cannot** be run inside it. Seed by
pointing a local checkout at the same database file:

```bash
DATABASE_PATH=/path/to/mounted/bank.db \
  FOUNDRY_ADMIN_KEY=x \
  BANK_API_KEY=x \
  SESSION_SECRET=0123456789012345678901234567890123456789 \
  pnpm --filter @demo/bank run seed
```

Stop the container first. SQLite is single-writer, and seeding while the app
holds the file open risks a lock error or a half-reset database.

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