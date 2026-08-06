# Payment Banking Demo — Plan 2: Merchant & Settlement

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the merchant web shop, fold the payment screen in as a route,
and close the loop: a wallet holding the DPC credential from Plan 1 pays for a
real order, the bank actually debits the account, and the merchant shows a real
success screen backed by `foundry`'s real verification verdict.

**Architecture:** A second Next.js 15 App Router application (`apps/merchant`)
added to the existing pnpm workspace, reusing `packages/foundry-client` and
`packages/ui` from Plan 1 unchanged. The merchant's `/api/*` route handlers are
its REST API. The one cross-service call in this plan — merchant → bank
settlement — is a real HTTP call authenticated by a shared API key, exactly as
it would be between separate production services.

**Tech Stack:** Node 22+, pnpm 10, Next.js 15 (App Router), React 19,
TypeScript 5.7 strict, Tailwind CSS 4, Drizzle ORM + better-sqlite3 (`^13.0.3`),
zod, `packages/foundry-client`, `packages/ui`, vitest.

**Design spec:** `docs/superpowers/specs/2026-08-05-payment-banking-demo-design.md`.
Read it before starting. Section references below (§n) point at it.

**Prior plan:** Plan 1 (`docs/superpowers/plans/2026-08-05-plan-1-foundation-and-bank.md`)
built the workspace, `packages/foundry-client`, `packages/ui`, and the bank
app through card issuance. This plan does not repeat any of that — it only
adds `apps/merchant` and one new bank endpoint.

## Global Constraints

Every task's requirements implicitly include this section. Several of these
were discovered the hard way while executing Plan 1 — see the referenced task
for the story if you want it, but you don't need to rediscover the bug.

- **Node** ≥ 22. **pnpm** 10.x.
- **TypeScript strict mode on** in every package. No `any` in committed code;
  use `unknown` plus a narrowing check.
- **No hardcoded URLs or secrets anywhere.** All of them come from validated
  env (§8.1). A missing secret must crash the process at boot with a named
  error — this requires **both** an `src/instrumentation.ts` file (Next only
  validates imported modules; nothing is imported until something needs it)
  **and** that hook calling `process.exit(1)` itself on failure rather than
  merely `throw`ing (a bare throw is not reliably fatal — see Plan 1 Task 13's
  final commit message for the full story). Bake this in from Task 1; do not
  wait to discover it later.
- **Every Next.js app's `next.config.ts` must set**
  `webpack(config) { config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] }; return config; }`.
  This codebase's local imports are written `./foo.js` for a `./foo.ts` file
  (correct Node ESM form, needed so vitest/tsc agree); Turbopack resolves that
  mapping natively but `next build`'s webpack resolver does not, and every
  such import fails with "Module not found" without this (found in Plan 1
  Task 5/6).
- **`instrumentation.ts` must live under `src/`, not the package root**, for
  any app using the `src/app` layout — Next computes the instrumentation-hook
  root as the parent of the App Router's `app/` directory, not the package
  root (found in Plan 1 Task 13).
- **`better-sqlite3` must be `^13.0.3`**, not the `^11.x` line the design spec's
  code samples might imply by omission — `^11.x` fails to compile against a
  current Node's V8 (found in Plan 1 Task 5). The root `package.json`'s
  `pnpm.onlyBuiltDependencies: ["better-sqlite3"]` (already present from
  Plan 1 Task 2) covers this package too; no workspace-level change needed.
- **All money is integer cents.** Never a float. Column names end in `_cents`.
  The one place a decimal-string amount is required is `transaction_data.amount`
  in the verification request body (§6.2 step 3) — convert at the boundary,
  keep cents everywhere else.
- **`foundry` verification states are exactly `"pending" | "verified" | "failed"`.**
  (Confirmed type already exists: `packages/foundry-client/src/types.ts`'s
  `VerificationState`.)
- **Merchant credential state is never persisted** — the merchant has no
  `credentials` table. It only ever sees `credential_id` inside a verification
  verdict's disclosed claims, and forwards that same string to the bank at
  settlement. The bank is the sole owner of credential state.
- **The settle gate is `verified === true` AND the `transaction_data_binding`
  check passed** — not merely `state === "verified"`. Reaching `verified` only
  means foundry finished checking; the gate is what makes the amount binding
  meaningful (§6.2).
- **`idempotency_key` on `POST /api/payments` is the merchant's payment-session
  id.** The bank's `transactions.idempotency_key` column and its `UNIQUE` index
  already exist from Plan 1 Task 6 — this plan only adds the row-lookup logic
  that makes a repeat with the same key safe.
- **Polling everywhere:** 2000 ms interval, 10-minute cap, error after 5
  consecutive failures, abort on unmount. Already implemented as
  `pollUntilTerminal`/`useStatusPoll` in `packages/ui` (Plan 1 Task 4) — reuse
  it, do not reimplement.
- **Merchant UI strings are English** (the shop is not German — only the bank
  is, per spec §9). Code identifiers, comments, and commit messages are
  English everywhere.
- **Merchant port 3000.** Bank is already on 3001.
- **`orders.status` has no `failed` value** — only `pending` → `paid`, or
  `cancelled`. A failed presentation or failed settlement leaves the order
  `pending` so it can be retried (§6.3).
- **`payment_sessions.state` has 4 non-terminal-adjacent values plus one
  terminal-failure value**: `pending → verified → settling → completed`, with
  `failed` reachable from any of the first three.
- **Commit after every task.** Conventional-commit prefixes (`feat:`, `test:`,
  `chore:`, `fix:`).
- **Ad-hoc DB-poking scripts must run under `tsx`, from a scratch `.ts` file —
  not `node --experimental-strip-types`, and not `tsx -e`.** Node's type
  stripping does not apply the `./foo.js` → `./foo.ts` mapping this codebase's
  imports rely on, so it dies with `ERR_MODULE_NOT_FOUND` on the *transitive*
  `../env.js` import even when the script itself writes `./src/db/index.ts`.
  `tsx -e` fails differently — it evaluates as CJS and chokes on `import`.
  The pattern that works, used by every verification step below:

  ```bash
  cat > scratch.ts <<'TS'
  import { createDb } from "./src/db/index.js";
  // ...
  TS
  pnpm exec tsx --env-file-if-exists=.env.local scratch.ts
  rm -f scratch.ts
  ```

  (Found while executing Task 6; the same root cause as the webpack
  `extensionAlias` constraint above.)
- **Deployment verification uses `podman`** in this environment (`docker` is
  not installed); the two CLIs are drop-in for the same Dockerfile syntax.
  Run containers detached (`-d`) and inspect with `podman inspect`/`podman
  logs`, never a bare foreground `run` with no request sent — for a Next.js
  standalone server that can hang indefinitely rather than exiting, since
  nothing about `next start` is triggered by mere elapsed time (Plan 1 Task 13).

---

## File Structure

```
payment-banking-demo/
├─ apps/
│  ├─ bank/                                (Plan 1 — modified here)
│  │  └─ src/
│  │     ├─ lib/
│  │     │  ├─ apiKey.ts                   Task 7   requireApiKey()
│  │     │  └─ payments.ts                 Task 7   processPayment()
│  │     └─ app/api/payments/route.ts      Task 7   POST /api/payments
│  └─ merchant/                            NEW — Next 15 App Router, port 3000
│     ├─ package.json                      Task 1
│     ├─ tsconfig.json                     Task 1
│     ├─ next.config.ts                    Task 1
│     ├─ postcss.config.mjs                Task 1
│     ├─ vitest.config.ts                  Task 1
│     ├─ .env.example                      Task 1
│     ├─ drizzle.config.ts                 Task 2
│     ├─ Dockerfile                        Task 11
│     ├─ .dockerignore                     Task 11
│     └─ src/
│        ├─ env.ts                         Task 1
│        ├─ instrumentation.ts             Task 1
│        ├─ db/
│        │  ├─ schema.ts                   Task 2   products, orders, payment_sessions
│        │  ├─ index.ts                    Task 2   getDb/createDb
│        │  ├─ migrate.ts                  Task 2
│        │  └─ seed.ts                     Task 2   6 products
│        ├─ lib/
│        │  ├─ foundry.ts                  Task 1   getFoundry() — same shape as bank's
│        │  ├─ format.ts                   Task 3   formatEuroCents, centsToDecimalString
│        │  ├─ cart.ts                     Task 4   client-side cart (localStorage)
│        │  ├─ orders.ts                   Task 5   createOrder() — server total recompute
│        │  ├─ dcql.ts                     Task 6   buildDcqlQuery, buildTransactionData
│        │  ├─ bank.ts                     Task 8   getBankClient().pay()
│        │  └─ payment-sessions.ts         Task 6/8 startPaymentSession, refreshPaymentSessionState
│        ├─ components/
│        │  ├─ ProductCard.tsx             Task 3
│        │  ├─ CartBadge.tsx               Task 4
│        │  ├─ CheckoutForm.tsx            Task 5
│        │  ├─ EudiPayLogo.tsx             Task 9   inline SVG, no asset file
│        │  ├─ PaymentScreen.tsx           Task 9   the folded-in /pay UI
│        │  └─ VerificationDetails.tsx     Task 10  expandable checks list
│        └─ app/
│           ├─ globals.css                 Task 1 (+ Task 4/9/10 appends)
│           ├─ layout.tsx                  Task 1
│           ├─ page.tsx                    Task 3   shop
│           ├─ cart/page.tsx               Task 4
│           ├─ checkout/page.tsx           Task 5
│           ├─ pay/[sessionId]/page.tsx    Task 9
│           ├─ success/page.tsx            Task 10
│           └─ api/
│              ├─ health/route.ts          Task 1
│              ├─ ready/route.ts           Task 2 (modified from Task 1's stub)
│              ├─ products/route.ts        Task 3
│              ├─ products/[id]/route.ts   Task 3
│              ├─ orders/route.ts          Task 5
│              ├─ orders/[id]/route.ts     Task 10
│              ├─ payment-sessions/route.ts        Task 6
│              ├─ payment-sessions/[id]/route.ts   Task 6/8
│              └─ payment-sessions/[id]/cancel/route.ts  Task 9
├─ README.md                               Task 11  (extended, not replaced)
```

---

### Task 1: Merchant app scaffold — env, health/ready, instrumentation

**Files:**
- Create: `apps/merchant/package.json`
- Create: `apps/merchant/tsconfig.json`
- Create: `apps/merchant/next.config.ts`
- Create: `apps/merchant/postcss.config.mjs`
- Create: `apps/merchant/vitest.config.ts`
- Create: `apps/merchant/.env.example`
- Create: `apps/merchant/src/env.ts`
- Create: `apps/merchant/src/instrumentation.ts`
- Create: `apps/merchant/src/lib/foundry.ts`
- Create: `apps/merchant/src/app/globals.css`
- Create: `apps/merchant/src/app/layout.tsx`
- Create: `apps/merchant/src/app/api/health/route.ts`
- Create: `apps/merchant/src/app/api/ready/route.ts`
- Test: `apps/merchant/src/env.test.ts`

**Interfaces:**
- Consumes: `@demo/ui`, `@demo/foundry-client` (both from Plan 1, unchanged).
- Produces: `env` — validated config object with fields `PORT: number`,
  `DATABASE_PATH: string`, `MERCHANT_PUBLIC_URL: string`,
  `FOUNDRY_ADMIN_URL: string`, `FOUNDRY_ADMIN_KEY: string`,
  `BANK_API_URL: string`, `BANK_API_KEY: string`, `MERCHANT_NAME: string`; and
  `parseEnv(raw)` for tests. `getFoundry(): FoundryClient` — memoized client,
  identical shape to the bank's own `lib/foundry.ts` from Plan 1 Task 11.

- [ ] **Step 1: Create the package manifest**

`apps/merchant/package.json`:

```json
{
  "name": "@demo/merchant",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start --port ${PORT:-3000}",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "migrate": "tsx --env-file-if-exists=.env.local src/db/migrate.ts",
    "seed": "tsx --env-file-if-exists=.env.local src/db/seed.ts",
    "db:generate": "drizzle-kit generate"
  },
  "dependencies": {
    "@demo/foundry-client": "workspace:*",
    "@demo/ui": "workspace:*",
    "better-sqlite3": "^13.0.3",
    "drizzle-orm": "^0.38.2",
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.0.0",
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^22.10.2",
    "@types/react": "^19.0.1",
    "@types/react-dom": "^19.0.2",
    "drizzle-kit": "^0.30.1",
    "tailwindcss": "^4.0.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

No `jose` dependency here — the merchant has no session cookies, no login.

- [ ] **Step 2: Create tsconfig, next config, postcss, vitest config**

`apps/merchant/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "jsx": "preserve",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowJs": false,
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "src/**/*.ts", "src/**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`apps/merchant/next.config.ts` — both settings below are mandatory; see the
Global Constraints for why each exists:

```ts
import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  transpilePackages: ["@demo/ui", "@demo/foundry-client"],
  serverExternalPackages: ["better-sqlite3"],
  webpack(config) {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
```

`apps/merchant/postcss.config.mjs`:

```js
export default {
  plugins: { "@tailwindcss/postcss": {} },
};
```

`apps/merchant/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      DATABASE_PATH: ":memory:",
      FOUNDRY_ADMIN_URL: "http://127.0.0.1:9000",
      FOUNDRY_ADMIN_KEY: "test-admin-key",
      BANK_API_URL: "http://127.0.0.1:3001",
      BANK_API_KEY: "test-bank-key",
      MERCHANT_NAME: "Demo Shop",
    },
  },
  resolve: {
    alias: { "@": new URL("./src/", import.meta.url).pathname },
  },
});
```

- [ ] **Step 3: Write the failing env test**

`apps/merchant/src/env.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.js";

const complete = {
  FOUNDRY_ADMIN_KEY: "admin-key",
  BANK_API_KEY: "bank-key",
};

describe("parseEnv", () => {
  it("applies documented defaults for non-secret values", () => {
    const env = parseEnv(complete);
    expect(env.PORT).toBe(3000);
    expect(env.DATABASE_PATH).toBe("./data/merchant.db");
    expect(env.MERCHANT_PUBLIC_URL).toBe("http://localhost:3000");
    expect(env.FOUNDRY_ADMIN_URL).toBe("http://127.0.0.1:9000");
    expect(env.BANK_API_URL).toBe("http://localhost:3001");
    expect(env.MERCHANT_NAME).toBe("Demo Shop");
  });

  it("coerces PORT to a number", () => {
    expect(parseEnv({ ...complete, PORT: "4000" }).PORT).toBe(4000);
  });

  it("throws a named error listing every missing secret", () => {
    expect(() => parseEnv({})).toThrowError(/FOUNDRY_ADMIN_KEY/);
    expect(() => parseEnv({})).toThrowError(/BANK_API_KEY/);
  });

  it("rejects a non-URL BANK_API_URL", () => {
    expect(() => parseEnv({ ...complete, BANK_API_URL: "nope" })).toThrowError(
      /BANK_API_URL/,
    );
  });

  it("allows overriding MERCHANT_NAME", () => {
    expect(parseEnv({ ...complete, MERCHANT_NAME: "Other Shop" }).MERCHANT_NAME).toBe(
      "Other Shop",
    );
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
cd apps/merchant && pnpm test
```

Expected: FAIL — cannot resolve `./env.js`.

- [ ] **Step 5: Write env.ts**

`apps/merchant/src/env.ts` — deliberately has no `SESSION_SECRET` (no login on
this app) and no `SESSION_SECRET`-style min-length secret; `BANK_API_KEY` is a
shared secret presented as a header value, not used for signing:

```ts
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_PATH: z.string().min(1).default("./data/merchant.db"),
  MERCHANT_PUBLIC_URL: z.string().url().default("http://localhost:3000"),
  FOUNDRY_ADMIN_URL: z.string().url().default("http://127.0.0.1:9000"),
  FOUNDRY_ADMIN_KEY: z.string().min(1),
  BANK_API_URL: z.string().url().default("http://localhost:3001"),
  BANK_API_KEY: z.string().min(1),
  MERCHANT_NAME: z.string().min(1).default("Demo Shop"),
});

export type Env = z.infer<typeof schema>;

/** Exported separately from `env` so tests can exercise validation. */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid merchant environment configuration — ${detail}`);
  }
  return result.data;
}

/**
 * Validated at module load. On its own this only fires once something
 * imports this module — see src/instrumentation.ts, which forces that to
 * happen at server boot rather than on whichever route happens to be hit
 * first (spec 8.1; the full story is in Plan 1 Task 13's final commit).
 */
export const env: Env = parseEnv(process.env);
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd apps/merchant && pnpm test
```

Expected: 5 PASS.

- [ ] **Step 7: Write instrumentation.ts, the foundry client accessor, theme, layout, and health endpoints**

`apps/merchant/src/instrumentation.ts` — must live under `src/` (see Global
Constraints), and must call `process.exit(1)` itself on failure:

```ts
/**
 * Next.js calls `register()` once per server process boot. Without this file,
 * nothing in the app is imported until some route needs it, so env.ts's
 * "validate at import time" design silently never fires for a container whose
 * first-hit route doesn't happen to need it (e.g. /api/health). A bare throw
 * here is not reliably fatal either — depending on which internal Next.js
 * call site ends up invoking this hook, an uncaught throw can degrade to
 * "every route permanently 500s" without the process ever exiting, which is a
 * far weaker signal for an orchestrator than a hard crash. Both findings are
 * from Plan 1 Task 13, verified against a real podman container.
 */
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
}
```

`apps/merchant/src/lib/foundry.ts` — identical shape to the bank's own
`lib/foundry.ts` from Plan 1 Task 11:

```ts
import { FoundryClient } from "@demo/foundry-client";
import { env } from "../env.js";

let instance: FoundryClient | null = null;

/** Memoized client pointed at foundry's admin listener. */
export function getFoundry(): FoundryClient {
  instance ??= new FoundryClient({
    adminUrl: env.FOUNDRY_ADMIN_URL,
    adminKey: env.FOUNDRY_ADMIN_KEY,
  });
  return instance;
}
```

`apps/merchant/src/app/globals.css` — tokens verbatim from spec §9.3. Later
tasks append component classes to this same file; do not create a second CSS
file.

```css
@import "tailwindcss";

@theme {
  --color-brand: oklch(0.51 0.09 162);
  --color-brand-dark: oklch(0.4 0.09 162);
  --color-accent: oklch(0.74 0.14 55);
  --color-background: oklch(0.97 0.01 60);
  --color-surface: oklch(1 0 0);
  --color-foreground: oklch(0.24 0.02 260);
  --color-muted-foreground: oklch(0.52 0.01 260);
  --color-border: oklch(0.9 0.01 50);
  --color-success: oklch(0.58 0.15 145);
  --color-destructive: oklch(0.55 0.19 25);

  --font-sans: "Inter", system-ui, -apple-system, sans-serif;
  --radius: 1rem;

  --shadow-card: 0 10px 24px rgb(20 40 30 / 0.06);
  --shadow-card-hover: 0 16px 32px rgb(20 40 30 / 0.1);
}

body {
  background: var(--color-background);
  color: var(--color-foreground);
  font-family: var(--font-sans);
}
```

`apps/merchant/src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Demo Shop",
  description: "EUDI Wallet payment demo storefront",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
```

`apps/merchant/src/app/api/health/route.ts`:

```ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok" });
}
```

`apps/merchant/src/app/api/ready/route.ts` — the real DB check arrives in
Task 2; this version is honest about only proving the process is up:

```ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ready" });
}
```

- [ ] **Step 8: Write .env.example**

`apps/merchant/.env.example`:

```
# Copy to .env.local for local development.
PORT=3000
DATABASE_PATH=./data/merchant.db
MERCHANT_PUBLIC_URL=http://localhost:3000

# foundry's ADMIN listener — never publicly exposed.
FOUNDRY_ADMIN_URL=http://127.0.0.1:9000
FOUNDRY_ADMIN_KEY=dev-admin-key

# The bank's own REST API and the shared secret it expects on POST /api/payments.
# Must match the bank's own BANK_API_KEY exactly.
BANK_API_URL=http://localhost:3001
BANK_API_KEY=dev-bank-api-key

MERCHANT_NAME="Demo Shop"
```

- [ ] **Step 9: Install and verify the app boots**

```bash
cd /Users/senexi/dev/eudiw/payment-banking-demo
pnpm install
cd apps/merchant && cp .env.example .env.local && pnpm typecheck
pnpm dev &
sleep 12
curl -sS http://localhost:3000/api/health
curl -sS http://localhost:3000/api/ready
kill %1
```

Expected: `{"status":"ok"}` and `{"status":"ready"}`.

- [ ] **Step 10: Commit**

```bash
cd /Users/senexi/dev/eudiw/payment-banking-demo
git add apps/merchant pnpm-lock.yaml
git commit -m "feat(merchant): scaffold app with validated env, instrumentation, and health endpoints"
```

---

### Task 2: Merchant database — schema, migrations, seed

**Files:**
- Create: `apps/merchant/drizzle.config.ts`
- Create: `apps/merchant/src/db/schema.ts`
- Create: `apps/merchant/src/db/index.ts`
- Create: `apps/merchant/src/db/migrate.ts`
- Create: `apps/merchant/src/db/seed.ts`
- Modify: `apps/merchant/src/app/api/ready/route.ts` (real DB check)
- Test: `apps/merchant/src/db/schema.test.ts`

**Interfaces:**
- Consumes: `env` from Task 1.
- Produces:
  - tables `products`, `orders`, `paymentSessions` (Drizzle table objects,
    camelCase properties over snake_case columns)
  - `getDb(): BetterSQLite3Database<typeof schema>` — memoized, runs
    migrations on first call
  - `createDb(path: string)` — for tests, no memoization
  - `seed(db)` — idempotent; deletes all rows then inserts 6 products
  - fixture product ids `prod_1` through `prod_6`

- [ ] **Step 1: Write the schema**

`apps/merchant/src/db/schema.ts`:

```ts
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  priceCents: integer("price_cents").notNull(),
  imageUrl: text("image_url").notNull(),
  category: text("category").notNull(),
});

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  totalCents: integer("total_cents").notNull(),
  currency: text("currency").notNull().default("EUR"),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  status: text("status", { enum: ["pending", "paid", "cancelled"] })
    .notNull()
    .default("pending"),
  createdAt: integer("created_at").notNull(),
});

/**
 * One row per verification attempt for an order. `state` is a superset of
 * foundry's own verification state — see spec 5.2 for why this table exists
 * rather than proxying foundry directly.
 */
export const paymentSessions = sqliteTable("payment_sessions", {
  id: text("id").primaryKey(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id),
  foundryVerificationId: text("foundry_verification_id"),
  state: text("state", {
    enum: ["pending", "verified", "settling", "completed", "failed"],
  })
    .notNull()
    .default("pending"),
  openid4vpUri: text("openid4vp_uri"),
  requestUri: text("request_uri"),
  /** foundry's verdict, stored verbatim so the success screen can show it. */
  disclosedClaimsJson: text("disclosed_claims_json"),
  checksJson: text("checks_json"),
  bankTxId: text("bank_tx_id"),
  failureReason: text("failure_reason"),
  createdAt: integer("created_at").notNull(),
});

export type Product = typeof products.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type PaymentSession = typeof paymentSessions.$inferSelect;
export type OrderStatus = Order["status"];
export type PaymentSessionState = PaymentSession["state"];
```

**Deliberately no `UNIQUE` constraint on `payment_sessions.order_id`**, even
though a first draft of this schema had one. Spec §6.3 explicitly requires a
retry to "start a fresh presentation" for two failure rows (wallet-declined,
bank-unreachable-during-settle) — that is a *second* session for the same
order, so a schema-level one-to-one constraint would directly contradict the
spec's own retry semantics. The invariant this plan actually needs — at most
one *live* (non-terminal) session per order at a time — is enforced in code
instead, by `startPaymentSession` (Task 6) refusing to start a new session
unless the order is still `pending`, which stays true after a failed session
but flips to `paid` once one succeeds.

- [ ] **Step 2: Write the drizzle-kit config**

`apps/merchant/drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
```

- [ ] **Step 3: Generate the migration**

```bash
cd apps/merchant && pnpm db:generate
ls drizzle
```

Expected: a `drizzle/0000_*.sql` file plus `drizzle/meta/`. Commit these.

- [ ] **Step 4: Write the db module**

`apps/merchant/src/db/index.ts` — identical shape to the bank's:

```ts
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { env } from "../env.js";
import * as schema from "./schema.js";

export type Db = BetterSQLite3Database<typeof schema>;

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

/** Creates an unmemoized connection. Used by tests and by getDb(). */
export function createDb(filePath: string, runMigrations = true): Db {
  if (filePath !== ":memory:") {
    mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  }
  const sqlite = new Database(filePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  if (runMigrations) migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

let instance: Db | null = null;

/** Memoized app connection. Migrations run once, on first access. */
export function getDb(): Db {
  instance ??= createDb(env.DATABASE_PATH);
  return instance;
}

export * as schema from "./schema.js";
```

`apps/merchant/src/db/migrate.ts`:

```ts
import { getDb } from "./index.js";

getDb();
console.log("merchant: migrations applied");
```

- [ ] **Step 5: Write the failing schema/seed test**

`apps/merchant/src/db/schema.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "./index.js";
import { orders, paymentSessions, products } from "./schema.js";
import { seed } from "./seed.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "merchant-db-"));
  db = createDb(path.join(dir, "test.db"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("seed", () => {
  it("creates exactly six products", () => {
    seed(db);
    expect(db.select().from(products).all()).toHaveLength(6);
  });

  it("gives each product a positive price in whole cents", () => {
    seed(db);
    for (const product of db.select().from(products).all()) {
      expect(product.priceCents).toBeGreaterThan(0);
      expect(Number.isInteger(product.priceCents)).toBe(true);
    }
  });

  it("creates no orders or payment sessions", () => {
    seed(db);
    expect(db.select().from(orders).all()).toHaveLength(0);
    expect(db.select().from(paymentSessions).all()).toHaveLength(0);
  });

  it("is idempotent — running twice leaves the same row count", () => {
    seed(db);
    seed(db);
    expect(db.select().from(products).all()).toHaveLength(6);
  });

  it("does not delete orders created after seeding, only re-running seed does", () => {
    seed(db);
    db.insert(orders)
      .values({
        id: "ord_test",
        totalCents: 1000,
        currency: "EUR",
        customerName: "Test",
        customerEmail: "test@example.com",
        createdAt: 1,
      })
      .run();
    expect(db.select().from(orders).all()).toHaveLength(1);
  });
});

describe("payment_sessions retries", () => {
  it("allows a second session for the same order — retrying a failed presentation needs this", () => {
    // Spec 6.3: a retry "starts a fresh presentation" for the same order, so
    // the schema must not forbid a second row with the same order_id.
    seed(db);
    db.insert(orders)
      .values({
        id: "ord_1",
        totalCents: 1000,
        currency: "EUR",
        customerName: "Test",
        customerEmail: "test@example.com",
        createdAt: 1,
      })
      .run();

    db.insert(paymentSessions)
      .values({ id: "sess_1", orderId: "ord_1", state: "failed", createdAt: 1 })
      .run();

    expect(() =>
      db
        .insert(paymentSessions)
        .values({ id: "sess_2", orderId: "ord_1", state: "pending", createdAt: 2 })
        .run(),
    ).not.toThrow();

    expect(db.select().from(paymentSessions).all()).toHaveLength(2);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

```bash
cd apps/merchant && pnpm test src/db/schema.test.ts
```

Expected: FAIL — cannot resolve `./seed.js`.

- [ ] **Step 7: Write the seed script**

`apps/merchant/src/db/seed.ts` — six products spanning a few categories, so
the shop grid (Task 3) has something to group visually:

```ts
import { createDb, type Db } from "./index.js";
import { orders, paymentSessions, products } from "./schema.js";
import { env } from "../env.js";

interface Fixture {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  imageUrl: string;
  category: string;
}

const FIXTURES: Fixture[] = [
  {
    id: "prod_1",
    name: "Wireless Headphones",
    description: "Over-ear, active noise cancelling, 30h battery.",
    priceCents: 12_999,
    imageUrl: "/products/headphones.svg",
    category: "Electronics",
  },
  {
    id: "prod_2",
    name: "Mechanical Keyboard",
    description: "Hot-swappable switches, aluminium frame.",
    priceCents: 8_999,
    imageUrl: "/products/keyboard.svg",
    category: "Electronics",
  },
  {
    id: "prod_3",
    name: "Ceramic Pour-Over Set",
    description: "Dripper, server, and filters for a slow morning.",
    priceCents: 4_499,
    imageUrl: "/products/pour-over.svg",
    category: "Home",
  },
  {
    id: "prod_4",
    name: "Canvas Tote Bag",
    description: "Heavyweight cotton canvas, leather handles.",
    priceCents: 2_999,
    imageUrl: "/products/tote.svg",
    category: "Accessories",
  },
  {
    id: "prod_5",
    name: "Desk Plant — Monstera",
    description: "Low-maintenance, ships in a ceramic pot.",
    priceCents: 3_499,
    imageUrl: "/products/plant.svg",
    category: "Home",
  },
  {
    id: "prod_6",
    name: "Notebook, Dot Grid",
    description: "A5, 160 pages, fountain-pen-friendly paper.",
    priceCents: 1_799,
    imageUrl: "/products/notebook.svg",
    category: "Accessories",
  },
];

/**
 * Resets the database to the documented fixtures (spec 5.3). Idempotent, and
 * deliberately leaves orders/payment_sessions alone — those are runtime data,
 * not fixtures, and re-seeding mid-demo should not erase an in-progress order.
 */
export function seed(db: Db): void {
  db.delete(products).run();
  for (const fixture of FIXTURES) {
    db.insert(products).values(fixture).run();
  }
}

/** CLI entry point: `pnpm seed`. */
function main(): void {
  const db = createDb(env.DATABASE_PATH);
  seed(db);
  console.log(`merchant: seeded ${FIXTURES.length} products`);
}

if (process.argv[1]?.endsWith("seed.ts")) main();
```

Note `orders` and `paymentSessions` are imported only for the test file's use;
`seed.ts` itself only touches `products`. This matches the test above, which
pins that re-running seed does not delete orders.

- [ ] **Step 8: Run the tests to verify they pass**

```bash
cd apps/merchant && pnpm test src/db/schema.test.ts
```

Expected: 6 PASS.

- [ ] **Step 9: Make /api/ready actually check the database**

Replace `apps/merchant/src/app/api/ready/route.ts`:

```ts
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    getDb().get<{ ok: number }>(sql`select 1 as ok`);
    return NextResponse.json({ status: "ready" });
  } catch (error) {
    return NextResponse.json(
      { status: "unavailable", reason: error instanceof Error ? error.message : "unknown" },
      { status: 503 },
    );
  }
}
```

- [ ] **Step 10: Seed and verify end to end**

```bash
cd apps/merchant
pnpm migrate && pnpm seed
pnpm dev &
sleep 12
curl -sS http://localhost:3000/api/ready
kill %1
```

Expected: seed prints `merchant: seeded 6 products`; `/api/ready` returns
`{"status":"ready"}`.

- [ ] **Step 11: Commit**

```bash
cd /Users/senexi/dev/eudiw/payment-banking-demo
git add apps/merchant
git commit -m "feat(merchant): add drizzle schema, migrations, and product seed data"
```

---

### Task 3: Merchant products API and shop page

**Files:**
- Create: `apps/merchant/src/lib/format.ts`
- Create: `apps/merchant/src/lib/queries.ts`
- Create: `apps/merchant/src/app/api/products/route.ts`
- Create: `apps/merchant/src/app/api/products/[id]/route.ts`
- Create: `apps/merchant/src/components/ProductCard.tsx`
- Create: `apps/merchant/src/app/page.tsx`
- Modify: `apps/merchant/src/app/globals.css` (append shop-page classes)
- Test: `apps/merchant/src/lib/format.test.ts`
- Test: `apps/merchant/src/lib/queries.test.ts`

**Interfaces:**
- Consumes: `getDb`, `products` table from Task 2.
- Produces:
  - `formatEuroCents(cents: number): string` — e.g. `€47.98` (English locale;
    only the bank UI is German, per spec §9)
  - `centsToDecimalString(cents: number): string` — e.g. `"47.98"`, a plain
    two-decimal string with no currency symbol and no thousands separator.
    Task 6's `transaction_data.amount` needs exactly this shape.
  - `ProductDto = { id: string; name: string; description: string; priceCents: number; category: string }`
  - `listProducts(db): ProductDto[]`, `getProduct(db, id): ProductDto | null`
  - `<ProductCard product: ProductDto />` — the "Add to Cart" button is
    disabled in this task; Task 4 replaces it with a working one, the same
    pattern Plan 1 used for the bank's `CardTile`/`AddToWalletButton` split.

Note: this app renders no product images. `products.imageUrl` stays in the
schema because the spec's data model lists it, but `ProductCard` shows a
category-coloured monogram tile instead of an `<img>` — avoids depending on
asset files that don't exist, and the spec's UI section never requires a
literal photo, only "a six-product grid" (§9.4).

- [ ] **Step 1: Write the failing format test**

`apps/merchant/src/lib/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { centsToDecimalString, formatEuroCents } from "./format.js";

describe("formatEuroCents", () => {
  it("formats with a euro sign and two decimals", () => {
    expect(formatEuroCents(4_798)).toBe("€47.98");
  });

  it("formats zero", () => {
    expect(formatEuroCents(0)).toBe("€0.00");
  });

  it("formats a value under one euro", () => {
    expect(formatEuroCents(5)).toBe("€0.05");
  });
});

describe("centsToDecimalString", () => {
  it("converts cents to a plain two-decimal string", () => {
    expect(centsToDecimalString(4_798)).toBe("47.98");
  });

  it("never inserts a thousands separator", () => {
    expect(centsToDecimalString(100_000)).toBe("1000.00");
  });

  it("pads a whole-euro amount to two decimals", () => {
    expect(centsToDecimalString(500)).toBe("5.00");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/merchant && pnpm test src/lib/format.test.ts
```

Expected: FAIL — cannot resolve `./format.js`.

- [ ] **Step 3: Write format.ts**

`apps/merchant/src/lib/format.ts`:

```ts
const euro = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Integer cents to an English-locale euro string, e.g. "€47.98". */
export function formatEuroCents(cents: number): string {
  return euro.format(cents / 100);
}

/**
 * Integer cents to the plain decimal string foundry's `transaction_data.amount`
 * expects (spec 6.2 step 3) — no currency symbol, no thousands separator.
 * `toFixed` rather than `Intl` deliberately: this value is machine-read by
 * foundry, not displayed, and must never localize.
 */
export function centsToDecimalString(cents: number): string {
  return (cents / 100).toFixed(2);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/merchant && pnpm test src/lib/format.test.ts
```

Expected: 6 PASS.

- [ ] **Step 5: Write the failing queries test**

`apps/merchant/src/lib/queries.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/index.js";
import { seed } from "../db/seed.js";
import { getProduct, listProducts } from "./queries.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "merchant-q-"));
  db = createDb(path.join(dir, "test.db"));
  seed(db);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("listProducts", () => {
  it("returns all six seeded products", () => {
    expect(listProducts(db)).toHaveLength(6);
  });

  it("exposes only the DTO fields, deliberately omitting imageUrl", () => {
    // The column exists because the spec's data model lists it, but nothing
    // renders an image (see Task 3's note), so it must not leak into the API.
    const [first] = listProducts(db);
    expect(Object.keys(first ?? {}).sort()).toEqual([
      "category",
      "description",
      "id",
      "name",
      "priceCents",
    ]);
  });
});

describe("getProduct", () => {
  it("returns a seeded product by id", () => {
    const product = getProduct(db, "prod_1");
    expect(product?.name).toBe("Wireless Headphones");
    expect(product?.priceCents).toBe(12_999);
  });

  it("returns null for an unknown id", () => {
    expect(getProduct(db, "prod_nope")).toBeNull();
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

```bash
cd apps/merchant && pnpm test src/lib/queries.test.ts
```

Expected: FAIL — cannot resolve `./queries.js`.

- [ ] **Step 7: Write queries.ts**

`apps/merchant/src/lib/queries.ts`:

```ts
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { products } from "../db/schema.js";

export interface ProductDto {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  category: string;
}

function toDto(row: typeof products.$inferSelect): ProductDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    priceCents: row.priceCents,
    category: row.category,
  };
}

export function listProducts(db: Db): ProductDto[] {
  return db.select().from(products).all().map(toDto);
}

export function getProduct(db: Db, id: string): ProductDto | null {
  const row = db.select().from(products).where(eq(products.id, id)).get();
  return row ? toDto(row) : null;
}
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
cd apps/merchant && pnpm test src/lib/queries.test.ts
```

Expected: 4 PASS.

- [ ] **Step 9: Append shop-page component classes to globals.css**

Append to `apps/merchant/src/app/globals.css`:

```css
.shop-header {
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.shop-hero {
  background: linear-gradient(
    135deg,
    color-mix(in oklab, var(--color-brand) 10%, white),
    color-mix(in oklab, var(--color-accent) 10%, white)
  );
}

.product-card {
  background: var(--color-surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow-card);
  transition: box-shadow 150ms ease;
}

.product-card:hover {
  box-shadow: var(--shadow-card-hover);
}

.product-monogram {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 4 / 3;
  border-radius: calc(var(--radius) - 0.25rem);
  font-size: 2rem;
  font-weight: 700;
  color: white;
}
```

- [ ] **Step 10: Write the product routes**

`apps/merchant/src/app/api/products/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import { listProducts } from "@/lib/queries.js";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ products: listProducts(getDb()) });
}
```

`apps/merchant/src/app/api/products/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import { getProduct } from "@/lib/queries.js";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const product = getProduct(getDb(), id);
  if (!product) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ product });
}
```

- [ ] **Step 11: Write ProductCard**

A fixed palette keyed by category, so the monogram tile colour is deterministic
rather than random per render:

`apps/merchant/src/components/ProductCard.tsx`:

```tsx
import type { ProductDto } from "@/lib/queries.js";
import { formatEuroCents } from "@/lib/format.js";

const CATEGORY_COLOR: Record<string, string> = {
  Electronics: "var(--color-brand)",
  Home: "var(--color-accent)",
  Accessories: "var(--color-brand-dark)",
};

export function ProductCard({ product }: { product: ProductDto }) {
  const color = CATEGORY_COLOR[product.category] ?? "var(--color-brand)";

  return (
    <div className="product-card overflow-hidden">
      <div className="product-monogram" style={{ background: color }}>
        {product.name.slice(0, 2).toUpperCase()}
      </div>
      <div className="space-y-2 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
          {product.category}
        </p>
        <h3 className="font-semibold">{product.name}</h3>
        <p className="text-sm text-[var(--color-muted-foreground)]">{product.description}</p>
        <div className="flex items-center justify-between pt-2">
          <span className="text-lg font-bold">{formatEuroCents(product.priceCents)}</span>
          <button
            type="button"
            disabled
            title="Cart is wired up in the next task"
            className="rounded-[var(--radius)] bg-[var(--color-brand)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Add to Cart
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 12: Write the shop page**

`apps/merchant/src/app/page.tsx` — a server component reading the database
directly (same pattern the bank dashboard used in Plan 1 Task 10 — the `/api/products`
routes exist as a real, curl-able REST surface per spec §4.4, but a page that
already runs on the server has no reason to re-fetch its own API over HTTP):

```tsx
import { ProductCard } from "@/components/ProductCard.js";
import { getDb } from "@/db/index.js";
import { listProducts } from "@/lib/queries.js";

export const dynamic = "force-dynamic";

export default function ShopPage() {
  const products = listProducts(getDb());

  return (
    <>
      <header className="shop-header">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <span className="text-xl font-bold text-[var(--color-brand-dark)]">Demo Shop</span>
        </div>
      </header>

      <section className="shop-hero px-4 py-16 text-center">
        <h1 className="text-3xl font-bold">Pay with your EUDI Wallet</h1>
        <p className="mt-2 text-[var(--color-muted-foreground)]">
          A demo shop that settles payments through a real digital wallet.
        </p>
      </section>

      <main className="mx-auto max-w-5xl px-4 py-10">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </main>

      <footer className="mt-10 border-t border-[var(--color-border)] py-6 text-center text-sm text-[var(--color-muted-foreground)]">
        Demo Shop — a payment-banking-demo storefront.
      </footer>
    </>
  );
}
```

- [ ] **Step 13: Verify in a browser and over HTTP**

```bash
cd apps/merchant && pnpm dev &
sleep 12
curl -sS http://localhost:3000/api/products
curl -sS http://localhost:3000/api/products/prod_1
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/products/prod_nope
kill %1
```

Expected: 6 products from the list endpoint; `prod_1` returns Wireless
Headphones at `12999` cents; the unknown id returns `404`. Open
`http://localhost:3000/` and confirm a six-tile grid with coloured monogram
tiles, prices formatted as `€xx.xx`, and a disabled "Add to Cart" button on
every card.

- [ ] **Step 14: Typecheck and commit**

```bash
cd apps/merchant && pnpm typecheck && pnpm test
cd /Users/senexi/dev/eudiw/payment-banking-demo
git add apps/merchant
git commit -m "feat(merchant): add products API and shop page"
```

---

### Task 4: Cart — client-side, localStorage-backed

**Files:**
- Create: `apps/merchant/src/lib/cart.ts`
- Create: `apps/merchant/src/lib/useCart.ts`
- Create: `apps/merchant/src/components/AddToCartButton.tsx`
- Create: `apps/merchant/src/components/CartBadge.tsx`
- Create: `apps/merchant/src/app/cart/page.tsx`
- Modify: `apps/merchant/src/components/ProductCard.tsx` (replace the disabled button)
- Modify: `apps/merchant/src/app/page.tsx` (add `<CartBadge />` to the header)
- Modify: `apps/merchant/src/app/globals.css` (append cart-page classes)
- Test: `apps/merchant/src/lib/cart.test.ts`

**Interfaces:**
- Consumes: `ProductDto` from Task 3.
- Produces:
  - `CartItem = { productId: string; name: string; priceCents: number; quantity: number }`
  - `addItem(items, item, quantity?): CartItem[]`, `updateQuantity(items, productId, quantity): CartItem[]`,
    `removeItem(items, productId): CartItem[]`, `cartTotalCents(items): number`,
    `cartItemCount(items): number` — pure, storage-agnostic, unit-tested
  - `useCart()` — client hook wrapping the above with `localStorage`;
    `{ items, add, setQuantity, remove, clear, totalCents, itemCount }`.
    Not unit-tested (no DOM in this workspace's vitest environment — see
    Plan 1's `useIsTouch`/`useStatusPoll` for the same split), verified by
    browser instead.
  - `<CartBadge />` — client component rendering `itemCount` from `useCart()`
  - `<AddToCartButton product: ProductDto />` — client component

The cart intentionally has no server-side table — spec §5.2 lists it as one of
the two "deliberately absent" tables. There is nothing to migrate here.

- [ ] **Step 1: Write the failing cart test**

`apps/merchant/src/lib/cart.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  addItem,
  cartItemCount,
  cartTotalCents,
  removeItem,
  updateQuantity,
  type CartItem,
} from "./cart.js";

const headphones = { productId: "prod_1", name: "Wireless Headphones", priceCents: 12_999 };
const keyboard = { productId: "prod_2", name: "Mechanical Keyboard", priceCents: 8_999 };

describe("addItem", () => {
  it("adds a new item with quantity 1 by default", () => {
    const items = addItem([], headphones);
    expect(items).toEqual([{ ...headphones, quantity: 1 }]);
  });

  it("merges quantities when the product is already in the cart", () => {
    const items = addItem([{ ...headphones, quantity: 1 }], headphones, 2);
    expect(items).toEqual([{ ...headphones, quantity: 3 }]);
  });

  it("leaves other items untouched", () => {
    const items = addItem([{ ...headphones, quantity: 1 }], keyboard);
    expect(items).toHaveLength(2);
  });
});

describe("updateQuantity", () => {
  const cart: CartItem[] = [{ ...headphones, quantity: 2 }];

  it("sets a new quantity", () => {
    expect(updateQuantity(cart, "prod_1", 5)).toEqual([{ ...headphones, quantity: 5 }]);
  });

  it("removes the item when the quantity drops to zero or below", () => {
    expect(updateQuantity(cart, "prod_1", 0)).toEqual([]);
    expect(updateQuantity(cart, "prod_1", -1)).toEqual([]);
  });
});

describe("removeItem", () => {
  it("removes only the named product", () => {
    const cart: CartItem[] = [
      { ...headphones, quantity: 1 },
      { ...keyboard, quantity: 1 },
    ];
    expect(removeItem(cart, "prod_1")).toEqual([{ ...keyboard, quantity: 1 }]);
  });
});

describe("cartTotalCents", () => {
  it("sums price times quantity across items", () => {
    const cart: CartItem[] = [
      { ...headphones, quantity: 2 },
      { ...keyboard, quantity: 1 },
    ];
    expect(cartTotalCents(cart)).toBe(12_999 * 2 + 8_999);
  });

  it("is zero for an empty cart", () => {
    expect(cartTotalCents([])).toBe(0);
  });
});

describe("cartItemCount", () => {
  it("sums quantities, not item rows", () => {
    const cart: CartItem[] = [
      { ...headphones, quantity: 2 },
      { ...keyboard, quantity: 3 },
    ];
    expect(cartItemCount(cart)).toBe(5);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/merchant && pnpm test src/lib/cart.test.ts
```

Expected: FAIL — cannot resolve `./cart.js`.

- [ ] **Step 3: Write cart.ts**

`apps/merchant/src/lib/cart.ts`:

```ts
export interface CartItem {
  productId: string;
  name: string;
  priceCents: number;
  quantity: number;
}

export function addItem(
  items: CartItem[],
  item: Omit<CartItem, "quantity">,
  quantity = 1,
): CartItem[] {
  const existing = items.find((row) => row.productId === item.productId);
  if (existing) {
    return items.map((row) =>
      row.productId === item.productId ? { ...row, quantity: row.quantity + quantity } : row,
    );
  }
  return [...items, { ...item, quantity }];
}

/** A quantity of 0 or less removes the item. */
export function updateQuantity(items: CartItem[], productId: string, quantity: number): CartItem[] {
  if (quantity <= 0) return items.filter((row) => row.productId !== productId);
  return items.map((row) => (row.productId === productId ? { ...row, quantity } : row));
}

export function removeItem(items: CartItem[], productId: string): CartItem[] {
  return items.filter((row) => row.productId !== productId);
}

export function cartTotalCents(items: CartItem[]): number {
  return items.reduce((sum, row) => sum + row.priceCents * row.quantity, 0);
}

export function cartItemCount(items: CartItem[]): number {
  return items.reduce((sum, row) => sum + row.quantity, 0);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd apps/merchant && pnpm test src/lib/cart.test.ts
```

Expected: 9 PASS.

- [ ] **Step 5: Write the useCart hook**

`apps/merchant/src/lib/useCart.ts`:

```ts
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  addItem,
  cartItemCount,
  cartTotalCents,
  removeItem,
  updateQuantity,
  type CartItem,
} from "./cart.js";

const STORAGE_KEY = "demo-shop-cart";
/** Fired after every write so other mounted components resync in the same tab
 *  — the native `storage` event only fires cross-tab. */
const CART_EVENT = "demo-shop-cart-change";

function readStorage(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CartItem[]) : [];
  } catch {
    return [];
  }
}

function writeStorage(items: CartItem[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  window.dispatchEvent(new Event(CART_EVENT));
}

export function useCart() {
  const [items, setItems] = useState<CartItem[]>([]);

  useEffect(() => {
    setItems(readStorage());
    const onChange = () => setItems(readStorage());
    window.addEventListener(CART_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(CART_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const add = useCallback((item: Omit<CartItem, "quantity">, quantity = 1) => {
    writeStorage(addItem(readStorage(), item, quantity));
  }, []);

  const setQuantity = useCallback((productId: string, quantity: number) => {
    writeStorage(updateQuantity(readStorage(), productId, quantity));
  }, []);

  const remove = useCallback((productId: string) => {
    writeStorage(removeItem(readStorage(), productId));
  }, []);

  const clear = useCallback(() => writeStorage([]), []);

  return {
    items,
    add,
    setQuantity,
    remove,
    clear,
    totalCents: cartTotalCents(items),
    itemCount: cartItemCount(items),
  };
}
```

- [ ] **Step 6: Write AddToCartButton and CartBadge**

`apps/merchant/src/components/AddToCartButton.tsx`:

```tsx
"use client";

import type { ProductDto } from "@/lib/queries.js";
import { useCart } from "@/lib/useCart.js";

export function AddToCartButton({ product }: { product: ProductDto }) {
  const { add } = useCart();

  return (
    <button
      type="button"
      onClick={() =>
        add({ productId: product.id, name: product.name, priceCents: product.priceCents })
      }
      className="rounded-[var(--radius)] bg-[var(--color-brand)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--color-brand-dark)]"
    >
      Add to Cart
    </button>
  );
}
```

`apps/merchant/src/components/CartBadge.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useCart } from "@/lib/useCart.js";

export function CartBadge() {
  const { itemCount } = useCart();

  return (
    <Link
      href="/cart"
      className="relative rounded-[var(--radius)] border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium"
    >
      Cart
      {itemCount > 0 ? (
        <span className="ml-1.5 rounded-full bg-[var(--color-accent)] px-1.5 py-0.5 text-xs font-bold text-white">
          {itemCount}
        </span>
      ) : null}
    </Link>
  );
}
```

- [ ] **Step 7: Wire AddToCartButton into ProductCard**

In `apps/merchant/src/components/ProductCard.tsx`, add the import:

```tsx
import { AddToCartButton } from "./AddToCartButton.js";
```

and replace the disabled `<button>` element with:

```tsx
          <AddToCartButton product={product} />
```

- [ ] **Step 8: Add CartBadge to the shop header**

In `apps/merchant/src/app/page.tsx`, add the import:

```tsx
import { CartBadge } from "@/components/CartBadge.js";
```

and change the header's inner div to include it:

```tsx
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <span className="text-xl font-bold text-[var(--color-brand-dark)]">Demo Shop</span>
          <CartBadge />
        </div>
```

- [ ] **Step 9: Append cart-page classes to globals.css**

Append to `apps/merchant/src/app/globals.css`:

```css
.cart-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  border-bottom: 1px solid var(--color-border);
  padding: 1rem 0;
}

.quantity-stepper {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 0.25rem 0.5rem;
}
```

- [ ] **Step 10: Write the cart page**

`apps/merchant/src/app/cart/page.tsx`:

```tsx
"use client";

import Link from "next/link";
import { formatEuroCents } from "@/lib/format.js";
import { useCart } from "@/lib/useCart.js";

export default function CartPage() {
  const { items, setQuantity, remove, totalCents } = useCart();

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold">Your Cart</h1>

      {items.length === 0 ? (
        <p className="text-[var(--color-muted-foreground)]">
          Your cart is empty. <Link href="/" className="font-medium text-[var(--color-brand)]">Continue shopping</Link>.
        </p>
      ) : (
        <>
          <ul>
            {items.map((item) => (
              <li key={item.productId} className="cart-row">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{item.name}</p>
                  <p className="text-sm text-[var(--color-muted-foreground)]">
                    {formatEuroCents(item.priceCents)} each
                  </p>
                </div>
                <div className="quantity-stepper">
                  <button
                    type="button"
                    onClick={() => setQuantity(item.productId, item.quantity - 1)}
                    aria-label={`Decrease quantity of ${item.name}`}
                  >
                    −
                  </button>
                  <span className="tabular-nums">{item.quantity}</span>
                  <button
                    type="button"
                    onClick={() => setQuantity(item.productId, item.quantity + 1)}
                    aria-label={`Increase quantity of ${item.name}`}
                  >
                    +
                  </button>
                </div>
                <span className="w-20 text-right font-semibold tabular-nums">
                  {formatEuroCents(item.priceCents * item.quantity)}
                </span>
                <button
                  type="button"
                  onClick={() => remove(item.productId)}
                  aria-label={`Remove ${item.name}`}
                  className="text-sm text-[var(--color-destructive)]"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-6 flex items-center justify-between">
            <span className="text-lg font-semibold">Total</span>
            <span className="text-lg font-bold">{formatEuroCents(totalCents)}</span>
          </div>

          <Link
            href="/checkout"
            className="mt-6 block w-full rounded-[var(--radius)] bg-[var(--color-brand)] py-3 text-center font-semibold text-white hover:bg-[var(--color-brand-dark)]"
          >
            Proceed to Checkout
          </Link>
        </>
      )}
    </main>
  );
}
```

`useCart` requires client-side `localStorage`, so this page is a client
component end to end (`"use client"` at the top) rather than a server
component — there is no server-side cart to read.

- [ ] **Step 11: Verify in a browser**

```bash
cd apps/merchant && pnpm dev
```

1. On `/`, click "Add to Cart" on two different products. The header's Cart
   badge should show a count immediately (no reload) and persist across a
   full page reload (localStorage).
2. Open `/cart`: both items appear with correct unit prices, quantity steppers
   work, the row total updates live, and the page total matches the sum.
3. Set a quantity to 0 with the stepper — the row disappears.
4. Remove the remaining item — the empty-cart message and "Continue shopping"
   link appear.

- [ ] **Step 12: Typecheck and commit**

```bash
cd apps/merchant && pnpm typecheck && pnpm test
cd /Users/senexi/dev/eudiw/payment-banking-demo
git add apps/merchant
git commit -m "feat(merchant): add client-side cart with localStorage persistence"
```

---

### Task 5: Checkout — order creation with server-side price recomputation

**Files:**
- Create: `apps/merchant/src/lib/orders.ts`
- Create: `apps/merchant/src/app/api/orders/route.ts`
- Create: `apps/merchant/src/components/CheckoutForm.tsx`
- Create: `apps/merchant/src/app/checkout/page.tsx`
- Modify: `apps/merchant/src/app/globals.css` (append checkout-page classes)
- Test: `apps/merchant/src/lib/orders.test.ts`

**Interfaces:**
- Consumes: `getDb`, `products`/`orders` tables from Task 2; `useCart` from
  Task 4.
- Produces:
  - `OrderItemInput = { productId: string; quantity: number }` — deliberately
    has no price field. This is a structural guarantee, not just a runtime
    check: the type the client is allowed to send cannot express a price at
    all, so there is no client-supplied number to "forget" to ignore.
  - `CreateOrderResult = { ok: true; orderId: string; totalCents: number } | { ok: false; reason: "empty_cart" | "unknown_product" }`
  - `createOrder(db, items: OrderItemInput[], customer: { name: string; email: string }, now?): CreateOrderResult`

- [ ] **Step 1: Write the failing orders test**

`apps/merchant/src/lib/orders.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/index.js";
import { orders } from "../db/schema.js";
import { seed } from "../db/seed.js";
import { createOrder } from "./orders.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "merchant-ord-"));
  db = createDb(path.join(dir, "test.db"));
  seed(db);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const customer = { name: "Ada Lovelace", email: "ada@example.com" };

describe("createOrder", () => {
  it("computes the total from the products table, not from the caller", () => {
    // prod_1 is 12999 cents, prod_2 is 8999 cents (see db/seed.ts fixtures).
    const result = createOrder(
      db,
      [{ productId: "prod_1", quantity: 2 }, { productId: "prod_2", quantity: 1 }],
      customer,
    );
    expect(result).toEqual({
      ok: true,
      orderId: expect.any(String),
      totalCents: 12_999 * 2 + 8_999,
    });
  });

  it("persists a pending order with the computed total", () => {
    const result = createOrder(db, [{ productId: "prod_1", quantity: 1 }], customer);
    if (!result.ok) throw new Error("expected success");
    const row = db.select().from(orders).where(eq(orders.id, result.orderId)).get();
    expect(row?.status).toBe("pending");
    expect(row?.totalCents).toBe(12_999);
    expect(row?.customerName).toBe("Ada Lovelace");
    expect(row?.customerEmail).toBe("ada@example.com");
  });

  it("multiplies price by quantity for each line", () => {
    const result = createOrder(db, [{ productId: "prod_6", quantity: 3 }], customer);
    expect(result).toMatchObject({ ok: true, totalCents: 1_799 * 3 });
  });

  it("rejects an empty cart", () => {
    expect(createOrder(db, [], customer)).toEqual({ ok: false, reason: "empty_cart" });
  });

  it("rejects a reference to a product that does not exist", () => {
    const result = createOrder(
      db,
      [{ productId: "prod_1", quantity: 1 }, { productId: "prod_nope", quantity: 1 }],
      customer,
    );
    expect(result).toEqual({ ok: false, reason: "unknown_product" });
  });

  it("does not insert a row when rejecting", () => {
    createOrder(db, [], customer);
    createOrder(db, [{ productId: "prod_nope", quantity: 1 }], customer);
    expect(db.select().from(orders).all()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/merchant && pnpm test src/lib/orders.test.ts
```

Expected: FAIL — cannot resolve `./orders.js`.

- [ ] **Step 3: Write orders.ts**

`apps/merchant/src/lib/orders.ts`:

```ts
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { orders, products } from "../db/schema.js";

export interface OrderItemInput {
  productId: string;
  quantity: number;
}

export interface CustomerInput {
  name: string;
  email: string;
}

export type CreateOrderResult =
  | { ok: true; orderId: string; totalCents: number }
  | { ok: false; reason: "empty_cart" | "unknown_product" };

/**
 * Recomputes the total from this app's own `products` rows — the caller's
 * `OrderItemInput` cannot carry a price at all, so there is nothing client-
 * supplied to accidentally trust (spec 6.2: "the merchant never trusts the
 * browser about money").
 */
export function createOrder(
  db: Db,
  items: OrderItemInput[],
  customer: CustomerInput,
  now: number = Date.now(),
): CreateOrderResult {
  if (items.length === 0) return { ok: false, reason: "empty_cart" };

  let totalCents = 0;
  for (const item of items) {
    const product = db.select().from(products).where(eq(products.id, item.productId)).get();
    if (!product) return { ok: false, reason: "unknown_product" };
    totalCents += product.priceCents * item.quantity;
  }

  const orderId = `ord_${randomUUID()}`;
  db.insert(orders)
    .values({
      id: orderId,
      totalCents,
      currency: "EUR",
      customerName: customer.name,
      customerEmail: customer.email,
      status: "pending",
      createdAt: now,
    })
    .run();

  return { ok: true, orderId, totalCents };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd apps/merchant && pnpm test src/lib/orders.test.ts
```

Expected: 6 PASS.

- [ ] **Step 5: Write the orders route**

`apps/merchant/src/app/api/orders/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/index.js";
import { createOrder } from "@/lib/orders.js";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  items: z
    .array(z.object({ productId: z.string().min(1), quantity: z.number().int().positive() }))
    .min(1),
  customer: z.object({ name: z.string().min(1), email: z.string().email() }),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = createOrder(getDb(), parsed.data.items, parsed.data.customer);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }

  return NextResponse.json(
    { orderId: result.orderId, totalCents: result.totalCents },
    { status: 201 },
  );
}
```

Note the zod schema itself is the first line of defense: `items` only accepts
`productId`/`quantity`, so even a maliciously-crafted request body cannot
smuggle a price through — it would simply be an unrecognised field, ignored
by `.safeParse`.

- [ ] **Step 6: Append checkout-page classes to globals.css**

Append to `apps/merchant/src/app/globals.css`:

```css
.checkout-summary {
  background: var(--color-surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow-card);
}

.checkout-cta {
  background: #004dd7; /* EudiPay blue — the one place the merchant palette
                           yields to the payment brand (spec 9.4) */
}

.checkout-cta:hover {
  background: #0040ad;
}
```

- [ ] **Step 7: Write CheckoutForm**

This task's version stops after creating the order and shows a confirmation —
Task 6 extends it to also create a payment session and redirect to `/pay`.

`apps/merchant/src/components/CheckoutForm.tsx`:

```tsx
"use client";

import { useState, type FormEvent } from "react";
import { formatEuroCents } from "@/lib/format.js";
import { useCart } from "@/lib/useCart.js";

interface CreatedOrder {
  orderId: string;
  totalCents: number;
}

export function CheckoutForm() {
  const { items, totalCents, clear } = useCart();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<CreatedOrder | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
          customer: { name, email },
        }),
      });
      if (!response.ok) {
        setError("Could not create the order. Please check your cart and try again.");
        return;
      }
      const body = (await response.json()) as CreatedOrder;
      clear();
      setCreated(body);
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (created) {
    return (
      <div className="checkout-summary p-6">
        <h2 className="text-lg font-semibold">Thanks, {name}!</h2>
        <p className="mt-2 text-[var(--color-muted-foreground)]">
          Order <span className="font-mono">{created.orderId}</span> created — total{" "}
          {formatEuroCents(created.totalCents)}.
        </p>
      </div>
    );
  }

  if (items.length === 0) {
    return <p className="text-[var(--color-muted-foreground)]">Your cart is empty.</p>;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="name" className="text-sm font-medium">
          Full name
        </label>
        <input
          id="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          className="w-full rounded-[var(--radius)] border border-[var(--color-border)] px-3 py-2"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          className="w-full rounded-[var(--radius)] border border-[var(--color-border)] px-3 py-2"
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-[var(--color-destructive)]">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="checkout-cta w-full rounded-[var(--radius)] py-3 font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Placing order…" : `Pay with EUDI Wallet — ${formatEuroCents(totalCents)}`}
      </button>
    </form>
  );
}
```

- [ ] **Step 8: Write the checkout page**

`apps/merchant/src/app/checkout/page.tsx`:

```tsx
import { CheckoutForm } from "@/components/CheckoutForm.js";

export default function CheckoutPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold">Checkout</h1>
      <CheckoutForm />
    </main>
  );
}
```

- [ ] **Step 9: Verify in a browser and over HTTP**

```bash
cd apps/merchant && pnpm dev &
sleep 12
echo "--- server recomputes the total; a client-supplied price would be ignored ---"
curl -sS -X POST http://localhost:3000/api/orders \
  -H 'content-type: application/json' \
  -d '{"items":[{"productId":"prod_1","quantity":2}],"customer":{"name":"Ada","email":"ada@example.com"}}'
echo
echo "--- unknown product rejected ---"
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/orders \
  -H 'content-type: application/json' \
  -d '{"items":[{"productId":"prod_nope","quantity":1}],"customer":{"name":"Ada","email":"ada@example.com"}}'
kill %1
```

Expected: `{"orderId":"ord_...","totalCents":25998}` (2 × 12999); `400` for the
unknown product. In the browser: add items to the cart, go to `/checkout`,
submit the form, and see the "Thanks, {name}!" confirmation with the correct
total; the cart badge should read 0 afterward (cleared on success).

- [ ] **Step 10: Typecheck and commit**

```bash
cd apps/merchant && pnpm typecheck && pnpm test
cd /Users/senexi/dev/eudiw/payment-banking-demo
git add apps/merchant
git commit -m "feat(merchant): add checkout with server-side price recomputation"
```

---

### Task 6: Payment session creation and status endpoint

Starts a real `foundry` verification request. Implements spec §6.2 steps 2–4
and 7 (the read side of step 7; the settle side is Task 8, after the bank
endpoint exists in Task 7).

**Files:**
- Create: `apps/merchant/src/lib/dcql.ts`
- Create: `apps/merchant/src/lib/payment-sessions.ts`
- Create: `apps/merchant/src/app/api/payment-sessions/route.ts`
- Create: `apps/merchant/src/app/api/payment-sessions/[id]/route.ts`
- Modify: `apps/merchant/src/components/CheckoutForm.tsx` (start a session and redirect)
- Test: `apps/merchant/src/lib/dcql.test.ts`
- Test: `apps/merchant/src/lib/payment-sessions.test.ts`

**Interfaces:**
- Consumes: `getFoundry` (Task 1), `orders`/`paymentSessions` tables (Task 2),
  `centsToDecimalString` (Task 3), `FoundryClient.createVerificationRequest`
  (from `@demo/foundry-client`, built in Plan 1 Task 3, unused until now).
- Produces:
  - `buildDcqlQuery(): unknown` — the fixed DCQL shape from spec §6.2 step 3
  - `buildTransactionData(orderId, amountCents, merchantName): unknown[]`
  - `StartPaymentSessionResult = { ok: true; sessionId: string; uri: string } | { ok: false; reason: "order_not_found" | "order_not_pending" | "foundry_unavailable" }`
  - `startPaymentSession(db, client, orderId, merchantName, now?): Promise<StartPaymentSessionResult>`
  - `PaymentSessionStatusDto = { state: PaymentSessionState; checks?: unknown; failureReason?: string }`
  - `getPaymentSessionStatus(db, sessionId): PaymentSessionStatusDto | null` — a
    plain DB read, no foundry call. Task 8 adds foundry polling and the
    settle gate on top of this same lookup.

- [ ] **Step 1: Write the failing dcql test**

`apps/merchant/src/lib/dcql.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildDcqlQuery, buildTransactionData } from "./dcql.js";

describe("buildDcqlQuery", () => {
  it("asks for exactly the com.emvco.dpc.card credential and two claims", () => {
    expect(buildDcqlQuery()).toEqual({
      credentials: [
        {
          id: "card",
          format: "dc+sd-jwt",
          meta: { vct_values: ["com.emvco.dpc.card"] },
          claims: [{ path: ["credential_id"] }, { path: ["network"] }],
        },
      ],
    });
  });
});

describe("buildTransactionData", () => {
  it("carries the amount as a plain decimal string, not a number", () => {
    const data = buildTransactionData("ord_1", 4_798, "Demo Shop");
    expect(data).toEqual([
      {
        type: "payment",
        credential_ids: ["card"],
        amount: "47.98",
        currency: "EUR",
        merchant: "Demo Shop",
        order_id: "ord_1",
      },
    ]);
  });

  it("round-trips a whole-euro amount without dropping decimals", () => {
    const [entry] = buildTransactionData("ord_2", 5_000, "Demo Shop") as Array<{
      amount: string;
    }>;
    expect(entry?.amount).toBe("50.00");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/merchant && pnpm test src/lib/dcql.test.ts
```

Expected: FAIL — cannot resolve `./dcql.js`.

- [ ] **Step 3: Write dcql.ts**

`apps/merchant/src/lib/dcql.ts`:

```ts
import { centsToDecimalString } from "./format.js";

/**
 * The DCQL query is fixed — this demo only ever asks for one credential type
 * and the two claims it needs to settle (spec 6.2 step 3). `credential_ids`
 * in transaction_data below must reference this query's `id: "card"`.
 */
export function buildDcqlQuery(): unknown {
  return {
    credentials: [
      {
        id: "card",
        format: "dc+sd-jwt",
        meta: { vct_values: ["com.emvco.dpc.card"] },
        claims: [{ path: ["credential_id"] }, { path: ["network"] }],
      },
    ],
  };
}

/**
 * `amount` must be a plain decimal string — confirmed against the real
 * foundry instance in Plan 1 Task 1: foundry itself performs the OpenID4VP
 * base64url-JSON encoding, so this app sends plain JSON with a string amount,
 * never a pre-encoded value and never a number (a float amount is exactly the
 * kind of silent precision bug this whole design avoids elsewhere).
 */
export function buildTransactionData(
  orderId: string,
  amountCents: number,
  merchantName: string,
): unknown[] {
  return [
    {
      type: "payment",
      credential_ids: ["card"],
      amount: centsToDecimalString(amountCents),
      currency: "EUR",
      merchant: merchantName,
      order_id: orderId,
    },
  ];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd apps/merchant && pnpm test src/lib/dcql.test.ts
```

Expected: 3 PASS.

- [ ] **Step 5: Write the failing payment-sessions test**

`apps/merchant/src/lib/payment-sessions.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FoundryClient } from "@demo/foundry-client";
import { createDb, type Db } from "../db/index.js";
import { orders, paymentSessions } from "../db/schema.js";
import { getPaymentSessionStatus, startPaymentSession } from "./payment-sessions.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "merchant-sess-"));
  db = createDb(path.join(dir, "test.db"));
  db.insert(orders)
    .values({
      id: "ord_1",
      totalCents: 4_798,
      currency: "EUR",
      customerName: "Ada",
      customerEmail: "ada@example.com",
      status: "pending",
      createdAt: 1,
    })
    .run();
  db.insert(orders)
    .values({
      id: "ord_paid",
      totalCents: 1_000,
      currency: "EUR",
      customerName: "Ada",
      customerEmail: "ada@example.com",
      status: "paid",
      createdAt: 1,
    })
    .run();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A FoundryClient whose HTTP layer is replaced by a scripted stub. */
function stubClient(
  handler: (url: string, init: RequestInit) => { status: number; body: unknown },
): FoundryClient {
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const { status, body } = handler(String(input), init ?? {});
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  return new FoundryClient({ adminUrl: "http://f:9000", adminKey: "k", fetchImpl });
}

const verificationOk = () => ({
  status: 200,
  body: {
    verification_id: "ver_1",
    openid4vp_uri: "openid4vp://?x=1",
    request_uri: "https://foundry.example/req/1",
  },
});

describe("startPaymentSession", () => {
  it("creates a pending session and returns the presentation uri", async () => {
    const result = await startPaymentSession(db, stubClient(verificationOk), "ord_1", "Demo Shop");

    expect(result).toEqual({ ok: true, sessionId: expect.any(String), uri: "openid4vp://?x=1" });

    const row = db.select().from(paymentSessions).get();
    expect(row?.state).toBe("pending");
    expect(row?.orderId).toBe("ord_1");
    expect(row?.foundryVerificationId).toBe("ver_1");
  });

  it("sends the fixed DCQL query and this order's amount as transaction_data", async () => {
    let sentBody: unknown = null;
    const client = stubClient((_url, init) => {
      sentBody = JSON.parse(String(init.body));
      return verificationOk();
    });

    await startPaymentSession(db, client, "ord_1", "Demo Shop");

    expect(sentBody).toMatchObject({
      transport: "request_uri",
      dcql_query: { credentials: [{ id: "card" }] },
      transaction_data: [{ amount: "47.98", order_id: "ord_1", merchant: "Demo Shop" }],
    });
  });

  it("refuses an unknown order", async () => {
    const result = await startPaymentSession(db, stubClient(verificationOk), "ord_nope", "Demo Shop");
    expect(result).toEqual({ ok: false, reason: "order_not_found" });
  });

  it("refuses an order that is not pending", async () => {
    const result = await startPaymentSession(db, stubClient(verificationOk), "ord_paid", "Demo Shop");
    expect(result).toEqual({ ok: false, reason: "order_not_pending" });
  });

  it("marks the row failed when foundry rejects the request", async () => {
    const client = stubClient(() => ({ status: 500, body: { error: "boom" } }));
    const result = await startPaymentSession(db, client, "ord_1", "Demo Shop");

    expect(result).toEqual({ ok: false, reason: "foundry_unavailable" });
    const row = db.select().from(paymentSessions).get();
    // The row is persisted BEFORE foundry is called, mirroring the bank's
    // issuance flow (Plan 1 Task 11) — the failure stays visible in the DB.
    expect(row?.state).toBe("failed");
    expect(row?.failureReason).toBe("foundry_unavailable");
  });
});

describe("getPaymentSessionStatus", () => {
  it("returns the current state without contacting foundry", async () => {
    const started = await startPaymentSession(db, stubClient(verificationOk), "ord_1", "Demo Shop");
    if (!started.ok) throw new Error("setup failed");

    expect(getPaymentSessionStatus(db, started.sessionId)).toEqual({ state: "pending" });
  });

  it("returns null for an unknown session id", () => {
    expect(getPaymentSessionStatus(db, "sess_nope")).toBeNull();
  });

  it("includes checks and failureReason once a session has them", async () => {
    const started = await startPaymentSession(db, stubClient(verificationOk), "ord_1", "Demo Shop");
    if (!started.ok) throw new Error("setup failed");

    db.update(paymentSessions)
      .set({
        state: "failed",
        failureReason: "verification_failed",
        checksJson: JSON.stringify([{ check: "dcql_match", passed: false }]),
      })
      .where(eq(paymentSessions.id, started.sessionId))
      .run();

    expect(getPaymentSessionStatus(db, started.sessionId)).toEqual({
      state: "failed",
      failureReason: "verification_failed",
      checks: [{ check: "dcql_match", passed: false }],
    });
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

```bash
cd apps/merchant && pnpm test src/lib/payment-sessions.test.ts
```

Expected: FAIL — cannot resolve `./payment-sessions.js`.

- [ ] **Step 7: Write payment-sessions.ts**

`apps/merchant/src/lib/payment-sessions.ts`:

```ts
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FoundryClient } from "@demo/foundry-client";
import type { Db } from "../db/index.js";
import { orders, paymentSessions, type PaymentSessionState } from "../db/schema.js";
import { buildDcqlQuery, buildTransactionData } from "./dcql.js";

export type StartPaymentSessionResult =
  | { ok: true; sessionId: string; uri: string }
  | { ok: false; reason: "order_not_found" | "order_not_pending" | "foundry_unavailable" };

export interface PaymentSessionStatusDto {
  state: PaymentSessionState;
  checks?: unknown;
  failureReason?: string;
}

/**
 * Spec 6.2 steps 2–4. The session row is written BEFORE foundry is called, so
 * a failed verification-request creation leaves a visible `failed` row
 * rather than nothing at all — the same property Plan 1's bank issuance flow
 * relies on.
 */
export async function startPaymentSession(
  db: Db,
  client: FoundryClient,
  orderId: string,
  merchantName: string,
  now: number = Date.now(),
): Promise<StartPaymentSessionResult> {
  const order = db.select().from(orders).where(eq(orders.id, orderId)).get();
  if (!order) return { ok: false, reason: "order_not_found" };
  if (order.status !== "pending") return { ok: false, reason: "order_not_pending" };

  const sessionId = `sess_${randomUUID()}`;

  db.insert(paymentSessions)
    .values({ id: sessionId, orderId: order.id, state: "pending", createdAt: now })
    .run();

  try {
    const response = await client.createVerificationRequest({
      transport: "request_uri",
      dcql_query: buildDcqlQuery(),
      transaction_data: buildTransactionData(order.id, order.totalCents, merchantName),
    });

    const uri = response.openid4vp_uri ?? response.request_uri ?? "";

    db.update(paymentSessions)
      .set({
        foundryVerificationId: response.verification_id,
        openid4vpUri: response.openid4vp_uri ?? null,
        requestUri: response.request_uri ?? null,
      })
      .where(eq(paymentSessions.id, sessionId))
      .run();

    return { ok: true, sessionId, uri };
  } catch {
    db.update(paymentSessions)
      .set({ state: "failed", failureReason: "foundry_unavailable" })
      .where(eq(paymentSessions.id, sessionId))
      .run();
    return { ok: false, reason: "foundry_unavailable" };
  }
}

/**
 * A plain lookup, no foundry traffic. Task 8 wraps this with a
 * `refreshPaymentSessionState` that polls foundry and drives the settle gate;
 * this function stays the single place both read the DB row from.
 */
export function getPaymentSessionStatus(db: Db, sessionId: string): PaymentSessionStatusDto | null {
  const row = db.select().from(paymentSessions).where(eq(paymentSessions.id, sessionId)).get();
  if (!row) return null;

  return {
    state: row.state,
    checks: row.checksJson ? JSON.parse(row.checksJson) : undefined,
    failureReason: row.failureReason ?? undefined,
  };
}
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
cd apps/merchant && pnpm test src/lib/payment-sessions.test.ts
```

Expected: 8 PASS.

- [ ] **Step 9: Write the two routes**

`apps/merchant/src/app/api/payment-sessions/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/index.js";
import { env } from "@/env.js";
import { getFoundry } from "@/lib/foundry.js";
import { startPaymentSession } from "@/lib/payment-sessions.js";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ orderId: z.string().min(1) });

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await startPaymentSession(
    getDb(),
    getFoundry(),
    parsed.data.orderId,
    env.MERCHANT_NAME,
  );

  if (!result.ok) {
    const status =
      result.reason === "order_not_found" ? 404 : result.reason === "order_not_pending" ? 409 : 502;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json({ sessionId: result.sessionId, uri: result.uri }, { status: 201 });
}
```

`apps/merchant/src/app/api/payment-sessions/[id]/route.ts` — this task's
minimal version; Task 8 replaces the body with one that also polls foundry and
drives the settle gate, but the route's shape and response contract do not
change:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import { getPaymentSessionStatus } from "@/lib/payment-sessions.js";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const status = getPaymentSessionStatus(getDb(), id);
  if (!status) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(status);
}
```

Per spec §7.2, this endpoint returns **only** `{state, checks?, failureReason?}`
— never `openid4vpUri`. The `/pay/{sessionId}` page (Task 9) reads the URI
directly from its own database as a server component, exactly once, rather
than through this polled endpoint.

- [ ] **Step 10: Wire CheckoutForm to start a payment session and redirect**

Replace the success branch of `apps/merchant/src/components/CheckoutForm.tsx`.
First, add imports:

```tsx
import { useRouter } from "next/navigation";
```

Then change the component to use the router and, after a successful order,
immediately start a payment session and navigate instead of showing a static
confirmation:

```tsx
export function CheckoutForm() {
  const router = useRouter();
  const { items, totalCents, clear } = useCart();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const orderResponse = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
          customer: { name, email },
        }),
      });
      if (!orderResponse.ok) {
        setError("Could not create the order. Please check your cart and try again.");
        return;
      }
      const order = (await orderResponse.json()) as { orderId: string };

      const sessionResponse = await fetch("/api/payment-sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: order.orderId }),
      });
      if (!sessionResponse.ok) {
        setError("Could not start the payment. Please try again.");
        return;
      }
      const session = (await sessionResponse.json()) as { sessionId: string };

      clear();
      router.push(`/pay/${session.sessionId}`);
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (items.length === 0) {
    return <p className="text-[var(--color-muted-foreground)]">Your cart is empty.</p>;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="name" className="text-sm font-medium">
          Full name
        </label>
        <input
          id="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          className="w-full rounded-[var(--radius)] border border-[var(--color-border)] px-3 py-2"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          className="w-full rounded-[var(--radius)] border border-[var(--color-border)] px-3 py-2"
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-[var(--color-destructive)]">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="checkout-cta w-full rounded-[var(--radius)] py-3 font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Starting payment…" : `Pay with EUDI Wallet — ${formatEuroCents(totalCents)}`}
      </button>
    </form>
  );
}
```

The `CreatedOrder` state and `created` branch from Task 5 are gone — checkout
now always ends by navigating to `/pay/{sessionId}`, which does not exist
until Task 9. That is expected; this task's HTTP verification (Step 11 below)
checks the two API calls directly rather than driving the UI through to a
page that doesn't exist yet.

- [ ] **Step 11: Verify over HTTP against the real foundry**

Requires `foundry` running (from Plan 1 Task 1) and this app pointed at it.

```bash
cd apps/merchant && pnpm dev &
sleep 12

ORDER=$(curl -sS -X POST http://localhost:3000/api/orders \
  -H 'content-type: application/json' \
  -d '{"items":[{"productId":"prod_1","quantity":1}],"customer":{"name":"Ada","email":"ada@example.com"}}')
echo "order: $ORDER"
ORDER_ID=$(echo "$ORDER" | sed -E 's/.*"orderId":"([^"]+)".*/\1/')

echo "--- start payment session ---"
SESSION=$(curl -sS -X POST http://localhost:3000/api/payment-sessions \
  -H 'content-type: application/json' \
  -d "{\"orderId\":\"$ORDER_ID\"}")
echo "$SESSION"
SESSION_ID=$(echo "$SESSION" | sed -E 's/.*"sessionId":"([^"]+)".*/\1/')

echo "--- status (expect pending, no uri exposed here) ---"
curl -sS http://localhost:3000/api/payment-sessions/$SESSION_ID

echo "--- starting a session for an unknown order is 404 ---"
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/payment-sessions \
  -H 'content-type: application/json' -d '{"orderId":"ord_nope"}'

echo "--- a RETRY on a still-pending order is allowed (201), per spec 6.3 ---"
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/payment-sessions \
  -H 'content-type: application/json' -d "{\"orderId\":\"$ORDER_ID\"}"
kill %1
```

Then check the one rejection that the `order_not_pending` guard actually
owns. Nothing in this task can move an order out of `pending` yet — settlement
is Task 8 and cancellation is Task 10 — so flip the status directly, the same
way Task 7 Step 11 inserts a synthetic credential to exercise a path whose
real producer does not exist yet:

```bash
cd apps/merchant
cat > scratch.ts <<'TS'
import { eq } from "drizzle-orm";
import { createDb } from "./src/db/index.js";
import { orders } from "./src/db/schema.js";
const db = createDb(process.env.DATABASE_PATH ?? "./data/merchant.db", false);
const row = db.select().from(orders).where(eq(orders.status, "pending")).get();
if (!row) throw new Error("no pending order to flip — run the block above first");
db.update(orders).set({ status: "paid" }).where(eq(orders.id, row.id)).run();
console.log("flipped to paid:", row.id);
TS
pnpm exec tsx --env-file-if-exists=.env.local scratch.ts
rm -f scratch.ts

pnpm dev &
sleep 12
echo "--- a session for a non-pending order is 409 ---"
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/payment-sessions \
  -H 'content-type: application/json' -d "{\"orderId\":\"<the id printed above>\"}"
kill %1
```

Expected: a `sessionId` plus a `uri` starting `openid4vp://` or `https://`;
`{"state":"pending"}` from the status endpoint with **no `uri` field present**
(spec §7.2 — the polled endpoint never carries the presentation URI); `404`
for the unknown order; `201` for the retry on a still-`pending` order; and
`409` only once the order is no longer `pending`.

That `201` is the point of the schema decision in Task 2: a failed or
abandoned presentation leaves its order `pending`, and spec §6.3 requires the
retry to "start a fresh presentation" — a second `payment_sessions` row for
the same order. `order_not_pending` is therefore the *only* thing gating
repeat sessions, and it deliberately does not fire until the order actually
reaches a terminal status.

One consequence worth stating plainly, since it is a real limitation rather
than an oversight: nothing stops a client from opening several concurrent
sessions for one `pending` order. The last one the user actually completes
wins, and the others simply expire in foundry — harmless here because
settlement (Task 8) is keyed by `idempotency_key = sessionId` on the bank
side and gated by `orders.status` flipping to `paid` on the merchant side, so
concurrent sessions cannot double-charge. Closing that hole properly would
mean a partial unique index over non-terminal states, which SQLite supports
but Drizzle's schema builder does not express cleanly; it is not worth the
complexity for a demo.

- [ ] **Step 12: Typecheck and commit**

```bash
cd apps/merchant && pnpm typecheck && pnpm test
cd /Users/senexi/dev/eudiw/payment-banking-demo
git add apps/merchant
git commit -m "feat(merchant): add payment session creation and status endpoint"
```

---

### Task 7: Bank settlement endpoint — POST /api/payments

Modifies `apps/bank` only. No merchant code changes here — this task is fully
self-contained and independently testable, which is deliberate: it lets a
reviewer approve the bank's debit logic without needing anything from Task 6
to exist.

**Files:**
- Create: `apps/bank/src/lib/apiKey.ts`
- Create: `apps/bank/src/lib/payments.ts`
- Create: `apps/bank/src/app/api/payments/route.ts`
- Test: `apps/bank/src/lib/apiKey.test.ts`
- Test: `apps/bank/src/lib/payments.test.ts`

**Interfaces:**
- Consumes: `getDb`, `credentials`/`cards`/`accounts`/`transactions` tables,
  `env.BANK_API_KEY` — all from Plan 1.
- Produces:
  - `class InvalidApiKeyError extends Error`
  - `requireApiKey(request: Request): void` — throws `InvalidApiKeyError`
    unless the `X-API-Key` header exactly matches `env.BANK_API_KEY`
  - `ProcessPaymentInput = { credentialId: string; amountCents: number; currency: string; merchant: string; reference: string; idempotencyKey: string }`
  - `ProcessPaymentResult = { ok: true; bankTxId: string; newBalanceCents: number } | { ok: false; reason: "unknown_credential" | "credential_not_active" | "insufficient_funds" }`
  - `processPayment(db, input, now?): ProcessPaymentResult`

- [ ] **Step 1: Write the failing API key test**

`apps/bank/src/lib/apiKey.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("../env.js", () => ({
  env: {
    PORT: 3001,
    DATABASE_PATH: ":memory:",
    BANK_PUBLIC_URL: "http://localhost:3001",
    FOUNDRY_ADMIN_URL: "http://127.0.0.1:9000",
    FOUNDRY_ADMIN_KEY: "k",
    BANK_API_KEY: "dev-bank-api-key",
    SESSION_SECRET: "0123456789012345678901234567890123456789",
  },
}));

const { InvalidApiKeyError, requireApiKey } = await import("./apiKey.js");

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/payments", { headers });
}

describe("requireApiKey", () => {
  it("does not throw for the correct key", () => {
    expect(() => requireApiKey(request({ "x-api-key": "dev-bank-api-key" }))).not.toThrow();
  });

  it("throws InvalidApiKeyError when the header is missing", () => {
    expect(() => requireApiKey(request())).toThrow(InvalidApiKeyError);
  });

  it("throws InvalidApiKeyError for a wrong key of the same length", () => {
    expect(() => requireApiKey(request({ "x-api-key": "dev-bank-api-kez" }))).toThrow(
      InvalidApiKeyError,
    );
  });

  it("throws InvalidApiKeyError for a key of a different length", () => {
    expect(() => requireApiKey(request({ "x-api-key": "short" }))).toThrow(InvalidApiKeyError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/bank && pnpm test src/lib/apiKey.test.ts
```

Expected: FAIL — cannot resolve `./apiKey.js`.

- [ ] **Step 3: Write apiKey.ts**

`apps/bank/src/lib/apiKey.ts`:

```ts
import { timingSafeEqual } from "node:crypto";
import { env } from "../env.js";

export class InvalidApiKeyError extends Error {
  constructor() {
    super("Invalid or missing API key");
    this.name = "InvalidApiKeyError";
  }
}

/**
 * Throws InvalidApiKeyError unless the `X-API-Key` header exactly matches
 * `env.BANK_API_KEY`. The length check happens before `timingSafeEqual` is
 * called — that function throws a RangeError on mismatched buffer lengths
 * rather than returning false, so the length check is load-bearing, not just
 * an optimisation.
 */
export function requireApiKey(request: Request): void {
  const provided = request.headers.get("x-api-key");
  if (!provided) throw new InvalidApiKeyError();

  const expected = Buffer.from(env.BANK_API_KEY);
  const actual = Buffer.from(provided);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new InvalidApiKeyError();
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd apps/bank && pnpm test src/lib/apiKey.test.ts
```

Expected: 4 PASS.

- [ ] **Step 5: Write the failing payments test**

`apps/bank/src/lib/payments.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/index.js";
import { accounts, credentials, transactions } from "../db/schema.js";
import { seed } from "../db/seed.js";
import { processPayment } from "./payments.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bank-pay-"));
  db = createDb(path.join(dir, "test.db"));
  seed(db);
  // seed() issues no credentials (Plan 1 Task 6) — insert one active row for
  // anna's card so payments have something valid to resolve against.
  db.insert(credentials)
    .values({
      id: "cred_active",
      userId: "user_anna",
      cardId: "card_anna",
      credentialId: "dpc_active_1",
      state: "active",
      issuedAt: 1,
      createdAt: 1,
    })
    .run();
  db.insert(credentials)
    .values({
      id: "cred_offered",
      userId: "user_anna",
      cardId: "card_anna",
      credentialId: "dpc_offered_1",
      state: "offered",
      issuedAt: null,
      createdAt: 1,
    })
    .run();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function baseInput(overrides: Partial<Parameters<typeof processPayment>[1]> = {}) {
  return {
    credentialId: "dpc_active_1",
    amountCents: 4_798,
    currency: "EUR",
    merchant: "Demo Shop",
    reference: "Order #1",
    idempotencyKey: "sess_1",
    ...overrides,
  };
}

describe("processPayment", () => {
  it("debits the account and records a transaction", () => {
    const before = db.select().from(accounts).where(eq(accounts.id, "acc_anna")).get();

    const result = processPayment(db, baseInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newBalanceCents).toBe((before?.balanceCents ?? 0) - 4_798);

    const row = db.select().from(transactions).where(eq(transactions.id, result.bankTxId)).get();
    expect(row?.amountCents).toBe(-4_798);
    expect(row?.credentialId).toBe("dpc_active_1");
    expect(row?.idempotencyKey).toBe("sess_1");
    expect(row?.counterparty).toBe("Demo Shop");
  });

  it("rejects an unknown credential without touching the balance", () => {
    const before = db.select().from(accounts).where(eq(accounts.id, "acc_anna")).get();
    const result = processPayment(db, baseInput({ credentialId: "dpc_nope" }));
    expect(result).toEqual({ ok: false, reason: "unknown_credential" });
    const after = db.select().from(accounts).where(eq(accounts.id, "acc_anna")).get();
    expect(after?.balanceCents).toBe(before?.balanceCents);
  });

  it("rejects a credential that is only 'offered', not 'active'", () => {
    const result = processPayment(db, baseInput({ credentialId: "dpc_offered_1" }));
    expect(result).toEqual({ ok: false, reason: "credential_not_active" });
  });

  it("rejects a payment larger than the account balance", () => {
    const result = processPayment(db, baseInput({ amountCents: 999_999_999 }));
    expect(result).toEqual({ ok: false, reason: "insufficient_funds" });
  });

  it("is idempotent — a repeated idempotency key returns the original result without debiting again", () => {
    const first = processPayment(db, baseInput());
    const second = processPayment(db, baseInput());

    expect(second).toEqual(first);
    expect(db.select().from(transactions).all()).toHaveLength(21); // 20 seeded + 1
  });

  it("treats a different idempotency key as a genuinely new payment", () => {
    processPayment(db, baseInput({ idempotencyKey: "sess_1" }));
    processPayment(db, baseInput({ idempotencyKey: "sess_2" }));
    expect(db.select().from(transactions).all()).toHaveLength(22);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

```bash
cd apps/bank && pnpm test src/lib/payments.test.ts
```

Expected: FAIL — cannot resolve `./payments.js`.

- [ ] **Step 7: Write payments.ts**

`apps/bank/src/lib/payments.ts`:

```ts
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { accounts, cards, credentials, transactions } from "../db/schema.js";

export interface ProcessPaymentInput {
  credentialId: string;
  amountCents: number;
  currency: string;
  merchant: string;
  reference: string;
  idempotencyKey: string;
}

export type ProcessPaymentResult =
  | { ok: true; bankTxId: string; newBalanceCents: number }
  | { ok: false; reason: "unknown_credential" | "credential_not_active" | "insufficient_funds" };

/**
 * The merchant→bank debit (spec 6.2 steps 8–9). Checked in order: an existing
 * idempotency_key short-circuits everything below it, so a repeat request
 * with the same key never re-evaluates credential state or balance — it just
 * replays the original result.
 */
export function processPayment(
  db: Db,
  input: ProcessPaymentInput,
  now: number = Date.now(),
): ProcessPaymentResult {
  const existing = db
    .select()
    .from(transactions)
    .where(eq(transactions.idempotencyKey, input.idempotencyKey))
    .get();
  if (existing) {
    const account = db.select().from(accounts).where(eq(accounts.id, existing.accountId)).get();
    return { ok: true, bankTxId: existing.id, newBalanceCents: account?.balanceCents ?? 0 };
  }

  const credential = db
    .select()
    .from(credentials)
    .where(eq(credentials.credentialId, input.credentialId))
    .get();
  if (!credential) return { ok: false, reason: "unknown_credential" };
  if (credential.state !== "active") return { ok: false, reason: "credential_not_active" };

  const card = db.select().from(cards).where(eq(cards.id, credential.cardId)).get();
  if (!card) return { ok: false, reason: "unknown_credential" };

  const account = db.select().from(accounts).where(eq(accounts.id, card.accountId)).get();
  if (!account) return { ok: false, reason: "unknown_credential" };

  if (account.balanceCents < input.amountCents) return { ok: false, reason: "insufficient_funds" };

  const bankTxId = `tx_${randomUUID()}`;
  const newBalanceCents = account.balanceCents - input.amountCents;

  try {
    return db.transaction((tx) => {
      tx.update(accounts)
        .set({ balanceCents: newBalanceCents })
        .where(eq(accounts.id, account.id))
        .run();
      tx.insert(transactions)
        .values({
          id: bankTxId,
          accountId: account.id,
          amountCents: -input.amountCents,
          currency: input.currency,
          counterparty: input.merchant,
          reference: input.reference,
          bookedAt: now,
          credentialId: input.credentialId,
          idempotencyKey: input.idempotencyKey,
        })
        .run();
      return { ok: true, bankTxId, newBalanceCents } as const;
    });
  } catch (error) {
    // A concurrent request with the same idempotency key won the race between
    // our SELECT above and this INSERT — the UNIQUE constraint on
    // idempotency_key caught it. Not separately exercised by a test: a
    // single-threaded vitest run cannot produce a genuine concurrent race,
    // only the sequential case above (which the top-of-function check
    // already covers). Re-fetch and return the winner's result rather than
    // throwing, so this path is still idempotent under real concurrency.
    const raced = db
      .select()
      .from(transactions)
      .where(eq(transactions.idempotencyKey, input.idempotencyKey))
      .get();
    if (raced) {
      const racedAccount = db.select().from(accounts).where(eq(accounts.id, raced.accountId)).get();
      return { ok: true, bankTxId: raced.id, newBalanceCents: racedAccount?.balanceCents ?? 0 };
    }
    throw error;
  }
}
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
cd apps/bank && pnpm test src/lib/payments.test.ts
```

Expected: 6 PASS.

- [ ] **Step 9: Write the route**

`apps/bank/src/app/api/payments/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/index.js";
import { InvalidApiKeyError, requireApiKey } from "@/lib/apiKey.js";
import { processPayment } from "@/lib/payments.js";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  credential_id: z.string().min(1),
  amount_cents: z.number().int().positive(),
  currency: z.string().length(3),
  merchant: z.string().min(1),
  reference: z.string().min(1),
  idempotency_key: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    requireApiKey(request);
  } catch (error) {
    if (error instanceof InvalidApiKeyError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    throw error;
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = processPayment(getDb(), {
    credentialId: parsed.data.credential_id,
    amountCents: parsed.data.amount_cents,
    currency: parsed.data.currency,
    merchant: parsed.data.merchant,
    reference: parsed.data.reference,
    idempotencyKey: parsed.data.idempotency_key,
  });

  if (!result.ok) {
    const status = result.reason === "insufficient_funds" ? 402 : 404;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json({ bank_tx_id: result.bankTxId, new_balance_cents: result.newBalanceCents });
}
```

`unknown_credential` and `credential_not_active` both return `404` (different
`error` bodies) — the merchant maps both to the same user-facing message per
spec §6.3 ("This card is no longer valid"), and there is no browser client
here whose existence-leak this would matter to (this is a server-to-server
call authenticated by a shared secret, not a public endpoint).

- [ ] **Step 10: Verify the rejection paths over HTTP**

These need no active credential, so they run against the app as seeded:

```bash
cd apps/bank && pnpm seed && pnpm dev &
sleep 12
echo "--- missing API key ---"
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3001/api/payments \
  -H 'content-type: application/json' -d '{}'
echo "--- wrong API key ---"
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3001/api/payments \
  -H 'content-type: application/json' -H 'x-api-key: wrong' -d '{}'
echo "--- correct key, malformed body ---"
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3001/api/payments \
  -H 'content-type: application/json' -H 'x-api-key: dev-bank-api-key' -d '{}'
echo "--- correct key, unknown credential ---"
curl -sS -X POST http://localhost:3001/api/payments \
  -H 'content-type: application/json' -H 'x-api-key: dev-bank-api-key' \
  -d '{"credential_id":"dpc_nope","amount_cents":100,"currency":"EUR","merchant":"Demo Shop","reference":"Order #1","idempotency_key":"sess_x"}'
kill %1
```

Expected: `401`, `401`, `400`, then `{"error":"unknown_credential"}` with a
`404`.

- [ ] **Step 11: Verify the happy path over HTTP with a synthetic active credential**

The seed data ships no `active` credential (Plan 1's issuance milestone needs a
real wallet, which this environment may not have). Insert one directly to
exercise the real HTTP endpoint end to end without needing a phone — this is
exactly what Task 9's manual walkthrough replaces once a real device is
available:

```bash
cd apps/bank
cat > scratch.ts <<'TS'
import { createDb } from "./src/db/index.js";
import { credentials } from "./src/db/schema.js";
const db = createDb(process.env.DATABASE_PATH ?? "./data/bank.db", false);
db.insert(credentials).values({
  id: "cred_manual_test", userId: "user_anna", cardId: "card_anna",
  credentialId: "dpc_manual_test", state: "active", issuedAt: Date.now(), createdAt: Date.now(),
}).run();
console.log("inserted a synthetic active credential: dpc_manual_test");
TS
pnpm exec tsx --env-file-if-exists=.env.local scratch.ts
rm -f scratch.ts

pnpm dev &
sleep 12
curl -sS -X POST http://localhost:3001/api/payments \
  -H 'content-type: application/json' -H 'x-api-key: dev-bank-api-key' \
  -d '{"credential_id":"dpc_manual_test","amount_cents":4798,"currency":"EUR","merchant":"Demo Shop","reference":"Order #1","idempotency_key":"sess_manual_test"}'
echo
echo "--- repeating the same idempotency_key does not debit twice ---"
curl -sS -X POST http://localhost:3001/api/payments \
  -H 'content-type: application/json' -H 'x-api-key: dev-bank-api-key' \
  -d '{"credential_id":"dpc_manual_test","amount_cents":4798,"currency":"EUR","merchant":"Demo Shop","reference":"Order #1","idempotency_key":"sess_manual_test"}'
kill %1
pnpm seed  # reset the dev database back to a clean demo state
```

Expected: the first call returns `{"bank_tx_id":"tx_...","new_balance_cents":343914}`
(anna's seeded `348712` minus `4798`); the second call, same idempotency key,
returns the identical `bank_tx_id` and `new_balance_cents` — proving no second
debit occurred. Re-seeding at the end returns the demo database to a clean
state for later tasks.

- [ ] **Step 12: Typecheck and commit**

```bash
cd apps/bank && pnpm typecheck && pnpm test
cd /Users/senexi/dev/eudiw/payment-banking-demo
git add apps/bank
git commit -m "feat(bank): add merchant settlement endpoint POST /api/payments"
```

---

### Task 8: The settle gate — verification polling and the bank debit

This is the task that closes the loop. Implements spec §6.2 steps 7–10 and the
failure mapping in §6.3.

**Files:**
- Create: `apps/merchant/src/lib/bank.ts`
- Create: `apps/merchant/src/lib/checks.ts`
- Modify: `apps/merchant/src/lib/payment-sessions.ts` (add `refreshPaymentSessionState`)
- Modify: `apps/merchant/src/app/api/payment-sessions/[id]/route.ts` (poll + settle)
- Test: `apps/merchant/src/lib/checks.test.ts`
- Test: `apps/merchant/src/lib/settle.test.ts`

**Interfaces:**
- Consumes: `getPaymentSessionStatus`, `startPaymentSession` (Task 6);
  `FoundryClient.getVerificationStatus` (Plan 1 Task 3); `processPayment`'s
  HTTP surface from Task 7 (called over the network, not imported).
- Produces:
  - `passedTransactionDataBinding(checks: unknown): boolean` — true only if a
    check named `transaction_data_binding` is present **and** `passed === true`
  - `extractCredentialId(claims: unknown): string | null`
  - `BankPayInput = { credentialId: string; amountCents: number; currency: string; merchant: string; reference: string; idempotencyKey: string }`
  - `BankPayResult = { ok: true; bankTxId: string } | { ok: false; reason: "insufficient_funds" | "credential_invalid" | "bank_unreachable" }`
  - `BankClient` with `pay(input: BankPayInput): Promise<BankPayResult>`;
    `getBankClient(): BankClient` — memoized, configured from env
  - `RefreshResult = { ok: true; status: PaymentSessionStatusDto } | { ok: false; reason: "not_found" }`
  - `refreshPaymentSessionState(db, foundry, bank, sessionId, now?): Promise<RefreshResult>`

- [ ] **Step 1: Write the failing checks test**

`apps/merchant/src/lib/checks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { extractCredentialId, passedTransactionDataBinding } from "./checks.js";

describe("passedTransactionDataBinding", () => {
  it("is true when the named check is present and passed", () => {
    expect(
      passedTransactionDataBinding([
        { check: "dcql_match", passed: true },
        { check: "transaction_data_binding", passed: true },
      ]),
    ).toBe(true);
  });

  it("is false when the named check failed", () => {
    expect(
      passedTransactionDataBinding([
        { check: "dcql_match", passed: true },
        { check: "transaction_data_binding", passed: false },
      ]),
    ).toBe(false);
  });

  it("is false when the check is absent entirely — the whole point of the gate", () => {
    // A foundry that silently stopped enforcing amount binding would report
    // every other check as passing. Absence must never read as success.
    expect(passedTransactionDataBinding([{ check: "dcql_match", passed: true }])).toBe(false);
  });

  it("is false for an empty list, null, or a non-array", () => {
    expect(passedTransactionDataBinding([])).toBe(false);
    expect(passedTransactionDataBinding(null)).toBe(false);
    expect(passedTransactionDataBinding("nope")).toBe(false);
    expect(passedTransactionDataBinding({ check: "transaction_data_binding" })).toBe(false);
  });
});

describe("extractCredentialId", () => {
  it("reads a credential_id nested under the DCQL query id", () => {
    expect(extractCredentialId({ card: { credential_id: "dpc_abc", network: "VISA" } })).toBe(
      "dpc_abc",
    );
  });

  it("reads a flat credential_id", () => {
    expect(extractCredentialId({ credential_id: "dpc_abc" })).toBe("dpc_abc");
  });

  it("returns null when no credential_id is present", () => {
    expect(extractCredentialId({ card: { network: "VISA" } })).toBeNull();
    expect(extractCredentialId({})).toBeNull();
    expect(extractCredentialId(null)).toBeNull();
  });

  it("returns null for a non-string credential_id rather than coercing", () => {
    expect(extractCredentialId({ credential_id: 42 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/merchant && pnpm test src/lib/checks.test.ts
```

Expected: FAIL — cannot resolve `./checks.js`.

- [ ] **Step 3: Write checks.ts**

`apps/merchant/src/lib/checks.ts`:

```ts
/** The check name foundry reports for amount binding (spec 6.2 step 8). */
const BINDING_CHECK = "transaction_data_binding";

/**
 * True only if foundry explicitly reported `transaction_data_binding` as
 * passed. Absence reads as failure, deliberately: the entire value of
 * transaction_data is lost if the merchant settles without confirming this
 * specific check, so a foundry that stopped reporting it must fail closed.
 */
export function passedTransactionDataBinding(checks: unknown): boolean {
  if (!Array.isArray(checks)) return false;
  return checks.some(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as { check?: unknown }).check === BINDING_CHECK &&
      (entry as { passed?: unknown }).passed === true,
  );
}

/**
 * Pulls `credential_id` out of foundry's disclosed claims. Handles both a
 * shape keyed by the DCQL query id (`{ card: { credential_id } }`) and a flat
 * one, because the exact nesting is the one part of foundry's verification
 * response this project has not yet observed against a real presentation —
 * issuance was confirmed in Plan 1 Task 1, verification claims were not.
 * Step 11 of this task pins down which shape is real; once observed, delete
 * the branch that does not occur and tighten this function.
 */
export function extractCredentialId(claims: unknown): string | null {
  if (typeof claims !== "object" || claims === null) return null;

  const flat = (claims as { credential_id?: unknown }).credential_id;
  if (typeof flat === "string") return flat;

  const nested = (claims as { card?: unknown }).card;
  if (typeof nested === "object" && nested !== null) {
    const value = (nested as { credential_id?: unknown }).credential_id;
    if (typeof value === "string") return value;
  }

  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd apps/merchant && pnpm test src/lib/checks.test.ts
```

Expected: 8 PASS.

- [ ] **Step 5: Write the bank client**

`apps/merchant/src/lib/bank.ts` — the merchant's only outbound call to another
service. Note it maps the bank's HTTP status codes back into the same reason
vocabulary the failure table in spec §6.3 uses:

```ts
import { env } from "../env.js";

export interface BankPayInput {
  credentialId: string;
  amountCents: number;
  currency: string;
  merchant: string;
  reference: string;
  idempotencyKey: string;
}

export type BankPayResult =
  | { ok: true; bankTxId: string }
  | { ok: false; reason: "insufficient_funds" | "credential_invalid" | "bank_unreachable" };

export interface BankClientOptions {
  baseUrl: string;
  apiKey: string;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export class BankClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: BankClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async pay(input: BankPayInput): Promise<BankPayResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/payments`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": this.apiKey },
        body: JSON.stringify({
          credential_id: input.credentialId,
          amount_cents: input.amountCents,
          currency: input.currency,
          merchant: input.merchant,
          reference: input.reference,
          idempotency_key: input.idempotencyKey,
        }),
        cache: "no-store",
      });
    } catch {
      // Network-level failure: the bank was never reached, so nothing was
      // debited. Spec 6.3's honest hard case.
      return { ok: false, reason: "bank_unreachable" };
    }

    if (response.ok) {
      const body = (await response.json()) as { bank_tx_id?: unknown };
      if (typeof body.bank_tx_id !== "string") return { ok: false, reason: "bank_unreachable" };
      return { ok: true, bankTxId: body.bank_tx_id };
    }

    if (response.status === 402) return { ok: false, reason: "insufficient_funds" };
    if (response.status === 404) return { ok: false, reason: "credential_invalid" };
    // 401 (bad shared secret) and 5xx are both operator problems, not user
    // problems — surfaced the same way, since the user can only retry.
    return { ok: false, reason: "bank_unreachable" };
  }
}

let instance: BankClient | null = null;

export function getBankClient(): BankClient {
  instance ??= new BankClient({ baseUrl: env.BANK_API_URL, apiKey: env.BANK_API_KEY });
  return instance;
}
```

- [ ] **Step 6: Write the failing settle test**

`apps/merchant/src/lib/settle.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FoundryClient } from "@demo/foundry-client";
import { createDb, type Db } from "../db/index.js";
import { orders, paymentSessions } from "../db/schema.js";
import { BankClient } from "./bank.js";
import { refreshPaymentSessionState, startPaymentSession } from "./payment-sessions.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "merchant-settle-"));
  db = createDb(path.join(dir, "test.db"));
  db.insert(orders)
    .values({
      id: "ord_1",
      totalCents: 4_798,
      currency: "EUR",
      customerName: "Ada",
      customerEmail: "ada@example.com",
      status: "pending",
      createdAt: 1,
    })
    .run();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function stubFoundry(body: unknown, status = 200): FoundryClient {
  const fetchImpl = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
  return new FoundryClient({ adminUrl: "http://f:9000", adminKey: "k", fetchImpl });
}

/** foundry's create-verification response, used to seed a session. */
const createOk = {
  verification_id: "ver_1",
  openid4vp_uri: "openid4vp://?x=1",
  request_uri: "https://f/req/1",
};

function verdict(overrides: Record<string, unknown> = {}) {
  return {
    id: "ver_1",
    state: "verified",
    created_at: 1,
    result: {
      verified: true,
      checks: [
        { check: "sd_jwt_vc_signature_and_kb_jwt", passed: true },
        { check: "dcql_match", passed: true },
        { check: "transaction_data_binding", passed: true },
      ],
      claims: { card: { credential_id: "dpc_abc", network: "VISA" } },
    },
    ...overrides,
  };
}

function stubBank(result: Awaited<ReturnType<BankClient["pay"]>>, spy?: (input: unknown) => void) {
  return {
    pay: vi.fn(async (input: unknown) => {
      spy?.(input);
      return result;
    }),
  } as unknown as BankClient;
}

async function seedSession(): Promise<string> {
  const started = await startPaymentSession(
    db,
    stubFoundry(createOk),
    "ord_1",
    "Demo Shop",
  );
  if (!started.ok) throw new Error("setup failed");
  return started.sessionId;
}

describe("refreshPaymentSessionState — verification phase", () => {
  it("stays pending while foundry is still waiting for the wallet", async () => {
    const sessionId = await seedSession();
    const result = await refreshPaymentSessionState(
      db,
      stubFoundry({ id: "ver_1", state: "pending", created_at: 1 }),
      stubBank({ ok: true, bankTxId: "tx_1" }),
      sessionId,
    );
    expect(result).toMatchObject({ ok: true, status: { state: "pending" } });
  });

  it("fails the session when foundry reports the presentation failed", async () => {
    const sessionId = await seedSession();
    const result = await refreshPaymentSessionState(
      db,
      stubFoundry({ id: "ver_1", state: "failed", created_at: 1, result: null }),
      stubBank({ ok: true, bankTxId: "tx_1" }),
      sessionId,
    );
    expect(result).toMatchObject({
      ok: true,
      status: { state: "failed", failureReason: "verification_failed" },
    });
  });

  it("fails the session when verified is false even if state says verified", async () => {
    const sessionId = await seedSession();
    const result = await refreshPaymentSessionState(
      db,
      stubFoundry(verdict({ result: { verified: false, checks: [], claims: {} } })),
      stubBank({ ok: true, bankTxId: "tx_1" }),
      sessionId,
    );
    expect(result).toMatchObject({
      ok: true,
      status: { state: "failed", failureReason: "verification_failed" },
    });
  });

  it("refuses to settle when transaction_data_binding did not pass", async () => {
    const sessionId = await seedSession();
    const bank = stubBank({ ok: true, bankTxId: "tx_1" });
    const result = await refreshPaymentSessionState(
      db,
      stubFoundry(
        verdict({
          result: {
            verified: true,
            checks: [
              { check: "dcql_match", passed: true },
              { check: "transaction_data_binding", passed: false },
            ],
            claims: { card: { credential_id: "dpc_abc" } },
          },
        }),
      ),
      bank,
      sessionId,
    );

    expect(result).toMatchObject({
      ok: true,
      status: { state: "failed", failureReason: "transaction_data_binding_failed" },
    });
    // The gate must stop the money moving, not merely label the session.
    expect(bank.pay).not.toHaveBeenCalled();
  });

  it("fails when the verdict carries no credential_id to settle against", async () => {
    const sessionId = await seedSession();
    const bank = stubBank({ ok: true, bankTxId: "tx_1" });
    const result = await refreshPaymentSessionState(
      db,
      stubFoundry(
        verdict({
          result: {
            verified: true,
            checks: [{ check: "transaction_data_binding", passed: true }],
            claims: { card: { network: "VISA" } },
          },
        }),
      ),
      bank,
      sessionId,
    );
    expect(result).toMatchObject({
      ok: true,
      status: { state: "failed", failureReason: "verification_failed" },
    });
    expect(bank.pay).not.toHaveBeenCalled();
  });
});

describe("refreshPaymentSessionState — settlement phase", () => {
  it("debits the bank and completes the session and order", async () => {
    const sessionId = await seedSession();
    let sent: unknown = null;
    const bank = stubBank({ ok: true, bankTxId: "tx_bank_1" }, (input) => {
      sent = input;
    });

    const result = await refreshPaymentSessionState(db, stubFoundry(verdict()), bank, sessionId);

    expect(result).toMatchObject({ ok: true, status: { state: "completed" } });

    const session = db.select().from(paymentSessions).where(eq(paymentSessions.id, sessionId)).get();
    expect(session?.state).toBe("completed");
    expect(session?.bankTxId).toBe("tx_bank_1");

    const order = db.select().from(orders).where(eq(orders.id, "ord_1")).get();
    expect(order?.status).toBe("paid");

    // The amount is the order's server-side total, and the idempotency key is
    // the session id (spec 6.2).
    expect(sent).toMatchObject({
      credentialId: "dpc_abc",
      amountCents: 4_798,
      currency: "EUR",
      idempotencyKey: sessionId,
    });
  });

  it("maps insufficient funds to a failed session and leaves the order pending", async () => {
    const sessionId = await seedSession();
    const result = await refreshPaymentSessionState(
      db,
      stubFoundry(verdict()),
      stubBank({ ok: false, reason: "insufficient_funds" }),
      sessionId,
    );

    expect(result).toMatchObject({
      ok: true,
      status: { state: "failed", failureReason: "insufficient_funds" },
    });
    const order = db.select().from(orders).where(eq(orders.id, "ord_1")).get();
    expect(order?.status).toBe("pending");
  });

  it("maps an unreachable bank to a failed session, order still pending and retryable", async () => {
    const sessionId = await seedSession();
    const result = await refreshPaymentSessionState(
      db,
      stubFoundry(verdict()),
      stubBank({ ok: false, reason: "bank_unreachable" }),
      sessionId,
    );

    expect(result).toMatchObject({
      ok: true,
      status: { state: "failed", failureReason: "bank_unreachable" },
    });
    const order = db.select().from(orders).where(eq(orders.id, "ord_1")).get();
    expect(order?.status).toBe("pending");
  });

  it("does not call foundry or the bank again once completed", async () => {
    const sessionId = await seedSession();
    const bank = stubBank({ ok: true, bankTxId: "tx_bank_1" });
    await refreshPaymentSessionState(db, stubFoundry(verdict()), bank, sessionId);

    const callsAfterFirst = (bank.pay as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    const second = await refreshPaymentSessionState(db, stubFoundry(verdict()), bank, sessionId);

    expect(second).toMatchObject({ ok: true, status: { state: "completed" } });
    expect((bank.pay as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(
      callsAfterFirst,
    );
  });

  it("resumes a session left in 'verified' by an interrupted earlier poll", async () => {
    const sessionId = await seedSession();
    // Simulate a process that passed the gate and stored the claims, then
    // stopped before calling the bank.
    db.update(paymentSessions)
      .set({
        state: "verified",
        disclosedClaimsJson: JSON.stringify({ card: { credential_id: "dpc_abc" } }),
      })
      .where(eq(paymentSessions.id, sessionId))
      .run();

    const bank = stubBank({ ok: true, bankTxId: "tx_resumed" });
    // foundry deliberately still reports 'pending' here: if the resume path
    // re-polled instead of reading the stored claims, this would stall rather
    // than settle, so the assertion below pins that it does not re-poll.
    const result = await refreshPaymentSessionState(
      db,
      stubFoundry({ id: "ver_1", state: "pending", created_at: 1 }),
      bank,
      sessionId,
    );

    expect(result).toMatchObject({ ok: true, status: { state: "completed" } });
    expect(bank.pay).toHaveBeenCalledTimes(1);
  });

  it("returns not_found for an unknown session id", async () => {
    const result = await refreshPaymentSessionState(
      db,
      stubFoundry(verdict()),
      stubBank({ ok: true, bankTxId: "tx_1" }),
      "sess_nope",
    );
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

```bash
cd apps/merchant && pnpm test src/lib/settle.test.ts
```

Expected: FAIL — `refreshPaymentSessionState` is not exported.

- [ ] **Step 8: Add refreshPaymentSessionState to payment-sessions.ts**

Append to `apps/merchant/src/lib/payment-sessions.ts` (and add the imports
shown at the top):

```ts
import type { BankClient } from "./bank.js";
import { extractCredentialId, passedTransactionDataBinding } from "./checks.js";
```

```ts
export type RefreshResult =
  | { ok: true; status: PaymentSessionStatusDto }
  | { ok: false; reason: "not_found" };

function fail(db: Db, sessionId: string, reason: string, checksJson?: string): void {
  db.update(paymentSessions)
    .set({ state: "failed", failureReason: reason, ...(checksJson ? { checksJson } : {}) })
    .where(eq(paymentSessions.id, sessionId))
    .run();
}

/**
 * Spec 6.2 steps 7–10. Polled by the browser roughly every 2s.
 *
 * Ordering is the whole point of this function: foundry's verdict is consulted
 * first, the settle gate is applied second, and only then is the bank called.
 * A session that has already reached a terminal state does no further work, so
 * polling after completion is free and cannot double-charge.
 *
 * The state chain is spec 5.2's, walked in full:
 * `pending` → `verified` (gate passed, nothing sent) → `settling` (debit may
 * be in flight) → `completed`, with `failed` reachable throughout. Collapsing
 * `verified` into `settling` would make "the wallet proved the card" and "the
 * money may already have moved" indistinguishable after a crash.
 */
export async function refreshPaymentSessionState(
  db: Db,
  foundry: FoundryClient,
  bank: BankClient,
  sessionId: string,
  now: number = Date.now(),
): Promise<RefreshResult> {
  const row = db.select().from(paymentSessions).where(eq(paymentSessions.id, sessionId)).get();
  if (!row) return { ok: false, reason: "not_found" };

  // Terminal states need no further foundry or bank traffic.
  if (row.state === "completed" || row.state === "failed") {
    return { ok: true, status: getPaymentSessionStatus(db, sessionId)! };
  }

  let credentialId: string | null = null;

  if (row.state === "pending") {
    if (!row.foundryVerificationId) {
      fail(db, sessionId, "verification_failed");
      return { ok: true, status: getPaymentSessionStatus(db, sessionId)! };
    }

    let verdict;
    try {
      verdict = await foundry.getVerificationStatus(row.foundryVerificationId);
    } catch {
      // Transient: leave the session pending so a later poll can recover.
      // Only the client's consecutive-failure counter decides when to give up.
      return { ok: true, status: getPaymentSessionStatus(db, sessionId)! };
    }

    if (verdict.state === "pending") {
      return { ok: true, status: getPaymentSessionStatus(db, sessionId)! };
    }

    const checksJson = JSON.stringify(verdict.result?.checks ?? []);

    if (verdict.state === "failed" || verdict.result?.verified !== true) {
      fail(db, sessionId, "verification_failed", checksJson);
      return { ok: true, status: getPaymentSessionStatus(db, sessionId)! };
    }

    // The gate (spec 6.2 step 8): verified === true AND binding passed.
    if (!passedTransactionDataBinding(verdict.result.checks)) {
      fail(db, sessionId, "transaction_data_binding_failed", checksJson);
      return { ok: true, status: getPaymentSessionStatus(db, sessionId)! };
    }

    credentialId = extractCredentialId(verdict.result.claims);
    if (!credentialId) {
      fail(db, sessionId, "verification_failed", checksJson);
      return { ok: true, status: getPaymentSessionStatus(db, sessionId)! };
    }

    // 'verified' means the gate passed and nothing has been sent to the bank
    // yet. It is written as its own state, not folded into 'settling', so a
    // process that dies here is distinguishable from one that died after the
    // debit was already in flight (spec 5.2's four-state chain).
    db.update(paymentSessions)
      .set({
        state: "verified",
        checksJson,
        disclosedClaimsJson: JSON.stringify(verdict.result.claims ?? null),
      })
      .where(eq(paymentSessions.id, sessionId))
      .run();
  } else {
    // Already 'verified' or 'settling' from an earlier poll that stopped
    // between the gate and the debit — re-read the stored claims rather than
    // re-polling foundry, then retry the debit. Safe because the bank keys on
    // idempotency_key = sessionId, so a debit that did land is replayed rather
    // than repeated.
    credentialId = extractCredentialId(
      row.disclosedClaimsJson ? JSON.parse(row.disclosedClaimsJson) : null,
    );
    if (!credentialId) {
      fail(db, sessionId, "verification_failed");
      return { ok: true, status: getPaymentSessionStatus(db, sessionId)! };
    }
  }

  const order = db.select().from(orders).where(eq(orders.id, row.orderId)).get();
  if (!order) {
    fail(db, sessionId, "verification_failed");
    return { ok: true, status: getPaymentSessionStatus(db, sessionId)! };
  }

  // 'settling' is written immediately before the bank call and never after, so
  // the row means exactly "a debit for this session may be in flight".
  db.update(paymentSessions)
    .set({ state: "settling" })
    .where(eq(paymentSessions.id, sessionId))
    .run();

  const payment = await bank.pay({
    credentialId,
    amountCents: order.totalCents,
    currency: order.currency,
    merchant: MERCHANT_REFERENCE_NAME,
    reference: `Order ${order.id}`,
    idempotencyKey: sessionId,
  });

  if (!payment.ok) {
    // The order stays `pending` so the user can retry (spec 6.3) — only the
    // session is terminal.
    fail(db, sessionId, payment.reason);
    return { ok: true, status: getPaymentSessionStatus(db, sessionId)! };
  }

  db.update(paymentSessions)
    .set({ state: "completed", bankTxId: payment.bankTxId })
    .where(eq(paymentSessions.id, sessionId))
    .run();
  db.update(orders).set({ status: "paid" }).where(eq(orders.id, order.id)).run();

  return { ok: true, status: getPaymentSessionStatus(db, sessionId)! };
}
```

Add near the top of the file, next to the other imports:

```ts
import { env } from "../env.js";

/** The name shown on the bank statement. Same value the wallet authorized. */
const MERCHANT_REFERENCE_NAME = env.MERCHANT_NAME;
```

The `now` parameter is currently unused by this function but kept in the
signature for symmetry with `startPaymentSession` and because a future
expiry check (spec §6.3's 10-minute cap, presently enforced client-side by
`useStatusPoll`) belongs here. If your linter objects to an unused parameter,
prefix it `_now` rather than deleting it.

- [ ] **Step 9: Run the tests to verify they pass**

```bash
cd apps/merchant && pnpm test src/lib/settle.test.ts
```

Expected: 11 PASS.

- [ ] **Step 10: Wire the polled route to actually poll and settle**

Replace `apps/merchant/src/app/api/payment-sessions/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import { getBankClient } from "@/lib/bank.js";
import { getFoundry } from "@/lib/foundry.js";
import { refreshPaymentSessionState } from "@/lib/payment-sessions.js";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const result = await refreshPaymentSessionState(
    getDb(),
    getFoundry(),
    getBankClient(),
    id,
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 404 });
  }
  return NextResponse.json(result.status);
}
```

The response contract is unchanged from Task 6 — still only
`{state, checks?, failureReason?}`, never the presentation URI and never the
disclosed claims (spec §7.2).

- [ ] **Step 11: Confirm the real claims shape against a live presentation**

This is the one shape `extractCredentialId` guesses at. It cannot be confirmed
without a real wallet presenting a real credential, so do it as part of the
first end-to-end run (Task 11's walkthrough) and come back here:

```bash
# With a session that has just been presented to by a real wallet:
cd apps/merchant
cat > scratch.ts <<'TS'
import { createDb } from "./src/db/index.js";
import { paymentSessions } from "./src/db/schema.js";
const db = createDb(process.env.DATABASE_PATH ?? "./data/merchant.db", false);
for (const row of db.select().from(paymentSessions).all()) {
  console.log(row.id, row.state, row.disclosedClaimsJson);
}
TS
pnpm exec tsx --env-file-if-exists=.env.local scratch.ts
rm -f scratch.ts
```

If the printed claims are nested (`{"card":{"credential_id":...}}`), delete the
flat branch in `extractCredentialId`; if flat, delete the nested branch. Either
way update `checks.test.ts` to drop the test for the shape that does not occur,
and replace this step's note in the docstring with the observed shape. Leaving
both branches in place is acceptable if you cannot run a real wallet — it is
defensive, not wrong — but say so in the commit message rather than silently
leaving a guess in the code.

- [ ] **Step 12: Typecheck and commit**

```bash
cd apps/merchant && pnpm typecheck && pnpm test
cd /Users/senexi/dev/eudiw/payment-banking-demo
git add apps/merchant
git commit -m "feat(merchant): add settle gate, verification polling, and bank debit"
```

---

### Task 9: The payment screen — `/pay/{sessionId}`

This is the folded-in EudiPay screen (spec §9.5). The reference implementation
was a separate Vite app in a fullscreen iframe talking over `postMessage`;
here it is one route in this app, and all three message types collapse into
local state.

**Files:**
- Create: `apps/merchant/src/components/EudiPayLogo.tsx`
- Create: `apps/merchant/src/components/PaymentScreen.tsx`
- Create: `apps/merchant/src/app/pay/[sessionId]/page.tsx`
- Create: `apps/merchant/src/app/api/payment-sessions/[id]/cancel/route.ts`
- Modify: `apps/merchant/src/app/globals.css` (append payment-overlay classes)

**Interfaces:**
- Consumes: `GET /api/payment-sessions/{id}` (Task 8, the polled endpoint);
  `POST /api/payment-sessions` (Task 6, for Try Again); `QrCanvas`,
  `useStatusPoll`, `useIsTouch` from `@demo/ui` (Plan 1 Task 4).
- Produces:
  - `<EudiPayLogo className? />` — inline SVG, no asset file
  - `<PaymentScreen sessionId orderId amountCents merchantName openid4vpUri />`
  - `POST /api/payment-sessions/{id}/cancel` → `{ ok: true }`; marks the
    session `failed` with reason `cancelled` and the order `cancelled`

The route is a **server component** that reads `openid4vpUri` from its own
database and passes it as a prop (spec §7.2 — the polled endpoint must never
carry the URI, so a bystander who learns a session id cannot hijack the
request).

- [ ] **Step 1: Append the payment-overlay classes to globals.css**

The literal hex values below are the visual contract from spec §9.5 and are
deliberately **not** theme tokens — this screen is EudiPay-branded, not
merchant-branded, and must not drift when the merchant palette changes.

Append to `apps/merchant/src/app/globals.css`:

```css
@keyframes eudipay-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes eudipay-slide-up {
  from { transform: translateY(16px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

@keyframes eudipay-spin {
  to { transform: rotate(360deg); }
}

.eudipay-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100dvh;
  padding: 1.5rem;
  background: rgb(17 24 39 / 0.5);
  backdrop-filter: blur(4px);
  animation: eudipay-fade-in 0.3s ease;
  font-family: "Inter", system-ui, -apple-system, sans-serif;
}

.eudipay-card {
  width: 100%;
  max-width: 400px;
  padding: 2.5rem;
  background: #ffffff;
  border-radius: 1.5rem;
  border-top: 6px solid #004dd7;
  box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.25);
  text-align: center;
  color: #1f2937;
  animation: eudipay-slide-up 0.4s ease;
}

.eudipay-headline {
  font-size: 1.75rem;
  font-weight: 800;
  color: #004dd7;
}

.eudipay-amount {
  font-size: 1.5rem;
  font-weight: 700;
}

.eudipay-muted {
  color: #4b5563;
}

.eudipay-badge {
  display: inline-block;
  border-radius: 9999px;
  background: #ffefb4;
  padding: 0.25rem 0.75rem;
  font-size: 0.8rem;
  font-weight: 600;
}

.eudipay-qr-frame {
  display: inline-block;
  padding: 1rem;
  background: #ffffff;
  border: 2px solid #ffefb4;
  border-radius: 1rem;
}

.eudipay-button {
  font-size: 0.95rem;
  font-weight: 600;
  border-radius: 0.75rem;
  padding: 0.75rem 1.25rem;
}

.eudipay-button-primary {
  background: #004dd7;
  color: #ffffff;
}

.eudipay-button-secondary {
  background: transparent;
  color: #4b5563;
}

.eudipay-spinner {
  width: 2.5rem;
  height: 2.5rem;
  margin: 0 auto;
  border: 3px solid #ffefb4;
  border-top-color: #004dd7;
  border-radius: 9999px;
  animation: eudipay-spin 1s linear infinite;
}

/* Mobile: slide up from the bottom, top-only rounded corners. */
@media (max-width: 480px) {
  .eudipay-overlay {
    align-items: flex-end;
    padding: 0;
  }

  .eudipay-card {
    max-width: none;
    border-radius: 1.5rem 1.5rem 0 0;
    padding-bottom: calc(2.5rem + env(safe-area-inset-bottom));
  }
}
```

- [ ] **Step 2: Write the logo**

`apps/merchant/src/components/EudiPayLogo.tsx` — the reference used an
`eudi-wallet.svg` asset; this is an inline equivalent so the plan ships no
binary dependency:

```tsx
export function EudiPayLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="6" y="22" width="88" height="58" rx="12" fill="#004DD7" />
      <rect x="6" y="38" width="88" height="12" fill="#003BA8" />
      <circle cx="74" cy="64" r="9" fill="#FFCC00" />
      {/* Twelve stars, the EU mark, arranged on a circle. */}
      {Array.from({ length: 12 }, (_, index) => {
        const angle = (index / 12) * Math.PI * 2 - Math.PI / 2;
        return (
          <circle
            key={index}
            cx={30 + Math.cos(angle) * 11}
            cy={51 + Math.sin(angle) * 11}
            r="1.9"
            fill="#FFCC00"
          />
        );
      })}
    </svg>
  );
}
```

- [ ] **Step 3: Write the cancel route**

`apps/merchant/src/app/api/payment-sessions/[id]/cancel/route.ts`:

```ts
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import { orders, paymentSessions } from "@/db/schema.js";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const db = getDb();

  const session = db.select().from(paymentSessions).where(eq(paymentSessions.id, id)).get();
  if (!session) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Cancelling a session that already completed must not un-charge it.
  if (session.state === "completed") {
    return NextResponse.json({ error: "already_completed" }, { status: 409 });
  }

  db.update(paymentSessions)
    .set({ state: "failed", failureReason: "cancelled" })
    .where(eq(paymentSessions.id, id))
    .run();

  // Unlike every other failure, an explicit cancel is the user saying they do
  // not want this order at all — so the order becomes `cancelled` rather than
  // staying `pending` for retry (spec 5.2).
  db.update(orders).set({ status: "cancelled" }).where(eq(orders.id, session.orderId)).run();

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Write the payment screen**

`apps/merchant/src/components/PaymentScreen.tsx`. The four states map exactly
to spec §9.5's list; `useStatusPoll` supplies the 2s/10min/5-failure policy
from `@demo/ui` so none of it is reimplemented here:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { QrCanvas, useIsTouch, useStatusPoll } from "@demo/ui";
import { formatEuroCents } from "@/lib/format.js";
import { EudiPayLogo } from "./EudiPayLogo.js";

/** EudiPay brand blue — also the QR's dark modules (spec 9.5). */
const BRAND_BLUE = "#004DD7";

export interface PaymentScreenProps {
  sessionId: string;
  orderId: string;
  amountCents: number;
  merchantName: string;
  openid4vpUri: string;
  /** A session that was already terminal when the page rendered. */
  initialState: string;
  initialFailureReason?: string;
}

interface SessionStatus {
  state: string;
  failureReason?: string;
  failedChecks: string[];
}

/** Spec 6.3's failure table, in the user's words rather than the code's. */
const FAILURE_MESSAGE: Record<string, string> = {
  cancelled: "This payment was cancelled.",
  verification_failed: "Your card could not be verified.",
  transaction_data_binding_failed:
    "The amount could not be confirmed against your wallet's approval.",
  insufficient_funds: "Payment was declined by your bank.",
  credential_invalid: "This card is no longer valid.",
  bank_unreachable: "Could not reach your bank. Nothing was charged.",
  foundry_unavailable: "The payment service is unavailable. Please try again.",
};

export function PaymentScreen({
  sessionId,
  orderId,
  amountCents,
  merchantName,
  openid4vpUri,
  initialState,
  initialFailureReason,
}: PaymentScreenProps) {
  const router = useRouter();
  const isTouch = useIsTouch();
  const [redirecting, setRedirecting] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const terminalAtRender = initialState === "completed" || initialState === "failed";

  const fetchOnce = useCallback<() => Promise<SessionStatus>>(async () => {
    const response = await fetch(`/api/payment-sessions/${sessionId}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const body = (await response.json()) as {
      state?: unknown;
      failureReason?: unknown;
      checks?: unknown;
    };
    return {
      state: typeof body.state === "string" ? body.state : "pending",
      failureReason: typeof body.failureReason === "string" ? body.failureReason : undefined,
      // Spec 6.3 requires a failed verification to name the checks that
      // failed, so they are carried through rather than discarded.
      failedChecks: Array.isArray(body.checks)
        ? body.checks.flatMap((entry) =>
            typeof entry === "object" &&
            entry !== null &&
            (entry as { passed?: unknown }).passed === false &&
            typeof (entry as { check?: unknown }).check === "string"
              ? [(entry as { check: string }).check]
              : [],
          )
        : [],
    };
  }, [sessionId]);

  const isTerminal = useCallback(
    (value: SessionStatus) => value.state === "completed" || value.state === "failed",
    [],
  );

  const { value, outcome } = useStatusPoll<SessionStatus>({
    fetchOnce,
    isTerminal,
    enabled: !terminalAtRender,
  });

  const state = value?.state ?? initialState;
  const failureReason = value?.failureReason ?? initialFailureReason;
  const failedChecks = value?.failedChecks ?? [];

  // On a touch device the wallet lives on this same phone, so follow the deep
  // link rather than rendering a QR nobody can scan. Previously this was an
  // EUDIPAY_REDIRECT postMessage to a parent frame; with no parent, this route
  // navigates itself (spec 9.5).
  useEffect(() => {
    if (!isTouch || terminalAtRender || redirecting) return;
    setRedirecting(true);
    window.location.href = openid4vpUri;
  }, [isTouch, terminalAtRender, redirecting, openid4vpUri]);

  useEffect(() => {
    if (state !== "completed") return;
    const timer = setTimeout(() => router.replace(`/success?orderId=${orderId}`), 1500);
    return () => clearTimeout(timer);
  }, [state, router, orderId]);

  async function cancel() {
    await fetch(`/api/payment-sessions/${sessionId}/cancel`, { method: "POST" });
    router.replace("/");
  }

  async function tryAgain() {
    setRetryError(null);
    try {
      // A fresh presentation for the same still-pending order (spec 6.3).
      const response = await fetch("/api/payment-sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      if (!response.ok) {
        setRetryError("Could not start a new payment. Please start over from the shop.");
        return;
      }
      const body = (await response.json()) as { sessionId: string };
      router.replace(`/pay/${body.sessionId}`);
    } catch {
      setRetryError("Could not reach the server. Please try again.");
    }
  }

  const connectionLost = outcome?.status === "failed";
  const expired = outcome?.status === "timeout";
  const showError = state === "failed" || connectionLost || expired;

  const errorMessage = expired
    ? "This payment request expired."
    : connectionLost
      ? "Lost connection to the payment service."
      : (failureReason && FAILURE_MESSAGE[failureReason]) ||
        "The payment could not be completed.";

  return (
    <div className="eudipay-overlay" role="dialog" aria-modal="true" aria-label="EudiPay payment">
      <div className="eudipay-card">
        <EudiPayLogo className="mx-auto h-[100px] w-[100px]" />
        <h1 className="eudipay-headline mt-2">EudiPay</h1>

        <p className="eudipay-amount mt-4">{formatEuroCents(amountCents)}</p>
        <p className="eudipay-muted text-sm">
          {merchantName} · Order {orderId}
        </p>

        {state === "completed" ? (
          <>
            <div className="mt-6 text-5xl" aria-hidden="true">
              🇪🇺
            </div>
            <p className="mt-3 text-lg font-bold" style={{ color: BRAND_BLUE }}>
              Payment Successful
            </p>
          </>
        ) : showError ? (
          <>
            <div className="mt-6 text-5xl" aria-hidden="true">
              ⚠️
            </div>
            <p className="mt-3 text-lg font-bold">Payment failed</p>
            <p className="eudipay-muted mt-1 text-sm">{errorMessage}</p>
            {failedChecks.length > 0 ? (
              <p className="eudipay-muted mt-2 text-xs">
                Failed checks: <span className="font-mono">{failedChecks.join(", ")}</span>
              </p>
            ) : null}
            {retryError ? (
              <p role="alert" className="mt-2 text-sm text-[#b91c1c]">
                {retryError}
              </p>
            ) : null}
            <div className="mt-6 flex flex-col gap-2">
              {failureReason === "cancelled" ? null : (
                <button
                  type="button"
                  onClick={tryAgain}
                  className="eudipay-button eudipay-button-primary"
                >
                  Try Again
                </button>
              )}
              <button
                type="button"
                onClick={() => router.replace("/")}
                className="eudipay-button eudipay-button-secondary"
              >
                Back to shop
              </button>
            </div>
          </>
        ) : redirecting ? (
          <>
            <div className="eudipay-spinner mt-6" />
            <p className="eudipay-muted mt-4 text-sm">Opening your wallet…</p>
            <button
              type="button"
              onClick={cancel}
              className="eudipay-button eudipay-button-secondary mt-4"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <p className="eudipay-badge mt-4">
              {state === "settling" ? "Contacting your bank…" : "Waiting for your wallet"}
            </p>

            <div className="eudipay-qr-frame mt-5">
              <QrCanvas
                value={openid4vpUri}
                size={240}
                darkColor={BRAND_BLUE}
                ariaLabel="QR code for the payment request"
              />
            </div>

            <p className="eudipay-muted mt-4 text-sm">
              Scan this code with your EUDI Wallet app to authorize the payment.
            </p>

            <button
              type="button"
              onClick={cancel}
              className="eudipay-button eudipay-button-secondary mt-5"
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

Note there is deliberately **no countdown timer or progress bar** (spec §9.5) —
the 10-minute cap lives in `useStatusPoll` and surfaces only if it is reached.

- [ ] **Step 5: Write the route**

`apps/merchant/src/app/pay/[sessionId]/page.tsx` — a server component; this is
the one and only place the presentation URI leaves the database:

```tsx
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { PaymentScreen } from "@/components/PaymentScreen.js";
import { getDb } from "@/db/index.js";
import { orders, paymentSessions } from "@/db/schema.js";
import { env } from "@/env.js";

export const dynamic = "force-dynamic";

export default async function PayPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const db = getDb();

  const session = db
    .select()
    .from(paymentSessions)
    .where(eq(paymentSessions.id, sessionId))
    .get();
  if (!session) notFound();

  const order = db.select().from(orders).where(eq(orders.id, session.orderId)).get();
  if (!order) notFound();

  return (
    <PaymentScreen
      sessionId={session.id}
      orderId={order.id}
      amountCents={order.totalCents}
      merchantName={env.MERCHANT_NAME}
      openid4vpUri={session.openid4vpUri ?? session.requestUri ?? ""}
      initialState={session.state}
      initialFailureReason={session.failureReason ?? undefined}
    />
  );
}
```

- [ ] **Step 6: Verify the cancel route over HTTP**

```bash
cd apps/merchant && pnpm dev &
sleep 12

ORDER_ID=$(curl -sS -X POST http://localhost:3000/api/orders \
  -H 'content-type: application/json' \
  -d '{"items":[{"productId":"prod_1","quantity":1}],"customer":{"name":"Ada","email":"ada@example.com"}}' \
  | sed -E 's/.*"orderId":"([^"]+)".*/\1/')
SESSION_ID=$(curl -sS -X POST http://localhost:3000/api/payment-sessions \
  -H 'content-type: application/json' -d "{\"orderId\":\"$ORDER_ID\"}" \
  | sed -E 's/.*"sessionId":"([^"]+)".*/\1/')

echo "--- /pay renders (expect 200) ---"
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:3000/pay/$SESSION_ID

echo "--- an unknown session id is 404 ---"
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:3000/pay/sess_nope

echo "--- cancel ---"
curl -sS -X POST http://localhost:3000/api/payment-sessions/$SESSION_ID/cancel

echo "--- session is now failed/cancelled ---"
curl -sS http://localhost:3000/api/payment-sessions/$SESSION_ID

echo "--- cancelling an unknown session is 404 ---"
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/payment-sessions/sess_nope/cancel
kill %1
```

Expected: `200` for the real session, `404` for the unknown one, `{"ok":true}`
from cancel, then `{"state":"failed","failureReason":"cancelled"}`, and `404`
for cancelling a session that does not exist.

- [ ] **Step 7: Verify the screen in a browser**

```bash
cd apps/merchant && pnpm dev
```

With `foundry` running, add an item to the cart, check out, and land on
`/pay/{sessionId}`. Check against spec §9.5:

1. Full-viewport dark translucent overlay with a blurred backdrop; centered
   white card, max 400px, 6px blue top border, generous padding.
2. Vertical order: logo → "EudiPay" headline → amount and
   "{merchant} · Order {id}" line → light-yellow status badge → 240px QR with
   **blue** modules inside a light-yellow frame → instruction text → Cancel.
3. No countdown timer anywhere.
4. Narrow the window below 480px: the card sticks to the bottom edge with only
   its top corners rounded.
5. Click Cancel: it returns to `/` and the session reads
   `failed`/`cancelled` (verified over HTTP in Step 6).
6. With browser device emulation set to a touch device, reloading `/pay/{id}`
   shows the spinner and attempts to follow the `openid4vp://` deep link
   instead of rendering the QR.

- [ ] **Step 8: Typecheck and commit**

```bash
cd apps/merchant && pnpm typecheck && pnpm test
cd /Users/senexi/dev/eudiw/payment-banking-demo
git add apps/merchant
git commit -m "feat(merchant): add the EudiPay payment screen and cancel endpoint"
```

---

### Task 10: Success screen with real verification details

**Files:**
- Create: `apps/merchant/src/lib/order-view.ts`
- Create: `apps/merchant/src/app/api/orders/[id]/route.ts`
- Create: `apps/merchant/src/components/VerificationDetails.tsx`
- Create: `apps/merchant/src/app/success/page.tsx`
- Modify: `apps/merchant/src/app/globals.css` (append success classes)
- Test: `apps/merchant/src/lib/order-view.test.ts`

**Interfaces:**
- Consumes: `orders`/`paymentSessions` tables (Task 2); `formatEuroCents`
  (Task 3).
- Produces:
  - `OrderViewDto = { id: string; totalCents: number; currency: string; status: OrderStatus; customerName: string; paymentState: PaymentSessionState | null; bankTxId: string | null; checks: CheckView[] }`
  - `CheckView = { check: string; passed: boolean; detail?: string }`
  - `getOrderView(db, orderId): OrderViewDto | null` — joins the order with its
    most recent payment session
  - `<VerificationDetails checks: CheckView[] />` — an expandable `<details>`
    block listing foundry's actual check results

The success screen shows `foundry`'s **real** checks, not a prettified
retelling (spec §5.2) — including `transaction_data_binding`, which is the
whole point of the amount binding.

- [ ] **Step 1: Write the failing order-view test**

`apps/merchant/src/lib/order-view.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/index.js";
import { orders, paymentSessions } from "../db/schema.js";
import { getOrderView } from "./order-view.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "merchant-view-"));
  db = createDb(path.join(dir, "test.db"));
  db.insert(orders)
    .values({
      id: "ord_1",
      totalCents: 4_798,
      currency: "EUR",
      customerName: "Ada",
      customerEmail: "ada@example.com",
      status: "paid",
      createdAt: 1,
    })
    .run();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("getOrderView", () => {
  it("returns null for an unknown order", () => {
    expect(getOrderView(db, "ord_nope")).toBeNull();
  });

  it("returns the order with no payment state when no session exists", () => {
    const view = getOrderView(db, "ord_1");
    expect(view).toMatchObject({
      id: "ord_1",
      totalCents: 4_798,
      status: "paid",
      paymentState: null,
      bankTxId: null,
      checks: [],
    });
  });

  it("surfaces the session's state, bank transaction id, and parsed checks", () => {
    db.insert(paymentSessions)
      .values({
        id: "sess_1",
        orderId: "ord_1",
        state: "completed",
        bankTxId: "tx_bank_1",
        checksJson: JSON.stringify([
          { check: "dcql_match", passed: true },
          { check: "transaction_data_binding", passed: true, detail: "amount matched" },
        ]),
        createdAt: 1,
      })
      .run();

    expect(getOrderView(db, "ord_1")).toMatchObject({
      paymentState: "completed",
      bankTxId: "tx_bank_1",
      checks: [
        { check: "dcql_match", passed: true },
        { check: "transaction_data_binding", passed: true, detail: "amount matched" },
      ],
    });
  });

  it("prefers the newest session when an order was retried", () => {
    db.insert(paymentSessions)
      .values({
        id: "sess_old",
        orderId: "ord_1",
        state: "failed",
        failureReason: "bank_unreachable",
        createdAt: 10,
      })
      .run();
    db.insert(paymentSessions)
      .values({
        id: "sess_new",
        orderId: "ord_1",
        state: "completed",
        bankTxId: "tx_bank_2",
        createdAt: 20,
      })
      .run();

    expect(getOrderView(db, "ord_1")).toMatchObject({
      paymentState: "completed",
      bankTxId: "tx_bank_2",
    });
  });

  it("tolerates malformed checks json rather than throwing", () => {
    db.insert(paymentSessions)
      .values({
        id: "sess_bad",
        orderId: "ord_1",
        state: "completed",
        checksJson: "{not json",
        createdAt: 1,
      })
      .run();

    expect(getOrderView(db, "ord_1")?.checks).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/merchant && pnpm test src/lib/order-view.test.ts
```

Expected: FAIL — cannot resolve `./order-view.js`.

- [ ] **Step 3: Write order-view.ts**

`apps/merchant/src/lib/order-view.ts`:

```ts
import { desc, eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import {
  orders,
  paymentSessions,
  type OrderStatus,
  type PaymentSessionState,
} from "../db/schema.js";

export interface CheckView {
  check: string;
  passed: boolean;
  detail?: string;
}

export interface OrderViewDto {
  id: string;
  totalCents: number;
  currency: string;
  status: OrderStatus;
  customerName: string;
  paymentState: PaymentSessionState | null;
  bankTxId: string | null;
  checks: CheckView[];
}

/**
 * foundry's verdict is stored verbatim, so it is untrusted input as far as
 * this app's types are concerned — parse defensively and drop anything that
 * does not look like a check rather than rendering junk on the success page.
 */
function parseChecks(json: string | null): CheckView[] {
  if (!json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const check = (entry as { check?: unknown }).check;
    const passed = (entry as { passed?: unknown }).passed;
    if (typeof check !== "string" || typeof passed !== "boolean") return [];
    const detail = (entry as { detail?: unknown }).detail;
    return [{ check, passed, ...(typeof detail === "string" ? { detail } : {}) }];
  });
}

export function getOrderView(db: Db, orderId: string): OrderViewDto | null {
  const order = db.select().from(orders).where(eq(orders.id, orderId)).get();
  if (!order) return null;

  // Newest session wins: a retried order has more than one.
  const session = db
    .select()
    .from(paymentSessions)
    .where(eq(paymentSessions.orderId, orderId))
    .orderBy(desc(paymentSessions.createdAt))
    .limit(1)
    .get();

  return {
    id: order.id,
    totalCents: order.totalCents,
    currency: order.currency,
    status: order.status,
    customerName: order.customerName,
    paymentState: session?.state ?? null,
    bankTxId: session?.bankTxId ?? null,
    checks: parseChecks(session?.checksJson ?? null),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd apps/merchant && pnpm test src/lib/order-view.test.ts
```

Expected: 5 PASS.

- [ ] **Step 5: Write the order route**

`apps/merchant/src/app/api/orders/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import { getOrderView } from "@/lib/order-view.js";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const order = getOrderView(getDb(), id);
  if (!order) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ order });
}
```

- [ ] **Step 6: Append success-page classes to globals.css**

Append to `apps/merchant/src/app/globals.css`:

```css
.success-card {
  background: var(--color-surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow-card);
}

.check-row {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  border-bottom: 1px solid var(--color-border);
  padding: 0.5rem 0;
  font-size: 0.875rem;
}

.check-row:last-child {
  border-bottom: 0;
}

.check-name {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8rem;
}
```

- [ ] **Step 7: Write VerificationDetails**

`apps/merchant/src/components/VerificationDetails.tsx` — a plain `<details>`
element, so it needs no client-side JavaScript at all:

```tsx
import type { CheckView } from "@/lib/order-view.js";

export function VerificationDetails({ checks }: { checks: CheckView[] }) {
  if (checks.length === 0) return null;

  return (
    <details className="mt-6 text-left">
      <summary className="cursor-pointer text-sm font-medium text-[var(--color-brand)]">
        Verification details
      </summary>
      <div className="mt-3">
        {checks.map((entry) => (
          <div key={entry.check} className="check-row">
            <span aria-hidden="true">{entry.passed ? "✓" : "✗"}</span>
            <span className="check-name flex-1">{entry.check}</span>
            <span
              className={
                entry.passed
                  ? "text-[var(--color-success)]"
                  : "text-[var(--color-destructive)]"
              }
            >
              {entry.passed ? "passed" : "failed"}
            </span>
            {entry.detail ? (
              <span className="text-[var(--color-muted-foreground)]">{entry.detail}</span>
            ) : null}
          </div>
        ))}
      </div>
    </details>
  );
}
```

- [ ] **Step 8: Write the success page**

`apps/merchant/src/app/success/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { VerificationDetails } from "@/components/VerificationDetails.js";
import { getDb } from "@/db/index.js";
import { formatEuroCents } from "@/lib/format.js";
import { getOrderView } from "@/lib/order-view.js";

export const dynamic = "force-dynamic";

export default async function SuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string }>;
}) {
  const { orderId } = await searchParams;
  if (!orderId) notFound();

  const order = getOrderView(getDb(), orderId);
  if (!order) notFound();

  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <div className="success-card p-8 text-center">
        <div className="text-5xl" aria-hidden="true">
          ✅
        </div>
        <h1 className="mt-4 text-2xl font-bold">Payment successful</h1>
        <p className="mt-1 text-[var(--color-muted-foreground)]">
          Thanks, {order.customerName}. Your order is confirmed.
        </p>

        <dl className="mt-6 space-y-2 text-left text-sm">
          <div className="flex justify-between">
            <dt className="text-[var(--color-muted-foreground)]">Order</dt>
            <dd className="font-mono">{order.id}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[var(--color-muted-foreground)]">Total</dt>
            <dd className="font-semibold">{formatEuroCents(order.totalCents)}</dd>
          </div>
          {order.bankTxId ? (
            <div className="flex justify-between">
              <dt className="text-[var(--color-muted-foreground)]">Bank reference</dt>
              <dd className="font-mono text-xs">{order.bankTxId}</dd>
            </div>
          ) : null}
        </dl>

        <VerificationDetails checks={order.checks} />

        <Link
          href="/"
          className="mt-8 inline-block rounded-[var(--radius)] bg-[var(--color-brand)] px-5 py-2.5 font-semibold text-white"
        >
          Continue shopping
        </Link>
      </div>
    </main>
  );
}
```

- [ ] **Step 9: Verify over HTTP**

This task's screen only has content once an order has actually been paid, and
nothing before Task 11's end-to-end run produces one. Verify the shape now
with a synthetic completed session, the same technique Task 7 Step 11 uses:

```bash
cd apps/merchant && pnpm dev &
sleep 12
ORDER_ID=$(curl -sS -X POST http://localhost:3000/api/orders \
  -H 'content-type: application/json' \
  -d '{"items":[{"productId":"prod_1","quantity":1}],"customer":{"name":"Ada","email":"ada@example.com"}}' \
  | sed -E 's/.*"orderId":"([^"]+)".*/\1/')
kill %1

cat > scratch.ts <<TS
import { eq } from "drizzle-orm";
import { createDb } from "./src/db/index.js";
import { orders, paymentSessions } from "./src/db/schema.js";
const db = createDb(process.env.DATABASE_PATH ?? "./data/merchant.db", false);
const id = "\$ORDER_ID";
db.update(orders).set({ status: "paid" }).where(eq(orders.id, id)).run();
db.insert(paymentSessions).values({
  id: "sess_synthetic", orderId: id, state: "completed", bankTxId: "tx_synthetic",
  checksJson: JSON.stringify([
    { check: "sd_jwt_vc_signature_and_kb_jwt", passed: true },
    { check: "dcql_match", passed: true },
    { check: "status_check", passed: true },
    { check: "transaction_data_binding", passed: true },
  ]),
  createdAt: Date.now(),
}).run();
console.log("synthetic completed session for", id);
TS
pnpm exec tsx --env-file-if-exists=.env.local scratch.ts
rm -f scratch.ts

pnpm dev &
sleep 12
echo "--- order view API ---"
curl -sS http://localhost:3000/api/orders/$ORDER_ID
echo
echo "--- unknown order is 404 ---"
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/orders/ord_nope
echo "--- success page renders the four checks ---"
curl -sS "http://localhost:3000/success?orderId=$ORDER_ID" \
  | grep -o 'transaction_data_binding\|dcql_match\|status_check\|sd_jwt_vc_signature_and_kb_jwt\|Payment successful' | sort -u
echo "--- /success without an orderId is 404 ---"
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:3000/success
kill %1
```

Expected: the order view reports `"status":"paid"`,
`"paymentState":"completed"`, `"bankTxId":"tx_synthetic"`, and four checks;
`404` for the unknown order; all four check names plus "Payment successful"
present in the rendered page; `404` for `/success` with no `orderId`.

- [ ] **Step 10: Typecheck and commit**

```bash
cd apps/merchant && pnpm typecheck && pnpm test
cd /Users/senexi/dev/eudiw/payment-banking-demo
git add apps/merchant
git commit -m "feat(merchant): add success screen with real verification details"
```

---
### Task 11: Dockerfile, README, and the end-to-end walkthrough

**Files:**
- Create: `apps/merchant/Dockerfile`
- Create: `apps/merchant/.dockerignore`
- Modify: `README.md` (merchant env table, walkthrough — extend, do not replace)

**Interfaces:**
- Consumes: everything above.
- Produces: a container image honouring the §8 contract, and the documented
  manual end-to-end walkthrough that spec §10 names as the only meaningful
  test of the wallet leg.

- [ ] **Step 1: Write .dockerignore**

`apps/merchant/.dockerignore` — the build context is the repo root, so these
paths are root-relative:

```
**/node_modules
**/.next
**/data
**/*.db
**/.env
**/.env.local
.git
docs
```

- [ ] **Step 2: Write the Dockerfile**

`apps/merchant/Dockerfile` — build from the **repo root** as context. This is
the bank's Dockerfile from Plan 1 Task 13 with the paths and port changed;
keep them in sync if either is edited.

```dockerfile
# syntax=docker/dockerfile:1

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ---- deps ----------------------------------------------------------------
FROM base AS deps
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/foundry-client/package.json packages/foundry-client/
COPY packages/ui/package.json packages/ui/
COPY apps/merchant/package.json apps/merchant/
# better-sqlite3 needs a toolchain to build its native addon.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN pnpm install --frozen-lockfile

# ---- build ---------------------------------------------------------------
FROM base AS build
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY . .
# Placeholder secrets: next build must not require real ones, but env.ts
# validates at import time. These never reach the runtime image.
ENV FOUNDRY_ADMIN_KEY=build-only \
    BANK_API_KEY=build-only
RUN pnpm --filter @demo/merchant run build

# ---- runtime -------------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/data/merchant.db

# Next's standalone output already contains the traced workspace deps.
COPY --from=build /repo/apps/merchant/.next/standalone ./
COPY --from=build /repo/apps/merchant/.next/static ./apps/merchant/.next/static
COPY --from=build /repo/apps/merchant/drizzle ./apps/merchant/drizzle

RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000

# Migrations run on first DB access (src/db/index.ts), so no entrypoint script.
WORKDIR /app/apps/merchant
CMD ["node", "server.js"]
```

Note there is **no** `"type": "module"` in `apps/merchant/package.json`
(Task 1), deliberately: Next's generated standalone `server.js` is CommonJS
and ships alongside that same manifest, so adding it would crash the container
at boot. Plan 1 Task 13 investigated and confirmed this — do not "fix" it.

- [ ] **Step 3: Build and run the image**

```bash
cd /Users/senexi/dev/eudiw/payment-banking-demo
podman build -f apps/merchant/Dockerfile -t payment-demo-merchant:dev .

podman run -d --name merchant-check -p 3000:3000 \
  -e FOUNDRY_ADMIN_URL=http://host.containers.internal:9000 \
  -e FOUNDRY_ADMIN_KEY=dev-admin-key \
  -e BANK_API_URL=http://host.containers.internal:3001 \
  -e BANK_API_KEY=dev-bank-api-key \
  -e MERCHANT_PUBLIC_URL=http://localhost:3000 \
  -v payment-demo-merchant-data:/data \
  payment-demo-merchant:dev
sleep 5
podman inspect merchant-check --format '{{.State.Status}} exitcode={{.State.ExitCode}}'
curl -sS http://localhost:3000/api/health
curl -sS http://localhost:3000/api/ready
podman rm -f merchant-check
```

(With `docker`, swap `host.containers.internal` for `host.docker.internal`.)

Expected: `running exitcode=0`, then `{"status":"ok"}` and
`{"status":"ready"}` — the latter proves migrations ran against the mounted
volume. The container has **no seeded products**; seeding is an operator
action, documented in the README exactly as it is for the bank.

- [ ] **Step 4: Verify the contract holds — a missing secret must crash the container**

```bash
podman run -d --name merchant-crash-check -p 3002:3000 \
  -e FOUNDRY_ADMIN_URL=http://host.containers.internal:9000 \
  -e BANK_API_KEY=dev-bank-api-key \
  payment-demo-merchant:dev
sleep 5
podman inspect merchant-crash-check --format '{{.State.Status}} exitcode={{.State.ExitCode}}'
podman logs merchant-crash-check
podman rm -f merchant-crash-check
```

Expected: `exited exitcode=1` within about 5 seconds, **with no request sent**,
and a log line reading

```
[merchant] Fatal: invalid environment configuration — refusing to serve requests. Error: Invalid merchant environment configuration — FOUNDRY_ADMIN_KEY: Required
```

with no `Ready in ...` line before it. If the container stays up instead, one
of the three things the Global Constraints call out is wrong:
`src/instrumentation.ts` is missing, it is at the package root instead of
under `src/`, or it is `throw`ing rather than calling `process.exit(1)`. Fix
that — do not relax the test.

- [ ] **Step 5: Extend the README**

The README already documents the bank (Plan 1 Task 13). **Extend it, do not
rewrite it.** Make these five edits:

**5a.** In the intro list, replace the merchant bullet's
"*(Plan 2 — not yet implemented.)*" with what it now actually does:

```markdown
- **`apps/merchant`** — web shop. Requests that credential at checkout with
  `transaction_data` amount binding, verifies it through `foundry`, then
  settles by debiting the bank over its REST API.
```

**5b.** Add a merchant environment table immediately after the existing
"Bank environment" table:

```markdown
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
```

**5c.** Under "Building the image", add the merchant's build command next to
the bank's:

```bash
podman build -f apps/merchant/Dockerfile -t payment-demo-merchant:latest .
```

**5d.** Add a walkthrough section immediately before "Security notes":

```markdown
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
```

**5e.** In "Known limitations", add:

```markdown
- **Concurrent payment sessions per order are possible.** Nothing prevents
  opening several sessions for one `pending` order; whichever the user
  completes wins and the rest expire in `foundry`. Double-charging is
  prevented by the bank's `idempotency_key`, not by a schema constraint.
```

- [ ] **Step 6: Verify the README's quick start from a clean state**

```bash
cd /Users/senexi/dev/eudiw/payment-banking-demo
rm -rf apps/bank/data apps/merchant/data
pnpm install
cp apps/bank/.env.example apps/bank/.env.local
cp apps/merchant/.env.example apps/merchant/.env.local
pnpm migrate && pnpm seed && pnpm check
```

Expected: every step succeeds, both apps migrate and seed, and `pnpm check` is
green across all four workspace projects. If any documented command fails, fix
the README — it is the deployment contract, and a wrong one is worse than none.

- [ ] **Step 7: Verify both apps start in parallel**

```bash
cd /Users/senexi/dev/eudiw/payment-banking-demo
pnpm dev &
sleep 15
curl -sS http://localhost:3000/api/health
curl -sS http://localhost:3001/api/health
kill %1
```

Expected: `{"status":"ok"}` from both, with prefixed interleaved output showing
`apps/bank dev` and `apps/merchant dev` running together (spec §8.3).

- [ ] **Step 8: Run the manual end-to-end walkthrough**

Follow the README section written in Step 5, with a real phone. This is the
only test of the wallet leg that means anything (spec §10) — automating a
wallet is out of scope, and mocking one would skip the only interesting part.

While doing it, complete **Task 8 Step 11**: dump the stored
`disclosed_claims_json` and either tighten `extractCredentialId` to the real
shape or record that both branches were kept deliberately.

If the walkthrough cannot be run (no phone, or no publicly reachable
`foundry`), say so explicitly in the commit message rather than implying the
loop was observed to close. Everything except the wallet leg is verifiable
without a device; that leg is not.

- [ ] **Step 9: Commit**

```bash
cd /Users/senexi/dev/eudiw/payment-banking-demo
git add apps/merchant/Dockerfile apps/merchant/.dockerignore README.md
git commit -m "feat(merchant): add Dockerfile and document the end-to-end walkthrough"
```

---

## Definition of Done for Plan 2

- [ ] `pnpm check` green across all four workspace projects
- [ ] `pnpm dev` starts the merchant on :3000 and the bank on :3001 together
- [ ] A real EUDI wallet holding the DPC credential from Plan 1 pays for a real
      order, and the wallet's authorization prompt shows the same amount the
      merchant computed server-side
- [ ] The success screen lists `foundry`'s real checks, including
      `transaction_data_binding`
- [ ] The bank dashboard shows the purchase, a reduced balance, and the row
      badged "EUDI Wallet"
- [ ] Repeating a settle call with the same `idempotency_key` debits once
- [ ] The merchant container builds, applies migrations against a mounted
      volume, and passes `/api/health` and `/api/ready`
- [ ] A missing secret crashes the merchant container at boot with a named
      error, verified by `podman inspect` reporting `exitcode=1`
- [ ] The real shape of `foundry`'s disclosed verification claims is recorded
      (Task 8 Step 11) rather than left as a guess

## What this plan deliberately does not do

Stated so a reviewer does not read these as omissions:

- **No revocation.** `foundry` exposes no admin revoke endpoint; credentials
  expire on their 12-hour lifetime (spec §2).
- **No settlement reconciliation.** If a presentation verifies but the debit
  fails, nothing is debited and the order stays `pending` for the user to
  retry. There is no background job that later reconciles (spec §6.3).
- **No merchant login or order-history UI.** `GET /api/orders/{id}` exists and
  is curl-able, but there is no "my orders" page — the demo's narrative ends
  at the success screen and continues in the bank's transaction list.
- **No Digital Credentials API button.** `foundry` returns `dc_api_request`
  alongside the QR URIs, so this is a documented extension point rather than
  an oversight (spec §9.5).
- **No age verification and no loyalty.** Separate specs, per the scope
  discipline agreed at design time.