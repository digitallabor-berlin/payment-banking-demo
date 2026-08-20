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
| --- | --- |
| `pnpm dev` | Both apps in parallel, prefixed output |
| `pnpm check` | `typecheck && test` across all 4 projects — **the gate** |
| `pnpm migrate` | Apply migrations to both databases |
| `pnpm seed` | Reset both databases to fixtures (idempotent, destructive) |
| `pnpm build` | Production build of both apps |

`pnpm check` must be green before you claim work is done. Current baseline:
**357 tests** (148 bank + 167 merchant + 11 foundry-client + 31 ui), measured
2026-08-20.

That was **329** before the age-verification-credential work, which added 28,
all in `apps/bank`: 5 in `src/db/schema.test.ts`, 2 in `payments.test.ts`, 7 in
`queries.test.ts`, 7 in the new `av-issuance.test.ts`, and 7 in the new
`credential-copy.test.ts`. Its plan projected 356 and was off by one — its
Task 6 specified a test asserting the two credentials' `explain` string differs
in all three face states, which was unsatisfiable against the plan's own copy
table (both types share the `offered` string deliberately), so that one test
became two. Measure.

That was **305** before the DPC display-metadata work, which added 24: 19 in
`apps/bank/src/lib/display-metadata.test.ts`, 2 seed-invariant tests, 2 issuance
tests, and 1 forwarding test in `packages/foundry-client`.

That was **295** before the card-artwork / session-scoped-issuing work, which
added 10 (all in `apps/bank/src/lib/card-state.test.ts`).

That was **253** before the payment-sheet / 18+-marking work, which added 42.
That plan projected 294. It was off by one for the ordinary reason: its Task 4
specifies 15 `it()` blocks while its running total assumed 14. Every subsequent
task's projection inherited the error. Measure.

That was **218** before the named-query / age-verification work, which added 35.

That was **186** before the DC API transport work, which added 32. The plan for
that work projected 210 and was simply wrong — its per-task arithmetic did not
match the number of `it()` blocks actually written. Measure.

That number was **162** for most of this project's life, and a stale `162` is
still quoted in the Plan 3 document. The difference is not drift: 20 of those
tests arrived with in-flight UI work that sat uncommitted in the working tree
for a long stretch, and 4 are the `seedIfEmpty` tests. If a count disagrees with
yours, measure — do not trust a number written in a plan.

## Hard-won constraints

Every item below was discovered by something breaking. Do not "clean up" any of
them without reading the linked reasoning first.

### Credentials and credential types

- **Display metadata is DPC-only.** `foundry-issuer/src/create_offer.rs` gates
  both `offer_display` and `credential_response_display` on
  `ct.vct == "com.emvco.dpc.card"` and *rejects* them for every other credential
  type. A non-DPC credential's wallet appearance can therefore come only from
  foundry's static `display:` config — the issuer cannot influence it. Sending
  the bank's card display metadata on an `av` offer would turn every issuance
  into a `failed` row.

- **A `credentials` row needs neither a card nor a `credential_id`.**
  `credentialTypeId` (`com.emvco.dpc.card | av`) is the discriminator and
  defaults to the DPC type, so an insert that forgets it silently becomes a
  payment credential. `processPayment` refuses anything that is not a DPC row
  with a card — three independent ways, one of which is that SQL never matches
  `credential_id = <string>` against NULL.

- **`credential_type_id` for age verification is `av`.** Not
  `eu.europa.ec.av.1` — that is the mdoc docType configured on foundry's side,
  not the id the admin API takes.

- **No foundry config declares an `av` credential type**, so the bank's
  age-credential happy path has never run. Verified 2026-08-20 against a
  freshly restarted local foundry: HTTP **400**,
  `{"error":"unknown credential_type_id 'av'"}`. Adding the type is the
  operator's task. Note the local config's *named queries* already reference
  `av`, which makes the omission easy to misread as present.

- **Read `drizzle-kit generate`'s output before committing it.** For the `0001`
  migration it emitted a table rebuild whose `INSERT … SELECT` listed the
  newly-added `credential_type_id` on both sides, selecting a column the old
  table does not have. That is unrunnable (`no such column`) and broke every
  test in `schema.test.ts`, not just the new ones. The committed SQL is
  hand-edited to omit it so the column DEFAULT backfills.

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

- **Adding a no-default env var means editing the Dockerfile's build-stage
  `ENV` block too.** `env.ts` validates at import time and `**/.env.local` is
  dockerignored, so that block is the only thing satisfying required variables
  during `next build`. Miss one and the build fails *remotely from its cause* —
  `MERCHANT_PAYEE_ID` surfaced as `Failed to collect configuration for
  /success` / `Failed to collect page data for /api/payment-sessions`, with the
  real reason only inside `[cause]`. It is not a `build-job.yml` problem and no
  build arg is involved. Measured: the placeholders stay confined to the build
  stage and are absent from the runtime image's config, so the deployment
  manifest must supply the real value separately — a pod missing it exits 1 at
  boot (`CrashLoopBackOff`), it does not degrade to 500s.

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

- **A `next/font` variable must not be named after a Tailwind `@theme` token.**
  Already true of `--font-display-face`; now also of `--font-eudipay-face`.
  `@theme` writes its tokens to `:root`, the same element `next/font` writes to,
  so a token defined as `var(--font-eudipay)` referring to itself resolves to
  nothing.

### The payment sheet

- **The payment sheet is a modal on `/checkout`, not a route.** It used to render
  on `/pay/[sessionId]` over an empty page, so its scrim dimmed nothing. The
  sheet now opens without navigation, the session id is mirrored into
  `?session=`, and `/pay/[sessionId]` survives only for deep links and reloads —
  where it renders the order's line items as real content behind the sheet.

- **The cart is cleared when a payment completes, not when the form is
  submitted.** The basket is the content the sheet sits over, and a declined
  payment must leave it intact so "Back to the shop" is recoverable. The
  accepted cost is that abandoning and re-submitting creates a second `pending`
  order.

- **The sheet's rendering decision lives in `lib/sheet-state.ts`, not in JSX.**
  Every vitest project is `environment: "node"` with
  `include: ["src/**/*.test.ts"]`, so a `.tsx` file is never covered. Branching
  inside the component is how a spacing defect in one state stayed invisible
  from the others.

- **`.eudipay-*` classes own their padding and vertical rhythm**, unlike every
  other component class in `globals.css`. The sheet has one instance and its
  rhythm is part of the design; the old split between a stylesheet and `mt-*`
  utilities on inline-level buttons is what produced the reported spacing bugs.
  The sheet also carries the file's only `box-shadow`, on purpose.

- **The `18+` glyph is `18+`, never `+18`**, and it is drawn in Larder's palette
  rather than EudiPay's — an age restriction is the grocer's obligation. Its
  source of truth is `AGE_RESTRICTED_PRODUCT_IDS` in `lib/dcql.ts`, read through
  `isAgeRestricted`, which `selectNamedQuery` also calls so the shelf tag and the
  `dpc` → `dpc_av` escalation cannot disagree. There is no `products` column.

### The bank's card face

- **The card face is the real artwork, `apps/bank/public/card-face.webp`.** It
  already contains the logo, wordmark, chip, contactless mark and network mark,
  so `.card-chip`, `.card-network` and the on-card `SparkasseLogo` were deleted
  rather than layered over it. Only the IBAN and the holder are drawn on top.
  `background-color: var(--color-primary)` sits behind it deliberately, so a
  missing asset degrades to Sparkasse red instead of a hole.

- **`next build`'s standalone output does NOT include `public/`.** The bank had
  no `public/` at all until this work, so the Dockerfile only copied the
  merchant's; the bank's needs its own `COPY` line or the artwork 404s in every
  container and the card silently falls back to that flat red.

- **`SparkasseLogo` is portrait (354.126 / 460.684 = 0.769), not square.** Call
  sites must set height only (`h-8 w-auto`); `h-8 w-8` stretches the glyph
  horizontally by ~30%. Measured 25×32 px in the header.

- **"Wird hinzugefügt…" is session-scoped, never read back from the database.**
  Nothing in this project ever clears an `offered` credential row — there is no
  revocation and expiry does not change the row — so a single abandoned attempt
  used to pin the badge and the infinite `card-sheen` animation on forever. The
  decision lives in `lib/card-state.ts` (`cardFaceState`), not in JSX, because
  vitest is `environment: "node"` with `include: ["src/**/*.test.ts"]` and a
  `.tsx` file is never covered. The accepted cost: a genuinely open offer
  becomes invisible after a reload.

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

- **`pnpm dev` is currently broken — use `pnpm build` then `pnpm --filter
  @demo/<app> start`.** Both apps return HTTP 500 with `Module not found: Can't
  resolve 'fs'`, trace `better-sqlite3 → src/db/index.ts → src/instrumentation.ts`.
  Next compiles `instrumentation.ts` for the **edge** runtime as well as node,
  and `serverExternalPackages: ["better-sqlite3"]` does not apply to the edge
  bundle. A `process.env.NEXT_RUNTIME !== "nodejs"` early return does **not**
  fix it — measured, the dynamic `await import("./db/index.js")` is still pulled
  into the edge graph. This reproduces on a clean `main`; it is not caused by
  any feature branch. `next build` and `next start` are unaffected, so ad hoc
  browser verification should go through a production server.
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

### DC API

- **`packages/ui/src/dcApi.ts` injects browser globals on purpose.** All four
  vitest projects run `environment: "node"` with `include: ["src/**/*.test.ts"]`
  — there is no jsdom and `.tsx` is not matched. Reading `window` at module
  scope would make detection untestable. Keep decisions in `.ts`, rendering in
  `.tsx`. `selectTransport` in the merchant exists for exactly this reason.
- **No `await` may execute between a click handler starting and
  `navigator.credentials.get()` / `.create()`.** Chrome consumes the click's
  transient activation. This is why both apps have the DC API payload in the
  component as a prop before the click, rather than fetching it in the handler.
- **The `create` gate is lenient, the `get` gate is strict** —
  `supportsDcApi` skips `userAgentAllowsProtocol` for `create`. Measured on
  HeadlessChrome 151: `userAgentAllowsProtocol` exists and returns `true` for
  **both** `openid4vp-v1-unsigned` and `openid4vci-v1`, so on that build the
  leniency is currently doing no work. It is kept because `openid4vci-v1` is a
  Chrome origin-trial identifier behind
  `chrome://flags/#web-identity-digital-credentials-creation`, not a shipped
  protocol, and a browser that can issue may still answer `false`.
- **`useDcApiSupport` returning `null` is not `false`.** It means "not yet
  known". Rendering the QR fallback on `null` flashes a QR on Android.
- **A `dc_api` session can never be re-rendered as a QR.** It is bound to
  `response_mode: dc_api.jwt` with an inlined unsigned request object and
  foundry returns neither `openid4vp_uri` nor `request_uri`. Recovery creates a
  *new* `request_uri` session — that is what "Show QR code" does.
- **foundry needs `verifier.dc_api_expected_origins` to list the merchant
  origin.** Over the DC API transport the KB-JWT audience MUST be the
  browsing-context Origin. Unset, foundry accepts only an origin derived from
  its own `public_base_url`. Until this is configured, a merchant DC API
  payment fails `transaction_data_binding` *as a payment decline*, not as a
  transport error — nothing throws in the browser, so the "Show QR code"
  recovery never appears. `config.yaml` is gitignored in `../foundry`.

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

The DC API work narrowed this further, in a way worth stating precisely.
Headless Chrome **does** expose `window.DigitalCredential` here (the DC API
plan wrongly assumed it does not), so everything up to the wallet handover is
locally verifiable and was verified: detection returns true, the merchant
creates a real `transport: dc_api` verification against a running foundry,
the row stores foundry's inline `dc_api_request` with `response_mode:
dc_api.jwt` and both URIs null, and the pay screen renders the DC API button
rather than a QR.

What remains unverified is only the leg that needs a wallet:
`navigator.credentials.get()` / `.create()` never resolve successfully here —
they throw, which is what exercised the fallback paths. So no wallet has ever
returned a `DigitalCredential`, no response has ever been relayed to
`/dc-api-response`, and `submitDcApiResponse` has never been called against a
real foundry.

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
- **A long-running local foundry may silently predate the feature you are
  testing.** The local server here had been up since Aug 5 and returned `200`
  for a deliberately invalid `offer_display` — serde ignores unknown fields, so
  an old binary accepts new request members and drops them. A 200 is therefore
  not evidence that a new field was honoured. Either assert on the echo
  (`credential_offer.display`) or send a known-bad payload and require the
  rejection. `pkill -f 'target/debug/foundry serve'` and restart it after
  pulling.
- **A rejected display payload is HTTP 500, not 400** — body
  `{"error": "invalid request: <path>: <reason>"}`. The error *code* is
  `invalid_request`; the status is not. Verified 2026-08-19 on both the local and
  the deployed instance.
- **Send `transaction_data` as plain JSON.** foundry performs the OpenID4VP
  base64url encoding itself and adds `transaction_data_hashes_alg` when the key
  is absent (`or_insert_with`, so an explicitly sent value wins rather than
  conflicts).
- **foundry validates `transaction_data[].credential_ids` against the resolved
  query's credential ids.** An id no query declares is a hard 400, not a
  `verified: false` verdict. Verified 2026-08-19 against the deployed instance.
- **`VerificationResult` is `{ verified, checks, credentials[] }`.** There is no
  top-level `claims`, and top-level `checks` is cross-cutting only
  (`jwe_decryption`, `requested_credentials_answered`).
  `transaction_data_binding` lives in `credentials[i].checks`, and claims are
  held per credential and never merged. See `apps/merchant/AGENTS.md`.
- **The local and deployed foundry configs differ in their named queries.**
  `../foundry/config.yaml` has only `over18`; the deployed
  `dl-infra-k8s/foundry/foundry_config.yml` has `dpc`, `dpc_av`, `av`,
  `dpc_discovery`, `dpc_by_network`. The merchant needs `dpc` and `dpc_av`, so
  its payment flow **cannot** be exercised against a stock local foundry.
- **foundry now verifies several credentials per `vp_token`.** The deployed
  config's warning that `dpc_av` "CANNOT be fully verified" is stale — the
  openapi serves `credentials[]` and `verify.rs` has `select_presentations`
  (plural). Do not reason from that comment.
- **The deployed admin key is not `dev-admin-key`.** Read it with
  `kubectl -n foundry get secret foundry-admin -o jsonpath='{.data.admin-api-key}' | base64 -d`.
