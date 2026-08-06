# Kubernetes Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run both demo apps on the digitallabor k8s cluster at
`sparkasse-musterstadt.digitallabor.dev` (bank) and
`larder-shop.digitallabor.dev` (merchant), against the foundry instance already
deployed in the `foundry` namespace.

**Architecture:** One container image holds both apps as two independently-copied
Next standalone trees, selected at runtime by an entrypoint argument. The image
is built in-cluster by a `buildah` Job cloning a new GitHub repo, then run as two
Deployments in one namespace, each with its own SQLite PVC, routed by one Istio
`VirtualService` with explicit per-host matches. Seeding moves into the app's
boot hook so a fresh PVC is demoable with no operator step.

**Tech Stack:** Next.js 15 standalone, better-sqlite3 + drizzle, pnpm workspace,
Kubernetes, Istio, buildah, `podman` (not `docker`), Make.

**Spec:** `docs/superpowers/specs/2026-08-06-kubernetes-deployment-design.md`

## Global Constraints

- **`pnpm`, never `npm`.** Run from the repo root. `pnpm check` is the gate.
- **Baseline is 162 tests** (77 bank + 71 merchant + 7 foundry-client + 7 ui).
  This plan adds 4, so the final count is **166**.
- **Use `podman`, not `docker`** — docker is not installed. Never verify a
  container with a bare foreground `podman run`; use `podman run -d` then
  `podman logs` / `podman inspect`. **The `timeout` command is not available.**
- **TypeScript is strict** with `noUnusedLocals` and `noUnusedParameters`. An
  intentionally-unused parameter must be prefixed `_`.
- **Local imports are written `./foo.js` for a `./foo.ts` file.** Keep that form.
- **All money is integer cents.** Column names end in `_cents`.
- **No hardcoded URLs or secrets** in app code — everything via zod-validated env.
- **Commits** use conventional prefixes (`feat(scope):`, `fix:`, `chore:`,
  `docs:`). Commit messages state what was *verified*, and state plainly what was
  not.
- **Two repos.** App repo: `~/dev/eudiw/payment-banking-demo`. Infra repo:
  `~/dev/dl-infra-k8s` (work in its `payment-banking-demo/` subdirectory).
  Every task says which one it is in. Commit in each repo separately.
- **Cluster facts, already verified — do not re-derive, do not create these:**
  both hostnames already resolve to `167.235.116.254` via the wildcard
  `*.digitallabor.dev`; the wildcard TLS cert `digitallabor-dev-tls-secret` on
  `istio-system/public-ingress-gateway` already covers them; no `NetworkPolicy`
  blocks cross-namespace traffic; the default StorageClass is `local-path`.
- **foundry is not modified by this plan.** Its live ConfigMap already declares
  `com.emvco.dpc.card`.
- **Namespace:** `payment-banking-demo`. **Image:**
  `containers.digitallabor.dev/payment-banking-demo/demo:latest`.

## Defects this plan corrects

Found while planning, by inspecting the tree rather than trusting the previous
plans' verification claims. Each is a real bug in the committed per-app
Dockerfiles. Task 3 fixes all three at once; they are listed here because a
reviewer needs to know they are intentional changes, not drive-by edits.

1. **`.dockerignore` is at a path Docker never reads.** `apps/bank/.dockerignore`
   and `apps/merchant/.dockerignore` are committed, but builds run as
   `podman build -f apps/bank/Dockerfile .` with the **repo root** as context.
   Docker/BuildKit only honours `<context>/.dockerignore` or
   `<dockerfile-path>.dockerignore` — neither matches, so both files are
   silently ignored and the host's `node_modules/` (and `data/`, `*.db`) are
   copied into the build context.
2. **The `deps` stage drops the workspace links, so a clean build would fail.**
   `.npmrc` sets `node-linker=hoisted`, so third-party packages hoist to the
   root `node_modules` — but the `@demo/*` workspace links live **only** in
   `apps/<app>/node_modules`. Verified: `node_modules/@demo` does not exist,
   while `apps/bank/node_modules/@demo/` holds `ui` and `foundry-client` as
   symlinks into `packages/`. `COPY --from=deps /repo/node_modules ./node_modules`
   does not carry those, so `next build` cannot resolve `@demo/ui`. This has been
   masked by defect 1: the host's real `node_modules` trees were being copied in
   by `COPY . .`. In the build Job there is no host tree, so the build would
   fail. **This means the "verified against a real podman container" claim for
   the existing Dockerfiles only held because of an unrelated bug.**
3. **`apps/merchant/public/` is never copied into the image.** It exists and
   contains `products/`, i.e. the product imagery. Every product image would 404
   in a containerised merchant. (`apps/bank/public` does not exist — verified —
   so the bank needs no such copy.)

---

## File Structure

**App repo — `~/dev/eudiw/payment-banking-demo`**

| Path | Responsibility | Task |
|---|---|---|
| `apps/bank/src/db/seed.ts` | add `seedIfEmpty` beside existing `seed` | 1 |
| `apps/bank/src/db/seed.test.ts` | **new** — the two `seedIfEmpty` guards | 1 |
| `apps/bank/src/instrumentation.ts` | call `seedIfEmpty` at boot | 1 |
| `apps/merchant/src/db/seed.ts` | add `seedIfEmpty` | 2 |
| `apps/merchant/src/db/seed.test.ts` | **new** | 2 |
| `apps/merchant/src/instrumentation.ts` | call `seedIfEmpty` at boot | 2 |
| `Dockerfile` | **new, root** — one image, both apps | 3 |
| `docker-entrypoint.sh` | **new, root** — `bank` \| `merchant` selector | 3 |
| `.dockerignore` | **new, root** — the one Docker actually reads | 3 |
| `apps/bank/Dockerfile`, `apps/bank/.dockerignore` | **deleted** | 3 |
| `apps/merchant/Dockerfile`, `apps/merchant/.dockerignore` | **deleted** | 3 |
| `README.md` | rewrite the image + seeding sections | 3 |
| `AGENTS.md` | note the root Dockerfile and boot seeding | 3 |

**Infra repo — `~/dev/dl-infra-k8s/payment-banking-demo/`** (currently empty)

| Path | Responsibility | Task |
|---|---|---|
| `.gitignore` | keep `regcred.yaml`, `.buildkey/`, `.pi/` out | 5 |
| `build-job.yml` | in-cluster buildah build of the one image | 5 |
| `Makefile` | build + deploy + ops targets (grown across 5–6) | 5, 6 |
| `manifest.yml` | Namespace, 2 PVC, 2 Deployment, 2 Service, 1 VirtualService | 6 |
| `README.md` | durable documentation, incl. verification outcomes | 7 |

---

### Task 1: Boot-time seeding for the bank

The bank is unusable on a fresh database: its login expects `anna/demo1234`,
which only exists in `seed.ts`'s fixtures. Migrations already run on first DB
access, but seeding does not, and `seed.ts` is a `tsx` script that is absent
from the runtime image. This task makes the app seed itself at boot when — and
only when — the database is empty.

**Files:**
- Modify: `apps/bank/src/db/seed.ts` (add `seedIfEmpty`; leave `seed` alone)
- Create: `apps/bank/src/db/seed.test.ts`
- Modify: `apps/bank/src/instrumentation.ts`

**Interfaces:**
- Consumes: `seed(db: Db, now?: number): void` from
  `apps/bank/src/db/seed.ts`; `createDb(filePath: string, runMigrations?: boolean): Db`
  and `type Db` from `apps/bank/src/db/index.ts`; `users` from
  `apps/bank/src/db/schema.ts`.
- Produces: `seedIfEmpty(db: Db, now?: number): boolean` exported from
  `apps/bank/src/db/seed.ts`. Returns `true` if it seeded, `false` if it found
  existing rows and did nothing. Task 2 mirrors this signature for the merchant
  (minus `now`); nothing else consumes it.

**Why a boolean return:** the caller logs which branch happened, so
`make logs` shows whether a pod seeded a fresh volume or attached to an existing
one. That distinction is the first thing you want when the bank login fails.

- [ ] **Step 1: Write the failing test**

Create `apps/bank/src/db/seed.test.ts`. The existing suite's DB pattern is
`mkdtempSync` + `createDb` (see `apps/bank/src/lib/queries.test.ts`) — follow it
rather than `:memory:`, so migrations resolve against the real `drizzle/` folder.

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "./index.js";
import { users } from "./schema.js";
import { seedIfEmpty } from "./seed.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bank-seed-"));
  db = createDb(path.join(dir, "test.db"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("seedIfEmpty", () => {
  it("seeds the fixtures when the users table is empty and reports it did", () => {
    expect(db.select().from(users).all()).toHaveLength(0);

    expect(seedIfEmpty(db)).toBe(true);

    const seeded = db.select().from(users).all();
    expect(seeded).toHaveLength(2);
    expect(seeded.map((u) => u.username).sort()).toEqual(["anna", "ben"]);
  });

  it("leaves a populated database untouched and reports it did nothing", () => {
    db.insert(users)
      .values({
        id: "user_zoe",
        username: "zoe",
        passwordHash: "not-a-real-hash",
        displayName: "Zoe Operator",
      })
      .run();

    expect(seedIfEmpty(db)).toBe(false);

    const after = db.select().from(users).all();
    expect(after).toHaveLength(1);
    expect(after[0]?.username).toBe("zoe");
  });
});
```

The second test is the important one. `seed()` calls `db.delete(...)` on every
table before inserting, so the empty-table check is the *entire* safety property
— if `seedIfEmpty` ever calls through on a populated database it destroys real
demo state.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd ~/dev/eudiw/payment-banking-demo/apps/bank
pnpm vitest run src/db/seed.test.ts
```

Expected: FAIL. `seedIfEmpty` is not exported from `./seed.js`, so this is
either a TypeScript/import error naming `seedIfEmpty`, or
`TypeError: seedIfEmpty is not a function`. If you see any *other* failure —
especially a migration or path error — stop and fix that first; the test must
fail for the intended reason.

- [ ] **Step 3: Implement `seedIfEmpty`**

In `apps/bank/src/db/seed.ts`, add `import { sql } from "drizzle-orm";` at the
top and append this after the existing `seed` function, before the `main()` CLI
block:

```ts
/**
 * Seeds only a database that has never been seeded. Called at server boot from
 * `src/instrumentation.ts` so a fresh deployment (empty PVC) is immediately
 * demoable without an operator step — `seed.ts` is a tsx script and is not in
 * the runtime image, so `pnpm seed` has no in-cluster equivalent.
 *
 * The emptiness check is the entire safety property: `seed()` deletes every row
 * before inserting, so calling it on a populated database would destroy live
 * demo state. Returns whether it seeded, so the caller can log which happened.
 */
export function seedIfEmpty(db: Db, now = Date.now()): boolean {
  const row = db.select({ n: sql<number>`count(*)` }).from(users).get();
  if ((row?.n ?? 0) > 0) return false;
  seed(db, now);
  return true;
}
```

`users` is already imported by this file (it appears in `db.delete(users)` inside
`seed`), so do **not** add a second import of it — `noUnusedLocals` and duplicate
bindings will both bite.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd ~/dev/eudiw/payment-banking-demo/apps/bank
pnpm vitest run src/db/seed.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Wire it into the boot hook**

Replace the body of `register()` in `apps/bank/src/instrumentation.ts`. Keep the
entire existing file comment — it documents two hard-won findings (the hook must
live under `src/`, and `process.exit(1)` must be explicit) that remain true.

```ts
export async function register() {
  try {
    await import("./env.js");
  } catch (error) {
    console.error(
      "[bank] Fatal: invalid environment configuration — refusing to serve requests.",
      error,
    );
    process.exit(1);
  }

  try {
    const { getDb } = await import("./db/index.js");
    const { seedIfEmpty } = await import("./db/seed.js");
    const seeded = seedIfEmpty(getDb());
    console.log(
      seeded
        ? "[bank] Seeded an empty database with the demo fixtures."
        : "[bank] Database already populated — left untouched.",
    );
  } catch (error) {
    console.error(
      "[bank] Fatal: could not open or seed the database — refusing to serve requests.",
      error,
    );
    process.exit(1);
  }
}
```

Three things matter here:

1. **Both imports must stay dynamic (`await import`)**, inside the function. A
   static top-level `import` of `./db/index.js` would transitively evaluate
   `./env.js` at module load, *before* the try/catch — reintroducing exactly the
   failure mode the existing comment describes at length.
2. **Two separate try/catch blocks.** An env failure and a database failure need
   different messages; one combined block would report a DB error as a config
   error.
3. **`process.exit(1)` on seed failure**, matching the env contract. A bank with
   no accounts is broken, not degraded, and a hard crash is a far stronger
   signal to Kubernetes than permanent 500s.

- [ ] **Step 6: Run the bank's full suite and typecheck**

```bash
cd ~/dev/eudiw/payment-banking-demo/apps/bank
pnpm typecheck && pnpm test
```

Expected: typecheck clean, **79 tests** passing (77 baseline + 2).

- [ ] **Step 7: Commit**

```bash
cd ~/dev/eudiw/payment-banking-demo
git add apps/bank/src/db/seed.ts apps/bank/src/db/seed.test.ts \
        apps/bank/src/instrumentation.ts
git commit -m "feat(bank): seed the demo fixtures at boot when the database is empty

A fresh deployment gets an empty PVC, and the runtime image carries no tsx and
no src/, so 'pnpm seed' has no in-cluster equivalent. instrumentation.ts now
calls seedIfEmpty() once per server boot.

Guarded on 'select count(*) from users' being 0, because seed() deletes every
row before inserting -- calling it on a populated database would destroy live
demo state. Both branches log which happened, so 'kubectl logs' answers 'did
this pod seed a fresh volume?'.

Imports stay dynamic and inside register()'s try/catch: a static import of
db/index.js would transitively evaluate env.js before the catch, undoing the
fix documented in this file's header comment.

Verified: 79 bank tests pass (77 + 2 new), typecheck clean. The populated-db
test is the one that matters -- it asserts seed() is never reached."
```

---

### Task 2: Boot-time seeding for the merchant

Same change, mirrored. The merchant is worse off than the bank on a fresh
volume: it has **zero products**, so the shop renders an empty catalogue and no
checkout is possible.

**Files:**
- Modify: `apps/merchant/src/db/seed.ts`
- Create: `apps/merchant/src/db/seed.test.ts`
- Modify: `apps/merchant/src/instrumentation.ts`

**Interfaces:**
- Consumes: `seed(db: Db): void` from `apps/merchant/src/db/seed.ts` (note: **no
  `now` parameter**, unlike the bank's); `createDb`, `type Db` from
  `apps/merchant/src/db/index.ts`; `products` from
  `apps/merchant/src/db/schema.ts`.
- Produces: `seedIfEmpty(db: Db): boolean` exported from
  `apps/merchant/src/db/seed.ts`.

**Difference from Task 1, deliberately:** the merchant's `seed()` deletes only
`products`, leaving `orders` and `payment_sessions` alone — its own comment says
re-seeding mid-demo must not erase an in-progress order. So the guard reads
`products`, and the signature takes no `now`.

- [ ] **Step 1: Write the failing test**

Create `apps/merchant/src/db/seed.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "./index.js";
import { products } from "./schema.js";
import { seedIfEmpty } from "./seed.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "merchant-seed-"));
  db = createDb(path.join(dir, "test.db"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("seedIfEmpty", () => {
  it("seeds the product fixtures when the products table is empty", () => {
    expect(db.select().from(products).all()).toHaveLength(0);

    expect(seedIfEmpty(db)).toBe(true);

    expect(db.select().from(products).all().length).toBeGreaterThan(0);
  });

  it("leaves a populated catalogue untouched and reports it did nothing", () => {
    db.insert(products)
      .values({
        id: "prod_operator",
        name: "Operator's Placeholder",
        description: "Inserted by hand to prove seedIfEmpty does not clobber it.",
        priceCents: 199,
        imageUrl: "/products/placeholder.jpg",
        category: "test",
        packLabel: "1 pc",
        baseQuantity: 1,
        baseUnit: "pc",
      })
      .run();

    expect(seedIfEmpty(db)).toBe(false);

    const after = db.select().from(products).all();
    expect(after).toHaveLength(1);
    expect(after[0]?.id).toBe("prod_operator");
  });
});
```

The first test asserts `> 0` rather than an exact count on purpose: the fixture
list is long and product churn should not break this test. The *guard* is what
is under test, not the catalogue size.

If the `products` insert above is rejected for a missing column, read
`apps/merchant/src/db/schema.ts` and add the required fields — do not weaken the
test by switching to raw SQL.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd ~/dev/eudiw/payment-banking-demo/apps/merchant
pnpm vitest run src/db/seed.test.ts
```

Expected: FAIL, because `seedIfEmpty` is not exported yet.

- [ ] **Step 3: Implement `seedIfEmpty`**

In `apps/merchant/src/db/seed.ts`, add `import { sql } from "drizzle-orm";` and
append after the existing `seed` function:

```ts
/**
 * Seeds only a catalogue that has never been seeded. Called at server boot from
 * `src/instrumentation.ts`: a fresh deployment gets an empty PVC, and without
 * this the shop renders zero products and no checkout is possible. `seed.ts` is
 * a tsx script and is not in the runtime image, so `pnpm seed` has no
 * in-cluster equivalent.
 *
 * Guards on `products` specifically, matching what `seed()` actually deletes —
 * orders and payment_sessions are runtime data and are left alone. Returns
 * whether it seeded, so the caller can log which happened.
 */
export function seedIfEmpty(db: Db): boolean {
  const row = db.select({ n: sql<number>`count(*)` }).from(products).get();
  if ((row?.n ?? 0) > 0) return false;
  seed(db);
  return true;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd ~/dev/eudiw/payment-banking-demo/apps/merchant
pnpm vitest run src/db/seed.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Wire it into the boot hook**

Replace the body of `register()` in `apps/merchant/src/instrumentation.ts`,
keeping the existing header comment intact:

```ts
export async function register() {
  try {
    await import("./env.js");
  } catch (error) {
    console.error(
      "[merchant] Fatal: invalid environment configuration — refusing to serve requests.",
      error,
    );
    process.exit(1);
  }

  try {
    const { getDb } = await import("./db/index.js");
    const { seedIfEmpty } = await import("./db/seed.js");
    const seeded = seedIfEmpty(getDb());
    console.log(
      seeded
        ? "[merchant] Seeded an empty catalogue with the demo products."
        : "[merchant] Catalogue already populated — left untouched.",
    );
  } catch (error) {
    console.error(
      "[merchant] Fatal: could not open or seed the database — refusing to serve requests.",
      error,
    );
    process.exit(1);
  }
}
```

Both imports must stay dynamic and inside the function, for the same reason as
Task 1 Step 5.

- [ ] **Step 6: Run the whole gate**

```bash
cd ~/dev/eudiw/payment-banking-demo
pnpm check
```

Expected: typecheck clean across all 4 projects, **166 tests** passing
(162 baseline + 2 from Task 1 + 2 here).

- [ ] **Step 7: Commit**

```bash
cd ~/dev/eudiw/payment-banking-demo
git add apps/merchant/src/db/seed.ts apps/merchant/src/db/seed.test.ts \
        apps/merchant/src/instrumentation.ts
git commit -m "feat(merchant): seed the product catalogue at boot when empty

Mirrors the bank change. The merchant is worse off on a fresh PVC than the bank
was: with no products the shop renders an empty catalogue and no checkout is
reachable at all.

Guards on 'products' specifically, matching what seed() deletes -- orders and
payment_sessions are runtime data and stay untouched, per seed()'s own comment
about not erasing an in-progress order.

Verified: pnpm check green, 166 tests (162 baseline + 4 new across both apps)."
```
---

### Task 3: One image for both apps

Replace the two per-app Dockerfiles with a single root Dockerfile producing one
image that can start either app. This also fixes the three defects listed at the
top of this plan — read that section before starting; two of them mean the
existing Dockerfiles **would fail** in a clean-clone build even though they were
reported as verified.

**Files:**
- Create: `Dockerfile` (repo root)
- Create: `docker-entrypoint.sh` (repo root)
- Create: `.dockerignore` (repo root)
- Delete: `apps/bank/Dockerfile`, `apps/bank/.dockerignore`,
  `apps/merchant/Dockerfile`, `apps/merchant/.dockerignore`
- Modify: `README.md` (the "Building the image" and "Seeding a deployed
  instance" sections)
- Modify: `AGENTS.md` (build/tooling constraints)

**Interfaces:**
- Produces: an image whose entrypoint takes one argument, `bank` or `merchant`.
  Task 5's build Job builds it; Task 6's manifest runs it with
  `args: ["bank"]` / `args: ["merchant"]`. Runtime paths the manifest depends on:
  `/data` is the writable volume mount; `/app/bank/apps/bank/.next/cache` and
  `/app/merchant/apps/merchant/.next/cache` are the two directories that need a
  writable `emptyDir` when `readOnlyRootFilesystem: true`.

- [ ] **Step 1: Write the root `.dockerignore`**

Create `.dockerignore` at the repo root. This is the file Docker actually reads
for a root-context build; the two existing per-app ones never took effect.

```
**/node_modules
**/.next
**/data
**/*.db
**/*.db-journal
**/.env
**/.env.local
**/*.tsbuildinfo
.git
.pi
docs
tools
```

Excluding `**/node_modules` is not merely a size optimisation here — it is what
forces the build to run its own `pnpm install` instead of silently inheriting the
host's (Apple Silicon) `better-sqlite3` native addon, which would be the wrong
architecture for the cluster.

- [ ] **Step 2: Write the entrypoint**

Create `docker-entrypoint.sh` at the repo root:

```sh
#!/bin/sh
# One image, two apps. The argument selects which one this container runs.
#
# Owning the `cd` here rather than via the manifest's workingDir keeps a single
# source of truth: `podman run <image> bank` behaves identically to the pod.
set -eu

APP="${1:-}"
case "$APP" in
  bank | merchant) ;;
  *)
    echo "docker-entrypoint.sh: expected 'bank' or 'merchant', got '${APP}'" >&2
    echo "usage: docker-entrypoint.sh <bank|merchant>" >&2
    exit 64
    ;;
esac

# Both apps resolve drizzle migrations as path.join(process.cwd(), "drizzle")
# (apps/*/src/db/index.ts), so the CWD must be the app's own root.
cd "/app/${APP}/apps/${APP}"
exec node server.js
```

`exit 64` is `EX_USAGE`. A distinct non-1 code makes "you passed the wrong
argument" visually distinct from "the app crashed" in `kubectl describe`.

- [ ] **Step 3: Write the root `Dockerfile`**

Create `Dockerfile` at the repo root:

```dockerfile
# syntax=docker/dockerfile:1

# One image, both apps. See
# docs/superpowers/specs/2026-08-06-kubernetes-deployment-design.md
#
# Build from the REPO ROOT as context: a pnpm workspace build needs the root
# manifests and the packages/ sources.
#   podman build -t payment-demo:dev .

# ---- build ---------------------------------------------------------------
FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

# better-sqlite3 compiles a native addon.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# The install runs AFTER the sources are in place, deliberately -- there is no
# separate `deps` stage. `.npmrc` sets node-linker=hoisted, so third-party
# packages hoist to the root node_modules, but the @demo/* workspace links live
# ONLY in apps/<app>/node_modules (verified: node_modules/@demo does not exist;
# apps/bank/node_modules/@demo/{ui,foundry-client} are symlinks into packages/).
# A deps stage copying just /repo/node_modules drops those links and
# `next build` then cannot resolve @demo/ui. Letting pnpm run over the real
# tree creates every link itself. No cache is lost that matters: the in-cluster
# build Job clones fresh every time, so a deps layer would never hit.
COPY . .
RUN pnpm install --frozen-lockfile

# `next build` must not require real secrets, but env.ts validates at import
# time. These placeholders never reach the runtime stage.
ENV FOUNDRY_ADMIN_KEY=build-only \
    BANK_API_KEY=build-only \
    SESSION_SECRET=build-only-secret-0123456789012345678901234567890123
RUN pnpm --filter @demo/bank run build \
  && pnpm --filter @demo/merchant run build

# ---- runtime -------------------------------------------------------------
FROM node:22-slim AS runtime
ENV NODE_ENV=production
# Next's standalone server binds to $HOSTNAME when set. Container runtimes set
# HOSTNAME to the container/pod name, which is not a bindable interface -- pin
# it to 0.0.0.0 so the server is reachable from off-pod (kubelet probes).
ENV HOSTNAME=0.0.0.0
WORKDIR /app

# Both standalone trees, side by side, each copied verbatim into its own prefix.
# NOT merged into a shared /app: each carries its own root-level node_modules
# produced by Next's independent dependency trace, and COPY resolves an overlap
# last-writer-wins per file -- a subtly missing traced file would surface as a
# runtime MODULE_NOT_FOUND on a rarely-hit route, not as a build failure.
COPY --from=build /repo/apps/bank/.next/standalone      /app/bank/
COPY --from=build /repo/apps/bank/.next/static          /app/bank/apps/bank/.next/static
COPY --from=build /repo/apps/bank/drizzle               /app/bank/apps/bank/drizzle

COPY --from=build /repo/apps/merchant/.next/standalone   /app/merchant/
COPY --from=build /repo/apps/merchant/.next/static       /app/merchant/apps/merchant/.next/static
COPY --from=build /repo/apps/merchant/drizzle            /app/merchant/apps/merchant/drizzle
# The merchant serves product imagery from public/. The per-app Dockerfiles this
# replaces never copied it, so every product image 404'd in a container.
COPY --from=build /repo/apps/merchant/public             /app/merchant/apps/merchant/public

COPY docker-entrypoint.sh /app/docker-entrypoint.sh

# `USER 1000` numerically, not `USER node`: with a NAME the kubelet cannot prove
# the user is non-root and rejects `runAsNonRoot: true` with
# CreateContainerConfigError. 1000 is `node` in node:22-slim.
RUN chmod +x /app/docker-entrypoint.sh \
  && mkdir -p /data \
  && chown 1000:1000 /data
USER 1000

VOLUME ["/data"]
# bank 3001, merchant 3000. Documentation only; the manifest sets PORT.
EXPOSE 3000 3001

# Migrations AND seeding run at boot via src/instrumentation.ts, so there is no
# migrate/seed step here.
ENTRYPOINT ["/app/docker-entrypoint.sh"]
```

- [ ] **Step 4: Delete the superseded files**

```bash
cd ~/dev/eudiw/payment-banking-demo
git rm apps/bank/Dockerfile apps/bank/.dockerignore \
       apps/merchant/Dockerfile apps/merchant/.dockerignore
```

- [ ] **Step 5: Build the image and verify the layout**

This is an arm64 build on this machine. That is fine and intended: it verifies
the image *layout*, the install-after-copy fix, and both entrypoints. It does
**not** verify the amd64 artefact — that only comes from Task 5's in-cluster
build.

```bash
cd ~/dev/eudiw/payment-banking-demo
podman build -t payment-demo:dev .
```

Expected: success. If `next build` fails with a module-resolution error naming
`@demo/ui` or `@demo/foundry-client`, the install is not seeing the workspace —
re-read Step 3's comment about the deps stage; do **not** "fix" it by adding
`@demo/*` to a package.json.

Then confirm the layout is what the manifest will assume:

```bash
podman run --rm --entrypoint sh payment-demo:dev -c \
  'ls /app/bank/apps/bank/server.js /app/merchant/apps/merchant/server.js \
      /app/merchant/apps/merchant/public/products \
      /app/bank/apps/bank/drizzle /app/merchant/apps/merchant/drizzle'
```

Expected: every path listed, no "No such file".

- [ ] **Step 6: Verify both apps start, and that a bad argument fails loudly**

Never use a bare foreground `podman run` — a Next standalone server can hang
rather than exit. Use `-d`, then inspect.

```bash
cd ~/dev/eudiw/payment-banking-demo

# bank
podman run -d --name pbd-bank -p 3001:3001 \
  -e FOUNDRY_ADMIN_KEY=x -e BANK_API_KEY=x \
  -e SESSION_SECRET=0123456789012345678901234567890123456789 \
  payment-demo:dev bank
sleep 12
podman logs pbd-bank
curl -s -o /dev/null -w 'bank /api/health -> %{http_code}\n' http://127.0.0.1:3001/api/health
curl -s -o /dev/null -w 'bank /api/ready  -> %{http_code}\n' http://127.0.0.1:3001/api/ready

# merchant
podman run -d --name pbd-merchant -p 3000:3000 \
  -e FOUNDRY_ADMIN_KEY=x -e BANK_API_KEY=x -e MERCHANT_NAME=Larder \
  payment-demo:dev merchant
sleep 12
podman logs pbd-merchant
curl -s -w '\nmerchant /api/products -> %{http_code}\n' http://127.0.0.1:3000/api/products
```

Expected:
- Both `podman logs` contain the seeding line from Task 1/2 —
  `Seeded an empty database...` / `Seeded an empty catalogue...`. **This is the
  real proof that boot seeding works**, and it is why those tasks come first.
- `/api/health` -> 200 and `/api/ready` -> 200 for the bank.
- `/api/products` -> 200 with a non-empty JSON array.

Now the negative case:

```bash
podman run --rm payment-demo:dev nonsense; echo "exit=$?"
```

Expected: the usage message on stderr and `exit=64`.

Clean up:

```bash
podman rm -f pbd-bank pbd-merchant
```

- [ ] **Step 7: Update `README.md`**

Two sections need rewriting.

Replace the body of the **"Building the image"** section with:

````markdown
One image contains both apps; the entrypoint argument selects which one runs.
The build context is the repository root, because a pnpm workspace build needs
the root manifests and the `packages/` sources. Use `podman` (docker is not
installed here); the CLIs are drop-in for this Dockerfile.

```bash
podman build -t payment-demo:dev .
podman run -d --name pbd-bank -p 3001:3001 \
  -e FOUNDRY_ADMIN_KEY=x -e BANK_API_KEY=x \
  -e SESSION_SECRET=0123456789012345678901234567890123456789 \
  payment-demo:dev bank
```

A local build on Apple Silicon produces an `arm64` image, useful for checking
layout and startup but **not** runnable on the cluster. The deployed
`linux/amd64` image is built in-cluster — see
`~/dev/dl-infra-k8s/payment-banking-demo/README.md`.
````

Replace the **"Seeding a deployed instance"** section entirely — its premise no
longer holds:

```markdown
### Seeding a deployed instance

Nothing to do. Each app seeds itself at boot when its database is empty
(`src/instrumentation.ts` -> `seedIfEmpty`), so a fresh volume comes up
demoable. A populated database is never touched.

To force a re-seed, destroy the volume. In Kubernetes that is `make reset` in
`~/dev/dl-infra-k8s/payment-banking-demo/`; locally, delete the SQLite file and
restart.

`pnpm seed` still exists for local development and resets to the fixtures
unconditionally.
```

- [ ] **Step 8: Update `AGENTS.md`**

In the "Build and tooling" list, add these two entries, keeping the existing
house style (bold lead-in, then the reason it exists):

```markdown
- **There is ONE Dockerfile, at the repo root, producing ONE image for both
  apps.** The entrypoint takes `bank` or `merchant`. Its `pnpm install` runs
  *after* `COPY . .` on purpose: `.npmrc` sets `node-linker=hoisted`, so
  third-party packages hoist to the root `node_modules` but the `@demo/*`
  workspace links exist only in `apps/<app>/node_modules`. A `deps` stage that
  copies just `/repo/node_modules` drops them and `next build` cannot resolve
  `@demo/ui`. Do not "optimise" this back into a separate deps stage.

- **`.dockerignore` must be at the repo root.** Builds use the root as context,
  and Docker only honours `<context>/.dockerignore`. Two per-app
  `.dockerignore` files previously sat at paths Docker never reads and were
  silently inert, which let the host's `node_modules` — including an `arm64`
  `better-sqlite3` addon — leak into the build.
```

In the "Layout" section, add `Dockerfile`, `docker-entrypoint.sh` and
`.dockerignore` at the root, and remove any implication that Dockerfiles live
under `apps/*`. Also update the "Known-unverifiable" section only if Task 6/7
changes its content — not here.

- [ ] **Step 9: Re-run the gate and commit**

```bash
cd ~/dev/eudiw/payment-banking-demo
pnpm check
```

Expected: still 166 tests, typecheck clean (this task changes no TypeScript).

```bash
git add Dockerfile docker-entrypoint.sh .dockerignore README.md AGENTS.md
git commit -m "feat: single root Dockerfile building one image for both apps

The entrypoint takes 'bank' or 'merchant' and cd's to that app's root, so the
two Next standalone trees live side by side under /app/<app>/ and are never
merged -- each has its own traced root node_modules, and merging resolves the
overlap last-writer-wins.

Fixes three real defects in the per-app Dockerfiles this replaces:

1. .dockerignore was at apps/<app>/.dockerignore, a path Docker never reads for
   a root-context build. Both files were silently inert, so the host's
   node_modules -- including an arm64 better-sqlite3 addon -- was copied in.
2. The deps stage copied only /repo/node_modules. With node-linker=hoisted the
   @demo/* workspace links live only in apps/<app>/node_modules, so a clean
   clone (i.e. the in-cluster build Job) could not resolve @demo/ui. Defect 1
   masked this locally by supplying the host's real trees. The install now runs
   after COPY . . so pnpm creates every link itself.
3. apps/merchant/public/ was never copied, so every product image 404'd in a
   container.

Also pins ENV HOSTNAME=0.0.0.0 (container runtimes set HOSTNAME to the pod name,
which Next standalone would try to bind) and switches to numeric USER 1000 so
the manifest can set runAsNonRoot: true.

Verified with a real arm64 podman build: both entrypoints serve, bank
/api/health and /api/ready return 200, merchant /api/products returns a
non-empty list, /app/merchant/apps/merchant/public/products is present, and a
bad argument exits 64 with a usage message. Both containers logged the
boot-seeding line, which is the first real proof of Tasks 1-2 outside vitest.

NOT verified: the linux/amd64 artefact. Local builds here are arm64; the
deployed image comes from the in-cluster buildah Job."
```

---

### Task 4: Give the app repo a GitHub home

The in-cluster build Job clones over SSH, so the code must be on GitHub before
anything can be built. This repo currently has **no remote at all**.

This is a one-time manual step in the app repo, deliberately *not* a target in
the infra Makefile — the infra repo deploys, it does not manage another repo's
git remote.

**Files:** none created or modified. This task only moves commits to a remote.

**Interfaces:**
- Produces: `git@github.com:digitallabor-berlin/payment-banking-demo.git` with
  `main` pushed. Task 5's `build-job.yml` clones exactly that URL and branch.

- [ ] **Step 1: Confirm the gate is green before publishing anything**

```bash
cd ~/dev/eudiw/payment-banking-demo
pnpm check
```

Expected: typecheck clean, 166 tests. Do not proceed on a red gate.

- [ ] **Step 2: Confirm nothing secret is about to be committed**

```bash
cd ~/dev/eudiw/payment-banking-demo
cat .gitignore
git status --short
git ls-files | grep -iE '\.env|secret|\.db$|/data/' || echo "OK: nothing secret tracked"
```

Expected: `.gitignore` already covers `.env`, `.env.local`, `data/`, `*.db`,
`*.db-journal`, `.pi/`. The only `.env*` files tracked are the two
`.env.example`, which contain dev placeholders and are meant to ship. If
anything else appears, stop and fix `.gitignore` first.

- [ ] **Step 3: Commit the remaining working-tree changes**

At planning time the tree had 36 modified and 11 untracked files — UI work plus
a new merchant migration (`apps/merchant/drizzle/0001_lively_senator_kelly.sql`
and its snapshot) and `apps/merchant/public/`. Re-check what is actually there,
then commit it. This is real work that must ship: the build Job clones `main`,
so anything uncommitted simply will not exist in the image — and the merchant's
product images and second migration are load-bearing.

```bash
cd ~/dev/eudiw/payment-banking-demo
git status --short
git add -A
git status --short   # expect empty
git commit -m "feat: UI refresh for both apps and the merchant's second migration

Sparkasse-styled bank surfaces and the Larder merchant storefront, plus
apps/merchant/drizzle/0001_lively_senator_kelly.sql, its snapshot, and
apps/merchant/public/products imagery.

Committed as-is ahead of publishing the repo: the in-cluster build Job clones
main, so uncommitted work would be absent from the image.

Verified: pnpm check green, 166 tests."
```

If `git status --short` is already empty because a previous task committed
everything, skip the commit and say so — do not create an empty commit.

- [ ] **Step 4: Create the private repo and push**

```bash
cd ~/dev/eudiw/payment-banking-demo
gh repo create digitallabor-berlin/payment-banking-demo \
  --private \
  --source . \
  --remote origin \
  --description "EUDI wallet as a payment instrument: Sparkasse-styled bank issuing an EMVCo DPC, and the Larder merchant checkout that verifies and settles it" \
  --push
```

`--private` matches every sibling repo in this org. `--source .` plus `--push`
adds the `origin` remote and pushes the current branch in one step.

- [ ] **Step 5: Verify the remote is real and complete**

```bash
cd ~/dev/eudiw/payment-banking-demo
git remote -v
git status -sb                 # expect: ## main...origin/main with nothing ahead
gh repo view digitallabor-berlin/payment-banking-demo --json name,visibility,defaultBranchRef
gh api repos/digitallabor-berlin/payment-banking-demo/contents/Dockerfile --jq .name
```

Expected: `origin` present, `main` tracking `origin/main` with nothing ahead,
visibility `PRIVATE`, default branch `main`, and `Dockerfile` resolvable through
the API — that last check proves the file the build Job needs is actually on the
remote, not merely local.

No commit in this task; it publishes existing commits.

---

### Task 5: In-cluster build producing the amd64 image

**Repo: `~/dev/dl-infra-k8s`** — all file paths below are inside
`payment-banking-demo/`.

Build the image on the cluster rather than locally. The cluster's nodes are
`linux/amd64`; this machine is Apple Silicon, and `better-sqlite3` compiles a
native addon, so an emulated cross-build is slow and its correctness is not
something to assert without testing. A Job on the cluster is a native build.
This mirrors `foundry/build-job.yml` — read that file alongside this task.

**Files:**
- Create: `payment-banking-demo/.gitignore`
- Create: `payment-banking-demo/build-job.yml`
- Create: `payment-banking-demo/Makefile` (build + registry targets; Task 6
  appends deploy and ops targets to the same file)

**Interfaces:**
- Consumes: the GitHub repo from Task 4; the root `Dockerfile` from Task 3.
- Produces: `containers.digitallabor.dev/payment-banking-demo/demo:latest` in
  the registry, and Secrets `regcred` + `demo-build-git` in namespace
  `payment-banking-demo`. Task 6's manifest pulls that tag using `regcred`.

- [ ] **Step 1: Write `.gitignore`**

Create `payment-banking-demo/.gitignore`, following `foundry/.gitignore`'s
convention of explaining *why* each entry is excluded:

```gitignore
# Registry pull credential: a live Secret holding the plaintext registry
# password for containers.digitallabor.dev. Deliberately NOT committed, even
# though sibling services in this repo do commit theirs -- that precedent is a
# defect, not a licence. Recreate locally with
# `kubectl create secret docker-registry regcred ...` (see README).
regcred.yaml

# Locally generated deploy-key material (`make deploy-key` deletes this itself
# once the key is registered on GitHub and stored as a Secret; gitignored as
# defense-in-depth in case a run is interrupted mid-way).
.buildkey/

# Agent-harness scratch (task ledgers). No precedent for tracking these in this
# infra repo -- the durable record lives in commit messages and README.md.
.pi/
```

- [ ] **Step 2: Create the namespace and the registry credential**

The namespace must exist before any Secret can live in it. Task 6's
`manifest.yml` also declares it (so `kubectl apply -f manifest.yml` stays
self-contained), but this task needs it now.

```bash
kubectl create namespace payment-banking-demo --dry-run=client -o yaml \
  | kubectl apply -f -
```

Then copy the registry credential from the `foundry` namespace, which already
has a working one, rather than re-entering the password:

```bash
cd ~/dev/dl-infra-k8s/payment-banking-demo
kubectl -n foundry get secret regcred -o yaml \
  | sed 's/namespace: foundry/namespace: payment-banking-demo/' \
  | grep -vE '^  (resourceVersion|uid|creationTimestamp|selfLink):' \
  > regcred.yaml
kubectl apply -f regcred.yaml
kubectl -n payment-banking-demo get secret regcred -o jsonpath='{.type}'; echo
```

Expected: `kubernetes.io/dockerconfigjson`.

Then confirm the file is ignored, not staged:

```bash
cd ~/dev/dl-infra-k8s && git status --short payment-banking-demo/
```

Expected: `regcred.yaml` does **not** appear. If it does, `.gitignore` from Step 1
is wrong or missing.

- [ ] **Step 3: Write `build-job.yml`**

Create `payment-banking-demo/build-job.yml`:

```yaml
# --- IN-CLUSTER BUILD JOB (buildah) -----------------------------------------
# Builds containers.digitallabor.dev/payment-banking-demo/demo:latest from the
# `main` branch of git@github.com:digitallabor-berlin/payment-banking-demo.git
# and pushes it, using buildah instead of a Docker daemon (no privileged
# docker-in-docker sidecar, no external CI runner).
#
# Why build here rather than on a dev machine: this cluster's nodes are
# linux/amd64 and the dev machines here are Apple Silicon. better-sqlite3
# compiles a native addon, so a local `--platform linux/amd64` build would run
# the toolchain under QEMU emulation -- slow, and not something to trust
# without testing. Building in-cluster is a genuinely native build.
#
# ONE Job builds ONE image containing BOTH apps. The repo is a single pnpm
# workspace with one lockfile, and the image's entrypoint selects bank or
# merchant at run time. This also makes a version skew between the two apps
# impossible, which matters because credential_id is a contract between them.
#
# Trigger: MANUAL ONLY, via `make build-image`. There is no webhook and no
# poller. Run it by hand after pushing to main.
#
# Prerequisites (one-time): `make deploy-key` creates the demo-build-git Secret
# (a read-only GitHub deploy key scoped to just this repo). Registry push
# reuses the regcred Secret.
apiVersion: batch/v1
kind: Job
metadata:
  name: demo-build
  namespace: payment-banking-demo
spec:
  # One-shot: a broken clone or build should fail loudly and immediately, not
  # retry silently and mask a real compile error behind a flaky-looking log.
  backoffLimit: 0
  ttlSecondsAfterFinished: 3600
  template:
    metadata:
      labels:
        app: demo-build
    spec:
      restartPolicy: Never
      volumes:
      - name: workspace
        emptyDir: {}
      - name: git-key
        secret:
          secretName: demo-build-git
          defaultMode: 0400
      - name: registry-auth
        secret:
          secretName: regcred
          # regcred's docker/config.json shape ({"auths": {...}}) is the same
          # shape buildah/skopeo authfiles use, so this mounts directly as
          # --authfile with no conversion.
          items:
          - key: .dockerconfigjson
            path: config.json
      initContainers:
      # Clones main into the shared workspace over SSH using the read-only
      # deploy key from `make deploy-key`. --depth 1 keeps this fast; only the
      # tip of main is ever needed.
      - name: clone
        image: alpine/git:2.45.2
        command:
        - sh
        - -c
        - |
          set -eu
          mkdir -p /root/.ssh
          cp /git-key/ssh-privatekey /root/.ssh/id_ed25519
          chmod 600 /root/.ssh/id_ed25519
          cp /git-key/known_hosts /root/.ssh/known_hosts
          git clone --depth 1 --branch main \
            git@github.com:digitallabor-berlin/payment-banking-demo.git \
            /workspace/src
        volumeMounts:
        - name: git-key
          mountPath: /git-key
          readOnly: true
        - name: workspace
          mountPath: /workspace
      containers:
      - name: build
        image: quay.io/buildah/stable:v1.41.3
        securityContext:
          # buildah needs user/mount namespaces and overlayfs mounts. Rootless
          # buildah + fuse-overlayfs avoids `privileged: true` but is slower and
          # fussier; this namespace has no PodSecurity restrictions, so plain
          # privileged is the simplest reliable option for a one-shot Job.
          privileged: true
        workingDir: /workspace/src
        command:
        - sh
        - -c
        - |
          set -eu
          buildah bud --format docker --platform linux/amd64 \
            -t containers.digitallabor.dev/payment-banking-demo/demo:latest \
            /workspace/src
          buildah push --authfile /registry-auth/config.json \
            containers.digitallabor.dev/payment-banking-demo/demo:latest
        volumeMounts:
        - name: workspace
          mountPath: /workspace
        - name: registry-auth
          mountPath: /registry-auth
          readOnly: true
        resources:
          # pnpm install with a native better-sqlite3 compile, plus two
          # `next build`s. Generous headroom; bump if the Job OOMs.
          requests:
            cpu: "2"
            memory: 4Gi
          limits:
            cpu: "4"
            memory: 8Gi
```

- [ ] **Step 4: Write the Makefile's build half**

Create `payment-banking-demo/Makefile`. Task 6 appends to this same file, so
leave the structure open.

```makefile
# payment-banking-demo -- EUDI wallet as a payment instrument
#   ns: payment-banking-demo
#   bank:     https://sparkasse-musterstadt.digitallabor.dev
#   merchant: https://larder-shop.digitallabor.dev
#
# One image holds both apps; the entrypoint argument selects which one a
# container runs. Secrets are NOT committed -- `make secrets` creates them in
# the cluster directly, and regcred.yaml is gitignored.
#
# Depends on foundry (ns: foundry) for issuance and verification. The
# FOUNDRY_ADMIN key is COPIED from that namespace by `make secrets`; see README.

NS            := payment-banking-demo
BANK_HOST     := sparkasse-musterstadt.digitallabor.dev
MERCHANT_HOST := larder-shop.digitallabor.dev
IMAGE         := containers.digitallabor.dev/payment-banking-demo/demo:latest
GH_REPO       := digitallabor-berlin/payment-banking-demo
BUILD_KEY_DIR := .buildkey

.PHONY: help deploy-key build-image build-status build-logs

help:
	@grep -E '^[a-z-]+:.*?##' $(MAKEFILE_LIST) | sed 's/:.*##/\t/'

# --- BUILD (in-cluster, buildah) ---------------------------------------------
# The cluster is linux/amd64; dev machines here are Apple Silicon and
# better-sqlite3 compiles a native addon. Manual trigger only -- run this by
# hand after pushing to main. Nothing rebuilds automatically.

deploy-key: ## One-time: generate + register a read-only GitHub deploy key, store as a Secret
	@mkdir -p $(BUILD_KEY_DIR)
	ssh-keygen -t ed25519 -N "" -C "payment-banking-demo-build-job ($(shell date +%F))" \
	  -f $(BUILD_KEY_DIR)/id_ed25519
	gh repo deploy-key add $(BUILD_KEY_DIR)/id_ed25519.pub \
	  --repo $(GH_REPO) --title "payment-banking-demo-build-job"
	ssh-keyscan -t ed25519 github.com > $(BUILD_KEY_DIR)/known_hosts
	kubectl -n $(NS) create secret generic demo-build-git \
	  --from-file=ssh-privatekey=$(BUILD_KEY_DIR)/id_ed25519 \
	  --from-file=known_hosts=$(BUILD_KEY_DIR)/known_hosts \
	  --dry-run=client -o yaml | kubectl apply -f -
	@rm -rf $(BUILD_KEY_DIR)
	@echo "OK: deploy key registered on GitHub (read-only, repo-scoped) and"
	@echo "    stored as Secret/demo-build-git. Local copy deleted."

build-image: ## Build main + push $(IMAGE) via an in-cluster buildah Job
	kubectl -n $(NS) delete job demo-build --ignore-not-found
	kubectl apply -f build-job.yml
	kubectl -n $(NS) wait --for=condition=ready pod -l job-name=demo-build --timeout=180s || true
	-kubectl -n $(NS) logs -f job/demo-build --all-containers --prefix
	@echo ">> log stream ended, confirming final Job status (a stream drop isn't necessarily a failure) ..."
	@kubectl -n $(NS) wait --for=condition=complete --for=condition=failed --timeout=1800s job/demo-build >/dev/null 2>&1; \
	  ok=$$(kubectl -n $(NS) get job/demo-build -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}'); \
	  if [ "$$ok" != "True" ]; then \
	    echo ">> BUILD FAILED — recent logs:"; kubectl -n $(NS) logs job/demo-build --all-containers --prefix --tail=40; exit 1; \
	  fi
	@echo "OK: pushed $(IMAGE)"

build-status: ## Show the build Job + its pod
	kubectl -n $(NS) get job/demo-build -o wide
	kubectl -n $(NS) get pods -l job-name=demo-build

build-logs: ## Tail logs from the build Job (clone + buildah)
	kubectl -n $(NS) logs job/demo-build --all-containers --prefix
```

The `--timeout=1800s` on the completion wait is deliberately longer than
foundry's 900s: this build does a full `pnpm install` with a native compile plus
two `next build`s.

- [ ] **Step 5: Register the deploy key**

```bash
cd ~/dev/dl-infra-k8s/payment-banking-demo
make deploy-key
```

Expected: `ssh-keygen` output, `gh` confirming the key was added, then the
success message. Verify both sides, and that nothing was left behind:

```bash
gh repo deploy-key list --repo digitallabor-berlin/payment-banking-demo
kubectl -n payment-banking-demo get secret demo-build-git \
  -o jsonpath='{.data}' | tr ',' '\n' | sed 's/:.*//'
ls -a ~/dev/dl-infra-k8s/payment-banking-demo   # .buildkey must be GONE
```

Expected: a `payment-banking-demo-build-job` key listed as read-only; the Secret
holding `ssh-privatekey` and `known_hosts`; no `.buildkey/` directory.

- [ ] **Step 6: Build the image**

```bash
cd ~/dev/dl-infra-k8s/payment-banking-demo
make build-image
```

Expected: the clone initContainer succeeds, `buildah bud` runs both
`next build`s, `buildah push` uploads, and the target prints
`OK: pushed containers.digitallabor.dev/payment-banking-demo/demo:latest`.

Diagnosis if it fails:
- **Clone permission denied** — the deploy key is not registered against this
  repo. Re-run Step 5.
- **`next build` cannot resolve `@demo/ui`** — the Dockerfile has regressed to a
  separate `deps` stage. See Task 3 Step 3.
- **OOMKilled** — raise the `resources.limits.memory` in `build-job.yml`.

Confirm the Job genuinely completed rather than merely streaming logs:

```bash
kubectl -n payment-banking-demo get job demo-build \
  -o jsonpath='{.status.conditions[*].type}{"\n"}'
```

Expected: `Complete`.

- [ ] **Step 7: Commit**

```bash
cd ~/dev/dl-infra-k8s
git add payment-banking-demo/.gitignore payment-banking-demo/build-job.yml \
        payment-banking-demo/Makefile
git status --short   # regcred.yaml must NOT appear
git commit -m "feat(payment-banking-demo): in-cluster buildah build for the demo image

One Job builds ONE image containing both the bank and the merchant. The repo is
a single pnpm workspace with one lockfile and the image's entrypoint selects the
app at run time, so this also makes a bank/merchant version skew impossible --
credential_id is a contract between them.

Built in-cluster for the same reason foundry is: the cluster is linux/amd64, dev
machines here are Apple Silicon, and better-sqlite3 compiles a native addon.
Manual trigger only, no webhook.

regcred was copied from the foundry namespace (Secrets do not cross namespaces)
and is gitignored rather than committed -- unlike some older siblings in this
repo.

Verified: make deploy-key registered a read-only repo-scoped key and deleted the
local copy; make build-image completed (Job condition Complete) and pushed
containers.digitallabor.dev/payment-banking-demo/demo:latest."
```

---

### Task 6: Deploy both apps and route them

**Repo: `~/dev/dl-infra-k8s`**, in `payment-banking-demo/`.

**Files:**
- Create: `payment-banking-demo/manifest.yml`
- Modify: `payment-banking-demo/Makefile` (append secrets, deploy and ops targets)

**Interfaces:**
- Consumes: the image from Task 5; `Secret/regcred` in this namespace;
  `Secret/foundry-admin` key `admin-api-key` in namespace `foundry`;
  `Gateway/public-ingress-gateway` in `istio-system`. From the image: the
  entrypoint argument `bank`/`merchant`, `/data` as the writable volume, and the
  two `.next/cache` paths listed in Task 3's Interfaces.
- Produces: two Deployments serving on the two public hosts. Task 7 documents
  and smoke-tests them.

- [ ] **Step 1: Write `manifest.yml`**

Create `payment-banking-demo/manifest.yml`:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: payment-banking-demo
  labels:
    Environment: infra
---
# --- PERSISTENT STORAGE FÜR SQLITE -------------------------------------------
# Each app owns a SQLite file. The bank is the sole owner of credential state;
# the merchant never persists it. One PVC each, so `make reset` can wipe one
# without the other. The default StorageClass (local-path, reclaim Delete) is
# deliberate: `make reset` destroys these volumes to re-trigger boot seeding.
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: bank-data
  namespace: payment-banking-demo
spec:
  accessModes: ["ReadWriteOnce"]
  resources:
    requests:
      storage: 1Gi
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: merchant-data
  namespace: payment-banking-demo
spec:
  accessModes: ["ReadWriteOnce"]
  resources:
    requests:
      storage: 1Gi
---
# --- BANK --------------------------------------------------------------------
apiVersion: apps/v1
kind: Deployment
metadata:
  name: bank
  namespace: payment-banking-demo
  labels:
    app: bank
spec:
  replicas: 1 # SQLite: never scale past 1 (filesystem locks).
  strategy:
    # Recreate, not RollingUpdate: a ReadWriteOnce PVC cannot attach to a new
    # pod while the old one still holds it, so a RollingUpdate deadlocks.
    type: Recreate
  selector:
    matchLabels:
      app: bank
  template:
    metadata:
      labels:
        app: bank
    spec:
      imagePullSecrets:
      - name: regcred
      securityContext:
        # The image declares a NUMERIC `USER 1000`, so the kubelet can prove the
        # user is non-root and runAsNonRoot works. (foundry cannot do this: its
        # image uses `USER foundry`, a name, which fails the pod with
        # CreateContainerConfigError.)
        runAsNonRoot: true
        runAsUser: 1000
        runAsGroup: 1000
        fsGroup: 1000
        fsGroupChangePolicy: OnRootMismatch
      containers:
      - name: bank
        image: containers.digitallabor.dev/payment-banking-demo/demo:latest
        imagePullPolicy: Always
        # One image, two apps: the argument selects this one.
        args: ["bank"]
        securityContext:
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          capabilities:
            drop: ["ALL"]
        env:
        - name: PORT
          value: "3001"
        - name: DATABASE_PATH
          value: /data/bank.db
        - name: BANK_PUBLIC_URL
          value: https://sparkasse-musterstadt.digitallabor.dev
        # foundry's ADMIN listener, cross-namespace. Never publicly exposed from
        # here; foundry's own public hosts are separate.
        - name: FOUNDRY_ADMIN_URL
          value: http://foundry.foundry.svc.cluster.local:9000
        - name: FOUNDRY_ADMIN_KEY
          valueFrom:
            secretKeyRef:
              name: demo-secrets
              key: foundry-admin-key
        # Shared secret the merchant must present on POST /api/payments. Both
        # Deployments read the SAME Secret key, so they cannot drift.
        - name: BANK_API_KEY
          valueFrom:
            secretKeyRef:
              name: demo-secrets
              key: bank-api-key
        - name: SESSION_SECRET
          valueFrom:
            secretKeyRef:
              name: demo-secrets
              key: session-secret
        ports:
        - name: http
          containerPort: 3001
        # /api/ready opens SQLite, which triggers migrations AND boot seeding --
        # so readiness gates on the app being usable, not merely on the process
        # being up. /api/health is static, which is what liveness should be.
        startupProbe:
          httpGet:
            path: /api/ready
            port: http
          failureThreshold: 30
          periodSeconds: 5
        readinessProbe:
          httpGet:
            path: /api/ready
            port: http
          periodSeconds: 10
        livenessProbe:
          httpGet:
            path: /api/health
            port: http
          periodSeconds: 20
        resources:
          requests:
            cpu: 100m
            memory: 256Mi
          limits:
            cpu: "1"
            memory: 1Gi
        volumeMounts:
        - name: data
          mountPath: /data
        # readOnlyRootFilesystem: true makes / immutable, but a Next standalone
        # server writes its cache at runtime. This is the only writable path it
        # needs beyond the PVC.
        - name: next-cache
          mountPath: /app/bank/apps/bank/.next/cache
      volumes:
      - name: data
        persistentVolumeClaim:
          claimName: bank-data
      - name: next-cache
        emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: bank
  namespace: payment-banking-demo
spec:
  selector:
    app: bank
  ports:
  - name: http
    port: 3001
    targetPort: http
---
# --- MERCHANT ----------------------------------------------------------------
apiVersion: apps/v1
kind: Deployment
metadata:
  name: merchant
  namespace: payment-banking-demo
  labels:
    app: merchant
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: merchant
  template:
    metadata:
      labels:
        app: merchant
    spec:
      imagePullSecrets:
      - name: regcred
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        runAsGroup: 1000
        fsGroup: 1000
        fsGroupChangePolicy: OnRootMismatch
      containers:
      - name: merchant
        image: containers.digitallabor.dev/payment-banking-demo/demo:latest
        imagePullPolicy: Always
        args: ["merchant"]
        securityContext:
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          capabilities:
            drop: ["ALL"]
        env:
        - name: PORT
          value: "3000"
        - name: DATABASE_PATH
          value: /data/merchant.db
        - name: MERCHANT_PUBLIC_URL
          value: https://larder-shop.digitallabor.dev
        - name: FOUNDRY_ADMIN_URL
          value: http://foundry.foundry.svc.cluster.local:9000
        - name: FOUNDRY_ADMIN_KEY
          valueFrom:
            secretKeyRef:
              name: demo-secrets
              key: foundry-admin-key
        # In-namespace, plain HTTP. The bank is never reached over its public
        # host from here.
        - name: BANK_API_URL
          value: http://bank:3001
        - name: BANK_API_KEY
          valueFrom:
            secretKeyRef:
              name: demo-secrets
              key: bank-api-key
        # NOT cosmetic: this becomes MERCHANT_REFERENCE_NAME in
        # lib/payment-sessions.ts, i.e. the merchant name the WALLET shows when
        # asking the user to authorise the payment. env.ts defaults it to
        # "Demo Shop", which would contradict the storefront's own branding.
        - name: MERCHANT_NAME
          value: Larder
        ports:
        - name: http
          containerPort: 3000
        startupProbe:
          httpGet:
            path: /api/ready
            port: http
          failureThreshold: 30
          periodSeconds: 5
        readinessProbe:
          httpGet:
            path: /api/ready
            port: http
          periodSeconds: 10
        livenessProbe:
          httpGet:
            path: /api/health
            port: http
          periodSeconds: 20
        resources:
          requests:
            cpu: 100m
            memory: 256Mi
          limits:
            cpu: "1"
            memory: 1Gi
        volumeMounts:
        - name: data
          mountPath: /data
        - name: next-cache
          mountPath: /app/merchant/apps/merchant/.next/cache
      volumes:
      - name: data
        persistentVolumeClaim:
          claimName: merchant-data
      - name: next-cache
        emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: merchant
  namespace: payment-banking-demo
spec:
  selector:
    app: merchant
  ports:
  - name: http
    port: 3000
    targetPort: http
---
# --- ISTIO ROUTING (EXTERNER ZUGRIFF) ---------------------------------------
# TLS terminates at istio-system/public-ingress-gateway using the wildcard cert
# `*.digitallabor.dev` (credentialName: digitallabor-dev-tls-secret), so both
# hostnames below are covered without a dedicated Certificate resource. DNS is
# likewise wildcard -- both names already resolve to 167.235.116.254.
#
# EVERY route MUST carry an explicit host match. With two hosts on one
# VirtualService, a bare catch-all route (no `match:`) matches BOTH hostnames
# and would send half the demo to the wrong app.
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: payment-banking-demo
  namespace: payment-banking-demo
spec:
  hosts:
  - "sparkasse-musterstadt.digitallabor.dev"
  - "larder-shop.digitallabor.dev"
  gateways:
  - istio-system/public-ingress-gateway
  http:
  - match:
    - headers:
        host:
          exact: "sparkasse-musterstadt.digitallabor.dev"
    route:
    - destination:
        host: bank
        port:
          number: 3001
  - match:
    - headers:
        host:
          exact: "larder-shop.digitallabor.dev"
    route:
    - destination:
        host: merchant
        port:
          number: 3000
```

- [ ] **Step 2: Append the secrets, deploy and ops targets to the Makefile**

Add the following to `payment-banking-demo/Makefile`, and replace the existing
`.PHONY` line with the extended one shown at the end of this step.

```makefile
# --- SECRETS -----------------------------------------------------------------
# Idempotent by design. `session-secret` and `bank-api-key` are generated ONCE
# and thereafter read back out of the cluster: regenerating them on every
# invocation would invalidate every live bank session and desynchronise the
# merchant from the bank.
#
# `foundry-admin-key` is COPIED from the foundry namespace, because Kubernetes
# Secrets do not cross namespaces. Consequence: rotating foundry's admin key
# (`make admin-key` over in foundry/) silently breaks this deployment until
# `make secrets && make restart` is run here.
secrets: ## Create/refresh Secret/demo-secrets (idempotent; never rotates existing keys)
	@set -e; \
	existing() { kubectl -n $(NS) get secret demo-secrets -o jsonpath="{.data.$$1}" 2>/dev/null | base64 -d; }; \
	session=$$(existing session-secret); \
	bankkey=$$(existing bank-api-key); \
	if [ -z "$$session" ]; then session=$$(openssl rand -hex 32); echo ">> generated a new session-secret"; \
	  else echo ">> reusing the existing session-secret"; fi; \
	if [ -z "$$bankkey" ]; then bankkey=$$(openssl rand -hex 32); echo ">> generated a new bank-api-key"; \
	  else echo ">> reusing the existing bank-api-key"; fi; \
	foundrykey=$$(kubectl -n foundry get secret foundry-admin -o jsonpath='{.data.admin-api-key}' | base64 -d); \
	if [ -z "$$foundrykey" ]; then echo "ERROR: could not read admin-api-key from Secret/foundry-admin in ns foundry" >&2; exit 1; fi; \
	kubectl -n $(NS) create secret generic demo-secrets \
	  --from-literal=session-secret="$$session" \
	  --from-literal=bank-api-key="$$bankkey" \
	  --from-literal=foundry-admin-key="$$foundrykey" \
	  --dry-run=client -o yaml | kubectl apply -f -
	@echo "OK: Secret/demo-secrets in $(NS) (foundry-admin-key copied from ns foundry)"

# --- DEPLOY ------------------------------------------------------------------
deploy: ## Namespace + regcred + secrets + manifest, then wait for both rollouts
	kubectl apply -f manifest.yml
	kubectl apply -f regcred.yaml
	$(MAKE) secrets
	kubectl -n $(NS) rollout status deployment/bank --timeout=300s
	kubectl -n $(NS) rollout status deployment/merchant --timeout=300s

update: ## Re-apply the manifest only
	kubectl apply -f manifest.yml

restart: ## Restart both Deployments (picks up a freshly pushed :latest)
	kubectl -n $(NS) rollout restart deployment/bank deployment/merchant
	kubectl -n $(NS) rollout status deployment/bank --timeout=300s
	kubectl -n $(NS) rollout status deployment/merchant --timeout=300s

delete: ## Delete the manifest's resources (PVCs included -- data is lost)
	kubectl delete -f manifest.yml || true

reset: ## DESTRUCTIVE: wipe both databases so each app re-seeds at boot
	@echo "This DESTROYS both SQLite volumes in $(NS):"
	@echo "  - bank-data      (users, accounts, cards, credentials, transactions)"
	@echo "  - merchant-data  (products, orders, payment sessions)"
	@echo "The StorageClass reclaim policy is Delete, so this is IRREVERSIBLE."
	@printf 'Type the namespace to confirm: '; read ans; \
	  [ "$$ans" = "$(NS)" ] || { echo "aborted"; exit 1; }
	kubectl -n $(NS) scale deployment/bank deployment/merchant --replicas=0
	kubectl -n $(NS) wait --for=delete pod -l app=bank --timeout=120s || true
	kubectl -n $(NS) wait --for=delete pod -l app=merchant --timeout=120s || true
	kubectl -n $(NS) delete pvc bank-data merchant-data
	kubectl apply -f manifest.yml
	kubectl -n $(NS) scale deployment/bank deployment/merchant --replicas=1
	kubectl -n $(NS) rollout status deployment/bank --timeout=300s
	kubectl -n $(NS) rollout status deployment/merchant --timeout=300s
	@echo "OK: both volumes recreated; each app re-seeded itself at boot."

# --- OPS ---------------------------------------------------------------------
validate: ## Client-side schema check of the manifest
	kubectl apply --dry-run=client -f manifest.yml

logs: ## Recent logs from both apps
	kubectl -n $(NS) logs deployment/bank --tail=50 --prefix
	kubectl -n $(NS) logs deployment/merchant --tail=50 --prefix

monitor: ## Follow both apps' logs
	kubectl -n $(NS) logs -f -l 'app in (bank,merchant)' --all-containers --prefix --max-log-requests=4

pods:
	kubectl -n $(NS) get pods -o wide

events:
	kubectl get events --sort-by=.metadata.creationTimestamp -n $(NS)

describe:
	kubectl -n $(NS) describe deployment/bank deployment/merchant

smoke: ## Verify both public hosts route to the right app
	@printf 'bank     /api/health           -> '; \
	  curl -s -o /dev/null -w '%{http_code}\n' https://$(BANK_HOST)/api/health
	@printf 'bank     /api/ready            -> '; \
	  curl -s -o /dev/null -w '%{http_code}\n' https://$(BANK_HOST)/api/ready
	@printf 'merchant /api/health           -> '; \
	  curl -s -o /dev/null -w '%{http_code}\n' https://$(MERCHANT_HOST)/api/health
	@printf 'merchant /api/ready            -> '; \
	  curl -s -o /dev/null -w '%{http_code}\n' https://$(MERCHANT_HOST)/api/ready
	@printf 'merchant /api/products (count) -> '; \
	  curl -s https://$(MERCHANT_HOST)/api/products | tr ',' '\n' | grep -c '"id"' || true
```

Replace the `.PHONY` line with:

```makefile
.PHONY: help deploy-key build-image build-status build-logs \
        secrets deploy update restart delete reset validate logs monitor \
        pods events describe smoke
```

- [ ] **Step 3: Validate the manifest before applying it**

```bash
cd ~/dev/dl-infra-k8s/payment-banking-demo
make validate
```

Expected: every resource reported valid (`created (dry run)` / `configured (dry
run)`). Fix any schema error before applying.

- [ ] **Step 4: Deploy**

```bash
cd ~/dev/dl-infra-k8s/payment-banking-demo
make deploy
```

Expected: `secrets` reports generating both keys (first run) and copying
`foundry-admin-key`, then both rollouts report `successfully rolled out`.

If a pod is stuck, the two likeliest causes in order:

1. **`CreateContainerConfigError`** — `runAsNonRoot` rejected the image, meaning
   the Dockerfile regressed to a named `USER`. See Task 3 Step 3.
2. **`CrashLoopBackOff` with `EROFS`** — `readOnlyRootFilesystem` needs a
   writable path this manifest does not provide. Handle it in Step 6, not by
   guessing here.

```bash
make pods
make logs
```

- [ ] **Step 5: Verify routing, seeding and cross-namespace reach**

```bash
cd ~/dev/dl-infra-k8s/payment-banking-demo
make smoke
```

Expected: four `200`s and a product count greater than 0.

Now confirm the two hosts really reach *different* apps. A `VirtualService`
host-match bug is invisible to a health check, because both apps answer
`/api/health` identically:

```bash
curl -s https://sparkasse-musterstadt.digitallabor.dev/ | grep -oiE 'sparkasse|larder' | sort -u
curl -s https://larder-shop.digitallabor.dev/ | grep -oiE 'sparkasse|larder' | sort -u
```

Expected: the first prints `Sparkasse`-ish matches only, the second `Larder`
only. If both print the same brand, a route is missing its `host` match.

Confirm boot seeding ran against a real PVC:

```bash
kubectl -n payment-banking-demo logs deployment/bank | grep -i seed
kubectl -n payment-banking-demo logs deployment/merchant | grep -i seed
```

Expected on this first deploy: `Seeded an empty database...` and
`Seeded an empty catalogue...`.

Finally, prove the merchant can reach foundry across namespaces — the one thing
no health check covers:

```bash
kubectl -n payment-banking-demo exec deployment/merchant -- \
  node -e 'fetch("http://foundry.foundry.svc.cluster.local:9000/health").then(r=>console.log("foundry /health ->",r.status)).catch(e=>{console.error("FAILED:",e.message);process.exit(1)})'
```

Expected: `foundry /health -> 200`. A connection error means cross-namespace
networking; `/health` is unauthenticated, so a 401 here would be surprising and
worth investigating rather than assuming it is the key.

- [ ] **Step 6: Settle the `readOnlyRootFilesystem` question**

Check for filesystem errors now that both pods have served real traffic:

```bash
kubectl -n payment-banking-demo logs deployment/bank --tail=200 | grep -iE 'EROFS|read-only file system' || echo "bank: clean"
kubectl -n payment-banking-demo logs deployment/merchant --tail=200 | grep -iE 'EROFS|read-only file system' || echo "merchant: clean"
kubectl -n payment-banking-demo get pods   # RESTARTS should be 0
```

**If clean:** keep `readOnlyRootFilesystem: true`. Record the outcome for Task 7.

**If not clean:** do not guess at further mount points. Remove
`readOnlyRootFilesystem: true` from both containers, run
`make update && make restart`, re-verify, and record in Task 7's README exactly
which path failed and why the flag was dropped. Either outcome is acceptable; an
unrecorded one is not.

- [ ] **Step 7: Commit**

```bash
cd ~/dev/dl-infra-k8s
git add payment-banking-demo/manifest.yml payment-banking-demo/Makefile
git commit -m "feat(payment-banking-demo): deploy bank + merchant with Istio routing

Two Deployments off ONE image, selected by the entrypoint argument, each with
its own ReadWriteOnce PVC and strategy: Recreate (SQLite filesystem locks make a
RollingUpdate deadlock on the volume).

One VirtualService, two hosts, and every route carries an explicit host match --
with two hosts on one VirtualService a bare catch-all matches BOTH names and
would send half the demo to the wrong app. No Certificate and no DNS record are
needed: the wildcard *.digitallabor.dev cert and DNS already cover both names.

Both Deployments read bank-api-key from the SAME Secret key, so the shared
secret the merchant presents on POST /api/payments cannot drift.
foundry-admin-key is copied from ns foundry by 'make secrets' because Secrets do
not cross namespaces -- rotating foundry's key therefore requires re-running
'make secrets && make restart' here. 'make secrets' reuses existing generated
keys rather than rotating them, so re-running it does not invalidate live
sessions.

MERCHANT_NAME is set to Larder rather than left at its 'Demo Shop' default: it
becomes the merchant name the wallet shows in its authorisation prompt.

Verified against the live cluster: both rollouts complete; make smoke returns
200 on /api/health and /api/ready for both hosts with a non-empty product list;
the two hosts serve visibly different apps (Sparkasse vs Larder), which is what
actually proves the host matches; both pods logged boot-seeding against real
PVCs; and the merchant reached foundry cross-namespace at
foundry.foundry.svc.cluster.local:9000/health -> 200.

NOT verified: the wallet leg. No device is available in this environment."
```

---

### Task 7: Verify the demo end to end and write the README

**Repo: `~/dev/dl-infra-k8s`**, in `payment-banking-demo/`.

The README is this deployment's durable record — `foundry/README.md`'s role.
Write it *after* verifying, so it documents what actually happened rather than
what was intended, and so it can state the `readOnlyRootFilesystem` outcome from
Task 6 Step 6 as fact.

**Files:**
- Create: `payment-banking-demo/README.md`
- Possibly modify: the app repo's `AGENTS.md`, "Known-unverifiable" section (see
  Step 4)

**Interfaces:** consumes Task 6's verification results. Produces no code.

- [ ] **Step 1: Verify the interactive path with a real browser**

`curl` proves routing; it does not prove the app works. The app repo's
`AGENTS.md` is explicit that browser behaviour must be checked with a real
browser rather than by asserting on server-rendered HTML, and ships
`tools/cdp/cdp.mjs` for exactly this.

```bash
cd ~/dev/eudiw/payment-banking-demo
ls tools/cdp
sed -n '1,40p' tools/cdp/cdp.mjs
```

Read its usage, then drive it to check three things:

1. The bank login page renders at
   `https://sparkasse-musterstadt.digitallabor.dev`, and logging in as
   `anna` / `demo1234` succeeds.
2. Anna's balance shows **€3.487,12** (the fixture is `348712` cents). A wrong
   or missing balance means seeding ran but the app is reading a different
   database than you think.
3. On `https://larder-shop.digitallabor.dev` the catalogue lists products **and
   the product images actually load**. This is the live check for the
   `apps/merchant/public/` defect from Task 3 — a 404 on `/products/...` means
   the `COPY` is missing from the image.

Record the exact commands and their results; they go into the README and the
commit message. If the CDP driver cannot reach the public hosts, say so plainly
rather than substituting a `curl` and calling it browser-verified.

- [ ] **Step 2: Verify a payment session reaches foundry**

Start a checkout on `https://larder-shop.digitallabor.dev`, get to the payment
screen, and confirm a QR code / `openid4vp` URI is rendered. That URI can only
exist if the merchant successfully called foundry's admin API with the copied
key — the deepest check available without a wallet.

Cross-check server-side:

```bash
kubectl -n payment-banking-demo logs deployment/merchant --tail=100 \
  | grep -iE 'payment.session|openid4vp|foundry' | tail -20
```

If the payment screen shows an error instead, compare the two keys first:

```bash
kubectl -n payment-banking-demo get secret demo-secrets -o jsonpath='{.data.foundry-admin-key}' | base64 -d; echo
kubectl -n foundry get secret foundry-admin -o jsonpath='{.data.admin-api-key}' | base64 -d; echo
```

These must be byte-identical. If they differ, `make secrets && make restart`.

- [ ] **Step 3: Write `README.md`**

Create `payment-banking-demo/README.md` with the structure below. Fill every
`<observed: ...>` marker with what you actually saw in Task 6 and Steps 1–2 —
and if something was **not** verified, write that instead of quietly omitting the
line.

````markdown
# payment-banking-demo — EUDI wallet as a payment instrument

ns: `payment-banking-demo`

| App | Host | Language |
|---|---|---|
| bank | https://sparkasse-musterstadt.digitallabor.dev | German, Sparkasse-styled |
| merchant | https://larder-shop.digitallabor.dev | English, "Larder" grocer |

Source: <https://github.com/digitallabor-berlin/payment-banking-demo>
Depends on **foundry** (ns `foundry`) for OpenID4VCI issuance and OpenID4VP
verification. foundry itself needs no configuration for this deployment.

## Quick start

```bash
make deploy-key    # one-time: read-only GitHub deploy key -> Secret/demo-build-git
make build-image   # clone main, buildah build + push :latest, stream logs
make deploy        # manifest + regcred + secrets, then wait for both rollouts
make smoke         # confirm both hosts route to the right app
```

Bank login: `anna / demo1234` (also `ben / demo1234`).
`make help` lists all targets.

## What this deploys

The bank issues an EMVCo Digital Payment Credential (`com.emvco.dpc.card`) into
a user's wallet. The merchant requests it at checkout with `transaction_data`
amount binding, verifies it through foundry, then debits the bank over REST; the
purchase then appears in the bank's transaction list. `credential_id` is the join
key, and the bank is the sole owner of credential state — the merchant never
persists it.

## One image, two apps

`containers.digitallabor.dev/payment-banking-demo/demo:latest` contains **both**
apps. The entrypoint takes one argument:

```
/app/bank/apps/bank/server.js         <- args: ["bank"],     PORT 3001
/app/merchant/apps/merchant/server.js <- args: ["merchant"],  PORT 3000
```

The two Next standalone trees sit side by side and are never merged: each carries
its own root-level `node_modules` from Next's independent dependency trace, and
merging them resolves the overlap last-writer-wins. One image also makes a
bank/merchant version skew structurally impossible, which matters because
`credential_id` is a contract between them.

The trade-off: the two apps cannot be rebuilt or rolled forward independently.
That is deliberate.

## Build & push

Built **in-cluster** by a `buildah` Job (`build-job.yml`), not locally. The
cluster's nodes are `linux/amd64`; the dev machines here are Apple Silicon, and
`better-sqlite3` compiles a native addon, so a local `--platform linux/amd64`
build runs that toolchain under QEMU emulation. A Job on the cluster is a
genuinely native build.

Trigger is **manual only** — run `make build-image` by hand after pushing to
`main`. There is no webhook and no poller. `imagePullPolicy: Always` on `:latest`
means `make restart` is enough to pick up a new build.

## Seeding

Neither app needs a seeding step. Each seeds itself at boot when its database is
empty (`src/instrumentation.ts` -> `seedIfEmpty`), so a fresh PVC comes up
demoable. A populated database is never touched — the guard is an empty-table
check, and the underlying `seed()` deletes every row before inserting.

`make reset` destroys both PVCs and lets the apps re-seed. It is irreversible
(the `local-path` StorageClass reclaims `Delete`) and asks for confirmation.

## Secrets

Nothing is committed. `make secrets` creates `Secret/demo-secrets` directly in
the cluster; `regcred.yaml` is gitignored.

| Key | Consumed by | Source |
|---|---|---|
| `session-secret` | bank `SESSION_SECRET` | generated once, then reused |
| `bank-api-key` | bank **and** merchant `BANK_API_KEY` | generated once, then reused |
| `foundry-admin-key` | bank and merchant `FOUNDRY_ADMIN_KEY` | copied from `foundry/foundry-admin` |

`bank-api-key` is the shared secret the merchant presents on
`POST /api/payments`. Both Deployments read the same Secret key, so it cannot
drift.

**`make secrets` never rotates an existing generated key** — it reads the current
value back out of the cluster and only creates what is missing. Rotating
`session-secret` would invalidate every live bank session; rotating
`bank-api-key` would desynchronise the two apps.

⚠️ **Rotating foundry's admin key breaks this deployment silently.** Secrets do
not cross namespaces, so `foundry-admin-key` is a *copy*. After `make admin-key`
in `foundry/`, run `make secrets && make restart` here. The symptom is a checkout
that fails at the payment screen with the storefront otherwise healthy.

## TLS & DNS

Nothing to create. TLS terminates at `istio-system/public-ingress-gateway` with
the wildcard `*.digitallabor.dev` cert (`digitallabor-dev-tls-secret`), and DNS
is wildcard too — both hostnames already resolve to `167.235.116.254`.
Gateway-to-pod traffic is plain HTTP, which is why `*_PUBLIC_URL` is `https://`
while the containers listen cleartext.

## Design notes

The non-obvious constraints this deployment encodes.

**`strategy: Recreate`, `replicas: 1`.** SQLite uses filesystem locks and each
PVC is `ReadWriteOnce`; a `RollingUpdate` deadlocks waiting for the outgoing pod
to release the volume.

**Every VirtualService route carries an explicit host match.** Two hosts share
one VirtualService, and a route with no `match:` block matches *both* — it would
send half the demo to the wrong app. A health check cannot detect this, because
both apps answer `/api/health` identically; compare the rendered brand instead.

**Probes split deliberately.** `/api/ready` opens SQLite, which triggers
migrations *and* boot seeding, so readiness gates on the app being usable.
`/api/health` is static, which is what liveness should be.

**`runAsNonRoot: true` works here but not in foundry.** This image declares a
numeric `USER 1000`; foundry's declares `USER foundry`, a name the kubelet cannot
prove is non-root, which fails the pod with `CreateContainerConfigError`.

**`readOnlyRootFilesystem`:** <observed: kept, with an emptyDir at each app's
`.next/cache` — no EROFS in either pod's logs and 0 restarts / OR dropped,
because ...>

**`BANK_PUBLIC_URL` and `MERCHANT_PUBLIC_URL` are currently inert.** Both are
declared in the apps' `env.ts` but read by no application code. They are set
correctly so that changes here do not surprise a future reader.

**`MERCHANT_NAME=Larder` is not cosmetic.** It becomes
`MERCHANT_REFERENCE_NAME` in `lib/payment-sessions.ts` — the merchant name the
wallet shows when asking the user to authorise the payment. The `env.ts` default
is `"Demo Shop"`, which would contradict the storefront.

**No revocation anywhere.** foundry exposes no revoke endpoint; credentials
expire on their 12-hour lifetime.

## Verified

<observed: the concrete results — rollout status, the five make smoke lines,
brand-per-host output, both seeding log lines, foundry /health from inside the
merchant pod, the browser login and balance, product images loading, and the
payment session producing an openid4vp URI. Include the actual commands.>

## NOT verified

**The wallet leg.** There is no phone and no EUDI wallet app in this environment,
so issuing the credential into a wallet and presenting it with
`transaction_data` amount binding have not been exercised end to end.

What this deployment *does* change: foundry's wallet-facing listener is now
reachable over public HTTPS at `https://foundry.digitallabor.dev`, and both apps
are on public HTTPS origins too — so the infrastructural blocker is gone and a
human with a device can now run the full flow. That is a different claim from
having run it. Two Definition-of-Done items in Plan 2 remain open, including the
real nesting shape of foundry's disclosed verification claims
(`apps/merchant/src/lib/checks.ts` keeps both plausible branches on purpose).

## Failure modes

| Symptom | Cause | Where to look |
|---|---|---|
| `CrashLoopBackOff`, `Fatal: invalid environment configuration` | a `demo-secrets` key missing or too short (`SESSION_SECRET` needs ≥32 chars) | `make logs` |
| `CreateContainerConfigError` | image regressed to a named `USER`; `runAsNonRoot` cannot verify it | `make describe` |
| Pod up, `/api/ready` 503 | SQLite unopenable — PVC permissions vs `fsGroup` | `make describe`, `make events` |
| Bank login rejects `anna/demo1234` | the database is non-empty but unseeded, so `seedIfEmpty` skipped it | `make logs`, grep for the seed line |
| Checkout fails at the payment screen | `foundry-admin-key` stale after a foundry rotation | `make secrets && make restart` |
| Product images 404 | `apps/merchant/public/` missing from the image | rebuild; check the Dockerfile's `COPY` |
| Wrong app answers a host | a VirtualService route missing its `host` match | `manifest.yml` |
| `exec format error` | an arm64 image was pushed by hand, bypassing the build Job | `make build-image` |
| Pod restarts with `EROFS` | `readOnlyRootFilesystem` needs another writable path | see Design notes |
````

- [ ] **Step 4: Update the app repo's "Known-unverifiable" section if warranted**

`~/dev/eudiw/payment-banking-demo/AGENTS.md` currently says foundry's
wallet-facing listener is bound to `localhost:8443` rather than a public HTTPS
origin. That is no longer the whole picture — it is public at
`https://foundry.digitallabor.dev`, and both apps now have public HTTPS origins
too.

Amend that section to keep the honest part (no phone, no wallet app, so the
wallet leg is still unverified) while correcting the reason: the blocker is now
purely the absence of a device, not the absence of a reachable origin. Do not
overstate it — no wallet flow has been run.

Commit that separately, in the app repo:

```bash
cd ~/dev/eudiw/payment-banking-demo
git add AGENTS.md
git commit -m "docs: the wallet-leg blocker is now the missing device, not the origin

foundry's wallet-facing listener is reachable at https://foundry.digitallabor.dev
and both apps are on public HTTPS origins, so the infrastructural reason the
wallet leg could not be exercised no longer applies. What remains is that there
is no phone and no EUDI wallet app in this environment.

Still NOT verified: any wallet flow. This only corrects why."
```

- [ ] **Step 5: Commit the README**

```bash
cd ~/dev/dl-infra-k8s
git add payment-banking-demo/README.md
git commit -m "docs(payment-banking-demo): document the deployment and what was verified

Covers the one-image/two-apps layout and why the standalone trees are never
merged, the in-cluster build, boot seeding, the copied foundry-admin-key and the
silent-breakage it implies on rotation, and the design notes worth knowing before
changing anything (Recreate + RWO, explicit host matches, the probe split,
numeric USER 1000, MERCHANT_NAME feeding the wallet prompt).

Records the readOnlyRootFilesystem outcome as observed rather than as intended.

Has an explicit 'NOT verified' section: the wallet leg was not exercised -- no
device is available here. Deploying to public HTTPS removes the infrastructural
blocker, which is a different claim from having run the flow."
```

---

## Definition of Done

The whole plan is done when every one of these holds, each backed by output you
have actually seen:

1. `pnpm check` green in the app repo — **166 tests**, typecheck clean.
2. A local `podman build` of the root Dockerfile succeeds; `podman run -d`
   serves both `bank` and `merchant`; a bad entrypoint argument exits 64.
3. Both containers logged the boot-seeding line.
4. `digitallabor-berlin/payment-banking-demo` exists, private, `main` pushed,
   with `Dockerfile` fetchable through the GitHub API.
5. `make build-image` reports Job condition `Complete` and pushed `:latest`.
6. `make deploy` completes both rollouts.
7. `make smoke` returns 200 on `/api/health` and `/api/ready` for **both** hosts,
   with a product count > 0.
8. The two hosts render **visibly different apps** (Sparkasse vs Larder).
9. Both pods logged boot-seeding against real PVCs.
10. The merchant reached `foundry.foundry.svc.cluster.local:9000/health` -> 200
    from inside its pod.
11. Bank login as `anna/demo1234` works in a **real browser** and shows
    €3.487,12; merchant product **images load**.
12. A merchant checkout produces an `openid4vp` URI.
13. The `readOnlyRootFilesystem` outcome is recorded in the README either way.

**Out of reach, and must not be claimed:** the wallet leg — issuance into a
wallet and a `transaction_data`-bound presentation. No device exists in this
environment.

---

## Plan self-review

Run against the spec after writing, per the writing-plans skill.

**Spec coverage.** Every spec section maps to a task: Scope -> Tasks 3–6;
"Already verified against the live cluster" -> Global Constraints; Image -> Task
3; Cluster resources -> Task 6 Step 1; `readOnlyRootFilesystem` -> Task 6 Step 6
plus Task 7's README; Ingress -> Task 6 Step 1 and Step 5; Configuration and
secrets -> Task 6 Steps 1–2; Build -> Task 5; App-repo changes 1/2/3 -> Tasks 4,
1–2, 3; Makefile -> Tasks 5 and 6; Failure modes -> Task 7's README; Definition
of Done -> the section above. No spec requirement is unassigned.

**Corrections fed back into the spec while writing this plan.** Three points
where planning found the approved spec would not have worked; the spec has been
amended so the two documents agree, and each is called out here because a
reviewer comparing them against an older reading of the spec would otherwise see
an unexplained divergence.

1. **The spec described a separate `deps` stage.** That is defect 2 at the top of
   this plan: with `node-linker=hoisted` it drops the `@demo/*` workspace links
   and `next build` cannot resolve `@demo/ui` in a clean clone. The install now
   runs after `COPY . .`.
2. **The spec put `workingDir` in the manifest.** The `cd` lives in
   `docker-entrypoint.sh` instead. The entrypoint needs it regardless — so that
   `podman run <image> bank` behaves like the pod — and duplicating the path in
   the manifest is a second source of truth that can drift from the image.
   The manifest therefore sets no `workingDir`.
3. **The spec mentioned neither `ENV HOSTNAME=0.0.0.0` nor a root
   `.dockerignore`.** Both are required for correctness: Next standalone binds
   to `$HOSTNAME`, which container runtimes set to the pod name, and the
   `.dockerignore` is defect 1.

**Type consistency.** `seedIfEmpty` is `(db: Db, now?: number) => boolean` in the
bank and `(db: Db) => boolean` in the merchant, matching each app's existing
`seed` signature; both are called as `seedIfEmpty(getDb())`. The entrypoint
argument is `bank`/`merchant` in the Dockerfile, the entrypoint script and the
manifest's `args`. Secret name `demo-secrets` with keys `session-secret`,
`bank-api-key`, `foundry-admin-key` is identical in the Makefile and the
manifest. Namespace `payment-banking-demo` and image tag
`containers.digitallabor.dev/payment-banking-demo/demo:latest` are identical in
`build-job.yml`, the Makefile and `manifest.yml`. The two `.next/cache` mount
paths in the manifest match the two standalone tree roots in the Dockerfile.

**Ordering.** Tasks 1–2 precede Task 3 so the image build can *prove* boot
seeding works. Task 4 precedes Task 5 because the build Job clones from GitHub.
Task 5 precedes Task 6 because the manifest pulls the tag Task 5 pushes. Task 7
comes last because it documents observed results.
