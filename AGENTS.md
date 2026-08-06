# AGENTS.md — payment-banking-demo

Instructions for AI agents working in this repository. Read this before making
changes. Per-app specifics live in `apps/bank/AGENTS.md` and
`apps/merchant/AGENTS.md`.

## What this is

A demo proving the EUDI wallet works as a **payment instrument**. Two Next.js
apps talk to an external Rust issuer/verifier (`foundry`, at `../foundry`):

1. `apps/bank` issues an EMVCo Digital Payment Credential (`com.emvco.dpc.card`)
   into a user's wallet.
2. `apps/merchant` requests it at checkout with `transaction_data` amount
   binding, verifies via `foundry`, then debits the bank over REST.
3. The purchase appears in the bank's transaction list.

`credential_id` is the join key between the two apps. The bank is the **sole
owner** of credential state — the merchant never persists it.

## Layout

```
Dockerfile          ONE image containing BOTH apps (see below)
docker-entrypoint.sh  Takes `bank` or `merchant`; anything else exits 64
.dockerignore       Must live here, at the build-context root
apps/bank/          Next.js 15, port 3001, German UI
apps/merchant/      Next.js 15, port 3000, English UI
packages/foundry-client/   Typed client for foundry's admin API
packages/ui/        Shared hooks + QrCanvas (NOT shared design tokens)
docs/superpowers/specs/    Design spec — the source of truth
docs/superpowers/plans/    Implementation plans 1-3 (all executed)
tools/cdp/          Headless-Chrome driver for ad hoc browser verification
```

There are no per-app Dockerfiles. `apps/bank/Dockerfile` and
`apps/merchant/Dockerfile` were deleted in favour of the root one.

Reference apps at `../foundry`, `../eudipay-merchant-mock`,
`../banking-frontend`, `../eudipay-frontend` are **visual/UX references only**.
Copy the design, not the architecture.

## Commands

Run from the repo root. `pnpm`, never `npm`.

| Command | Effect |
|---|---|
| `pnpm dev` | Both apps in parallel, prefixed output |
| `pnpm check` | `typecheck && test` across all 4 projects — **the gate** |
| `pnpm migrate` | Apply migrations to both databases |
| `pnpm seed` | Reset both databases to fixtures (idempotent, destructive) |
| `pnpm build` | Production build of both apps |

`pnpm check` must be green before you claim work is done. Current baseline:
**186 tests** (85 bank + 87 merchant + 7 foundry-client + 7 ui), measured.

That number was **162** for most of this project's life, and a stale `162` is
still quoted in the Plan 3 document. The difference is not drift: 20 of those
tests arrived with in-flight UI work that sat uncommitted in the working tree
for a long stretch, and 4 are the `seedIfEmpty` tests. If a count disagrees with
yours, measure — do not trust a number written in a plan.

## Hard-won constraints

Every item below was discovered by something breaking. Do not "clean up" any of
them without reading the linked reasoning first.

### Build and tooling

- **Every Next app's `next.config.ts` must set**
  `webpack(config) { config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] }; return config; }`.
  Local imports are written `./foo.js` for a `./foo.ts` file (correct Node ESM
  form, needed so vitest and tsc agree). Turbopack resolves that natively;
  `next build`'s webpack resolver does not, and every such import fails with
  "Module not found" without it.

- **`better-sqlite3` must be `^13.0.3`.** The `^11.x` line fails to compile
  against current Node's V8 (`GetPrototype`, `Context::GetIsolate`,
  `PropertyCallbackInfo::This` were removed).

- **There is ONE Dockerfile, at the repo root, producing ONE image for both
  apps.** The entrypoint takes `bank` or `merchant`. Its `pnpm install` runs
  *after* `COPY . .` on purpose: `.npmrc` sets `node-linker=hoisted`, so
  third-party packages hoist to the root `node_modules` but the `@demo/*`
  workspace links exist only in `apps/<app>/node_modules` (verified:
  `node_modules/@demo` does not exist). A `deps` stage that copies just
  `/repo/node_modules` drops them and `next build` cannot resolve `@demo/ui`.
  Do not "optimise" this back into a separate deps stage.

- **`.dockerignore` must be at the repo root.** Builds use the root as context,
  and Docker only honours `<context>/.dockerignore`. Two per-app `.dockerignore`
  files previously sat at paths Docker never reads and were silently inert,
  which let the host's `node_modules` — including an `arm64` `better-sqlite3`
  addon — leak into the build. That also masked the deps-stage bug above, so the
  earlier "verified in a real podman container" claim for those Dockerfiles only
  held by accident.

- **`docker-entrypoint.sh` defaults `PORT` and `DATABASE_PATH` per app.**
  `env.ts` defaults `DATABASE_PATH` to a *relative* `./data/<app>.db`, which
  resolves under the app directory — owned by root, unwritable by `USER 1000`,
  so both apps exited 1 at boot with `EACCES` until the entrypoint pointed them
  at `/data`. `PORT` is defaulted for the same class of reason: Next uses 3000
  for both apps, so `podman run -p 3001:3001 <image> bank` would otherwise
  listen on the wrong port and every request would hang. Explicit values win.

- **Root `package.json` needs `pnpm.onlyBuiltDependencies: ["better-sqlite3"]`.**
  pnpm 10 blocks native postinstall scripts by default.

- **App `package.json` files deliberately have NO `"type": "module"`.** Next's
  generated standalone `server.js` is CommonJS and ships alongside that same
  manifest; adding it crashes the container at boot. The *root* package.json
  does have it — that is correct and different.

- **`instrumentation.ts` must live under `src/`, not the package root**, for the
  `src/app` layout. Next computes the hook root as the parent of `app/`. A file
  at the package root is silently ignored with no build warning.

- **That hook must call `process.exit(1)` itself** on env-validation failure. A
  bare `throw` is not reliably fatal — it can degrade to permanent per-request
  500s without the process ever exiting, which is a far weaker signal for an
  orchestrator than a hard crash.

- **TypeScript is strict with `noUnusedLocals` and `noUnusedParameters`.** An
  intentionally-unused parameter must be prefixed `_` (see
  `refreshPaymentSessionState`'s `_now`).

- **`vitest.config.ts` needs an explicit `test.env` block** in each app —
  `env.ts` validates at import time, so tests fail without it.

### Running ad hoc scripts

- **Use a scratch `.ts` file plus `pnpm exec tsx`.** Not
  `node --experimental-strip-types` (it does not apply the `./foo.js` →
  `./foo.ts` mapping and dies with `ERR_MODULE_NOT_FOUND` on the *transitive*
  `../env.js` import), and not `tsx -e` (evaluates as CJS, chokes on `import`):

  ```bash
  cd apps/merchant
  cat > scratch.ts <<'TS'
  import { createDb } from "./src/db/index.js";
  // ...
  TS
  pnpm exec tsx --env-file-if-exists=.env.local scratch.ts
  rm -f scratch.ts
  ```

- **`tsx` does not auto-load `.env.local`** — hence
  `--env-file-if-exists=.env.local` in every db script.

### Environment notes

- **Use `podman`, not `docker`** — docker is not installed here. Same Dockerfile
  syntax. Container-to-host is `host.containers.internal` (podman) vs
  `host.docker.internal` (docker).
- **Never verify a container with a bare foreground `podman run`** — a Next
  standalone server can hang indefinitely rather than exiting. Use
  `podman run -d` then `podman inspect` / `podman logs`.
- **The `timeout` command is not available** in this shell.
- **Browser verification**: `tools/cdp/cdp.mjs` drives real headless Chrome. Use
  it instead of asserting on server-rendered HTML when checking interaction.

## Conventions

- **All money is integer cents.** Never a float. Column names end in `_cents`.
  The one exception is `transaction_data.amount`, which must be a plain decimal
  string — convert at that boundary only, with `toFixed`, never `Intl` (it is
  machine-read by foundry and must never localize).
- **No hardcoded URLs or secrets.** Everything comes from zod-validated env. A
  missing secret crashes the process at boot with a named error.
- **Design tokens are deliberately NOT shared** between the apps. The bank is
  Sparkasse-styled and German; the merchant is its own brand and English. Only
  behaviour (`packages/ui`) is shared.
- **No revocation anywhere.** foundry exposes no revoke endpoint; credentials
  expire on their 12-hour lifetime.
- **TDD.** Write the failing test, run it, confirm it fails for the right
  reason, then implement. Both plans were executed this way.
- **Verify against real services, not mocks**, wherever it is possible. Unit
  tests may stub `fetch`; task-completion claims should rest on a real HTTP
  call, a real container, or a real browser.
- **Commits** use conventional prefixes (`feat(scope):`, `fix:`, `chore:`,
  `docs:`). Commit messages state what was *verified*, and state plainly what
  was not.

## Known-unverifiable

The wallet leg cannot be exercised in this environment: no phone and no EUDI
wallet app (`adb devices` shows none attached). Two Definition-of-Done items in
Plan 2 remain open for that reason, including confirming the real nesting shape
of foundry's disclosed verification claims (`apps/merchant/src/lib/checks.ts`
keeps both plausible branches on purpose).

The *reason* narrowed in Plan 3. This used to also say foundry's wallet-facing
listener was bound to `localhost:8443` rather than a public HTTPS origin. That
is no longer true of the deployed system: foundry is reachable at
`https://foundry.digitallabor.dev`, both apps are on public HTTPS origins
(`sparkasse-musterstadt.digitallabor.dev`, `larder-shop.digitallabor.dev`), and
a real checkout there produces an `openid4vp://` URI whose `request_uri` points
at that public foundry host. So the infrastructural blocker is gone and a human
with a device can now run the full flow.

That is a strictly different claim from having run it. No wallet flow has been
exercised. The local `pnpm dev` setup still talks to a `localhost` foundry.

Do not fake this. If a change depends on real wallet behaviour, say so.

## foundry

Not in this repo. Run it from `../foundry`:

```bash
./target/debug/foundry serve --config config.yaml
```

- Admin API: `127.0.0.1:9000`, `Authorization: Bearer dev-admin-key` — never
  publicly exposed.
- Wallet-facing: `0.0.0.0:8443` — must be publicly reachable over HTTPS for a
  real device.
- Issuance states: `offered | issued`. Verification states:
  `pending | verified | failed`.
- `config.yaml` is gitignored there; it needs the `com.emvco.dpc.card`
  credential type. Validate with `foundry config validate`.
- **Send `transaction_data` as plain JSON.** foundry performs the OpenID4VP
  base64url encoding itself and adds `transaction_data_hashes_alg`.