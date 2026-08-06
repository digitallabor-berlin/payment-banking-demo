# Kubernetes deployment — design

Date: 2026-08-06
Status: approved, not yet implemented

## Goal

Run both demo apps on the digitallabor k8s cluster, against the foundry
instance already deployed there:

| App | Public host |
|---|---|
| bank | `https://sparkasse-musterstadt.digitallabor.dev` |
| merchant | `https://larder-shop.digitallabor.dev` |

The reference deployment is `~/dev/dl-infra-k8s/foundry/`. This design follows
its shape and reuses its hard-won constraints; every deliberate divergence is
called out below with its reason.

## Scope

Two repositories change.

**`~/dev/dl-infra-k8s/payment-banking-demo/`** (new directory, currently empty)
gets the deployment:

```
manifest.yml    Namespace, 2x PVC, 2x Deployment, 2x Service, 1x VirtualService
build-job.yml   one buildah Job, one clone, one image
regcred.yaml    gitignored, recreated locally
Makefile        deploy / update / restart / build-image / secrets / reset / ops
README.md       durable documentation (matches foundry/README.md's role)
.gitignore
```

There is deliberately **no `secrets.yaml` on disk**. `make secrets` pipes
`kubectl create secret --dry-run=client -o yaml | kubectl apply -f -`, so the
secret material never lands in a file that could be committed by accident.
This matches `foundry/`, which has no such file either. (`regcred.yaml` is a
file only because it predates that convention; it is gitignored.)

**`~/dev/eudiw/payment-banking-demo/`** (the app repo) gets three changes:

1. A GitHub home, so the in-cluster build Job has something to clone.
2. Boot-time seeding, so a fresh deployment is demoable without an operator
   step.
3. A single root `Dockerfile` replacing the two per-app ones.

**`../foundry` does not change.** Its live ConfigMap already declares the
`com.emvco.dpc.card` credential type (verified against the cluster:
`kubectl -n foundry get configmap foundry-config` line 317). The merchant
hardcodes `transport: "request_uri"` (QR / cross-device) in
`apps/merchant/src/lib/payment-sessions.ts:49` and never uses the Digital
Credentials API, so foundry's `dc_api_expected_origins` is irrelevant to this
deployment and needs no new origin.

## Already verified against the live cluster

These are facts, not assumptions. Each removes work the design would otherwise
have had to include.

| Fact | Consequence |
|---|---|
| `sparkasse-musterstadt.digitallabor.dev` and `larder-shop.digitallabor.dev` both resolve to `167.235.116.254` (wildcard `*.digitallabor.dev`) | **No DNS records to create.** |
| `istio-system/public-ingress-gateway` serves `*.digitallabor.dev` on 443 with `credentialName: digitallabor-dev-tls-secret`, `mode: SIMPLE` | **No cert-manager `Certificate` needed.** Both hosts are already covered. |
| Only one `NetworkPolicy` exists cluster-wide, in `eudipal-ai` | Cross-namespace traffic to foundry is open. |
| `Service/foundry` in ns `foundry` is `ClusterIP 10.43.69.217`, ports 8443 + 9000 | Admin API reachable in-cluster at `foundry.foundry.svc.cluster.local:9000`. |
| StorageClasses: `local-path` (default, reclaim `Delete`) and `local-retain` (reclaim `Retain`) | Use the default; `Delete` is what `make reset` wants. |
| App repo `.gitignore` already excludes `.env`, `.env.local`, `data/`, `*.db` | Safe to push to GitHub. Only `.env.example` files are tracked. |
| Both apps expose `GET /api/health` (static 200) and `GET /api/ready` (`select 1` against SQLite, 503 on failure) | Probes need no new routes. |
| `next.config.ts` in both apps sets `output: "standalone"` and `outputFileTracingRoot` = monorepo root | Each standalone tree is `apps/<app>/server.js` plus a root-level `node_modules`. |

## Image

### One image, two apps

A single image contains both apps. This was chosen over two images because the
two apps are one demo: `credential_id` is a contract between them, they share
`BANK_API_KEY` and `FOUNDRY_ADMIN_KEY`, and a version skew between them is a
real failure mode. One image makes that skew structurally impossible, and one
build is meaningfully faster than two — the repo is one pnpm workspace with one
lockfile, so a shared `deps` stage installs once.

Image: `containers.digitallabor.dev/payment-banking-demo/demo:latest`.

### Layout: side by side, never merged

```
/app/bank/apps/bank/server.js            + /app/bank/node_modules
/app/merchant/apps/merchant/server.js    + /app/merchant/node_modules
/app/entrypoint.sh
```

Each `.next/standalone` tree is copied verbatim into its own prefix. They are
**not** merged into a shared `/app`.

Merging was rejected: both trees contain a root-level `node_modules/` and
`package.json`, each produced by Next's independent dependency trace of that
app. `COPY` resolves the overlap last-writer-wins per file. Because both apps
resolve from the same lockfile the versions agree, so it would probably work —
and a subtly missing traced file surfaces as a runtime `MODULE_NOT_FOUND` on a
rarely-hit route, not as a build failure. The cost of avoiding this is one
duplicated `node_modules` (a few hundred MB) in a private-registry demo image,
which is not worth a class of latent runtime bug.

`drizzle/` must land at `<tree>/apps/<app>/drizzle`, because
`apps/*/src/db/index.ts` resolves migrations as
`path.join(process.cwd(), "drizzle")`. The Kubernetes manifest sets
`workingDir` per container, so `process.cwd()` is correct without a shell
wrapper in the pod spec:

| Container | `workingDir` |
|---|---|
| bank | `/app/bank/apps/bank` |
| merchant | `/app/merchant/apps/merchant` |

### Dockerfile stages

Structurally the existing `apps/bank/Dockerfile`, generalised to both apps:

- **`base`** — `node:22-slim`, `corepack enable`.
- **`deps`** — copies the root manifests plus **all four** package manifests
  (`packages/foundry-client`, `packages/ui`, `apps/bank`, `apps/merchant`),
  installs `python3 make g++` (`better-sqlite3` builds a native addon), then
  `pnpm install --frozen-lockfile`.
- **`build`** — runs both `next build`s. Needs placeholder values for every
  secret both apps validate at import time (`env.ts` parses at module load), so
  the build does not require real ones: `FOUNDRY_ADMIN_KEY=build-only`,
  `BANK_API_KEY=build-only`, and a `SESSION_SECRET` of at least 32 characters
  for the bank. These never reach the runtime stage.
- **`runtime`** — `node:22-slim`, both standalone trees, `entrypoint.sh`,
  `/data` created and owned by uid 1000.

### `entrypoint.sh`

Takes exactly one argument, `bank` or `merchant`, and `exec`s the right
`server.js` after `cd`-ing to that app's root. Anything else is a hard error
with a usage message.

This is preferred over an arbitrary default `CMD`: it makes the image's dual
nature explicit, gives `podman run <image> bank` for local verification, and
cannot silently start the wrong app because someone forgot to override `CMD`.

### `USER 1000`, numerically

The existing Dockerfiles say `USER node` — a name. foundry's README documents
that this blocks `runAsNonRoot: true`, because the kubelet cannot prove a named
user is non-root and fails the pod with `CreateContainerConfigError`. Since we
are writing this Dockerfile anyway, it declares `USER 1000` (the numeric uid of
`node` in `node:22-slim`), which lets the manifest set `runAsNonRoot: true` and
`runAsUser: 1000` properly. This is a deliberate improvement over the reference,
not a divergence from it.

## Cluster resources

Namespace `payment-banking-demo`, one `manifest.yml`.

| | bank | merchant |
|---|---|---|
| Deployment / Service | `bank` | `merchant` |
| Container port | 3001 | 3000 |
| Public host | `sparkasse-musterstadt.digitallabor.dev` | `larder-shop.digitallabor.dev` |
| PVC | `bank-data`, 1Gi | `merchant-data`, 1Gi |
| `DATABASE_PATH` | `/data/bank.db` | `/data/merchant.db` |
| `args` | `["bank"]` | `["merchant"]` |
| `workingDir` | `/app/bank/apps/bank` | `/app/merchant/apps/merchant` |

Both Deployments:

- `replicas: 1` and `strategy: Recreate`. SQLite uses filesystem locks and the
  PVC is `ReadWriteOnce`; a `RollingUpdate` deadlocks waiting for the outgoing
  pod to release the volume. This is foundry's constraint, and it applies here
  for exactly the same reason.
- `imagePullPolicy: Always` with `:latest`, so `make restart` picks up a new
  build. `imagePullSecrets: [regcred]`.
- `securityContext`: `runAsNonRoot: true`, `runAsUser: 1000`,
  `runAsGroup: 1000`, `fsGroup: 1000` with
  `fsGroupChangePolicy: OnRootMismatch`; container-level
  `allowPrivilegeEscalation: false`, `capabilities.drop: ["ALL"]`.
- Probes: `startupProbe` and `readinessProbe` on `/api/ready`, `livenessProbe`
  on `/api/health`. `/api/ready` opens the database, which triggers migrations
  and (see below) seeding — so readiness genuinely gates on the app being
  usable, not merely on the process being up. `/api/health` is static, which is
  what a liveness probe should be.
- Modest resources: requests `cpu: 100m` / `memory: 256Mi`, limits `cpu: "1"` /
  `memory: 1Gi`.

PVCs use the default `local-path` StorageClass (`storageClassName` omitted).
Reclaim policy `Delete` is correct here: `make reset` deliberately destroys the
PVCs so boot seeding re-runs.

### `readOnlyRootFilesystem` — the one unverified item

The manifest sets `readOnlyRootFilesystem: true` plus an `emptyDir` mounted at
each app's Next cache directory, because a Next standalone server writes there
at runtime:

| Container | `emptyDir` mountPath |
|---|---|
| bank | `/app/bank/apps/bank/.next/cache` |
| merchant | `/app/merchant/apps/merchant/.next/cache` |

`/data` is the PVC and writable regardless.

This is the only part of the design that cannot be asserted without a live pod.
The implementation plan carries it as an explicit verification step: deploy,
confirm pages render and no `EROFS` appears in the logs. If it fails, the
documented fallback is to drop `readOnlyRootFilesystem` and record why in the
README — not to guess at further mount points.

### Ingress

One `VirtualService` named `payment-banking-demo`, `hosts:` both names,
`gateways: [istio-system/public-ingress-gateway]`.

**Every route carries an explicit `host` header match.** foundry's README
documents this as a real bug it hit: with two hosts on one `VirtualService`, a
route with no `match:` block matches *both* hostnames and silently swallows
traffic meant for the other. Here the two hosts go to two different Services,
so a catch-all route would send half the demo to the wrong app.

```
match host == sparkasse-musterstadt.digitallabor.dev  ->  bank:3001
match host == larder-shop.digitallabor.dev            ->  merchant:3000
```

Gateway-to-pod traffic is plain HTTP; TLS terminates at the gateway. The
`*_PUBLIC_URL` values are therefore `https://` while the containers listen
cleartext — same arrangement as foundry.

## Configuration and secrets

Non-secret environment comes from the manifest inline:

```
bank      PORT=3001
          DATABASE_PATH=/data/bank.db
          BANK_PUBLIC_URL=https://sparkasse-musterstadt.digitallabor.dev
          FOUNDRY_ADMIN_URL=http://foundry.foundry.svc.cluster.local:9000

merchant  PORT=3000
          DATABASE_PATH=/data/merchant.db
          MERCHANT_PUBLIC_URL=https://larder-shop.digitallabor.dev
          FOUNDRY_ADMIN_URL=http://foundry.foundry.svc.cluster.local:9000
          BANK_API_URL=http://bank:3001
          MERCHANT_NAME=Larder
```

`MERCHANT_NAME` must be overridden. Its `env.ts` default is `"Demo Shop"`, but
the merchant UI already brands itself Larder (`layout.tsx` title
`"Larder — grocer"`, `LarderMark`), and this value is not cosmetic: it becomes
`MERCHANT_REFERENCE_NAME` in `lib/payment-sessions.ts`, i.e. the merchant name
the wallet displays when asking the user to authorise the payment. Leaving the
default would show "Demo Shop" in the wallet while the shop says Larder.

`BANK_PUBLIC_URL` and `MERCHANT_PUBLIC_URL` are declared in each app's `env.ts`
but read by no application code today (verified by grep). They are set
correctly, and the README records that they are currently inert, so a future
reader does not assume something depends on them.

Secrets come from one `Secret` named `demo-secrets` (three keys), consumed via
`secretKeyRef`. It is **not committed** and has no on-disk representation — it
exists only in the cluster, created by `make secrets`:

| Key | Consumed by | Source |
|---|---|---|
| `session-secret` | bank `SESSION_SECRET` | `openssl rand -hex 32`, generated once |
| `bank-api-key` | bank + merchant `BANK_API_KEY` | `openssl rand -hex 32`, generated once |
| `foundry-admin-key` | bank + merchant `FOUNDRY_ADMIN_KEY` | **copied from `foundry/foundry-admin`, key `admin-api-key`** |

`bank-api-key` must be byte-identical in both containers — that is the shared
secret the merchant presents on `POST /api/payments` — which one Secret read by
both Deployments guarantees by construction.

Kubernetes Secrets do not cross namespaces, so `foundry-admin-key` is copied at
`make secrets` time:

```
kubectl -n foundry get secret foundry-admin -o jsonpath='{.data.admin-api-key}' | base64 -d
```

**Consequence, to be documented in the README:** rotating foundry's admin key
(`make admin-key` in `foundry/`) silently breaks this deployment until
`make secrets && make restart` is re-run here. A copy is the pragmatic choice —
the alternatives (a controller like kubernetes-reflector, or moving both
services into one namespace) are disproportionate for a demo.

`make secrets` must be idempotent and must **not** rotate the generated keys on
every invocation: it reads existing values back out of the cluster when present
and only generates what is missing. Otherwise re-running it after a foundry key
rotation would silently invalidate every live bank session.

## Build

An in-cluster `buildah` Job, cloning from GitHub — foundry's pattern, for a
weaker but still sufficient reason.

foundry builds in-cluster because Rust cannot be built for `linux/amd64` on
Apple Silicon at all (`rustc` segfaults under QEMU). Node is not that bad, but
`better-sqlite3` compiles a native addon, so an emulated cross-build is slow
and its correctness is not something to assert without testing. The cluster's
nodes are genuinely `linux/amd64`, so a Job there is a native build. Reusing the
pattern also means one build story across both services rather than two.

`build-job.yml`, mirroring `foundry/build-job.yml`:

- `backoffLimit: 0` — a broken build should fail loudly, not retry and hide the
  real compile error behind a flaky-looking log.
- `ttlSecondsAfterFinished: 3600`.
- initContainer `clone`: `alpine/git`, `git clone --depth 1 --branch main` over
  SSH using the read-only deploy key from Secret `demo-build-git`.
- container `build`: `quay.io/buildah/stable`, `privileged: true` (this
  namespace sets no PodSecurity restrictions; rootless buildah is fussier for
  no gain in a one-shot Job), one `buildah bud --format docker --platform
  linux/amd64` over the root `Dockerfile`, then `buildah push` using `regcred`'s
  `.dockerconfigjson` mounted directly as an authfile (same `{"auths":{...}}`
  shape).
- Resources: requests `cpu: "2"` / `memory: 4Gi`, limits `cpu: "4"` /
  `memory: 8Gi`. Two `next build`s plus a native addon compile; bump if it OOMs.

Trigger is **manual only** — `make build-image` after pushing to `main`. No
webhook, no poller, matching foundry.

`make deploy-key` generates an ed25519 keypair, registers the public half as a
read-only repo-scoped GitHub deploy key via `gh`, stores the private half as
Secret `demo-build-git`, and deletes the local copy. One-time.

## App-repo changes

### 1. GitHub home

Create `digitallabor-berlin/payment-banking-demo` (private, matching every
sibling), commit the 47 currently-uncommitted files, push `main`.

This is a **one-time manual step in the app repo**, not a target in the infra
Makefile. The infra repo deploys; it does not manage another repo's git remote.
The implementation plan carries it as an ordinary task.

The working tree has 36 modified and 11 untracked files, including a new
merchant migration (`apps/merchant/drizzle/0001_lively_senator_kelly.sql` plus
its snapshot) and `apps/merchant/public/`. All of it is real work that must ship
— the build Job clones `main`, so anything uncommitted simply will not exist in
the image.

Gate: `pnpm check` green before the push.

### 2. Boot-time seeding

Both apps are unusable empty. The bank's login expects `anna/demo1234` from
`seed.ts` fixtures (2 users, accounts, cards, 10 transactions each); the
merchant's shop has zero products. Migrations already run on first DB access
(`getDb()` → `createDb()` → `migrate()`), but seeding does not, and `seed.ts` is
a `tsx` script absent from the runtime image.

Each app gains `seedIfEmpty(db)` in `src/db/seed.ts`:

- bank: seeds only if `select count(*) from users` is 0
- merchant: seeds only if `select count(*) from products` is 0

`src/instrumentation.ts` calls it after the existing `import("./env.js")`.
`register()` runs exactly once per server process boot, before requests are
served, which is why the readiness probe on `/api/ready` is a real gate.

The existing `seed()` deletes every row before inserting, so the empty-table
check is the entire safety property: on a populated database `seedIfEmpty` must
not call `seed()` at all. Two tests, TDD, written first:

1. `seedIfEmpty` on an empty in-memory DB populates the fixtures.
2. `seedIfEmpty` on a DB with one hand-inserted row changes nothing.

A seeding failure calls `process.exit(1)`, the same contract `instrumentation.ts`
already applies to invalid environment: a bank with no accounts is broken, not
degraded, and a hard crash is a far stronger signal to an orchestrator than
permanent 500s. The existing `pnpm seed` CLI is unaffected and stays.

Rejected alternatives: a seeding `Job` (needs `tsx` + `src/` in the runtime
image, roughly doubling it and defeating the standalone build; also cannot run
while the app pod holds the `ReadWriteOnce` PVC), and a guarded
`POST /api/admin/seed` route (a destructive internet-reachable endpoint
permanently present in something that is meant to look like a bank).

### 3. Root `Dockerfile`

Replaces `apps/bank/Dockerfile` and `apps/merchant/Dockerfile`. Both are
deleted: `pnpm dev` does not use them, and two 95%-identical unused Dockerfiles
alongside the real one is exactly the drift that rots. `apps/*/AGENTS.md` and
the root `AGENTS.md` are updated where they reference the per-app Dockerfiles.

## Makefile

`NS := payment-banking-demo`, targets mirroring foundry's:

| Target | Effect |
|---|---|
| `help` | list targets |
| `deploy-key` | one-time: register a read-only deploy key, store `demo-build-git` |
| `build-image` | delete + apply the build Job, stream logs, confirm the Job's final condition (a log-stream drop is not a failure) |
| `build-status`, `build-logs` | inspect a run without re-triggering it |
| `secrets` | create/refresh `demo-secrets` idempotently |
| `deploy` | `manifest.yml` + `regcred.yaml` + `secrets`, then wait on both rollouts |
| `update` | re-apply the manifest only |
| `restart` | `rollout restart` both Deployments |
| `reset` | scale both to 0, delete both PVCs, scale back to 1 — re-seeds at boot |
| `logs`, `monitor`, `pods`, `events`, `describe`, `validate` | ops |
| `smoke` | curl both hosts' `/api/health` + `/api/ready` and the merchant's `/api/products` |
| `delete` | `kubectl delete -f manifest.yml` |

`reset` is destructive and irreversible (`local-path` reclaims `Delete`). It
prints what it is about to destroy and requires confirmation.

## Failure modes

| Symptom | Cause | Where to look |
|---|---|---|
| `CrashLoopBackOff`, logs show `Fatal: invalid environment configuration` | a `demo-secrets` key is missing or too short (`SESSION_SECRET` needs ≥32 chars) | `make logs` |
| Pod up, `/api/ready` 503 | SQLite unopenable — PVC permissions, i.e. `fsGroup` vs image uid | `describe`, pod events |
| Bank login rejects `anna/demo1234` | seeding did not run; DB non-empty but unseeded | `make logs` for the seed line |
| Merchant checkout 502/401 from foundry | `foundry-admin-key` stale after a foundry rotation | `make secrets && make restart` |
| Wrong app answers a host | a `VirtualService` route missing its `host` match | `manifest.yml` |
| `exec format error` | image built for arm64 — someone bypassed the build Job | rebuild via `make build-image` |
| Pod restarts with `EROFS` | `readOnlyRootFilesystem` needs another writable mount | see that section above |

## Definition of Done

1. `pnpm check` green in the app repo, including the two new `seedIfEmpty`
   tests (baseline is 162 tests).
2. Local `podman build` of the root Dockerfile succeeds, and
   `podman run -d <image> bank` and `... merchant` both reach a serving state
   (arm64 locally — this verifies image *layout* and both entrypoints, not the
   amd64 artefact). Per AGENTS.md: `podman run -d` then `inspect`/`logs`, never
   a bare foreground run.
3. `digitallabor-berlin/payment-banking-demo` exists with `main` pushed.
4. `make build-image` completes and pushes `:latest`.
5. `make deploy` completes both rollouts.
6. `curl` returns 200 on `/api/health` and `/api/ready` for **both** hosts.
7. `https://larder-shop.digitallabor.dev/api/products` returns a non-empty
   list — proves boot seeding ran on a real PVC.
8. Bank login as `anna/demo1234` succeeds and the account page renders,
   verified via `tools/cdp` against a real browser, not by asserting on
   server-rendered HTML.
9. A merchant checkout creates a payment session and returns an `openid4vp_uri`
   — proves cross-namespace reach to foundry's admin API with the copied key.
10. `readOnlyRootFilesystem` outcome recorded in the README, whichever way it
    goes.

**Explicitly out of reach:** the wallet leg. There is no phone and no EUDI
wallet app in this environment, so credential issuance into a wallet and
`transaction_data`-bound presentation cannot be exercised — consistent with the
existing Known-unverifiable section in the root `AGENTS.md`. Deploying to a
public HTTPS origin *removes the infrastructural blocker* (foundry's
wallet-facing listener is now internet-reachable at
`https://foundry.digitallabor.dev`), so this becomes testable by a human with a
device — but it is not verified by this work, and must not be claimed as such.