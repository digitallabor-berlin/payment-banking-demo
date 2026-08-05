# Payment Banking Demo — Plan 1: Foundation & Bank

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the pnpm workspace, the shared foundry client and UI package, and a working online-banking app that issues an EMVCo Digital Payment Credential into a real EUDI wallet.

**Architecture:** A pnpm workspace with one Next.js 15 App Router application (`apps/bank`) whose `/api/*` route handlers are its REST API, plus two shared packages. The bank persists to SQLite via Drizzle and drives credential issuance by calling `foundry`'s admin API; the wallet then talks to `foundry` directly. Everything environmental is injected via env vars — no URL is hardcoded.

**Tech Stack:** Node 22+, pnpm 10, Next.js 15 (App Router), React 19, TypeScript 5.7 strict, Tailwind CSS 4, Drizzle ORM + better-sqlite3, zod, jose (JWT), qrcode, vitest.

**Design spec:** `docs/superpowers/specs/2026-08-05-payment-banking-demo-design.md`. Read it before starting. Section references below (§n) point at it.

**Follow-up plan:** Plan 2 covers the merchant app, the `/pay` screen, verification, and settlement. Do not build merchant features here.

## Global Constraints

Every task's requirements implicitly include this section.

- **Node** ≥ 22. **pnpm** 10.x. Verified present: Node v26.5.0, pnpm 10.29.2.
- **TypeScript strict mode on** in every package. No `any` in committed code; use `unknown` plus a narrowing check.
- **No hardcoded URLs or secrets anywhere.** All of them come from validated env (§8.1). A missing secret must crash the process at boot with a named error.
- **All money is integer cents.** Never a float. Column names end in `_cents`.
- **Credential type id / vct is exactly `com.emvco.dpc.card`** — a reverse-DNS identifier, not a URL.
- **`foundry` admin auth is `Authorization: Bearer <FOUNDRY_ADMIN_KEY>`.**
- **`foundry` issuance states are exactly `"offered" | "issued"`.** There is no `failed` state on foundry's side.
- **Bank credential states are exactly `"offered" | "active" | "failed"`.** There is no `revoked` state — revocation is out of scope (§2).
- **Polling everywhere:** 2000 ms interval, 10 minute cap, error after 5 consecutive failures, abort on unmount.
- **Bank UI strings are German.** Code identifiers, comments, and commit messages are English.
- **Bank port 3001** (merchant will take 3000 in Plan 2).
- **Commit after every task.** Conventional-commit prefixes (`feat:`, `test:`, `chore:`, `fix:`).

---

## File Structure

```
payment-banking-demo/
├─ pnpm-workspace.yaml                    Task 2
├─ package.json                           Task 2   root scripts
├─ tsconfig.base.json                     Task 2   shared compiler options
├─ packages/
│  ├─ foundry-client/                     Task 3   ONLY code that knows foundry's wire format
│  │  ├─ package.json
│  │  ├─ tsconfig.json
│  │  ├─ vitest.config.ts
│  │  └─ src/
│  │     ├─ types.ts                      request/response shapes
│  │     ├─ client.ts                     FoundryClient + FoundryError
│  │     ├─ index.ts                      public exports
│  │     └─ client.test.ts
│  └─ ui/                                 Task 4   shared client-side primitives
│     ├─ package.json
│     ├─ tsconfig.json
│     ├─ vitest.config.ts
│     └─ src/
│        ├─ cn.ts                         class-name merge
│        ├─ poll.ts                       pollUntilTerminal — pure, testable
│        ├─ poll.test.ts
│        ├─ useStatusPoll.ts              thin React wrapper over poll.ts
│        ├─ useIsTouch.ts                 matchMedia(pointer: coarse)
│        ├─ QrCanvas.tsx                  brand-coloured QR
│        └─ index.ts
└─ apps/bank/
   ├─ package.json                        Task 5
   ├─ tsconfig.json                       Task 5
   ├─ next.config.ts                      Task 5   standalone + outputFileTracingRoot
   ├─ postcss.config.mjs                  Task 5
   ├─ vitest.config.ts                    Task 5
   ├─ drizzle.config.ts                   Task 6
   ├─ .env.example                        Task 5
   ├─ Dockerfile                          Task 13
   ├─ drizzle/                            Task 6   generated SQL migrations (committed)
   └─ src/
      ├─ env.ts                           Task 5   zod-validated env, throws at boot
      ├─ db/
      │  ├─ schema.ts                     Task 6   all five tables
      │  ├─ index.ts                      Task 6   drizzle instance + migrate-on-boot
      │  └─ seed.ts                       Task 6   fixtures (§5.3)
      ├─ lib/
      │  ├─ password.ts                   Task 7   scrypt hash/verify
      │  ├─ session.ts                    Task 7   JWT sign/verify + cookie helpers
      │  ├─ foundry.ts                    Task 11  configured FoundryClient singleton
      │  └─ credential-id.ts              Task 11  mintCredentialId()
      ├─ app/
      │  ├─ globals.css                   Task 5   @theme tokens (§9.1)
      │  ├─ layout.tsx                    Task 5
      │  ├─ page.tsx                      Task 10  dashboard
      │  ├─ login/page.tsx                Task 9
      │  ├─ transactions/page.tsx         Task 10
      │  └─ api/
      │     ├─ health/route.ts            Task 5
      │     ├─ ready/route.ts             Task 5
      │     ├─ auth/login/route.ts        Task 7
      │     ├─ auth/logout/route.ts       Task 7
      │     ├─ auth/me/route.ts           Task 7
      │     ├─ accounts/route.ts          Task 8
      │     ├─ cards/route.ts             Task 8
      │     ├─ transactions/route.ts      Task 8
      │     ├─ cards/[id]/credential/route.ts     Task 11
      │     └─ credentials/[id]/status/route.ts   Task 11
      └─ components/
         ├─ SparkasseLogo.tsx             Task 9
         ├─ AuthCard.tsx                  Task 9
         ├─ LoginForm.tsx                 Task 9
         ├─ AppHeader.tsx                 Task 10
         ├─ AccountPanel.tsx              Task 10
         ├─ TransactionRow.tsx            Task 10
         ├─ CardTile.tsx                  Task 10
         └─ IssuanceDialog.tsx            Task 12
```

**Why these boundaries:** `foundry-client` isolates the one wire format that could change underneath us. `ui/poll.ts` is a pure async function so the subtle polling logic is testable in Node without jsdom, with `useStatusPoll.ts` as an untested thin wrapper. Bank `lib/` holds logic worth unit-testing separately from route handlers, so route tests stay about HTTP.

---

### Task 1: Add the DPC credential type to foundry

**This task modifies a different repository: `/Users/senexi/dev/eudiw/foundry`.** It writes no code in `payment-banking-demo`. It blocks every other task — nothing downstream can be verified without it (§3).

**Files:**
- Modify: `/Users/senexi/dev/eudiw/foundry/config.yaml` (append to `credential_types`)

- [ ] **Step 1: Confirm the current config lacks the type**

```bash
cd /Users/senexi/dev/eudiw/foundry
grep -c 'com.emvco.dpc.card' config.yaml || echo "absent, as expected"
```

Expected: `0` or "absent, as expected".

- [ ] **Step 2: Append the credential type**

Add this entry to the end of the existing `credential_types:` list in
`/Users/senexi/dev/eudiw/foundry/config.yaml`. Do **not** regenerate the config
with `quickstart` — that would rotate the dev PKI and invalidate credentials
already held by any wallet.

```yaml
  - id: com.emvco.dpc.card
    format: dc+sd-jwt
    vct: com.emvco.dpc.card
    cryptographic_holder_binding: true
    validity_seconds: 43200
    display:
      - { name: "Payment Card", locale: en-US }
    claims:
      - path: [credential_id]
        selectively_disclosable: true
        required: true
      - path: [network]
        selectively_disclosable: true
        required: true
      - path: [card_id]
        selectively_disclosable: true
```

- [ ] **Step 3: Validate the config parses**

```bash
cd /Users/senexi/dev/eudiw/foundry
cargo run -p foundry -- config validate --config config.yaml
```

Expected: exits 0. If it reports an unknown key, read
`crates/foundry-core/src/config/model.rs` for the accepted shape and correct the
YAML — do not proceed on a config that fails validation.

- [ ] **Step 4: Start foundry**

```bash
cd /Users/senexi/dev/eudiw/foundry
cargo run -p foundry -- serve --config config.yaml
```

Leave it running in its own terminal for the rest of this plan. Admin listener
on `127.0.0.1:9000`, wallet-facing on `0.0.0.0:8443`.

- [ ] **Step 5: Verify §3.1(1) — the credential type resolves**

```bash
curl -sS -X POST http://127.0.0.1:9000/admin/issuance/offers \
  -H "Authorization: Bearer dev-admin-key" \
  -H "Content-Type: application/json" \
  -d '{"credential_type_id":"com.emvco.dpc.card",
       "claims":{"credential_id":"dpc_test_0001","network":"VISA","card_id":"card_test"}}'
```

Expected: JSON containing `transaction_id`, `credential_offer_uri`, and
`dc_api_offer`. Record the `transaction_id`.

- [ ] **Step 6: Verify the issuance status endpoint**

```bash
curl -sS http://127.0.0.1:9000/admin/issuance/offers/<transaction_id> \
  -H "Authorization: Bearer dev-admin-key"
```

Expected: JSON with `"state":"offered"`.

- [ ] **Step 7: Verify §3.1(2) — the `request_uri` transport round-trips**

```bash
curl -sS -X POST http://127.0.0.1:9000/admin/verification/requests \
  -H "Authorization: Bearer dev-admin-key" \
  -H "Content-Type: application/json" \
  -d '{"transport":"request_uri",
       "dcql_query":{"credentials":[{"id":"card","format":"dc+sd-jwt",
         "meta":{"vct_values":["com.emvco.dpc.card"]},
         "claims":[{"path":["credential_id"]},{"path":["network"]}]}]}}'
```

Expected: JSON with `verification_id`, a non-null `request_uri`, and an
`openid4vp_uri` of the form `openid4vp://?client_id=...&request_uri=...`.

- [ ] **Step 8: Verify §3.1(3) — the `transaction_data` shape is accepted**

```bash
curl -sS -X POST http://127.0.0.1:9000/admin/verification/requests \
  -H "Authorization: Bearer dev-admin-key" \
  -H "Content-Type: application/json" \
  -d '{"transport":"request_uri",
       "dcql_query":{"credentials":[{"id":"card","format":"dc+sd-jwt",
         "meta":{"vct_values":["com.emvco.dpc.card"]},
         "claims":[{"path":["credential_id"]},{"path":["network"]}]}]},
       "transaction_data":[{"type":"payment","credential_ids":["card"],
         "amount":"47.98","currency":"EUR","merchant":"Demo Shop","order_id":"ord_test"}]}'
```

Expected: HTTP 200 with a `verification_id`. **If this returns 4xx**, read
`crates/foundry-verifier/src/request.rs` for the accepted entry shape (it may
require base64url-encoded strings rather than JSON objects) and record the
working shape in a note on this task. If no shape works, Plan 2 falls back to a
possession-only DCQL query per §3.1(3) — that is a Plan 2 concern and does not
block this plan.

- [ ] **Step 9: Record the outcome**

Append the confirmed `transaction_data` entry shape from Step 8 to §3.1 of the
design spec, then commit in the **`payment-banking-demo`** repo:

```bash
cd /Users/senexi/dev/eudiw/payment-banking-demo
git add docs/superpowers/specs/2026-08-05-payment-banking-demo-design.md
git commit -m "docs: record verified foundry transaction_data shape"
```

Commit the foundry config change separately, in the foundry repo:

```bash
cd /Users/senexi/dev/eudiw/foundry
git add config.yaml
git commit -m "feat: add com.emvco.dpc.card credential type for payment demo"
```

---

### Task 2: Workspace scaffold

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.npmrc`

**Interfaces:**
- Produces: the workspace root that every later task's `pnpm` command resolves against; `tsconfig.base.json` extended by every package.

- [ ] **Step 1: Create the workspace manifest**

`pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 2: Create the root package.json**

`package.json`:

```json
{
  "name": "payment-banking-demo",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "packageManager": "pnpm@10.29.2",
  "scripts": {
    "dev": "pnpm -r --parallel run dev",
    "build": "pnpm -r run build",
    "seed": "pnpm -r run seed",
    "migrate": "pnpm -r run migrate",
    "test": "pnpm -r run test",
    "typecheck": "pnpm -r run typecheck",
    "check": "pnpm -r --parallel run typecheck && pnpm -r run test"
  },
  "devDependencies": {
    "typescript": "^5.7.2"
  }
}
```

- [ ] **Step 3: Create the shared TypeScript config**

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  }
}
```

- [ ] **Step 4: Create .npmrc**

pnpm hoists nothing by default, which breaks some Next.js and Tailwind
resolution. This setting is required, not cosmetic.

`.npmrc`:

```
node-linker=hoisted
strict-peer-dependencies=false
```

- [ ] **Step 5: Install and verify**

```bash
pnpm install
pnpm -v && node -v
```

Expected: install succeeds, creating `pnpm-lock.yaml`.

- [ ] **Step 6: Commit**

```bash
git add pnpm-workspace.yaml package.json tsconfig.base.json .npmrc pnpm-lock.yaml
git commit -m "chore: scaffold pnpm workspace"
```

---

### Task 3: packages/foundry-client

The only module in the repo that knows `foundry`'s wire format. Both apps consume
it; Plan 2's merchant uses the verification methods, which is why all four
endpoints land here now rather than being bolted on later.

**Files:**
- Create: `packages/foundry-client/package.json`
- Create: `packages/foundry-client/tsconfig.json`
- Create: `packages/foundry-client/vitest.config.ts`
- Create: `packages/foundry-client/src/types.ts`
- Create: `packages/foundry-client/src/client.ts`
- Create: `packages/foundry-client/src/index.ts`
- Test: `packages/foundry-client/src/client.test.ts`

**Interfaces:**
- Produces:
  - `class FoundryClient` with constructor `{ adminUrl: string; adminKey: string; fetchImpl?: typeof fetch }`
  - `createIssuanceOffer(req: CreateOfferRequest): Promise<CreateOfferResponse>`
  - `getIssuanceStatus(transactionId: string): Promise<AdminIssuanceStatus>`
  - `createVerificationRequest(req: CreateVerificationRequest): Promise<CreateVerificationResponse>`
  - `getVerificationStatus(verificationId: string): Promise<VerificationTransaction>`
  - `class FoundryError extends Error` with `.status: number` and `.body: string`
  - types `IssuanceState = 'offered' | 'issued'`, `VerificationState = 'pending' | 'verified' | 'failed'`, `CheckResult`, `VerificationResult`

- [ ] **Step 1: Create the package manifest**

`packages/foundry-client/package.json`:

```json
{
  "name": "@demo/foundry-client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create tsconfig and vitest config**

`packages/foundry-client/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src/**/*.ts"]
}
```

`packages/foundry-client/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
```

- [ ] **Step 3: Write the types**

`packages/foundry-client/src/types.ts`:

```ts
/** foundry issuance transaction state. Exactly two values — see openapi.json IssuanceState. */
export type IssuanceState = "offered" | "issued";

/** foundry verification transaction state — see openapi.json VerificationState. */
export type VerificationState = "pending" | "verified" | "failed";

export interface CreateOfferRequest {
  credential_type_id: string;
  claims?: Record<string, unknown>;
  tx_code_required?: boolean;
}

export interface CreateOfferResponse {
  transaction_id: string;
  credential_offer_uri: string;
  dc_api_offer?: unknown;
}

export interface AdminIssuanceStatus {
  transaction_id: string;
  credential_type_id: string;
  state: IssuanceState;
  created_at: number;
  status_list_index?: number | null;
  tx_code?: string | null;
}

/**
 * `transport` is "request_uri" (QR / cross-device) or "dc_api".
 * Confirmed against crates/foundry-verifier/src/request.rs.
 */
export interface CreateVerificationRequest {
  transport: "request_uri" | "dc_api";
  dcql_query?: unknown;
  named_query_ref?: string;
  transaction_data?: unknown[];
}

export interface CreateVerificationResponse {
  verification_id: string;
  openid4vp_uri?: string | null;
  request_uri?: string | null;
  dc_api_request?: unknown;
}

export interface CheckResult {
  check: string;
  passed: boolean;
  detail?: string | null;
}

export interface VerificationResult {
  verified: boolean;
  checks: CheckResult[];
  claims: unknown;
}

export interface VerificationTransaction {
  id: string;
  state: VerificationState;
  created_at: number;
  result?: VerificationResult | null;
}
```

- [ ] **Step 4: Write the failing test**

`packages/foundry-client/src/client.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FoundryClient, FoundryError } from "./client.js";

function stubFetch(
  status: number,
  body: unknown,
  capture?: (url: string, init: RequestInit) => void,
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    capture?.(String(input), init ?? {});
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

function makeClient(fetchImpl: typeof fetch): FoundryClient {
  return new FoundryClient({
    adminUrl: "http://foundry.test:9000",
    adminKey: "k-123",
    fetchImpl,
  });
}

describe("FoundryClient.createIssuanceOffer", () => {
  it("posts to /admin/issuance/offers with a bearer token and returns the offer", async () => {
    let seenUrl = "";
    let seenInit: RequestInit = {};
    const client = makeClient(
      stubFetch(
        200,
        {
          transaction_id: "tx_1",
          credential_offer_uri: "openid-credential-offer://x",
          dc_api_offer: {},
        },
        (url, init) => {
          seenUrl = url;
          seenInit = init;
        },
      ),
    );

    const res = await client.createIssuanceOffer({
      credential_type_id: "com.emvco.dpc.card",
      claims: { credential_id: "dpc_abc", network: "VISA" },
    });

    expect(seenUrl).toBe("http://foundry.test:9000/admin/issuance/offers");
    expect(seenInit.method).toBe("POST");
    const headers = new Headers(seenInit.headers);
    expect(headers.get("authorization")).toBe("Bearer k-123");
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(seenInit.body))).toEqual({
      credential_type_id: "com.emvco.dpc.card",
      claims: { credential_id: "dpc_abc", network: "VISA" },
    });
    expect(res.transaction_id).toBe("tx_1");
    expect(res.credential_offer_uri).toBe("openid-credential-offer://x");
  });

  it("strips a trailing slash from adminUrl so paths never double up", async () => {
    let seenUrl = "";
    const client = new FoundryClient({
      adminUrl: "http://foundry.test:9000/",
      adminKey: "k",
      fetchImpl: stubFetch(
        200,
        { transaction_id: "t", credential_offer_uri: "u" },
        (url) => {
          seenUrl = url;
        },
      ),
    });
    await client.createIssuanceOffer({ credential_type_id: "x" });
    expect(seenUrl).toBe("http://foundry.test:9000/admin/issuance/offers");
  });

  it("throws FoundryError carrying status and body on a non-2xx response", async () => {
    const client = makeClient(stubFetch(400, { error: "bad_request" }));
    await expect(
      client.createIssuanceOffer({ credential_type_id: "nope" }),
    ).rejects.toBeInstanceOf(FoundryError);

    try {
      await client.createIssuanceOffer({ credential_type_id: "nope" });
      expect.unreachable("should have thrown");
    } catch (err) {
      const e = err as FoundryError;
      expect(e.status).toBe(400);
      expect(e.body).toContain("bad_request");
    }
  });
});

describe("FoundryClient.getIssuanceStatus", () => {
  it("GETs the transaction and returns its state", async () => {
    let seenUrl = "";
    let seenInit: RequestInit = {};
    const client = makeClient(
      stubFetch(
        200,
        {
          transaction_id: "tx_1",
          credential_type_id: "com.emvco.dpc.card",
          state: "issued",
          created_at: 1,
        },
        (url, init) => {
          seenUrl = url;
          seenInit = init;
        },
      ),
    );

    const res = await client.getIssuanceStatus("tx_1");

    expect(seenUrl).toBe("http://foundry.test:9000/admin/issuance/offers/tx_1");
    expect(seenInit.method).toBe("GET");
    expect(res.state).toBe("issued");
  });

  it("percent-encodes the transaction id", async () => {
    let seenUrl = "";
    const client = makeClient(
      stubFetch(
        200,
        { transaction_id: "a/b", credential_type_id: "c", state: "offered", created_at: 1 },
        (url) => {
          seenUrl = url;
        },
      ),
    );
    await client.getIssuanceStatus("a/b");
    expect(seenUrl).toBe("http://foundry.test:9000/admin/issuance/offers/a%2Fb");
  });
});

describe("FoundryClient verification methods", () => {
  it("creates a verification request with the request_uri transport", async () => {
    let seenBody = "";
    const client = makeClient(
      stubFetch(
        200,
        { verification_id: "v_1", openid4vp_uri: "openid4vp://?x=1", request_uri: "http://r" },
        (_url, init) => {
          seenBody = String(init.body);
        },
      ),
    );

    const res = await client.createVerificationRequest({
      transport: "request_uri",
      dcql_query: { credentials: [] },
      transaction_data: [{ type: "payment" }],
    });

    expect(JSON.parse(seenBody).transport).toBe("request_uri");
    expect(res.verification_id).toBe("v_1");
    expect(res.openid4vp_uri).toBe("openid4vp://?x=1");
  });

  it("returns the verification verdict including per-check results", async () => {
    const client = makeClient(
      stubFetch(200, {
        id: "v_1",
        state: "verified",
        created_at: 1,
        result: {
          verified: true,
          checks: [{ check: "transaction_data_binding", passed: true }],
          claims: { credential_id: "dpc_abc" },
        },
      }),
    );

    const res = await client.getVerificationStatus("v_1");

    expect(res.state).toBe("verified");
    expect(res.result?.verified).toBe(true);
    expect(res.result?.checks[0]?.check).toBe("transaction_data_binding");
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

```bash
cd packages/foundry-client && pnpm test
```

Expected: FAIL — cannot resolve `./client.js`.

- [ ] **Step 6: Write the client**

`packages/foundry-client/src/client.ts`:

```ts
import type {
  AdminIssuanceStatus,
  CreateOfferRequest,
  CreateOfferResponse,
  CreateVerificationRequest,
  CreateVerificationResponse,
  VerificationTransaction,
} from "./types.js";

/** A non-2xx response from foundry's admin API. */
export class FoundryError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`foundry admin request failed with HTTP ${status}`);
    this.name = "FoundryError";
    this.status = status;
    this.body = body;
  }
}

export interface FoundryClientOptions {
  /** Base URL of foundry's ADMIN listener, e.g. http://127.0.0.1:9000 */
  adminUrl: string;
  adminKey: string;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export class FoundryClient {
  private readonly adminUrl: string;
  private readonly adminKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: FoundryClientOptions) {
    this.adminUrl = opts.adminUrl.replace(/\/+$/, "");
    this.adminKey = opts.adminKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async createIssuanceOffer(req: CreateOfferRequest): Promise<CreateOfferResponse> {
    return this.request<CreateOfferResponse>("POST", "/admin/issuance/offers", req);
  }

  async getIssuanceStatus(transactionId: string): Promise<AdminIssuanceStatus> {
    const path = `/admin/issuance/offers/${encodeURIComponent(transactionId)}`;
    return this.request<AdminIssuanceStatus>("GET", path);
  }

  async createVerificationRequest(
    req: CreateVerificationRequest,
  ): Promise<CreateVerificationResponse> {
    return this.request<CreateVerificationResponse>(
      "POST",
      "/admin/verification/requests",
      req,
    );
  }

  async getVerificationStatus(verificationId: string): Promise<VerificationTransaction> {
    const path = `/admin/verification/requests/${encodeURIComponent(verificationId)}`;
    return this.request<VerificationTransaction>("GET", path);
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.adminKey}`,
    };
    if (body !== undefined) headers["content-type"] = "application/json";

    const res = await this.fetchImpl(`${this.adminUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });

    const text = await res.text();
    if (!res.ok) throw new FoundryError(res.status, text);
    return JSON.parse(text) as T;
  }
}
```

- [ ] **Step 7: Write the barrel export**

`packages/foundry-client/src/index.ts`:

```ts
export { FoundryClient, FoundryError } from "./client.js";
export type { FoundryClientOptions } from "./client.js";
export type {
  AdminIssuanceStatus,
  CheckResult,
  CreateOfferRequest,
  CreateOfferResponse,
  CreateVerificationRequest,
  CreateVerificationResponse,
  IssuanceState,
  VerificationResult,
  VerificationState,
  VerificationTransaction,
} from "./types.js";
```

- [ ] **Step 8: Install deps and run the tests**

```bash
cd /Users/senexi/dev/eudiw/payment-banking-demo
pnpm install
cd packages/foundry-client && pnpm test && pnpm typecheck
```

Expected: all tests PASS, typecheck clean.

- [ ] **Step 9: Commit**

```bash
cd /Users/senexi/dev/eudiw/payment-banking-demo
git add packages/foundry-client pnpm-lock.yaml
git commit -m "feat: add typed foundry admin API client"
```

---

### Task 4: packages/ui

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/vitest.config.ts`
- Create: `packages/ui/src/cn.ts`
- Create: `packages/ui/src/poll.ts`
- Create: `packages/ui/src/useStatusPoll.ts`
- Create: `packages/ui/src/useIsTouch.ts`
- Create: `packages/ui/src/QrCanvas.tsx`
- Create: `packages/ui/src/index.ts`
- Test: `packages/ui/src/poll.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `cn(...inputs: ClassValue[]): string`
  - `pollUntilTerminal<T>(opts: PollOptions<T>): Promise<PollOutcome<T>>` where
    `PollOptions<T> = { fetchOnce: () => Promise<T>; isTerminal: (v: T) => boolean; intervalMs?: number; timeoutMs?: number; maxConsecutiveFailures?: number; signal?: AbortSignal; sleep?: (ms: number, signal?: AbortSignal) => Promise<void>; now?: () => number }`
    and `PollOutcome<T> = { status: "terminal"; value: T } | { status: "timeout" } | { status: "failed"; error: unknown } | { status: "aborted" }`
  - `useStatusPoll<T>(opts): { value: T | null; outcome: PollOutcome<T> | null }`
  - `useIsTouch(): boolean`
  - `QrCanvas({ value, size, darkColor, lightColor, className }): JSX.Element`

- [ ] **Step 1: Create the package manifest**

`packages/ui/package.json`:

```json
{
  "name": "@demo/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "clsx": "^2.1.1",
    "qrcode": "^1.5.4",
    "tailwind-merge": "^2.5.5"
  },
  "peerDependencies": {
    "react": "^19.0.0"
  },
  "devDependencies": {
    "@types/qrcode": "^1.5.5",
    "@types/react": "^19.0.1",
    "react": "^19.0.0",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create tsconfig and vitest config**

`packages/ui/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

`packages/ui/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
```

- [ ] **Step 3: Write cn.ts**

`packages/ui/src/cn.ts`:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4: Write the failing test for the polling loop**

`packages/ui/src/poll.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { pollUntilTerminal } from "./poll.js";

/** Deterministic clock: sleep advances it instantly, no real timers. */
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

describe("pollUntilTerminal", () => {
  it("returns the terminal value and stops polling", async () => {
    const clock = fakeClock();
    const states = ["pending", "pending", "verified", "verified"];
    let calls = 0;
    const fetchOnce = vi.fn(async () => states[calls++] ?? "pending");

    const outcome = await pollUntilTerminal({
      fetchOnce,
      isTerminal: (v) => v === "verified",
      intervalMs: 2000,
      timeoutMs: 600_000,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(outcome).toEqual({ status: "terminal", value: "verified" });
    expect(fetchOnce).toHaveBeenCalledTimes(3);
  });

  it("polls at the given interval", async () => {
    const clock = fakeClock();
    let calls = 0;
    await pollUntilTerminal({
      fetchOnce: async () => (++calls === 3 ? "done" : "pending"),
      isTerminal: (v) => v === "done",
      intervalMs: 2000,
      timeoutMs: 600_000,
      now: clock.now,
      sleep: clock.sleep,
    });
    // Two sleeps between three attempts.
    expect(clock.now()).toBe(4000);
  });

  it("gives up with timeout once the cap is exceeded", async () => {
    const clock = fakeClock();
    const outcome = await pollUntilTerminal({
      fetchOnce: async () => "pending",
      isTerminal: () => false,
      intervalMs: 2000,
      timeoutMs: 10_000,
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(outcome.status).toBe("timeout");
  });

  it("tolerates transient failures below the threshold", async () => {
    const clock = fakeClock();
    let calls = 0;
    const outcome = await pollUntilTerminal({
      fetchOnce: async () => {
        calls++;
        if (calls <= 3) throw new Error("network");
        return "done";
      },
      isTerminal: (v) => v === "done",
      intervalMs: 2000,
      timeoutMs: 600_000,
      maxConsecutiveFailures: 5,
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(outcome).toEqual({ status: "terminal", value: "done" });
  });

  it("fails after maxConsecutiveFailures consecutive errors", async () => {
    const clock = fakeClock();
    let calls = 0;
    const outcome = await pollUntilTerminal({
      fetchOnce: async () => {
        calls++;
        throw new Error(`boom ${calls}`);
      },
      isTerminal: () => false,
      intervalMs: 2000,
      timeoutMs: 600_000,
      maxConsecutiveFailures: 5,
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(outcome.status).toBe("failed");
    expect(calls).toBe(5);
  });

  it("resets the failure counter after a success", async () => {
    const clock = fakeClock();
    const script: Array<"ok" | "err"> = [
      "err", "err", "err", "err", "ok",
      "err", "err", "err", "err", "ok",
    ];
    let i = 0;
    const outcome = await pollUntilTerminal({
      fetchOnce: async () => {
        const step = script[i++];
        if (step === undefined) return "done";
        if (step === "err") throw new Error("transient");
        return "pending";
      },
      isTerminal: (v) => v === "done",
      intervalMs: 1000,
      timeoutMs: 600_000,
      maxConsecutiveFailures: 5,
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(outcome).toEqual({ status: "terminal", value: "done" });
  });

  it("returns aborted when the signal is already aborted", async () => {
    const clock = fakeClock();
    const controller = new AbortController();
    controller.abort();
    const fetchOnce = vi.fn(async () => "pending");

    const outcome = await pollUntilTerminal({
      fetchOnce,
      isTerminal: () => false,
      intervalMs: 2000,
      timeoutMs: 600_000,
      signal: controller.signal,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(outcome.status).toBe("aborted");
    expect(fetchOnce).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

```bash
cd packages/ui && pnpm test
```

Expected: FAIL — cannot resolve `./poll.js`.

- [ ] **Step 6: Write poll.ts**

`packages/ui/src/poll.ts`:

```ts
export type PollOutcome<T> =
  | { status: "terminal"; value: T }
  | { status: "timeout" }
  | { status: "failed"; error: unknown }
  | { status: "aborted" };

export interface PollOptions<T> {
  fetchOnce: () => Promise<T>;
  isTerminal: (value: T) => boolean;
  /** Delay between attempts. Default 2000 ms (spec 6.3). */
  intervalMs?: number;
  /** Total wall-clock cap. Default 600000 ms (10 minutes, spec 6.3). */
  timeoutMs?: number;
  /** Consecutive errors tolerated before giving up. Default 5 (spec 6.3). */
  maxConsecutiveFailures?: number;
  signal?: AbortSignal;
  /** Injectable for tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Polls `fetchOnce` until `isTerminal` accepts a value, the timeout is reached,
 * too many consecutive failures occur, or the signal aborts.
 *
 * Deliberately not a React hook so it is testable without a DOM.
 */
export async function pollUntilTerminal<T>(opts: PollOptions<T>): Promise<PollOutcome<T>> {
  const {
    fetchOnce,
    isTerminal,
    intervalMs = 2000,
    timeoutMs = 600_000,
    maxConsecutiveFailures = 5,
    signal,
    sleep = defaultSleep,
    now = () => Date.now(),
  } = opts;

  const startedAt = now();
  let consecutiveFailures = 0;

  for (;;) {
    if (signal?.aborted) return { status: "aborted" };
    if (now() - startedAt > timeoutMs) return { status: "timeout" };

    try {
      const value = await fetchOnce();
      consecutiveFailures = 0;
      if (isTerminal(value)) return { status: "terminal", value };
    } catch (error) {
      consecutiveFailures++;
      if (consecutiveFailures >= maxConsecutiveFailures) {
        return { status: "failed", error };
      }
    }

    if (signal?.aborted) return { status: "aborted" };
    await sleep(intervalMs, signal);
  }
}
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd packages/ui && pnpm test
```

Expected: all 7 PASS.

- [ ] **Step 8: Write the React wrapper, touch hook, and QR component**

`packages/ui/src/useStatusPoll.ts`:

```ts
"use client";

import { useEffect, useRef, useState } from "react";
import { pollUntilTerminal, type PollOptions, type PollOutcome } from "./poll.js";

export interface UseStatusPollResult<T> {
  value: T | null;
  outcome: PollOutcome<T> | null;
}

/**
 * Thin React wrapper over pollUntilTerminal. Aborts on unmount.
 * `enabled: false` suspends polling without unmounting the consumer.
 */
export function useStatusPoll<T>(
  opts: Omit<PollOptions<T>, "signal"> & { enabled?: boolean },
): UseStatusPollResult<T> {
  const { enabled = true, fetchOnce, isTerminal } = opts;
  const [value, setValue] = useState<T | null>(null);
  const [outcome, setOutcome] = useState<PollOutcome<T> | null>(null);

  const fetchRef = useRef(fetchOnce);
  fetchRef.current = fetchOnce;
  const terminalRef = useRef(isTerminal);
  terminalRef.current = isTerminal;

  const { intervalMs, timeoutMs, maxConsecutiveFailures } = opts;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let cancelled = false;

    void pollUntilTerminal<T>({
      fetchOnce: async () => {
        const next = await fetchRef.current();
        if (!cancelled) setValue(next);
        return next;
      },
      isTerminal: (v) => terminalRef.current(v),
      intervalMs,
      timeoutMs,
      maxConsecutiveFailures,
      signal: controller.signal,
    }).then((result) => {
      if (!cancelled) setOutcome(result);
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled, intervalMs, timeoutMs, maxConsecutiveFailures]);

  return { value, outcome };
}
```

`packages/ui/src/useIsTouch.ts`:

```ts
"use client";

import { useEffect, useState } from "react";

/**
 * True on coarse-pointer devices. Uses matchMedia rather than user-agent
 * sniffing (spec 9.5). Always false during SSR, so server and first client
 * render agree.
 */
export function useIsTouch(): boolean {
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(pointer: coarse)");
    setIsTouch(query.matches);
    const onChange = (event: MediaQueryListEvent) => setIsTouch(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return isTouch;
}
```

`packages/ui/src/QrCanvas.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import QRCode from "qrcode";

export interface QrCanvasProps {
  value: string;
  /** Rendered edge length in px. Default 240 (spec 9.5). */
  size?: number;
  /** Dark module colour. Default black; pass a brand colour to theme it. */
  darkColor?: string;
  lightColor?: string;
  className?: string;
  /** Accessible label; the canvas itself conveys nothing to a screen reader. */
  ariaLabel?: string;
}

export function QrCanvas({
  value,
  size = 240,
  darkColor = "#000000",
  lightColor = "#ffffff",
  className,
  ariaLabel = "QR code",
}: QrCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    void QRCode.toCanvas(canvas, value, {
      width: size,
      margin: 1,
      color: { dark: darkColor, light: lightColor },
    }).catch(() => {
      // A malformed value should not take the page down; the surrounding
      // component already renders the URI as copyable text.
    });
  }, [value, size, darkColor, lightColor]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={ariaLabel}
    />
  );
}
```

- [ ] **Step 9: Write the barrel export**

`packages/ui/src/index.ts`:

```ts
export { cn } from "./cn.js";
export { pollUntilTerminal } from "./poll.js";
export type { PollOptions, PollOutcome } from "./poll.js";
export { useStatusPoll } from "./useStatusPoll.js";
export type { UseStatusPollResult } from "./useStatusPoll.js";
export { useIsTouch } from "./useIsTouch.js";
export { QrCanvas } from "./QrCanvas.js";
export type { QrCanvasProps } from "./QrCanvas.js";
```

- [ ] **Step 10: Install, test, typecheck**

```bash
cd /Users/senexi/dev/eudiw/payment-banking-demo
pnpm install
cd packages/ui && pnpm test && pnpm typecheck
```

Expected: tests PASS, typecheck clean.

- [ ] **Step 11: Commit**

```bash
cd /Users/senexi/dev/eudiw/payment-banking-demo
git add packages/ui pnpm-lock.yaml
git commit -m "feat: add shared ui package with polling, QR, and touch detection"
```

---

### Task 5: Bank app scaffold, env validation, health endpoints

**Files:**
- Create: `apps/bank/package.json`
- Create: `apps/bank/tsconfig.json`
- Create: `apps/bank/next.config.ts`
- Create: `apps/bank/postcss.config.mjs`
- Create: `apps/bank/vitest.config.ts`
- Create: `apps/bank/.env.example`
- Create: `apps/bank/src/env.ts`
- Create: `apps/bank/src/app/globals.css`
- Create: `apps/bank/src/app/layout.tsx`
- Create: `apps/bank/src/app/api/health/route.ts`
- Create: `apps/bank/src/app/api/ready/route.ts`
- Test: `apps/bank/src/env.test.ts`

**Interfaces:**
- Consumes: `@demo/ui` (Task 4), `@demo/foundry-client` (Task 3).
- Produces: `env` — a frozen, validated config object imported by every later
  server module, with fields `PORT: number`, `DATABASE_PATH: string`,
  `BANK_PUBLIC_URL: string`, `FOUNDRY_ADMIN_URL: string`,
  `FOUNDRY_ADMIN_KEY: string`, `BANK_API_KEY: string`, `SESSION_SECRET: string`;
  and `parseEnv(raw: Record<string, string | undefined>)` for tests.

- [ ] **Step 1: Create the package manifest**

`apps/bank/package.json`:

```json
{
  "name": "@demo/bank",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3001",
    "build": "next build",
    "start": "next start --port ${PORT:-3001}",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "migrate": "tsx src/db/migrate.ts",
    "seed": "tsx src/db/seed.ts",
    "db:generate": "drizzle-kit generate"
  },
  "dependencies": {
    "@demo/foundry-client": "workspace:*",
    "@demo/ui": "workspace:*",
    "better-sqlite3": "^11.7.0",
    "drizzle-orm": "^0.38.2",
    "jose": "^5.9.6",
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.0.0",
    "@types/better-sqlite3": "^7.6.12",
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

- [ ] **Step 2: Create tsconfig, next config, postcss, vitest config**

`apps/bank/tsconfig.json`:

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

`apps/bank/next.config.ts` — the two settings below are mandatory for a pnpm
workspace: without `outputFileTracingRoot` the standalone build omits workspace
dependencies and the container starts with missing modules.

```ts
import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  transpilePackages: ["@demo/ui", "@demo/foundry-client"],
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
```

`apps/bank/postcss.config.mjs`:

```js
export default {
  plugins: { "@tailwindcss/postcss": {} },
};
```

`apps/bank/vitest.config.ts` — the `test.env` block is **required**, not
cosmetic. `src/env.ts` validates at module load, and `db/index.ts`, `db/seed.ts`,
`lib/session.ts` and `lib/foundry.ts` all import it, so without these values
every test that touches the database crashes on import.

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
      BANK_API_KEY: "test-bank-key",
      SESSION_SECRET: "test-secret-0123456789012345678901234567890123",
    },
  },
  resolve: {
    alias: { "@": new URL("./src/", import.meta.url).pathname },
  },
});
```

- [ ] **Step 3: Write the failing env test**

`apps/bank/src/env.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.js";

const complete = {
  FOUNDRY_ADMIN_KEY: "admin-key",
  BANK_API_KEY: "bank-key",
  SESSION_SECRET: "0123456789012345678901234567890123456789",
};

describe("parseEnv", () => {
  it("applies documented defaults for non-secret values", () => {
    const env = parseEnv(complete);
    expect(env.PORT).toBe(3001);
    expect(env.DATABASE_PATH).toBe("./data/bank.db");
    expect(env.BANK_PUBLIC_URL).toBe("http://localhost:3001");
    expect(env.FOUNDRY_ADMIN_URL).toBe("http://127.0.0.1:9000");
  });

  it("coerces PORT to a number", () => {
    expect(parseEnv({ ...complete, PORT: "4000" }).PORT).toBe(4000);
  });

  it("throws a named error listing every missing secret", () => {
    expect(() => parseEnv({})).toThrowError(/FOUNDRY_ADMIN_KEY/);
    expect(() => parseEnv({})).toThrowError(/BANK_API_KEY/);
    expect(() => parseEnv({})).toThrowError(/SESSION_SECRET/);
  });

  it("rejects a SESSION_SECRET shorter than 32 characters", () => {
    expect(() => parseEnv({ ...complete, SESSION_SECRET: "short" })).toThrowError(
      /SESSION_SECRET/,
    );
  });

  it("rejects a non-URL FOUNDRY_ADMIN_URL", () => {
    expect(() => parseEnv({ ...complete, FOUNDRY_ADMIN_URL: "nope" })).toThrowError(
      /FOUNDRY_ADMIN_URL/,
    );
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
cd apps/bank && pnpm test
```

Expected: FAIL — cannot resolve `./env.js`.

- [ ] **Step 5: Write env.ts**

`apps/bank/src/env.ts`:

```ts
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_PATH: z.string().min(1).default("./data/bank.db"),
  BANK_PUBLIC_URL: z.string().url().default("http://localhost:3001"),
  FOUNDRY_ADMIN_URL: z.string().url().default("http://127.0.0.1:9000"),
  FOUNDRY_ADMIN_KEY: z.string().min(1),
  BANK_API_KEY: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
});

export type Env = z.infer<typeof schema>;

/** Exported separately from `env` so tests can exercise validation. */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid bank environment configuration — ${detail}`);
  }
  return result.data;
}

/**
 * Validated at module load, so a misconfigured deployment fails at boot with a
 * named error rather than on the first request (spec 8.1).
 */
export const env: Env = parseEnv(process.env);
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd apps/bank && pnpm test
```

Expected: 5 PASS.

- [ ] **Step 7: Write the theme, layout, and health endpoints**

`apps/bank/src/app/globals.css` — tokens are verbatim from spec §9.1.

```css
@import "tailwindcss";

@theme {
  --color-primary: oklch(0.6279 0.2576 29);
  --color-primary-foreground: oklch(0.99 0 0);
  --color-background: oklch(0.99 0.005 240);
  --color-foreground: oklch(0.18 0.03 250);
  --color-card: oklch(1 0 0);
  --color-border: oklch(0.92 0.01 250);
  --color-header: oklch(0.6279 0.2576 29);
  --color-success: oklch(0.65 0.17 155);
  --color-destructive: oklch(0.6 0.22 25);
  --color-muted: oklch(0.96 0.01 240);
  --color-muted-foreground: oklch(0.45 0.02 250);

  --font-sans: "Inter", system-ui, -apple-system, sans-serif;
  --radius: 0.75rem;

  --shadow-panel:
    0 8px 32px -4px rgb(0 0 0 / 0.12), 0 2px 8px -2px rgb(0 0 0 / 0.06);
}

body {
  background: var(--color-background);
  color: var(--color-foreground);
  font-family: var(--font-sans);
}
```

`apps/bank/src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sparkasse Musterstadt",
  description: "Online-Banking Demo mit EUDI Wallet",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
```

`apps/bank/src/app/api/health/route.ts`:

```ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok" });
}
```

`apps/bank/src/app/api/ready/route.ts` — the real DB check arrives in Task 6;
this version is honest about only proving the process is up.

```ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ready" });
}
```

- [ ] **Step 8: Write .env.example**

`apps/bank/.env.example`:

```
# Copy to .env.local for local development.
PORT=3001
DATABASE_PATH=./data/bank.db
BANK_PUBLIC_URL=http://localhost:3001

# foundry's ADMIN listener — never publicly exposed.
FOUNDRY_ADMIN_URL=http://127.0.0.1:9000
FOUNDRY_ADMIN_KEY=dev-admin-key

# Shared secret the merchant must present on POST /api/payments (used in Plan 2).
BANK_API_KEY=dev-bank-api-key

# Must be at least 32 characters. Generate with: openssl rand -hex 32
SESSION_SECRET=change-me-0123456789012345678901234567890123456789
```

- [ ] **Step 9: Install and verify the app boots**

```bash
cd /Users/senexi/dev/eudiw/payment-banking-demo
pnpm install
cd apps/bank && cp .env.example .env.local && pnpm typecheck
pnpm dev &
sleep 12
curl -sS http://localhost:3001/api/health
curl -sS http://localhost:3001/api/ready
kill %1
```

Expected: `{"status":"ok"}` and `{"status":"ready"}`.

- [ ] **Step 10: Commit**

```bash
cd /Users/senexi/dev/eudiw/payment-banking-demo
git add apps/bank pnpm-lock.yaml
git commit -m "feat(bank): scaffold app with validated env and health endpoints"
```

---

### Task 6: Bank database — schema, migrations, seed

Includes `idempotency_key` on `transactions` even though `POST /api/payments`
arrives in Plan 2: the schema is one file, and splitting it would mean a
migration in Plan 2 for a column the design already specifies (§5.1).

**Files:**
- Create: `apps/bank/drizzle.config.ts`
- Create: `apps/bank/src/db/schema.ts`
- Create: `apps/bank/src/db/index.ts`
- Create: `apps/bank/src/db/migrate.ts`
- Create: `apps/bank/src/db/seed.ts`
- Modify: `apps/bank/src/app/api/ready/route.ts` (real DB check)
- Test: `apps/bank/src/db/schema.test.ts`

**Interfaces:**
- Consumes: `env` from Task 5.
- Produces:
  - tables `users`, `accounts`, `cards`, `credentials`, `transactions` (Drizzle
    table objects, camelCase properties over snake_case columns)
  - `getDb(): BetterSQLite3Database<typeof schema>` — memoized, runs migrations
    on first call
  - `createDb(path: string)` — for tests, no memoization
  - `seed(db)` — idempotent; deletes all rows then inserts fixtures
  - fixture ids `user_anna`, `user_ben`, `acc_anna`, `acc_ben`, `card_anna`,
    `card_ben`; usernames `anna` / `ben`, both with password `demo1234`

- [ ] **Step 1: Write the schema**

`apps/bank/src/db/schema.ts`:

```ts
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
});

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  iban: text("iban").notNull(),
  currency: text("currency").notNull().default("EUR"),
  balanceCents: integer("balance_cents").notNull(),
});

export const cards = sqliteTable("cards", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id),
  panLast4: text("pan_last4").notNull(),
  network: text("network").notNull(),
  cardAlias: text("card_alias").notNull(),
  createdAt: integer("created_at").notNull(),
});

/**
 * A digital credential instance derived from a card. One card may yield several
 * rows over time (re-issue after expiry); there is no `revoked` state (spec 2).
 */
export const credentials = sqliteTable("credentials", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  cardId: text("card_id")
    .notNull()
    .references(() => cards.id),
  /** The opaque value carried in the DPC credential — the loop's join key. */
  credentialId: text("credential_id").notNull().unique(),
  foundryTxId: text("foundry_tx_id"),
  state: text("state", { enum: ["offered", "active", "failed"] }).notNull(),
  issuedAt: integer("issued_at"),
  createdAt: integer("created_at").notNull(),
});

export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    /** Negative for a debit, positive for a credit. Always integer cents. */
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("EUR"),
    counterparty: text("counterparty").notNull(),
    reference: text("reference").notNull(),
    bookedAt: integer("booked_at").notNull(),
    /** Set when a wallet presentation authorized this transaction. */
    credentialId: text("credential_id"),
    /** Merchant payment-session id; makes POST /api/payments idempotent. */
    idempotencyKey: text("idempotency_key"),
  },
  (table) => [
    uniqueIndex("transactions_idempotency_key_unique").on(table.idempotencyKey),
  ],
);

export type User = typeof users.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Card = typeof cards.$inferSelect;
export type Credential = typeof credentials.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type CredentialState = Credential["state"];
```

- [ ] **Step 2: Write the drizzle-kit config**

`apps/bank/drizzle.config.ts`:

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
cd apps/bank && pnpm db:generate
ls drizzle
```

Expected: a `drizzle/0000_*.sql` file plus `drizzle/meta/`. Commit these — the
container applies them at boot and must not need drizzle-kit at runtime.

- [ ] **Step 4: Write the db module**

`apps/bank/src/db/index.ts`:

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

`apps/bank/src/db/migrate.ts`:

```ts
import { getDb } from "./index.js";

getDb();
console.log("bank: migrations applied");
```

- [ ] **Step 5: Write the failing schema/seed test**

`apps/bank/src/db/schema.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "./index.js";
import { accounts, cards, credentials, transactions, users } from "./schema.js";
import { seed } from "./seed.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bank-db-"));
  db = createDb(path.join(dir, "test.db"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("seed", () => {
  it("creates exactly two users with accounts and cards", () => {
    seed(db);
    expect(db.select().from(users).all()).toHaveLength(2);
    expect(db.select().from(accounts).all()).toHaveLength(2);
    expect(db.select().from(cards).all()).toHaveLength(2);
  });

  it("creates ten historical transactions per account, none wallet-paid", () => {
    seed(db);
    const rows = db.select().from(transactions).all();
    expect(rows).toHaveLength(20);
    expect(rows.every((row) => row.credentialId === null)).toBe(true);
    expect(rows.every((row) => row.idempotencyKey === null)).toBe(true);
  });

  it("issues no credentials, so cards start out not in the wallet", () => {
    seed(db);
    expect(db.select().from(credentials).all()).toHaveLength(0);
  });

  it("is idempotent — running twice leaves the same row counts", () => {
    seed(db);
    seed(db);
    expect(db.select().from(users).all()).toHaveLength(2);
    expect(db.select().from(transactions).all()).toHaveLength(20);
  });

  it("gives each account a positive balance in whole cents", () => {
    seed(db);
    for (const account of db.select().from(accounts).all()) {
      expect(account.balanceCents).toBeGreaterThan(0);
      expect(Number.isInteger(account.balanceCents)).toBe(true);
    }
  });

  it("links every card to an account owned by the same user", () => {
    seed(db);
    for (const card of db.select().from(cards).all()) {
      const account = db.select().from(accounts).where(eq(accounts.id, card.accountId)).get();
      expect(account?.userId).toBe(card.userId);
    }
  });
});

describe("transactions.idempotency_key", () => {
  it("rejects a duplicate non-null key", () => {
    seed(db);
    const account = db.select().from(accounts).all()[0];
    expect(account).toBeDefined();

    const row = {
      accountId: account!.id,
      amountCents: -100,
      currency: "EUR",
      counterparty: "Demo Shop",
      reference: "Order #1",
      bookedAt: 1,
      credentialId: "dpc_x",
      idempotencyKey: "sess_1",
    };

    db.insert(transactions).values({ id: "t_1", ...row }).run();
    expect(() =>
      db.insert(transactions).values({ id: "t_2", ...row }).run(),
    ).toThrowError(/UNIQUE/i);
  });

  it("allows many null keys, so seeded history is unconstrained", () => {
    seed(db);
    const account = db.select().from(accounts).all()[0];
    db.insert(transactions)
      .values({
        id: "t_null_1",
        accountId: account!.id,
        amountCents: -1,
        currency: "EUR",
        counterparty: "x",
        reference: "y",
        bookedAt: 1,
      })
      .run();
    expect(db.select().from(transactions).all()).toHaveLength(21);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

```bash
cd apps/bank && pnpm test src/db/schema.test.ts
```

Expected: FAIL — cannot resolve `./seed.js`.

- [ ] **Step 7: Write the seed script**

`apps/bank/src/db/seed.ts`:

```ts
import { hashPassword } from "../lib/password.js";
import { createDb, type Db } from "./index.js";
import { accounts, cards, credentials, transactions, users } from "./schema.js";
import { env } from "../env.js";

const DAY_MS = 86_400_000;

interface Fixture {
  userId: string;
  username: string;
  displayName: string;
  accountId: string;
  iban: string;
  balanceCents: number;
  cardId: string;
  panLast4: string;
  network: string;
  cardAlias: string;
}

const FIXTURES: Fixture[] = [
  {
    userId: "user_anna",
    username: "anna",
    displayName: "Anna Schmidt",
    accountId: "acc_anna",
    iban: "DE02120300000000202051",
    balanceCents: 348_712,
    cardId: "card_anna",
    panLast4: "4242",
    network: "VISA",
    cardAlias: "Girocard",
  },
  {
    userId: "user_ben",
    username: "ben",
    displayName: "Ben Müller",
    accountId: "acc_ben",
    iban: "DE02500105170137075030",
    balanceCents: 129_540,
    cardId: "card_ben",
    panLast4: "8815",
    network: "Mastercard",
    cardAlias: "Kreditkarte",
  },
];

/** Ten plausible booked transactions, newest first. */
const HISTORY: Array<{ counterparty: string; reference: string; amountCents: number }> = [
  { counterparty: "REWE Markt GmbH", reference: "Kartenzahlung", amountCents: -4_215 },
  { counterparty: "Deutsche Bahn AG", reference: "Fahrkarte Berlin-Hamburg", amountCents: -8_990 },
  { counterparty: "Stadtwerke Musterstadt", reference: "Abschlag Strom", amountCents: -7_400 },
  { counterparty: "Arbeitgeber GmbH", reference: "Gehalt", amountCents: 245_000 },
  { counterparty: "Netflix International", reference: "Abo", amountCents: -1_799 },
  { counterparty: "Apotheke am Markt", reference: "Kartenzahlung", amountCents: -2_340 },
  { counterparty: "Vermietung Mustermann", reference: "Miete", amountCents: -98_000 },
  { counterparty: "dm-drogerie markt", reference: "Kartenzahlung", amountCents: -3_112 },
  { counterparty: "Telekom Deutschland", reference: "Mobilfunk", amountCents: -3_999 },
  { counterparty: "Buchhandlung Lesezeit", reference: "Kartenzahlung", amountCents: -2_650 },
];

/**
 * Resets the database to the documented fixtures (spec 5.3). Idempotent:
 * deletes every row first, so `pnpm seed` returns the demo to a known state.
 */
export function seed(db: Db, now = Date.now()): void {
  db.delete(transactions).run();
  db.delete(credentials).run();
  db.delete(cards).run();
  db.delete(accounts).run();
  db.delete(users).run();

  const passwordHash = hashPassword("demo1234");

  for (const fixture of FIXTURES) {
    db.insert(users)
      .values({
        id: fixture.userId,
        username: fixture.username,
        passwordHash,
        displayName: fixture.displayName,
      })
      .run();

    db.insert(accounts)
      .values({
        id: fixture.accountId,
        userId: fixture.userId,
        iban: fixture.iban,
        currency: "EUR",
        balanceCents: fixture.balanceCents,
      })
      .run();

    db.insert(cards)
      .values({
        id: fixture.cardId,
        userId: fixture.userId,
        accountId: fixture.accountId,
        panLast4: fixture.panLast4,
        network: fixture.network,
        cardAlias: fixture.cardAlias,
        createdAt: now - 400 * DAY_MS,
      })
      .run();

    HISTORY.forEach((entry, index) => {
      db.insert(transactions)
        .values({
          id: `tx_${fixture.userId}_${index}`,
          accountId: fixture.accountId,
          amountCents: entry.amountCents,
          currency: "EUR",
          counterparty: entry.counterparty,
          reference: entry.reference,
          bookedAt: now - (index + 1) * 2 * DAY_MS,
          credentialId: null,
          idempotencyKey: null,
        })
        .run();
    });
  }
}

/** CLI entry point: `pnpm seed`. */
function main(): void {
  const db = createDb(env.DATABASE_PATH);
  seed(db);
  console.log(
    `bank: seeded ${FIXTURES.length} users — login with ` +
      FIXTURES.map((f) => `${f.username}/demo1234`).join(" or "),
  );
}

if (process.argv[1]?.endsWith("seed.ts")) main();
```

- [ ] **Step 8: Write password.ts (needed by seed)**

`apps/bank/src/lib/password.ts` — full unit tests for this land in Task 7; the
seed script needs it now.

```ts
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;

/** Returns `scrypt$<saltHex>$<hashHex>`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/** Constant-time comparison. Returns false for any malformed stored value. */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, saltHex, hashHex] = parts;
  if (!saltHex || !hashHex) return false;

  let expected: Buffer;
  try {
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (expected.length !== KEY_LENGTH) return false;

  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), KEY_LENGTH);
  return timingSafeEqual(actual, expected);
}
```

- [ ] **Step 9: Run the tests to verify they pass**

```bash
cd apps/bank && pnpm test src/db/schema.test.ts
```

Expected: 8 PASS.

- [ ] **Step 10: Make /api/ready actually check the database**

Replace `apps/bank/src/app/api/ready/route.ts`:

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

- [ ] **Step 11: Seed and verify end to end**

```bash
cd apps/bank
pnpm migrate && pnpm seed
pnpm dev &
sleep 12
curl -sS http://localhost:3001/api/ready
kill %1
```

Expected: seed prints the two logins; `/api/ready` returns
`{"status":"ready"}`.

- [ ] **Step 12: Commit**

```bash
cd /Users/senexi/dev/eudiw/payment-banking-demo
git add apps/bank
git commit -m "feat(bank): add drizzle schema, migrations, and seed fixtures"
```

---

### Task 7: Bank authentication

**Files:**
- Create: `apps/bank/src/lib/session.ts`
- Create: `apps/bank/src/app/api/auth/login/route.ts`
- Create: `apps/bank/src/app/api/auth/logout/route.ts`
- Create: `apps/bank/src/app/api/auth/me/route.ts`
- Test: `apps/bank/src/lib/password.test.ts`
- Test: `apps/bank/src/lib/session.test.ts`

**Interfaces:**
- Consumes: `hashPassword` / `verifyPassword` from `lib/password.ts` (Task 6),
  `getDb` and `users` from Task 6, `env.SESSION_SECRET` from Task 5.
- Produces:
  - `SESSION_COOKIE = "bank_session"` (exported constant)
  - `signSession(payload: SessionPayload): Promise<string>` where
    `SessionPayload = { userId: string; displayName: string }`
  - `verifySession(token: string): Promise<SessionPayload | null>` — returns
    `null` for any invalid, tampered, or expired token, never throws
  - `getSession(): Promise<SessionPayload | null>` — reads the cookie in a route
    handler or server component
  - `requireSession(): Promise<SessionPayload>` — throws `UnauthorizedError`
  - `class UnauthorizedError extends Error`

- [ ] **Step 1: Write the failing password test**

`apps/bank/src/lib/password.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("hashPassword", () => {
  it("produces a scrypt$salt$hash triple", () => {
    const stored = hashPassword("demo1234");
    const parts = stored.split("$");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("scrypt");
    expect(parts[1]).toMatch(/^[0-9a-f]{32}$/);
    expect(parts[2]).toMatch(/^[0-9a-f]{128}$/);
  });

  it("salts, so the same password hashes differently each time", () => {
    expect(hashPassword("demo1234")).not.toBe(hashPassword("demo1234"));
  });

  it("never stores the plaintext", () => {
    expect(hashPassword("demo1234")).not.toContain("demo1234");
  });
});

describe("verifyPassword", () => {
  it("accepts the correct password", () => {
    expect(verifyPassword("demo1234", hashPassword("demo1234"))).toBe(true);
  });

  it("rejects the wrong password", () => {
    expect(verifyPassword("wrong", hashPassword("demo1234"))).toBe(false);
  });

  it("rejects a password differing only in case", () => {
    expect(verifyPassword("Demo1234", hashPassword("demo1234"))).toBe(false);
  });

  it("returns false rather than throwing on malformed stored values", () => {
    expect(verifyPassword("x", "")).toBe(false);
    expect(verifyPassword("x", "plaintext")).toBe(false);
    expect(verifyPassword("x", "scrypt$deadbeef")).toBe(false);
    expect(verifyPassword("x", "bcrypt$aa$bb")).toBe(false);
    expect(verifyPassword("x", "scrypt$zz$zz")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm password.ts already satisfies these**

```bash
cd apps/bank && pnpm test src/lib/password.test.ts
```

Expected: 8 PASS — `password.ts` was written in Task 6 Step 8. If any fail, fix
`password.ts`, not the test.

- [ ] **Step 3: Write the failing session test**

`apps/bank/src/lib/session.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "0123456789012345678901234567890123456789";

vi.mock("../env.js", () => ({
  env: {
    PORT: 3001,
    DATABASE_PATH: ":memory:",
    BANK_PUBLIC_URL: "http://localhost:3001",
    FOUNDRY_ADMIN_URL: "http://127.0.0.1:9000",
    FOUNDRY_ADMIN_KEY: "k",
    BANK_API_KEY: "b",
    SESSION_SECRET: SECRET,
  },
}));

const { SESSION_COOKIE, signSession, verifySession } = await import("./session.js");

describe("SESSION_COOKIE", () => {
  it("is the documented cookie name", () => {
    expect(SESSION_COOKIE).toBe("bank_session");
  });
});

describe("signSession / verifySession", () => {
  let token: string;

  beforeEach(async () => {
    token = await signSession({ userId: "user_anna", displayName: "Anna Schmidt" });
  });

  it("round-trips the payload", async () => {
    await expect(verifySession(token)).resolves.toEqual({
      userId: "user_anna",
      displayName: "Anna Schmidt",
    });
  });

  it("produces a compact three-segment JWS", () => {
    expect(token.split(".")).toHaveLength(3);
  });

  it("returns null for a tampered signature", async () => {
    const [header, payload] = token.split(".");
    await expect(verifySession(`${header}.${payload}.deadbeef`)).resolves.toBeNull();
  });

  it("returns null for a token signed with a different secret", async () => {
    const { SignJWT } = await import("jose");
    const foreign = await new SignJWT({ userId: "u", displayName: "d" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("a-completely-different-secret-value-32ch"));
    await expect(verifySession(foreign)).resolves.toBeNull();
  });

  it("returns null for garbage input rather than throwing", async () => {
    await expect(verifySession("")).resolves.toBeNull();
    await expect(verifySession("not-a-jwt")).resolves.toBeNull();
    await expect(verifySession("a.b.c")).resolves.toBeNull();
  });

  it("returns null for an expired token", async () => {
    const { SignJWT } = await import("jose");
    const expired = await new SignJWT({ userId: "u", displayName: "d" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(SECRET));
    await expect(verifySession(expired)).resolves.toBeNull();
  });

  it("returns null when the payload lacks a userId", async () => {
    const { SignJWT } = await import("jose");
    const malformed = await new SignJWT({ displayName: "d" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(SECRET));
    await expect(verifySession(malformed)).resolves.toBeNull();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
cd apps/bank && pnpm test src/lib/session.test.ts
```

Expected: FAIL — cannot resolve `./session.js`.

- [ ] **Step 5: Write session.ts**

`apps/bank/src/lib/session.ts`:

```ts
import { cookies } from "next/headers";
import { jwtVerify, SignJWT } from "jose";
import { env } from "../env.js";

export const SESSION_COOKIE = "bank_session";

const ALG = "HS256";
const TTL = "12h";

export interface SessionPayload {
  userId: string;
  displayName: string;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "UnauthorizedError";
  }
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(env.SESSION_SECRET);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ userId: payload.userId, displayName: payload.displayName })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(TTL)
    .sign(secretKey());
}

/** Returns null for any token that is invalid, tampered, expired, or malformed. */
export async function verifySession(token: string): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: [ALG] });
    const userId = payload["userId"];
    const displayName = payload["displayName"];
    if (typeof userId !== "string" || typeof displayName !== "string") return null;
    if (userId.length === 0) return null;
    return { userId, displayName };
  } catch {
    return null;
  }
}

/** Reads and verifies the session cookie. Usable in route handlers and RSCs. */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return token ? verifySession(token) : null;
}

export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  return session;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd apps/bank && pnpm test src/lib/session.test.ts
```

Expected: 9 PASS.

- [ ] **Step 7: Write the three auth route handlers**

`apps/bank/src/app/api/auth/login/route.ts`:

```ts
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/index.js";
import { users } from "@/db/schema.js";
import { verifyPassword } from "@/lib/password.js";
import { SESSION_COOKIE, signSession } from "@/lib/session.js";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const db = getDb();
  const user = db
    .select()
    .from(users)
    .where(eq(users.username, parsed.data.username))
    .get();

  // Same response for unknown user and wrong password: never reveal which.
  if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const token = await signSession({ userId: user.id, displayName: user.displayName });
  const response = NextResponse.json({
    userId: user.id,
    displayName: user.displayName,
  });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
  return response;
}
```

`apps/bank/src/app/api/auth/logout/route.ts`:

```ts
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session.js";

export const dynamic = "force-dynamic";

export function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
```

`apps/bank/src/app/api/auth/me/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  return NextResponse.json(session);
}
```

- [ ] **Step 8: Verify the login flow over HTTP**

```bash
cd apps/bank && pnpm seed && pnpm dev &
sleep 12
echo "--- wrong password rejected ---"
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3001/api/auth/login \
  -H 'content-type: application/json' -d '{"username":"anna","password":"nope"}'
echo "--- unknown user rejected identically ---"
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3001/api/auth/login \
  -H 'content-type: application/json' -d '{"username":"nobody","password":"demo1234"}'
echo "--- correct login sets a cookie ---"
curl -sS -c /tmp/bank-cookies.txt -X POST http://localhost:3001/api/auth/login \
  -H 'content-type: application/json' -d '{"username":"anna","password":"demo1234"}'
echo "--- /me with cookie ---"
curl -sS -b /tmp/bank-cookies.txt http://localhost:3001/api/auth/me
echo "--- /me without cookie ---"
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:3001/api/auth/me
kill %1
```

Expected: `401`, `401`, then `{"userId":"user_anna","displayName":"Anna Schmidt"}`
from both login and `/me`, then `401` for the cookieless call. Confirm
`/tmp/bank-cookies.txt` shows `bank_session` flagged `HttpOnly`.

- [ ] **Step 9: Commit**

```bash
cd /Users/senexi/dev/eudiw/payment-banking-demo
git add apps/bank
git commit -m "feat(bank): add password hashing, JWT sessions, and auth endpoints"
```

---

### Task 8: Bank read APIs

**Files:**
- Create: `apps/bank/src/lib/api.ts`
- Create: `apps/bank/src/lib/queries.ts`
- Create: `apps/bank/src/app/api/accounts/route.ts`
- Create: `apps/bank/src/app/api/cards/route.ts`
- Create: `apps/bank/src/app/api/transactions/route.ts`
- Test: `apps/bank/src/lib/queries.test.ts`

**Interfaces:**
- Consumes: `getDb`, tables from Task 6; `requireSession`, `UnauthorizedError`
  from Task 7.
- Produces:
  - `withSession(handler: (session: SessionPayload, request: Request) => Promise<Response>): (request: Request) => Promise<Response>`
    — wraps a handler, turning `UnauthorizedError` into HTTP 401
  - `listAccounts(db, userId): AccountDto[]` where
    `AccountDto = { id: string; iban: string; currency: string; balanceCents: number }`
  - `listCards(db, userId): CardDto[]` where
    `CardDto = { id: string; panLast4: string; network: string; cardAlias: string; accountId: string; credentialState: "none" | "offered" | "active"; credentialRowId: string | null }`
  - `listTransactions(db, userId, limit, offset): TransactionDto[]` where
    `TransactionDto = { id: string; amountCents: number; currency: string; counterparty: string; reference: string; bookedAt: number; paidWithWallet: boolean }`

- [ ] **Step 1: Write the failing queries test**

`apps/bank/src/lib/queries.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/index.js";
import { credentials, transactions } from "../db/schema.js";
import { seed } from "../db/seed.js";
import { listAccounts, listCards, listTransactions } from "./queries.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bank-q-"));
  db = createDb(path.join(dir, "test.db"));
  seed(db);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("listAccounts", () => {
  it("returns only the requesting user's accounts", () => {
    const anna = listAccounts(db, "user_anna");
    expect(anna).toHaveLength(1);
    expect(anna[0]?.id).toBe("acc_anna");
    expect(anna[0]?.balanceCents).toBe(348_712);
  });

  it("returns an empty array for an unknown user", () => {
    expect(listAccounts(db, "user_nobody")).toEqual([]);
  });

  it("never leaks another user's account", () => {
    expect(listAccounts(db, "user_ben").map((a) => a.id)).toEqual(["acc_ben"]);
  });
});

describe("listCards", () => {
  it("reports credentialState 'none' when no credential exists", () => {
    const cards = listCards(db, "user_anna");
    expect(cards).toHaveLength(1);
    expect(cards[0]?.credentialState).toBe("none");
    expect(cards[0]?.credentialRowId).toBeNull();
    expect(cards[0]?.panLast4).toBe("4242");
    expect(cards[0]?.network).toBe("VISA");
  });

  it("reports 'offered' while issuance is pending", () => {
    db.insert(credentials)
      .values({
        id: "cred_1",
        userId: "user_anna",
        cardId: "card_anna",
        credentialId: "dpc_1",
        foundryTxId: "tx_1",
        state: "offered",
        issuedAt: null,
        createdAt: 1,
      })
      .run();
    const cards = listCards(db, "user_anna");
    expect(cards[0]?.credentialState).toBe("offered");
    expect(cards[0]?.credentialRowId).toBe("cred_1");
  });

  it("reports 'active' once issued", () => {
    db.insert(credentials)
      .values({
        id: "cred_2",
        userId: "user_anna",
        cardId: "card_anna",
        credentialId: "dpc_2",
        foundryTxId: "tx_2",
        state: "active",
        issuedAt: 100,
        createdAt: 50,
      })
      .run();
    expect(listCards(db, "user_anna")[0]?.credentialState).toBe("active");
  });

  it("prefers the newest credential when a card has several", () => {
    db.insert(credentials)
      .values({
        id: "cred_old",
        userId: "user_anna",
        cardId: "card_anna",
        credentialId: "dpc_old",
        state: "active",
        issuedAt: 10,
        createdAt: 10,
      })
      .run();
    db.insert(credentials)
      .values({
        id: "cred_new",
        userId: "user_anna",
        cardId: "card_anna",
        credentialId: "dpc_new",
        state: "offered",
        issuedAt: null,
        createdAt: 20,
      })
      .run();
    const card = listCards(db, "user_anna")[0];
    expect(card?.credentialRowId).toBe("cred_new");
    expect(card?.credentialState).toBe("offered");
  });

  it("ignores 'failed' credentials so a failed attempt shows as 'none'", () => {
    db.insert(credentials)
      .values({
        id: "cred_bad",
        userId: "user_anna",
        cardId: "card_anna",
        credentialId: "dpc_bad",
        state: "failed",
        issuedAt: null,
        createdAt: 99,
      })
      .run();
    expect(listCards(db, "user_anna")[0]?.credentialState).toBe("none");
  });
});

describe("listTransactions", () => {
  it("returns the newest transactions first", () => {
    const rows = listTransactions(db, "user_anna", 5, 0);
    expect(rows).toHaveLength(5);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.bookedAt).toBeGreaterThanOrEqual(rows[i]!.bookedAt);
    }
  });

  it("honours limit and offset", () => {
    const first = listTransactions(db, "user_anna", 3, 0);
    const second = listTransactions(db, "user_anna", 3, 3);
    expect(first).toHaveLength(3);
    expect(second).toHaveLength(3);
    expect(first.map((r) => r.id)).not.toEqual(second.map((r) => r.id));
  });

  it("marks seeded history as not wallet-paid", () => {
    expect(listTransactions(db, "user_anna", 20, 0).every((r) => !r.paidWithWallet)).toBe(
      true,
    );
  });

  it("marks a transaction with a credential_id as wallet-paid", () => {
    db.insert(transactions)
      .values({
        id: "tx_wallet",
        accountId: "acc_anna",
        amountCents: -4_798,
        currency: "EUR",
        counterparty: "Demo Shop",
        reference: "Order #1",
        bookedAt: Date.now() + 1000,
        credentialId: "dpc_1",
        idempotencyKey: "sess_1",
      })
      .run();
    const newest = listTransactions(db, "user_anna", 1, 0)[0];
    expect(newest?.id).toBe("tx_wallet");
    expect(newest?.paidWithWallet).toBe(true);
  });

  it("never returns another user's transactions", () => {
    const ids = listTransactions(db, "user_ben", 50, 0).map((r) => r.id);
    expect(ids.every((id) => id.startsWith("tx_user_ben"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/bank && pnpm test src/lib/queries.test.ts
```

Expected: FAIL — cannot resolve `./queries.js`.

- [ ] **Step 3: Write queries.ts**

`apps/bank/src/lib/queries.ts`:

```ts
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { accounts, cards, credentials, transactions } from "../db/schema.js";

export interface AccountDto {
  id: string;
  iban: string;
  currency: string;
  balanceCents: number;
}

/** "none" also covers a card whose only credential attempt failed. */
export type CardCredentialState = "none" | "offered" | "active";

export interface CardDto {
  id: string;
  accountId: string;
  panLast4: string;
  network: string;
  cardAlias: string;
  credentialState: CardCredentialState;
  credentialRowId: string | null;
}

export interface TransactionDto {
  id: string;
  amountCents: number;
  currency: string;
  counterparty: string;
  reference: string;
  bookedAt: number;
  paidWithWallet: boolean;
}

export function listAccounts(db: Db, userId: string): AccountDto[] {
  return db
    .select({
      id: accounts.id,
      iban: accounts.iban,
      currency: accounts.currency,
      balanceCents: accounts.balanceCents,
    })
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .all();
}

export function listCards(db: Db, userId: string): CardDto[] {
  const rows = db.select().from(cards).where(eq(cards.userId, userId)).all();

  return rows.map((card) => {
    // Newest non-failed credential wins: a re-issue supersedes its predecessor.
    const credential = db
      .select()
      .from(credentials)
      .where(
        and(
          eq(credentials.cardId, card.id),
          inArray(credentials.state, ["offered", "active"]),
        ),
      )
      .orderBy(desc(credentials.createdAt))
      .limit(1)
      .get();

    return {
      id: card.id,
      accountId: card.accountId,
      panLast4: card.panLast4,
      network: card.network,
      cardAlias: card.cardAlias,
      credentialState: credential ? credential.state : "none",
      credentialRowId: credential?.id ?? null,
    } satisfies CardDto;
  });
}

export function listTransactions(
  db: Db,
  userId: string,
  limit: number,
  offset: number,
): TransactionDto[] {
  const owned = db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .all()
    .map((row) => row.id);

  if (owned.length === 0) return [];

  return db
    .select()
    .from(transactions)
    .where(inArray(transactions.accountId, owned))
    .orderBy(desc(transactions.bookedAt))
    .limit(limit)
    .offset(offset)
    .all()
    .map((row) => ({
      id: row.id,
      amountCents: row.amountCents,
      currency: row.currency,
      counterparty: row.counterparty,
      reference: row.reference,
      bookedAt: row.bookedAt,
      paidWithWallet: row.credentialId !== null,
    }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd apps/bank && pnpm test src/lib/queries.test.ts
```

Expected: 14 PASS. Note `credentialState` deliberately narrows the DB's
`"failed"` to `"none"` — the UI has no failed state, and the last test in the
`listCards` block pins that.

- [ ] **Step 5: Write the session wrapper**

`apps/bank/src/lib/api.ts`:

```ts
import { NextResponse } from "next/server";
import { requireSession, UnauthorizedError, type SessionPayload } from "./session.js";

export type SessionHandler = (
  session: SessionPayload,
  request: Request,
) => Promise<Response>;

/**
 * Wraps a route handler so it only runs with a valid session, turning
 * UnauthorizedError into a 401 instead of a 500.
 */
export function withSession(handler: SessionHandler) {
  return async (request: Request): Promise<Response> => {
    let session: SessionPayload;
    try {
      session = await requireSession();
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
      }
      throw error;
    }
    return handler(session, request);
  };
}
```

- [ ] **Step 6: Write the three read routes**

`apps/bank/src/app/api/accounts/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import { withSession } from "@/lib/api.js";
import { listAccounts } from "@/lib/queries.js";

export const dynamic = "force-dynamic";

export const GET = withSession(async (session) =>
  NextResponse.json({ accounts: listAccounts(getDb(), session.userId) }),
);
```

`apps/bank/src/app/api/cards/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import { withSession } from "@/lib/api.js";
import { listCards } from "@/lib/queries.js";

export const dynamic = "force-dynamic";

export const GET = withSession(async (session) =>
  NextResponse.json({ cards: listCards(getDb(), session.userId) }),
);
```

`apps/bank/src/app/api/transactions/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/index.js";
import { withSession } from "@/lib/api.js";
import { listTransactions } from "@/lib/queries.js";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const GET = withSession(async (session, request) => {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }

  return NextResponse.json({
    transactions: listTransactions(
      getDb(),
      session.userId,
      parsed.data.limit,
      parsed.data.offset,
    ),
  });
});
```

- [ ] **Step 7: Verify over HTTP**

```bash
cd apps/bank && pnpm seed && pnpm dev &
sleep 12
curl -sS -c /tmp/c.txt -X POST http://localhost:3001/api/auth/login \
  -H 'content-type: application/json' -d '{"username":"anna","password":"demo1234"}' >/dev/null
echo "--- accounts ---";     curl -sS -b /tmp/c.txt http://localhost:3001/api/accounts
echo "--- cards ---";        curl -sS -b /tmp/c.txt http://localhost:3001/api/cards
echo "--- transactions ---"; curl -sS -b /tmp/c.txt 'http://localhost:3001/api/transactions?limit=3'
echo "--- unauthenticated ---"
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:3001/api/accounts
echo "--- bad query rejected ---"
curl -sS -b /tmp/c.txt -o /dev/null -w '%{http_code}\n' \
  'http://localhost:3001/api/transactions?limit=999'
kill %1
```

Expected: one account with `balanceCents: 348712`; one card with
`credentialState: "none"`; three transactions newest-first; `401` for the
cookieless call; `400` for `limit=999`.

- [ ] **Step 8: Commit**

```bash
cd /Users/senexi/dev/eudiw/payment-banking-demo
git add apps/bank
git commit -m "feat(bank): add accounts, cards, and transactions read APIs"
```

---
### Task 9: Bank login page

Visual reference: spec §9.2. A centered 420px card on an overlay with a
full-width red header block. The seeded credentials are shown on the page on
purpose — a demo nobody can log into is a bad demo.

**Files:**
- Create: `apps/bank/src/components/SparkasseLogo.tsx`
- Create: `apps/bank/src/components/AuthCard.tsx`
- Create: `apps/bank/src/components/LoginForm.tsx`
- Create: `apps/bank/src/app/login/page.tsx`
- Modify: `apps/bank/src/app/globals.css` (append component classes)

**Interfaces:**
- Consumes: `POST /api/auth/login` (Task 7); `cn` from `@demo/ui` (Task 4).
- Produces:
  - `<SparkasseLogo className?: string />` — inline SVG, `currentColor`
  - `<AuthCard title: string; subtitle: string; tagline: string; children: ReactNode />`
  - `<LoginForm />` — client component; on success does
    `router.replace("/")` then `router.refresh()`

- [ ] **Step 1: Append the auth layout classes to globals.css**

Append to `apps/bank/src/app/globals.css`:

```css
.auth-overlay {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: var(--color-muted);
}

.auth-card {
  width: 100%;
  max-width: 420px;
  background: var(--color-card);
  border-radius: var(--radius);
  overflow: hidden;
  box-shadow: var(--shadow-panel);
}

.auth-card-header {
  background: var(--color-header);
  color: var(--color-primary-foreground);
  padding: 1.5rem;
  display: flex;
  align-items: center;
  gap: 0.875rem;
}

.auth-card-tagline {
  font-size: 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.85;
}
```

- [ ] **Step 2: Write the logo component**

`apps/bank/src/components/SparkasseLogo.tsx`:

```tsx
export function SparkasseLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="20" cy="20" r="20" fill="currentColor" opacity="0.16" />
      <path
        d="M12 26.5c1.9 1.6 4.4 2.5 7.1 2.5 4.6 0 7.9-2.4 7.9-5.9 0-3.2-2.3-4.7-6.6-5.7-3.1-.7-4.2-1.3-4.2-2.5 0-1.2 1.2-2 3.2-2 1.9 0 3.7.6 5.2 1.7l2-3.3C24.8 9.9 22.3 9 19.6 9c-4.4 0-7.6 2.4-7.6 5.8 0 3.3 2.4 4.8 6.6 5.7 3 .7 4.1 1.3 4.1 2.6 0 1.3-1.3 2.1-3.5 2.1-2.1 0-4.1-.8-5.6-2.1L12 26.5Z"
        fill="currentColor"
      />
    </svg>
  );
}
```

- [ ] **Step 3: Write the AuthCard shell**

`apps/bank/src/components/AuthCard.tsx`:

```tsx
import type { ReactNode } from "react";
import { SparkasseLogo } from "./SparkasseLogo.js";

export interface AuthCardProps {
  title: string;
  subtitle: string;
  tagline: string;
  children: ReactNode;
}

export function AuthCard({ title, subtitle, tagline, children }: AuthCardProps) {
  return (
    <div className="auth-overlay">
      <div className="auth-card">
        <div className="auth-card-header">
          <SparkasseLogo className="h-10 w-10 shrink-0" />
          <div className="leading-tight">
            <div className="text-xl">
              <span className="font-bold">{title}</span>{" "}
              <span className="font-light">{subtitle}</span>
            </div>
            <div className="auth-card-tagline">{tagline}</div>
          </div>
        </div>
        <div className="p-6">{children}</div>
        <div className="border-t border-[var(--color-border)] px-6 py-3 text-center text-xs text-[var(--color-muted-foreground)]">
          Powered by EUDI Wallet
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write the login form**

`apps/bank/src/components/LoginForm.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("anna");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        setError("Anmeldung fehlgeschlagen. Bitte Zugangsdaten prüfen.");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Verbindung zum Server fehlgeschlagen.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="username" className="text-sm font-medium">
          Anmeldename
        </label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          required
          className="w-full rounded-[var(--radius)] border border-[var(--color-border)] px-3 py-2 outline-none focus:border-[var(--color-primary)]"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          Passwort
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          className="w-full rounded-[var(--radius)] border border-[var(--color-border)] px-3 py-2 outline-none focus:border-[var(--color-primary)]"
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
        className="w-full rounded-[var(--radius)] bg-[var(--color-primary)] px-4 py-2.5 font-semibold text-[var(--color-primary-foreground)] disabled:opacity-60"
      >
        {pending ? "Anmelden…" : "Anmelden"}
      </button>

      <div className="rounded-[var(--radius)] bg-[var(--color-muted)] px-3 py-2 text-xs text-[var(--color-muted-foreground)]">
        <strong className="font-semibold">Demo-Zugänge:</strong> anna / demo1234 ·
        ben / demo1234
      </div>
    </form>
  );
}
```

- [ ] **Step 5: Write the login page**

`apps/bank/src/app/login/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/AuthCard.js";
import { LoginForm } from "@/components/LoginForm.js";
import { getSession } from "@/lib/session.js";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Already signed in? The login screen is not useful.
  if (await getSession()) redirect("/");

  return (
    <AuthCard
      title="Sparkasse"
      subtitle="Musterstadt"
      tagline="Ihr verlässlicher Partner"
    >
      <LoginForm />
    </AuthCard>
  );
}
```

- [ ] **Step 6: Verify in a browser**

```bash
cd apps/bank && pnpm seed && pnpm dev
```

Open `http://localhost:3001/login`. Check by eye against spec §9.2:

1. Red header block spans the card's full width, logo left, "**Sparkasse**
   Musterstadt" with the bold/light weight split, uppercase tagline beneath.
2. Card is centered, max 420px, rounded, with a soft shadow.
3. Wrong password shows the German error and does **not** navigate.
4. `anna` / `demo1234` navigates to `/` (a 404 for now — the dashboard is Task 10).
5. Visiting `/login` again while signed in redirects to `/`.

- [ ] **Step 7: Typecheck and commit**

```bash
cd apps/bank && pnpm typecheck
cd /Users/senexi/dev/eudiw/payment-banking-demo
git add apps/bank
git commit -m "feat(bank): add login page with Sparkasse auth card"
```

---

### Task 10: Bank dashboard and transactions pages

Visual reference: spec §9.2. Top nav, account panel with a large balance, card
tiles with a credential state badge, recent transactions with a wallet badge.
The "Zum EUDI Wallet hinzufügen" button renders here but is wired to the
issuance dialog in Task 12 — in this task it is disabled with a title
explaining why, so the task is independently verifiable.

**Files:**
- Create: `apps/bank/src/lib/format.ts`
- Create: `apps/bank/src/components/AppHeader.tsx`
- Create: `apps/bank/src/components/AccountPanel.tsx`
- Create: `apps/bank/src/components/TransactionRow.tsx`
- Create: `apps/bank/src/components/CardTile.tsx`
- Create: `apps/bank/src/app/page.tsx`
- Create: `apps/bank/src/app/transactions/page.tsx`
- Test: `apps/bank/src/lib/format.test.ts`

**Interfaces:**
- Consumes: `listAccounts`, `listCards`, `listTransactions` and their DTOs
  (Task 8); `getSession` (Task 7); `getDb` (Task 6).
- Produces:
  - `formatEuroCents(cents: number): string` — German locale, e.g. `-42,15 €`
  - `formatIban(iban: string): string` — grouped in fours
  - `formatBookedAt(ms: number): string` — `dd.MM.yyyy`
  - `<AppHeader displayName: string; active: "dashboard" | "transactions" />`
  - `<AccountPanel account: AccountDto />`
  - `<TransactionRow transaction: TransactionDto />`
  - `<CardTile card: CardDto />` — Task 12 replaces its disabled button

- [ ] **Step 1: Write the failing format test**

`apps/bank/src/lib/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatBookedAt, formatEuroCents, formatIban } from "./format.js";

/** Non-breaking and narrow-no-break spaces vary by ICU build; normalise them. */
function normalise(value: string): string {
  return value.replace(/\u00a0|\u202f/g, " ");
}

describe("formatEuroCents", () => {
  it("formats a positive amount with a German decimal comma", () => {
    expect(normalise(formatEuroCents(348_712))).toBe("3.487,12 €");
  });

  it("formats a negative amount with a leading minus", () => {
    expect(normalise(formatEuroCents(-4_215))).toBe("-42,15 €");
  });

  it("formats zero", () => {
    expect(normalise(formatEuroCents(0))).toBe("0,00 €");
  });

  it("always shows two decimal places", () => {
    expect(normalise(formatEuroCents(100))).toBe("1,00 €");
    expect(normalise(formatEuroCents(5))).toBe("0,05 €");
  });
});

describe("formatIban", () => {
  it("groups an IBAN in blocks of four", () => {
    expect(formatIban("DE02120300000000202051")).toBe("DE02 1203 0000 0000 2020 51");
  });

  it("leaves an already-short value alone", () => {
    expect(formatIban("DE02")).toBe("DE02");
  });

  it("strips existing whitespace before regrouping", () => {
    expect(formatIban("DE02 1203 0000")).toBe("DE02 1203 0000");
  });
});

describe("formatBookedAt", () => {
  it("formats as dd.MM.yyyy", () => {
    const ms = Date.UTC(2026, 7, 5, 12, 0, 0);
    expect(formatBookedAt(ms)).toBe("05.08.2026");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/bank && pnpm test src/lib/format.test.ts
```

Expected: FAIL — cannot resolve `./format.js`.

- [ ] **Step 3: Write format.ts**

`apps/bank/src/lib/format.ts`:

```ts
const euro = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Integer cents to a German-locale euro string. */
export function formatEuroCents(cents: number): string {
  return euro.format(cents / 100);
}

/** Groups an IBAN in blocks of four for readability. */
export function formatIban(iban: string): string {
  return (iban.replace(/\s+/g, "").match(/.{1,4}/g) ?? []).join(" ");
}

/** dd.MM.yyyy in UTC, so a test is not tied to the runner's timezone. */
export function formatBookedAt(ms: number): string {
  const date = new Date(ms);
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${date.getUTCFullYear()}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/bank && pnpm test src/lib/format.test.ts
```

Expected: 8 PASS.

- [ ] **Step 5: Append panel, nav, and badge classes to globals.css**

Append to `apps/bank/src/app/globals.css`:

```css
.app-header {
  background: var(--color-header);
  color: var(--color-primary-foreground);
}

.panel {
  background: var(--color-card);
  border-radius: var(--radius);
  box-shadow: var(--shadow-panel);
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: 9999px;
  padding: 0.125rem 0.5rem;
  font-size: 0.7rem;
  font-weight: 600;
}

/*
 * Used by CardTile for the "Im Wallet ✓" state. This exists as a class rather
 * than a Tailwind opacity modifier because `bg-[var(--x)]/15` does NOT work —
 * Tailwind cannot apply an alpha channel to an arbitrary CSS variable.
 */
.badge-success {
  background: color-mix(in oklab, var(--color-success) 15%, white);
  color: var(--color-success);
}
```

- [ ] **Step 6: Write the header**

`apps/bank/src/components/AppHeader.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@demo/ui";
import { SparkasseLogo } from "./SparkasseLogo.js";

const NAV = [
  { key: "dashboard", href: "/", label: "Übersicht" },
  { key: "transactions", href: "/transactions", label: "Umsätze" },
] as const;

export interface AppHeaderProps {
  displayName: string;
  active: "dashboard" | "transactions";
}

export function AppHeader({ displayName, active }: AppHeaderProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="app-header">
      <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
        <SparkasseLogo className="h-8 w-8 shrink-0" />
        <span className="text-lg">
          <span className="font-bold">Sparkasse</span>{" "}
          <span className="font-light">Musterstadt</span>
        </span>

        <nav className="ml-auto hidden items-center gap-1 sm:flex">
          {NAV.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={cn(
                "rounded-[var(--radius)] px-3 py-1.5 text-sm",
                active === item.key ? "bg-white/20 font-semibold" : "hover:bg-white/10",
              )}
            >
              {item.label}
            </Link>
          ))}
          <span className="ml-3 text-sm opacity-90">{displayName}</span>
          <button
            type="button"
            onClick={logout}
            className="ml-2 rounded-[var(--radius)] bg-white/15 px-3 py-1.5 text-sm hover:bg-white/25"
          >
            Abmelden
          </button>
        </nav>

        <button
          type="button"
          aria-label="Menü"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="ml-auto rounded-[var(--radius)] bg-white/15 px-3 py-1.5 sm:hidden"
        >
          ☰
        </button>
      </div>

      {open ? (
        <div className="border-t border-white/20 px-4 pb-3 sm:hidden">
          {NAV.map((item) => (
            <Link key={item.key} href={item.href} className="block py-2 text-sm">
              {item.label}
            </Link>
          ))}
          <button type="button" onClick={logout} className="py-2 text-sm">
            Abmelden
          </button>
        </div>
      ) : null}
    </header>
  );
}
```

- [ ] **Step 7: Write the account panel, transaction row, and card tile**

`apps/bank/src/components/AccountPanel.tsx`:

```tsx
import type { AccountDto } from "@/lib/queries.js";
import { formatEuroCents, formatIban } from "@/lib/format.js";

export function AccountPanel({ account }: { account: AccountDto }) {
  return (
    <section className="panel p-5">
      <h2 className="text-sm font-semibold text-[var(--color-muted-foreground)]">
        Girokonto
      </h2>
      <p className="mt-1 font-mono text-xs text-[var(--color-muted-foreground)]">
        {formatIban(account.iban)}
      </p>
      <p className="mt-3 text-3xl font-bold tabular-nums">
        {formatEuroCents(account.balanceCents)}
      </p>
      <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
        Verfügbarer Betrag
      </p>
    </section>
  );
}
```

`apps/bank/src/components/TransactionRow.tsx`:

```tsx
import type { TransactionDto } from "@/lib/queries.js";
import { formatBookedAt, formatEuroCents } from "@/lib/format.js";

export function TransactionRow({ transaction }: { transaction: TransactionDto }) {
  const isDebit = transaction.amountCents < 0;

  return (
    <li className="flex items-center gap-3 border-b border-[var(--color-border)] py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{transaction.counterparty}</p>
        <p className="truncate text-xs text-[var(--color-muted-foreground)]">
          {formatBookedAt(transaction.bookedAt)} · {transaction.reference}
        </p>
      </div>

      {transaction.paidWithWallet ? (
        <span
          className="badge bg-[var(--color-muted)] text-[var(--color-foreground)]"
          title="Mit dem EUDI Wallet bezahlt"
        >
          EUDI Wallet
        </span>
      ) : null}

      <span
        className={
          isDebit
            ? "tabular-nums font-semibold"
            : "tabular-nums font-semibold text-[var(--color-success)]"
        }
      >
        {formatEuroCents(transaction.amountCents)}
      </span>
    </li>
  );
}
```

`apps/bank/src/components/CardTile.tsx` — the button is deliberately inert here
and becomes functional in Task 12.

```tsx
import type { CardDto } from "@/lib/queries.js";

const BADGE: Record<CardDto["credentialState"], { label: string; className: string }> = {
  none: {
    label: "Nicht im Wallet",
    className: "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]",
  },
  offered: {
    label: "Wird hinzugefügt…",
    className: "bg-[var(--color-muted)] text-[var(--color-foreground)]",
  },
  active: {
    label: "Im Wallet ✓",
    // .badge-success is defined in globals.css (Step 5 of this task): Tailwind cannot
    // apply an opacity modifier to an arbitrary CSS variable.
    className: "badge-success",
  },
};

export function CardTile({ card }: { card: CardDto }) {
  const badge = BADGE[card.credentialState];

  return (
    <div className="panel flex items-center gap-4 p-4">
      <div className="flex h-11 w-16 shrink-0 items-center justify-center rounded-md bg-[var(--color-foreground)] text-[0.6rem] font-bold tracking-wide text-white">
        {card.network.toUpperCase()}
      </div>

      <div className="min-w-0 flex-1">
        <p className="font-medium">{card.cardAlias}</p>
        <p className="font-mono text-sm text-[var(--color-muted-foreground)]">
          •••• •••• •••• {card.panLast4}
        </p>
        <span className={`badge mt-1.5 ${badge.className}`}>{badge.label}</span>
      </div>

      <button
        type="button"
        disabled
        title="Wird in Task 12 aktiviert"
        className="rounded-[var(--radius)] bg-[var(--color-primary)] px-3 py-2 text-sm font-semibold text-[var(--color-primary-foreground)] disabled:opacity-50"
      >
        Zum EUDI Wallet hinzufügen
      </button>
    </div>
  );
}
```

- [ ] **Step 8: Write the dashboard page**

`apps/bank/src/app/page.tsx`:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountPanel } from "@/components/AccountPanel.js";
import { AppHeader } from "@/components/AppHeader.js";
import { CardTile } from "@/components/CardTile.js";
import { TransactionRow } from "@/components/TransactionRow.js";
import { getDb } from "@/db/index.js";
import { listAccounts, listCards, listTransactions } from "@/lib/queries.js";
import { getSession } from "@/lib/session.js";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const db = getDb();
  const accounts = listAccounts(db, session.userId);
  const cards = listCards(db, session.userId);
  const recent = listTransactions(db, session.userId, 5, 0);

  return (
    <>
      <AppHeader displayName={session.displayName} active="dashboard" />

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <div className="grid gap-4 sm:grid-cols-2">
          {accounts.map((account) => (
            <AccountPanel key={account.id} account={account} />
          ))}
        </div>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Karten</h2>
          {cards.map((card) => (
            <CardTile key={card.id} card={card} />
          ))}
        </section>

        <section className="panel p-5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Letzte Umsätze</h2>
            <Link
              href="/transactions"
              className="text-sm font-medium text-[var(--color-primary)]"
            >
              Alle anzeigen
            </Link>
          </div>
          <ul>
            {recent.map((transaction) => (
              <TransactionRow key={transaction.id} transaction={transaction} />
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}
```

- [ ] **Step 9: Write the transactions page**

`apps/bank/src/app/transactions/page.tsx`:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader.js";
import { TransactionRow } from "@/components/TransactionRow.js";
import { getDb } from "@/db/index.js";
import { listTransactions } from "@/lib/queries.js";
import { getSession } from "@/lib/session.js";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { page: rawPage } = await searchParams;
  const page = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // Fetch one extra row to learn whether a next page exists.
  const rows = listTransactions(getDb(), session.userId, PAGE_SIZE + 1, offset);
  const hasNext = rows.length > PAGE_SIZE;
  const visible = rows.slice(0, PAGE_SIZE);

  return (
    <>
      <AppHeader displayName={session.displayName} active="transactions" />

      <main className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="mb-4 text-lg font-semibold">Umsätze</h1>

        <section className="panel p-5">
          <ul>
            {visible.map((transaction) => (
              <TransactionRow key={transaction.id} transaction={transaction} />
            ))}
          </ul>
          {visible.length === 0 ? (
            <p className="py-4 text-sm text-[var(--color-muted-foreground)]">
              Keine weiteren Umsätze.
            </p>
          ) : null}
        </section>

        <nav className="mt-4 flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link
              href={`/transactions?page=${page - 1}`}
              className="font-medium text-[var(--color-primary)]"
            >
              ← Neuer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-[var(--color-muted-foreground)]">Seite {page}</span>
          {hasNext ? (
            <Link
              href={`/transactions?page=${page + 1}`}
              className="font-medium text-[var(--color-primary)]"
            >
              Älter →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </main>
    </>
  );
}
```

- [ ] **Step 10: Verify in a browser**

```bash
cd apps/bank && pnpm seed && pnpm dev
```

Sign in as `anna` / `demo1234`, then check against spec §9.2:

1. Red top nav with logo, "Übersicht"/"Umsätze" tabs, the display name, and
   Abmelden. Below 640px it collapses to a `☰` that toggles the same links.
2. Account panel shows `DE02 1203 0000 0000 2020 51` and `3.487,12 €`.
3. One card tile: `VISA`, `•••• •••• •••• 4242`, badge "Nicht im Wallet", and a
   disabled "Zum EUDI Wallet hinzufügen" button.
4. Five recent transactions, credits green, no wallet badges yet.
5. "Alle anzeigen" → `/transactions`, pagination works, page 2 shows older rows,
   "Älter →" disappears on the last page.
6. Abmelden returns to `/login`; visiting `/` while signed out redirects there.

- [ ] **Step 11: Typecheck and commit**

```bash
cd apps/bank && pnpm typecheck && pnpm test
cd /Users/senexi/dev/eudiw/payment-banking-demo
git add apps/bank
git commit -m "feat(bank): add dashboard and transactions pages"
```

---
### Task 11: Bank issuance API

Implements spec §6.1 steps 2–9. This is the task that makes the demo real.

**Files:**
- Create: `apps/bank/src/lib/credential-id.ts`
- Create: `apps/bank/src/lib/foundry.ts`
- Create: `apps/bank/src/lib/issuance.ts`
- Create: `apps/bank/src/app/api/cards/[id]/credential/route.ts`
- Create: `apps/bank/src/app/api/credentials/[id]/status/route.ts`
- Test: `apps/bank/src/lib/credential-id.test.ts`
- Test: `apps/bank/src/lib/issuance.test.ts`

**Interfaces:**
- Consumes: `FoundryClient` (Task 3); `getDb`, `cards`, `credentials` (Task 6);
  `requireSession` and `UnauthorizedError` (Task 7); `env` (Task 5). **Not**
  `withSession` — see Step 9 for why dynamic-segment routes cannot use it.
- Produces:
  - `mintCredentialId(): string` — `dpc_` plus 24 base64url chars
  - `getFoundry(): FoundryClient` — memoized, configured from env
  - `startIssuance(db, client, userId, cardId, now?): Promise<StartIssuanceResult>`
    where `StartIssuanceResult =
      { ok: true; sessionId: string; offerUri: string }
    | { ok: false; reason: "card_not_found" | "foundry_unavailable" }`
  - `refreshIssuanceState(db, client, userId, credentialRowId): Promise<RefreshResult>`
    where `RefreshResult =
      { ok: true; state: "offered" | "active" | "failed" }
    | { ok: false; reason: "not_found" }`

- [ ] **Step 1: Write the failing credential-id test**

`apps/bank/src/lib/credential-id.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mintCredentialId } from "./credential-id.js";

describe("mintCredentialId", () => {
  it("is prefixed with dpc_", () => {
    expect(mintCredentialId().startsWith("dpc_")).toBe(true);
  });

  it("has 24 characters after the prefix", () => {
    expect(mintCredentialId().slice(4)).toHaveLength(24);
  });

  it("uses only URL-safe base64url characters", () => {
    expect(mintCredentialId()).toMatch(/^dpc_[A-Za-z0-9_-]{24}$/);
  });

  it("is unique across many mints", () => {
    const seen = new Set(Array.from({ length: 2000 }, () => mintCredentialId()));
    expect(seen.size).toBe(2000);
  });
});
```

- [ ] **Step 2: Write credential-id.ts**

`apps/bank/src/lib/credential-id.ts`:

```ts
import { randomBytes } from "node:crypto";

/**
 * The opaque value carried inside the DPC credential and returned by the wallet
 * at checkout. 18 random bytes encode to exactly 24 base64url characters with
 * no padding — roughly 144 bits, far beyond guessing range.
 */
export function mintCredentialId(): string {
  return `dpc_${randomBytes(18).toString("base64url")}`;
}
```

- [ ] **Step 3: Run the test to verify it passes**

```bash
cd apps/bank && pnpm test src/lib/credential-id.test.ts
```

Expected: 4 PASS.

- [ ] **Step 4: Write the foundry client accessor**

`apps/bank/src/lib/foundry.ts`:

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

- [ ] **Step 5: Write the failing issuance test**

`apps/bank/src/lib/issuance.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FoundryClient } from "@demo/foundry-client";
import { createDb, type Db } from "../db/index.js";
import { credentials } from "../db/schema.js";
import { seed } from "../db/seed.js";
import { refreshIssuanceState, startIssuance } from "./issuance.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bank-iss-"));
  db = createDb(path.join(dir, "test.db"));
  seed(db);
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

const offerOk = () => ({
  status: 200,
  body: {
    transaction_id: "tx_foundry_1",
    credential_offer_uri: "openid-credential-offer://?x=1",
    dc_api_offer: {},
  },
});

describe("startIssuance", () => {
  it("creates an offered credential row and returns the offer URI", async () => {
    const result = await startIssuance(db, stubClient(offerOk), "user_anna", "card_anna");

    expect(result).toEqual({
      ok: true,
      sessionId: expect.any(String),
      offerUri: "openid-credential-offer://?x=1",
    });

    const row = db.select().from(credentials).get();
    expect(row?.state).toBe("offered");
    expect(row?.cardId).toBe("card_anna");
    expect(row?.userId).toBe("user_anna");
    expect(row?.foundryTxId).toBe("tx_foundry_1");
    expect(row?.issuedAt).toBeNull();
    expect(row?.credentialId).toMatch(/^dpc_[A-Za-z0-9_-]{24}$/);
  });

  it("sends the DPC type and the card's own network as claims", async () => {
    let sentBody: unknown = null;
    const client = stubClient((_url, init) => {
      sentBody = JSON.parse(String(init.body));
      return offerOk();
    });

    await startIssuance(db, client, "user_anna", "card_anna");

    expect(sentBody).toMatchObject({
      credential_type_id: "com.emvco.dpc.card",
      claims: { network: "VISA", card_id: "card_anna" },
    });
  });

  it("uses the second card's own network rather than a hardcoded one", async () => {
    let sentBody: unknown = null;
    const client = stubClient((_url, init) => {
      sentBody = JSON.parse(String(init.body));
      return offerOk();
    });

    await startIssuance(db, client, "user_ben", "card_ben");

    expect(sentBody).toMatchObject({ claims: { network: "Mastercard" } });
  });

  it("refuses a card belonging to another user", async () => {
    const result = await startIssuance(db, stubClient(offerOk), "user_ben", "card_anna");
    expect(result).toEqual({ ok: false, reason: "card_not_found" });
    expect(db.select().from(credentials).all()).toHaveLength(0);
  });

  it("refuses an unknown card id", async () => {
    const result = await startIssuance(db, stubClient(offerOk), "user_anna", "card_nope");
    expect(result).toEqual({ ok: false, reason: "card_not_found" });
  });

  it("marks the row failed when foundry rejects the offer", async () => {
    const client = stubClient(() => ({ status: 500, body: { error: "boom" } }));

    const result = await startIssuance(db, client, "user_anna", "card_anna");

    expect(result).toEqual({ ok: false, reason: "foundry_unavailable" });
    const row = db.select().from(credentials).get();
    // The row is persisted BEFORE foundry is called (spec 6.1 step 3), so the
    // failure is visible rather than silently lost.
    expect(row?.state).toBe("failed");
    expect(row?.foundryTxId).toBeNull();
  });

  it("allows re-issuing the same card, creating a second row", async () => {
    await startIssuance(db, stubClient(offerOk), "user_anna", "card_anna");
    await startIssuance(db, stubClient(offerOk), "user_anna", "card_anna");
    expect(db.select().from(credentials).all()).toHaveLength(2);
  });
});

describe("refreshIssuanceState", () => {
  async function seedOffered(): Promise<string> {
    const started = await startIssuance(db, stubClient(offerOk), "user_anna", "card_anna");
    if (!started.ok) throw new Error("setup failed");
    return started.sessionId;
  }

  it("stays offered while foundry still reports offered", async () => {
    const sessionId = await seedOffered();
    const client = stubClient(() => ({
      status: 200,
      body: {
        transaction_id: "tx_foundry_1",
        credential_type_id: "com.emvco.dpc.card",
        state: "offered",
        created_at: 1,
      },
    }));

    await expect(
      refreshIssuanceState(db, client, "user_anna", sessionId),
    ).resolves.toEqual({ ok: true, state: "offered" });
  });

  it("promotes to active and stamps issuedAt once foundry reports issued", async () => {
    const sessionId = await seedOffered();
    const client = stubClient(() => ({
      status: 200,
      body: {
        transaction_id: "tx_foundry_1",
        credential_type_id: "com.emvco.dpc.card",
        state: "issued",
        created_at: 1,
      },
    }));

    await expect(
      refreshIssuanceState(db, client, "user_anna", sessionId),
    ).resolves.toEqual({ ok: true, state: "active" });

    const row = db.select().from(credentials).where(eq(credentials.id, sessionId)).get();
    expect(row?.state).toBe("active");
    expect(row?.issuedAt).toBeTypeOf("number");
  });

  it("is idempotent — a second poll after issuance stays active", async () => {
    const sessionId = await seedOffered();
    const client = stubClient(() => ({
      status: 200,
      body: {
        transaction_id: "tx_foundry_1",
        credential_type_id: "com.emvco.dpc.card",
        state: "issued",
        created_at: 1,
      },
    }));

    await refreshIssuanceState(db, client, "user_anna", sessionId);
    const first = db.select().from(credentials).where(eq(credentials.id, sessionId)).get();
    await refreshIssuanceState(db, client, "user_anna", sessionId);
    const second = db.select().from(credentials).where(eq(credentials.id, sessionId)).get();

    expect(second?.state).toBe("active");
    expect(second?.issuedAt).toBe(first?.issuedAt);
  });

  it("does not call foundry again once the row is already active", async () => {
    const sessionId = await seedOffered();
    let calls = 0;
    const issued = stubClient(() => {
      calls++;
      return {
        status: 200,
        body: {
          transaction_id: "tx_foundry_1",
          credential_type_id: "com.emvco.dpc.card",
          state: "issued",
          created_at: 1,
        },
      };
    });

    await refreshIssuanceState(db, issued, "user_anna", sessionId);
    const afterFirst = calls;
    await refreshIssuanceState(db, issued, "user_anna", sessionId);

    expect(calls).toBe(afterFirst);
  });

  it("refuses another user's credential row", async () => {
    const sessionId = await seedOffered();
    await expect(
      refreshIssuanceState(db, stubClient(offerOk), "user_ben", sessionId),
    ).resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it("returns not_found for an unknown row", async () => {
    await expect(
      refreshIssuanceState(db, stubClient(offerOk), "user_anna", "cred_nope"),
    ).resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it("keeps the row offered when foundry is unreachable, so polling can recover", async () => {
    const sessionId = await seedOffered();
    const client = stubClient(() => ({ status: 503, body: { error: "down" } }));

    await expect(
      refreshIssuanceState(db, client, "user_anna", sessionId),
    ).resolves.toEqual({ ok: true, state: "offered" });

    const row = db.select().from(credentials).where(eq(credentials.id, sessionId)).get();
    expect(row?.state).toBe("offered");
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

```bash
cd apps/bank && pnpm test src/lib/issuance.test.ts
```

Expected: FAIL — cannot resolve `./issuance.js`.

- [ ] **Step 7: Write issuance.ts**

`apps/bank/src/lib/issuance.ts`:

```ts
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FoundryClient } from "@demo/foundry-client";
import type { Db } from "../db/index.js";
import { cards, credentials } from "../db/schema.js";
import { mintCredentialId } from "./credential-id.js";

/** The credential type id configured in foundry (spec 3). */
export const DPC_CREDENTIAL_TYPE_ID = "com.emvco.dpc.card";

export type StartIssuanceResult =
  | { ok: true; sessionId: string; offerUri: string }
  | { ok: false; reason: "card_not_found" | "foundry_unavailable" };

export type RefreshResult =
  | { ok: true; state: "offered" | "active" | "failed" }
  | { ok: false; reason: "not_found" };

/**
 * Spec 6.1 steps 2–5. The credentials row is written BEFORE foundry is called,
 * so a failed offer leaves a visible `failed` row rather than nothing at all.
 */
export async function startIssuance(
  db: Db,
  client: FoundryClient,
  userId: string,
  cardId: string,
  now: number = Date.now(),
): Promise<StartIssuanceResult> {
  const card = db
    .select()
    .from(cards)
    .where(and(eq(cards.id, cardId), eq(cards.userId, userId)))
    .get();

  // Same answer for "no such card" and "not your card": never confirm existence.
  if (!card) return { ok: false, reason: "card_not_found" };

  const rowId = `cred_${randomUUID()}`;
  const credentialId = mintCredentialId();

  db.insert(credentials)
    .values({
      id: rowId,
      userId,
      cardId: card.id,
      credentialId,
      foundryTxId: null,
      state: "offered",
      issuedAt: null,
      createdAt: now,
    })
    .run();

  try {
    const offer = await client.createIssuanceOffer({
      credential_type_id: DPC_CREDENTIAL_TYPE_ID,
      claims: {
        credential_id: credentialId,
        network: card.network,
        card_id: card.id,
      },
    });

    db.update(credentials)
      .set({ foundryTxId: offer.transaction_id })
      .where(eq(credentials.id, rowId))
      .run();

    return { ok: true, sessionId: rowId, offerUri: offer.credential_offer_uri };
  } catch {
    db.update(credentials).set({ state: "failed" }).where(eq(credentials.id, rowId)).run();
    return { ok: false, reason: "foundry_unavailable" };
  }
}

/**
 * Spec 6.1 steps 8–9. Polled by the browser. A foundry outage deliberately
 * leaves the row `offered` so a later poll can still succeed — only the client's
 * consecutive-failure counter decides when to give up.
 */
export async function refreshIssuanceState(
  db: Db,
  client: FoundryClient,
  userId: string,
  credentialRowId: string,
): Promise<RefreshResult> {
  const row = db
    .select()
    .from(credentials)
    .where(and(eq(credentials.id, credentialRowId), eq(credentials.userId, userId)))
    .get();

  if (!row) return { ok: false, reason: "not_found" };

  // Terminal states need no further foundry traffic.
  if (row.state !== "offered") return { ok: true, state: row.state };
  if (!row.foundryTxId) return { ok: true, state: row.state };

  try {
    const status = await client.getIssuanceStatus(row.foundryTxId);
    if (status.state === "issued") {
      db.update(credentials)
        .set({ state: "active", issuedAt: Date.now() })
        .where(eq(credentials.id, row.id))
        .run();
      return { ok: true, state: "active" };
    }
    return { ok: true, state: "offered" };
  } catch {
    return { ok: true, state: "offered" };
  }
}
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
cd apps/bank && pnpm test src/lib/issuance.test.ts
```

Expected: 15 PASS.

- [ ] **Step 9: Write the two route handlers**

`apps/bank/src/app/api/cards/[id]/credential/route.ts` — note this uses the raw
`requireSession` rather than `withSession`, because Next passes a second
`context` argument for dynamic segments that `withSession` does not forward.

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import { getFoundry } from "@/lib/foundry.js";
import { startIssuance } from "@/lib/issuance.js";
import { requireSession, UnauthorizedError } from "@/lib/session.js";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let userId: string;
  try {
    userId = (await requireSession()).userId;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    throw error;
  }

  const { id: cardId } = await context.params;
  const result = await startIssuance(getDb(), getFoundry(), userId, cardId);

  if (!result.ok) {
    const status = result.reason === "card_not_found" ? 404 : 502;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json({ sessionId: result.sessionId, offerUri: result.offerUri });
}
```

`apps/bank/src/app/api/credentials/[id]/status/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import { getFoundry } from "@/lib/foundry.js";
import { refreshIssuanceState } from "@/lib/issuance.js";
import { requireSession, UnauthorizedError } from "@/lib/session.js";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let userId: string;
  try {
    userId = (await requireSession()).userId;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    throw error;
  }

  const { id } = await context.params;
  const result = await refreshIssuanceState(getDb(), getFoundry(), userId, id);

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 404 });
  }
  return NextResponse.json({ state: result.state });
}
```

- [ ] **Step 10: Verify against the real foundry**

Requires foundry running from Task 1.

```bash
cd apps/bank && pnpm seed && pnpm dev &
sleep 12
curl -sS -c /tmp/c.txt -X POST http://localhost:3001/api/auth/login \
  -H 'content-type: application/json' -d '{"username":"anna","password":"demo1234"}' >/dev/null

echo "--- start issuance ---"
curl -sS -b /tmp/c.txt -X POST http://localhost:3001/api/cards/card_anna/credential

echo "--- status (expect offered) ---"
SESSION=$(curl -sS -b /tmp/c.txt -X POST http://localhost:3001/api/cards/card_anna/credential \
  | sed -E 's/.*"sessionId":"([^"]+)".*/\1/')
curl -sS -b /tmp/c.txt "http://localhost:3001/api/credentials/$SESSION/status"

echo "--- another user's card is 404 ---"
curl -sS -b /tmp/c.txt -o /dev/null -w '%{http_code}\n' \
  -X POST http://localhost:3001/api/cards/card_ben/credential

echo "--- unknown session is 404 ---"
curl -sS -b /tmp/c.txt -o /dev/null -w '%{http_code}\n' \
  http://localhost:3001/api/credentials/cred_nope/status

echo "--- cards now report offered ---"
curl -sS -b /tmp/c.txt http://localhost:3001/api/cards
kill %1
```

Expected: a `sessionId` plus an `offerUri` starting
`openid-credential-offer://`; `{"state":"offered"}`; `404` for Ben's card;
`404` for the unknown session; `credentialState: "offered"` in `/api/cards`.

- [ ] **Step 11: Commit**

```bash
cd /Users/senexi/dev/eudiw/payment-banking-demo
git add apps/bank
git commit -m "feat(bank): add credential issuance and status polling APIs"
```

---

### Task 12: Issuance dialog — the first demoable milestone

Wires the dashboard button to the issuance API and closes the loop with a real
wallet. **At the end of this task a payment card is in a phone.**

**Files:**
- Create: `apps/bank/src/components/IssuanceDialog.tsx`
- Create: `apps/bank/src/components/AddToWalletButton.tsx`
- Modify: `apps/bank/src/components/CardTile.tsx` (replace the disabled button)
- Modify: `apps/bank/src/app/globals.css` (append dialog classes)

**Interfaces:**
- Consumes: `POST /api/cards/{id}/credential` and
  `GET /api/credentials/{id}/status` (Task 11); `QrCanvas`, `useStatusPoll`,
  `useIsTouch` from `@demo/ui` (Task 4).
- Produces:
  - `<AddToWalletButton cardId: string; disabled?: boolean />` — client component
  - `<IssuanceDialog sessionId: string; offerUri: string; onClose: () => void />`

- [ ] **Step 1: Append the dialog classes to globals.css**

Append to `apps/bank/src/app/globals.css`:

```css
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: rgb(17 24 39 / 0.5);
  backdrop-filter: blur(4px);
}

.dialog-card {
  width: 100%;
  max-width: 420px;
  background: var(--color-card);
  border-radius: var(--radius);
  padding: 1.75rem;
  text-align: center;
  box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.25);
}

.qr-frame {
  display: inline-block;
  padding: 1rem;
  background: #ffffff;
  border: 2px solid color-mix(in oklab, var(--color-primary) 25%, white);
  border-radius: 1.25rem;
}
```

- [ ] **Step 2: Write the dialog**

`apps/bank/src/components/IssuanceDialog.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { QrCanvas, useIsTouch, useStatusPoll } from "@demo/ui";

/** Sparkasse red, matching --color-primary, for the QR's dark modules. */
const QR_DARK = "#ff0000";

type Phase = "waiting" | "success" | "error";

export interface IssuanceDialogProps {
  sessionId: string;
  offerUri: string;
  onClose: () => void;
}

export function IssuanceDialog({ sessionId, offerUri, onClose }: IssuanceDialogProps) {
  const router = useRouter();
  const isTouch = useIsTouch();
  const [phase, setPhase] = useState<Phase>("waiting");

  const fetchOnce = useCallback(async () => {
    const response = await fetch(`/api/credentials/${sessionId}/status`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const body: unknown = await response.json();
    const state = (body as { state?: unknown }).state;
    return typeof state === "string" ? state : "offered";
  }, [sessionId]);

  const isTerminal = useCallback(
    (state: string) => state === "active" || state === "failed",
    [],
  );

  const { value, outcome } = useStatusPoll<string>({ fetchOnce, isTerminal });

  useEffect(() => {
    if (!outcome) return;
    if (outcome.status === "terminal" && outcome.value === "active") {
      setPhase("success");
      // Let the success state be seen, then refresh the dashboard behind it.
      const timer = setTimeout(() => {
        onClose();
        router.refresh();
      }, 1500);
      return () => clearTimeout(timer);
    }
    if (outcome.status !== "aborted") setPhase("error");
    return;
  }, [outcome, onClose, router]);

  const errorMessage =
    outcome?.status === "timeout"
      ? "Die Anfrage ist abgelaufen. Bitte erneut versuchen."
      : outcome?.status === "failed"
        ? "Verbindung zum Server verloren."
        : "Die Karte konnte nicht hinzugefügt werden.";

  return (
    <div
      className="dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Karte zum EUDI Wallet hinzufügen"
    >
      <div className="dialog-card">
        {phase === "waiting" ? (
          <>
            <h2 className="text-lg font-bold">Karte zum EUDI Wallet hinzufügen</h2>

            {isTouch ? (
              <>
                <a
                  href={offerUri}
                  className="mt-5 inline-block rounded-[var(--radius)] bg-[var(--color-primary)] px-5 py-2.5 font-semibold text-[var(--color-primary-foreground)]"
                >
                  Im Wallet öffnen
                </a>
                <p className="mt-4 text-sm text-[var(--color-muted-foreground)]">
                  Bestätigen Sie das Angebot in Ihrer EUDI Wallet App.
                </p>
              </>
            ) : (
              <>
                <div className="qr-frame mt-5">
                  <QrCanvas
                    value={offerUri}
                    size={240}
                    darkColor={QR_DARK}
                    ariaLabel="QR-Code für das Credential-Angebot"
                  />
                </div>
                <p className="mt-4 text-sm text-[var(--color-muted-foreground)]">
                  Scannen Sie den Code mit Ihrer EUDI Wallet App.
                </p>
              </>
            )}

            <p className="mt-3 text-xs text-[var(--color-muted-foreground)]">
              Status: {value === "offered" || value === null ? "Warte auf Wallet…" : value}
            </p>

            <button
              type="button"
              onClick={onClose}
              className="mt-5 text-sm font-medium text-[var(--color-muted-foreground)] underline"
            >
              Abbrechen
            </button>
          </>
        ) : null}

        {phase === "success" ? (
          <>
            <div className="text-5xl" aria-hidden="true">
              🇪🇺
            </div>
            <h2 className="mt-3 text-lg font-bold text-[var(--color-success)]">
              Karte hinzugefügt
            </h2>
            <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
              Ihre Karte ist jetzt in Ihrem EUDI Wallet.
            </p>
          </>
        ) : null}

        {phase === "error" ? (
          <>
            <div className="text-5xl" aria-hidden="true">
              ⚠️
            </div>
            <h2 className="mt-3 text-lg font-bold">Fehlgeschlagen</h2>
            <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
              {errorMessage}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 rounded-[var(--radius)] bg-[var(--color-primary)] px-5 py-2.5 font-semibold text-[var(--color-primary-foreground)]"
            >
              Schließen
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write the trigger button**

`apps/bank/src/components/AddToWalletButton.tsx`:

```tsx
"use client";

import { useState } from "react";
import { IssuanceDialog } from "./IssuanceDialog.js";

interface Session {
  sessionId: string;
  offerUri: string;
}

export function AddToWalletButton({
  cardId,
  disabled = false,
}: {
  cardId: string;
  disabled?: boolean;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/cards/${cardId}/credential`, { method: "POST" });
      if (!response.ok) {
        setError("Angebot konnte nicht erstellt werden.");
        return;
      }
      const body = (await response.json()) as Session;
      setSession({ sessionId: body.sessionId, offerUri: body.offerUri });
    } catch {
      setError("Verbindung zum Server fehlgeschlagen.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={start}
          disabled={disabled || pending}
          className="rounded-[var(--radius)] bg-[var(--color-primary)] px-3 py-2 text-sm font-semibold text-[var(--color-primary-foreground)] disabled:opacity-50"
        >
          {pending ? "Wird vorbereitet…" : "Zum EUDI Wallet hinzufügen"}
        </button>
        {error ? (
          <span role="alert" className="text-xs text-[var(--color-destructive)]">
            {error}
          </span>
        ) : null}
      </div>

      {session ? (
        <IssuanceDialog
          sessionId={session.sessionId}
          offerUri={session.offerUri}
          onClose={() => setSession(null)}
        />
      ) : null}
    </>
  );
}
```

- [ ] **Step 4: Wire it into CardTile**

In `apps/bank/src/components/CardTile.tsx`, add the import:

```tsx
import { AddToWalletButton } from "./AddToWalletButton.js";
```

and replace the entire disabled `<button>` element with:

```tsx
      <AddToWalletButton cardId={card.id} disabled={card.credentialState === "active"} />
```

An already-active card disables the button: re-issuing is supported by the data
model but is not a demo action, and leaving it live invites confusion about which
credential is current.

- [ ] **Step 5: Verify with a real wallet — the milestone**

Requires foundry running with a **publicly reachable HTTPS**
`issuer.credential_issuer` (spec §3), and a phone with an EUDI wallet app. A
`localhost` issuer URL will make the QR scan appear to work and then fail.

```bash
cd apps/bank && pnpm seed && pnpm dev
```

1. Sign in as `anna` / `demo1234`.
2. Click "Zum EUDI Wallet hinzufügen" → dialog opens with a red-moduled QR in a
   white frame, status line "Warte auf Wallet…".
3. Scan with the wallet app on the phone. Accept the offer.
4. Within ~2 s the dialog turns into 🇪🇺 "Karte hinzugefügt", then closes.
5. The card tile now reads **"Im Wallet ✓"** and its button is disabled.
6. Confirm in the wallet that the credential shows `credential_id`, `network`,
   and `card_id`.

Also verify the failure paths:

7. Open the dialog and click Abbrechen — it closes and the badge stays
   "Wird hinzugefügt…" until the next page load (the row is still `offered`,
   which is correct: the offer is live in foundry until it expires).
8. Stop foundry, then click the button — an inline error appears under it rather
   than an empty dialog.
9. On a phone-sized viewport (or with device emulation), the dialog shows
   "Im Wallet öffnen" instead of a QR.

- [ ] **Step 6: Typecheck, test, and commit**

```bash
cd apps/bank && pnpm typecheck && pnpm test
cd /Users/senexi/dev/eudiw/payment-banking-demo
git add apps/bank
git commit -m "feat(bank): add issuance dialog with QR and status polling"
```

---

### Task 13: Dockerfile and deployment contract

**Files:**
- Create: `apps/bank/Dockerfile`
- Create: `apps/bank/.dockerignore`
- Create: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: a container image honouring the §8 contract, and the README that
  documents it for whatever deploys this.

- [ ] **Step 1: Write .dockerignore**

`apps/bank/.dockerignore` — the build context is the repo root, so these paths
are root-relative:

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

`apps/bank/Dockerfile` — build from the **repo root** as context, since a pnpm
workspace build needs the root manifests and the `packages/` sources.

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
COPY apps/bank/package.json apps/bank/
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
    BANK_API_KEY=build-only \
    SESSION_SECRET=build-only-secret-0123456789012345678901234567890123
RUN pnpm --filter @demo/bank run build

# ---- runtime -------------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV DATABASE_PATH=/data/bank.db

# Next's standalone output already contains the traced workspace deps.
COPY --from=build /repo/apps/bank/.next/standalone ./
COPY --from=build /repo/apps/bank/.next/static ./apps/bank/.next/static
COPY --from=build /repo/apps/bank/drizzle ./apps/bank/drizzle

RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3001

# Migrations run on first DB access (src/db/index.ts), so no entrypoint script.
WORKDIR /app/apps/bank
CMD ["node", "server.js"]
```

- [ ] **Step 3: Build and run the image**

```bash
cd /Users/senexi/dev/eudiw/payment-banking-demo
docker build -f apps/bank/Dockerfile -t payment-demo-bank:dev .

docker run --rm -p 3001:3001 \
  -e FOUNDRY_ADMIN_URL=http://host.docker.internal:9000 \
  -e FOUNDRY_ADMIN_KEY=dev-admin-key \
  -e BANK_API_KEY=dev-bank-api-key \
  -e SESSION_SECRET=0123456789012345678901234567890123456789 \
  -e BANK_PUBLIC_URL=http://localhost:3001 \
  -v payment-demo-bank-data:/data \
  payment-demo-bank:dev &
sleep 10
curl -sS http://localhost:3001/api/health
curl -sS http://localhost:3001/api/ready
```

Expected: `{"status":"ok"}` and `{"status":"ready"}` — the latter proves
migrations ran against the mounted volume. Note the container has **no seed
data**; `/login` will render but no account exists yet. That is correct: seeding
is an operator action, documented in the README.

- [ ] **Step 4: Verify the contract holds — a missing secret must crash at boot**

```bash
docker run --rm -p 3002:3001 \
  -e FOUNDRY_ADMIN_URL=http://host.docker.internal:9000 \
  -e FOUNDRY_ADMIN_KEY=dev-admin-key \
  -e BANK_API_KEY=dev-bank-api-key \
  payment-demo-bank:dev
```

Expected: the process exits with
`Invalid bank environment configuration — SESSION_SECRET: ...` rather than
starting and failing later on a request. If it starts, `env.ts` is not being
imported early enough — fix that, do not relax the test.

- [ ] **Step 5: Write the README**

`README.md`:

````markdown
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

### Building the image

The build context is the repository root, because a pnpm workspace build needs
the root manifests and the `packages/` sources:

```bash
docker build -f apps/bank/Dockerfile -t payment-demo-bank:latest .
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
````

- [ ] **Step 6: Verify the README's quick start from a clean checkout**

```bash
cd /Users/senexi/dev/eudiw/payment-banking-demo
git status --short          # must be clean apart from the new files
rm -rf apps/bank/data node_modules apps/bank/node_modules
pnpm install
cp apps/bank/.env.example apps/bank/.env.local
pnpm migrate && pnpm seed && pnpm check
```

Expected: every step succeeds and `pnpm check` is green. If any documented
command fails, fix the README — it is the deployment contract, and a wrong one
is worse than none.

- [ ] **Step 7: Commit**

```bash
cd /Users/senexi/dev/eudiw/payment-banking-demo
git add apps/bank/Dockerfile apps/bank/.dockerignore README.md
git commit -m "feat(bank): add Dockerfile and document the deployment contract"
```

---

## Definition of Done for Plan 1

- [ ] `pnpm check` green across the workspace
- [ ] `pnpm dev` starts the bank on :3001
- [ ] A real EUDI wallet holds a `com.emvco.dpc.card` credential issued by the
      bank, and the dashboard shows "Im Wallet ✓"
- [ ] The bank container builds, applies migrations against a mounted volume, and
      passes `/api/health` and `/api/ready`
- [ ] A missing secret crashes the container at boot with a named error
- [ ] The §3.1(3) `transaction_data` shape is recorded in the design spec, so
      Plan 2 starts from a known answer

## What Plan 2 will add

For orientation only — do not build any of it here.

- Merchant app: products, cart, checkout, `/pay/{sessionId}`, `/success`
- `POST /admin/verification/requests` with `transaction_data` amount binding
- The settle gate: `verified === true` **and** `transaction_data_binding` passed
- Bank `POST /api/payments` — the debit, keyed by `credential_id`, made
  idempotent by the `transactions.idempotency_key` column this plan already
  created
- Wallet-paid transactions appearing in the bank's list with the "EUDI Wallet"
  badge that `TransactionRow` already renders