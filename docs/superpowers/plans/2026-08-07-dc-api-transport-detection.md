# DC API Transport Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Both demo apps automatically detect whether the browser can perform the W3C Digital Credentials API and use it when available, falling back to the existing QR / deep-link transport only when it cannot.

**Architecture:** A shared, dependency-free detection module in `packages/ui` (ported from two proven implementations, with browser globals injected so it is testable under vitest's node environment). The bank picks its transport at click time because foundry's issuance offer is transport-agnostic. The merchant must pick at session-create time because `transport` changes the OpenID4VP wire, so detection runs in `CheckoutForm` and travels in the POST body; the wallet's DC API response is relayed to foundry's **admin** endpoint server-side, because the admin key must never reach the browser.

**Tech Stack:** TypeScript (strict, `noUnusedLocals`, `noUnusedParameters`), Next.js 15 App Router, React 19, Drizzle ORM + better-sqlite3, vitest (node environment), pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-07-dc-api-transport-detection-design.md`

## Global Constraints

- **Run every command from the repo root with `pnpm`, never `npm`.**
- **`pnpm check` is the gate** (`typecheck && test` across all 4 projects). Baseline measured at the time of writing: **186 tests** (85 bank + 87 merchant + 7 foundry-client + 7 ui). Measure, never quote.
- **Local imports are written `./foo.js` for a `./foo.ts` file.** This is deliberate Node ESM form. Follow it in every new file.
- **TypeScript is strict with `noUnusedLocals` and `noUnusedParameters`.** An intentionally-unused parameter must be prefixed `_`.
- **vitest is `environment: "node"` with `include: ["src/**/*.test.ts"]` in all four projects.** `.tsx` files are not matched. Do **not** add jsdom or React Testing Library. Put logic in `.ts`, rendering in `.tsx`.
- **All money is integer cents.** Not touched by this plan, but do not introduce floats.
- **No hardcoded URLs or secrets.** Everything from zod-validated env.
- **Design tokens are NOT shared between apps.** The bank is Sparkasse-styled and German; the merchant is its own brand and English. Only behaviour (`packages/ui`) is shared.
- **Copy rule (spec D5):** DC API **diagnostic** strings in the bank are English; every other bank string stays German. The two exact strings are `"This browser does not support the Digital Credentials API."` and `"The wallet handover was cancelled."`.
- **Protocol identifiers, used verbatim:** issuance `openid4vci-v1` (`navigator.credentials.create`), presentation `openid4vp-v1-unsigned` (`navigator.credentials.get`).
- **Transient activation:** no `await` may execute between a click handler starting and `navigator.credentials.get()` / `.create()`. Chrome consumes the gesture otherwise.
- **TDD.** Write the failing test, run it, confirm it fails for the right reason, then implement.
- **Commits** use conventional prefixes and state what was *verified* and what was not.

---

### Task 1: Shared DC API detection module

**Files:**
- Create: `packages/ui/src/dcApi.ts`
- Create: `packages/ui/src/dcApi.test.ts`
- Create: `packages/ui/src/useDcApiSupport.ts`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type DcApiMethod = "get" | "create"`
  - `interface DcApiGlobals { isSecureContext?: boolean; DigitalCredential?: { userAgentAllowsProtocol?: (protocol: string) => boolean }; navigator?: { credentials?: Record<string, unknown> } }`
  - `interface DcApiEnvelope { digital: { requests: Array<{ protocol: string; data: unknown }> } }`
  - `const DC_API_ISSUANCE_PROTOCOL = "openid4vci-v1"`
  - `const DC_API_PRESENTATION_PROTOCOL = "openid4vp-v1-unsigned"`
  - `supportsDcApi(method: DcApiMethod, protocol: string, globals?: DcApiGlobals): boolean`
  - `isDcApiNotSupportedError(error: unknown): boolean`
  - `prepareDcApiRequest(data: unknown, protocol: string): DcApiEnvelope`
  - `invokeDcGet(req: DcApiEnvelope): Promise<{ response: string }>`
  - `invokeDcCreate(req: DcApiEnvelope): Promise<void>`
  - `useDcApiSupport(method: DcApiMethod, protocol: string): boolean | null`

Background you need: `packages/ui` holds shared *behaviour* only (hooks, `QrCanvas`), never design tokens. It has no test-environment setup beyond `environment: "node"`, which is why `supportsDcApi` takes an injected `globals` object defaulting to `globalThis` — reading `window` at module scope would make it untestable. This code is a port of `../foundry/crates/foundry/assets/console.html` (~L2900-2960) and `../eudipay-frontend/src/dcApi.js`; do not invent a different detection scheme.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/dcApi.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DC_API_ISSUANCE_PROTOCOL,
  DC_API_PRESENTATION_PROTOCOL,
  isDcApiNotSupportedError,
  prepareDcApiRequest,
  supportsDcApi,
  type DcApiGlobals,
} from "./dcApi.js";

/** A globals object that satisfies every check, so each test can break one. */
function fullSupport(allows = true): DcApiGlobals {
  return {
    isSecureContext: true,
    DigitalCredential: { userAgentAllowsProtocol: () => allows },
    navigator: { credentials: { get: () => undefined, create: () => undefined } },
  };
}

describe("supportsDcApi", () => {
  it("is true for get when every condition holds", () => {
    expect(supportsDcApi("get", DC_API_PRESENTATION_PROTOCOL, fullSupport())).toBe(true);
  });

  it("is false outside a secure context", () => {
    const g = fullSupport();
    g.isSecureContext = false;
    expect(supportsDcApi("get", DC_API_PRESENTATION_PROTOCOL, g)).toBe(false);
  });

  it("is false when DigitalCredential is absent", () => {
    const g = fullSupport();
    delete g.DigitalCredential;
    expect(supportsDcApi("get", DC_API_PRESENTATION_PROTOCOL, g)).toBe(false);
  });

  it("is false when navigator.credentials is absent", () => {
    const g = fullSupport();
    g.navigator = {};
    expect(supportsDcApi("get", DC_API_PRESENTATION_PROTOCOL, g)).toBe(false);
  });

  it("is false when the requested method is not a function", () => {
    const g = fullSupport();
    g.navigator = { credentials: { create: () => undefined } };
    expect(supportsDcApi("get", DC_API_PRESENTATION_PROTOCOL, g)).toBe(false);
  });

  it("is false when userAgentAllowsProtocol says no", () => {
    expect(supportsDcApi("get", DC_API_PRESENTATION_PROTOCOL, fullSupport(false))).toBe(false);
  });

  it("is false when userAgentAllowsProtocol throws", () => {
    const g = fullSupport();
    g.DigitalCredential = {
      userAgentAllowsProtocol: () => {
        throw new Error("boom");
      },
    };
    expect(supportsDcApi("get", DC_API_PRESENTATION_PROTOCOL, g)).toBe(false);
  });

  it("is true when userAgentAllowsProtocol is absent entirely", () => {
    const g = fullSupport();
    g.DigitalCredential = {};
    expect(supportsDcApi("get", DC_API_PRESENTATION_PROTOCOL, g)).toBe(true);
  });

  // Spec D4: create is lenient because openid4vci-v1 is a Chrome origin-trial
  // identifier that a capable browser may still answer false for.
  it("skips the protocol probe for create where get would fail", () => {
    const g = fullSupport(false);
    expect(supportsDcApi("get", DC_API_ISSUANCE_PROTOCOL, g)).toBe(false);
    expect(supportsDcApi("create", DC_API_ISSUANCE_PROTOCOL, g)).toBe(true);
  });

  it("still requires a secure context and DigitalCredential for create", () => {
    const noSecure = fullSupport();
    noSecure.isSecureContext = false;
    expect(supportsDcApi("create", DC_API_ISSUANCE_PROTOCOL, noSecure)).toBe(false);

    const noDc = fullSupport();
    delete noDc.DigitalCredential;
    expect(supportsDcApi("create", DC_API_ISSUANCE_PROTOCOL, noDc)).toBe(false);
  });
});

describe("isDcApiNotSupportedError", () => {
  it("recognises NotSupportedError by name", () => {
    const err = new Error("nope");
    err.name = "NotSupportedError";
    expect(isDcApiNotSupportedError(err)).toBe(true);
  });

  it("recognises a TypeError whose message says not supported", () => {
    const err = new TypeError("digital is not supported");
    expect(isDcApiNotSupportedError(err)).toBe(true);
  });

  it("recognises a CredentialContainer message", () => {
    expect(isDcApiNotSupportedError(new Error("CredentialContainer has no get"))).toBe(true);
  });

  it("rejects an unrelated error", () => {
    expect(isDcApiNotSupportedError(new Error("user cancelled"))).toBe(false);
  });

  it("rejects a plain TypeError with an unrelated message", () => {
    expect(isDcApiNotSupportedError(new TypeError("x is undefined"))).toBe(false);
  });

  it("tolerates non-Error inputs", () => {
    expect(isDcApiNotSupportedError(null)).toBe(false);
    expect(isDcApiNotSupportedError("NotSupportedError")).toBe(false);
    expect(isDcApiNotSupportedError(undefined)).toBe(false);
  });
});

describe("prepareDcApiRequest", () => {
  it("wraps the payload in the digital credentials envelope", () => {
    expect(prepareDcApiRequest({ a: 1 }, DC_API_ISSUANCE_PROTOCOL)).toEqual({
      digital: { requests: [{ protocol: "openid4vci-v1", data: { a: 1 } }] },
    });
  });
});

describe("protocol constants", () => {
  it("uses the exact identifiers foundry and Chrome expect", () => {
    expect(DC_API_ISSUANCE_PROTOCOL).toBe("openid4vci-v1");
    expect(DC_API_PRESENTATION_PROTOCOL).toBe("openid4vp-v1-unsigned");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @demo/ui test`
Expected: FAIL — `Failed to resolve import "./dcApi.js"`.

- [ ] **Step 3: Write the implementation**

Create `packages/ui/src/dcApi.ts`:

```ts
/**
 * W3C Digital Credentials API detection and invocation.
 *
 * Ported from two proven implementations that agree on everything except the
 * `create` gate: ../foundry/crates/foundry/assets/console.html and
 * ../eudipay-frontend/src/dcApi.js. See spec D4 for why `create` is lenient.
 *
 * Browser globals are INJECTED rather than read at module scope. That is what
 * makes this file testable under vitest's node environment, which has no
 * `window`.
 */

/** Chrome origin-trial identifier for DC API issuance. Not a pinned spec. */
export const DC_API_ISSUANCE_PROTOCOL = "openid4vci-v1";

/** OpenID4VP over the DC API, unsigned inline request object. */
export const DC_API_PRESENTATION_PROTOCOL = "openid4vp-v1-unsigned";

export type DcApiMethod = "get" | "create";

export interface DcApiGlobals {
  isSecureContext?: boolean;
  DigitalCredential?: { userAgentAllowsProtocol?: (protocol: string) => boolean };
  navigator?: { credentials?: Record<string, unknown> };
}

export interface DcApiEnvelope {
  digital: { requests: Array<{ protocol: string; data: unknown }> };
}

/**
 * Feature detection only — never a probe call, never user-agent sniffing.
 * Actual capability is answered by invoking and catching the throw.
 */
export function supportsDcApi(
  method: DcApiMethod,
  protocol: string,
  globals: DcApiGlobals = globalThis as unknown as DcApiGlobals,
): boolean {
  if (!globals || !globals.isSecureContext) return false;

  const dc = globals.DigitalCredential;
  if (!dc) return false;

  const credentials = globals.navigator?.credentials;
  if (!credentials) return false;
  if (typeof credentials[method] !== "function") return false;

  // Spec D4: `userAgentAllowsProtocol` is specified around presentation.
  // `openid4vci-v1` is a Chrome origin-trial identifier behind a flag, so a
  // browser that CAN issue may still answer false or throw for it. A false
  // negative would mean the feature silently never appears, which is worse
  // for this demo than a false positive costing one visible click.
  if (method === "create") return true;

  if (typeof dc.userAgentAllowsProtocol !== "function") return true;
  try {
    return Boolean(dc.userAgentAllowsProtocol(protocol));
  } catch {
    return false;
  }
}

/** Distinguishes "this browser cannot" from "this attempt failed". */
export function isDcApiNotSupportedError(error: unknown): boolean {
  const err = error as { name?: unknown; message?: unknown } | null | undefined;
  const name = typeof err?.name === "string" ? err.name : "";
  const message = typeof err?.message === "string" ? err.message : "";

  return (
    name === "NotSupportedError" ||
    (name === "TypeError" && /not supported/i.test(message)) ||
    /CredentialContainer/i.test(message)
  );
}

export function prepareDcApiRequest(data: unknown, protocol: string): DcApiEnvelope {
  return { digital: { requests: [{ protocol, data }] } };
}

/**
 * Presentation. MUST be reached with no `await` executed since the click
 * handler started — Chrome consumes transient activation otherwise.
 */
export async function invokeDcGet(req: DcApiEnvelope): Promise<{ response: string }> {
  const credentialResponse = await navigator.credentials.get(
    req as unknown as CredentialRequestOptions,
  );
  if (!credentialResponse || credentialResponse.constructor?.name !== "DigitalCredential") {
    throw new Error("No DigitalCredential returned from navigator.credentials.get");
  }
  return (credentialResponse as unknown as { data: { response: string } }).data;
}

/**
 * Issuance. Deliberately NOT symmetric with invokeDcGet: no return-shape
 * assertion. Chrome's documented issuance example ignores create()'s return
 * value, so asserting would manufacture failures on a successful handoff.
 * Non-throw IS the success signal.
 *
 * Same transient-activation constraint as invokeDcGet.
 */
export async function invokeDcCreate(req: DcApiEnvelope): Promise<void> {
  await navigator.credentials.create(req as unknown as CredentialCreationOptions);
}
```

Create `packages/ui/src/useDcApiSupport.ts`:

```ts
"use client";

import { useEffect, useState } from "react";
import { supportsDcApi, type DcApiMethod } from "./dcApi.js";

/**
 * `null` means "not yet known" and is load-bearing — it is NOT the same as
 * "known unavailable". A caller that renders the QR fallback on `null` will
 * flash a QR on Android before it disappears. Always false during SSR and the
 * first client render, so server and client markup agree (same discipline as
 * useIsTouch).
 *
 * Not unit-tested: it is a thin wrapper and all the logic lives in
 * supportsDcApi, which is.
 */
export function useDcApiSupport(method: DcApiMethod, protocol: string): boolean | null {
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    setSupported(supportsDcApi(method, protocol));
  }, [method, protocol]);

  return supported;
}
```

Append to `packages/ui/src/index.ts`:

```ts
export {
  DC_API_ISSUANCE_PROTOCOL,
  DC_API_PRESENTATION_PROTOCOL,
  invokeDcCreate,
  invokeDcGet,
  isDcApiNotSupportedError,
  prepareDcApiRequest,
  supportsDcApi,
} from "./dcApi.js";
export type { DcApiEnvelope, DcApiGlobals, DcApiMethod } from "./dcApi.js";
export { useDcApiSupport } from "./useDcApiSupport.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @demo/ui test && pnpm --filter @demo/ui typecheck`
Expected: PASS. ui test count goes 7 → 27.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/dcApi.ts packages/ui/src/dcApi.test.ts \
        packages/ui/src/useDcApiSupport.ts packages/ui/src/index.ts
git commit -m "feat(ui): add DC API detection and invocation primitives

Ported from foundry's admin console and eudipay-frontend. Globals are
injected so detection is testable under vitest's node environment.

Verified: 20 new unit tests cover the full support truth table and the
error classifier. Not verified: no navigator.credentials call is executed
here; useDcApiSupport is untested by design."
```

---

### Task 2: foundry-client DC API response relay

**Files:**
- Modify: `packages/foundry-client/src/client.ts`
- Modify: `packages/foundry-client/src/types.ts`
- Modify: `packages/foundry-client/src/index.ts`
- Test: `packages/foundry-client/src/client.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `interface AdminDcApiResponseBody { response: string }`
  - `FoundryClient.submitDcApiResponse(verificationId: string, response: string): Promise<VerificationResult>`

Background: `FoundryClient` already has a private `request<T>(method, path, body?)` that attaches the bearer token, sets `content-type`, uses `cache: "no-store"`, and throws `FoundryError` on non-2xx. Reuse it — do not write a new fetch. `VerificationResult` is already exported from `types.ts`. Path ids must be percent-encoded, matching `getVerificationStatus`.

- [ ] **Step 1: Write the failing test**

Append to `packages/foundry-client/src/client.test.ts` (inside the existing `describe("FoundryClient verification methods", ...)` block):

```ts
  it("relays a DC API response to the admin endpoint and returns the verdict", async () => {
    let seenUrl = "";
    let seenInit: RequestInit = {};
    const client = makeClient(
      stubFetch(
        200,
        { verified: true, checks: [{ check: "dcql_match", passed: true }], claims: {} },
        (url, init) => {
          seenUrl = url;
          seenInit = init;
        },
      ),
    );

    const result = await client.submitDcApiResponse("v_1", "eyJhbGciOi.encrypted.jwe");

    expect(seenUrl).toBe(
      "http://foundry.test:9000/admin/verification/requests/v_1/dc-api-response",
    );
    expect(seenInit.method).toBe("POST");
    expect(new Headers(seenInit.headers).get("authorization")).toBe("Bearer k-123");
    expect(JSON.parse(String(seenInit.body))).toEqual({
      response: "eyJhbGciOi.encrypted.jwe",
    });
    expect(result.verified).toBe(true);
  });

  it("percent-encodes the verification id in the dc-api-response path", async () => {
    let seenUrl = "";
    const client = makeClient(
      stubFetch(200, { verified: false, checks: [], claims: {} }, (url) => {
        seenUrl = url;
      }),
    );
    await client.submitDcApiResponse("a/b", "jwe");
    expect(seenUrl).toBe(
      "http://foundry.test:9000/admin/verification/requests/a%2Fb/dc-api-response",
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @demo/foundry-client test`
Expected: FAIL — `client.submitDcApiResponse is not a function`.

- [ ] **Step 3: Write the implementation**

In `packages/foundry-client/src/types.ts`, append:

```ts
/**
 * Body of POST /admin/verification/requests/{id}/dc-api-response.
 * See openapi.json AdminDcApiResponseBody. The value is the wallet's
 * encrypted JWE, taken verbatim from `DigitalCredential.data.response`.
 */
export interface AdminDcApiResponseBody {
  response: string;
}
```

In `packages/foundry-client/src/client.ts`, add `VerificationResult` to the type import list and add the method after `getVerificationStatus`:

```ts
  /**
   * Relays a browser Digital Credentials API response to foundry. This is an
   * ADMIN endpoint, so it can only ever be called server-side — the admin key
   * must never reach a browser. foundry verifies synchronously and returns the
   * verdict, but callers may discard it: the transaction state it also writes
   * is what the existing poll reads.
   */
  async submitDcApiResponse(
    verificationId: string,
    response: string,
  ): Promise<VerificationResult> {
    const path = `/admin/verification/requests/${encodeURIComponent(verificationId)}/dc-api-response`;
    return this.request<VerificationResult>("POST", path, { response });
  }
```

In `packages/foundry-client/src/index.ts`, add `AdminDcApiResponseBody` to the exported type list.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @demo/foundry-client test && pnpm --filter @demo/foundry-client typecheck`
Expected: PASS. foundry-client test count goes 7 → 9.

- [ ] **Step 5: Commit**

```bash
git add packages/foundry-client/src
git commit -m "feat(foundry-client): add submitDcApiResponse for the admin relay

Verified: 2 unit tests against a stubbed fetch assert the exact admin path,
bearer header, percent-encoding, and { response } body. Not verified: no
call against a running foundry."
```

---

### Task 3: Bank issuance returns the DC API offer

**Files:**
- Modify: `apps/bank/src/lib/issuance.ts`
- Modify: `apps/bank/src/app/api/cards/[id]/credential/route.ts`
- Test: `apps/bank/src/lib/issuance.test.ts`

**Interfaces:**
- Consumes: `CreateOfferResponse.dc_api_offer` (already typed in `@demo/foundry-client`; no change needed there).
- Produces: `StartIssuanceResult` success variant becomes `{ ok: true; sessionId: string; offerUri: string; dcApiOffer: unknown }`. The route's 200 body becomes `{ sessionId, offerUri, dcApiOffer }`.

Background: foundry's `POST /admin/issuance/offers` **always** returns `dc_api_offer` alongside `credential_offer_uri` — there is no transport parameter, because the offer, the pre-authorized code, `/token` and `/credential` are byte-identical either way. The two fields are two renderings of one offer. `dcApiOffer` is therefore **not persisted**: the offer is already recorded by `foundryTxId`, and a column would duplicate state and force a migration for nothing.

- [ ] **Step 1: Write the failing test**

In `apps/bank/src/lib/issuance.test.ts`, the existing fixture at ~L44 already includes `dc_api_offer: {}`. Change that fixture's value so the assertion is meaningful, and add a test.

Change the `offerOk` fixture's `dc_api_offer` to:

```ts
    dc_api_offer: { credential_issuer: "https://foundry.example", credential_configuration_ids: ["com.emvco.dpc.card"] },
```

Add inside the `describe("startIssuance", ...)` block:

```ts
  it("returns foundry's dc_api_offer verbatim alongside the deep-link uri", async () => {
    const result = await startIssuance(db, stubClient(offerOk), "user_anna", "card_anna");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.offerUri).toBe("openid-credential-offer://?x=1");
    expect(result.dcApiOffer).toEqual({
      credential_issuer: "https://foundry.example",
      credential_configuration_ids: ["com.emvco.dpc.card"],
    });
  });

  it("returns an undefined dcApiOffer when foundry omits it", async () => {
    const noDcApi = () => ({
      status: 200,
      body: { transaction_id: "tx_1", credential_offer_uri: "openid-credential-offer://?x=1" },
    });
    const result = await startIssuance(db, stubClient(noDcApi), "user_anna", "card_anna");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dcApiOffer).toBeUndefined();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @demo/bank test -- issuance`
Expected: FAIL — `Property 'dcApiOffer' does not exist on type ...`, or the assertion reports `undefined`.

- [ ] **Step 3: Write the implementation**

In `apps/bank/src/lib/issuance.ts`, change the success variant:

```ts
export type StartIssuanceResult =
  | { ok: true; sessionId: string; offerUri: string; dcApiOffer: unknown }
  | { ok: false; reason: "card_not_found" | "foundry_unavailable" };
```

and the return at the end of the `try` block:

```ts
    // Two renderings of ONE offer: the deep link and the DC API payload.
    // dcApiOffer is deliberately not persisted — the offer is already recorded
    // by foundryTxId, so a column would duplicate state (spec §2).
    return {
      ok: true,
      sessionId: rowId,
      offerUri: offer.credential_offer_uri,
      dcApiOffer: offer.dc_api_offer,
    };
```

In `apps/bank/src/app/api/cards/[id]/credential/route.ts`, change the final return:

```ts
  return NextResponse.json({
    sessionId: result.sessionId,
    offerUri: result.offerUri,
    dcApiOffer: result.dcApiOffer,
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @demo/bank test && pnpm --filter @demo/bank typecheck`
Expected: PASS. bank test count goes 85 → 87.

- [ ] **Step 5: Commit**

```bash
git add apps/bank/src/lib/issuance.ts apps/bank/src/lib/issuance.test.ts \
        'apps/bank/src/app/api/cards/[id]/credential/route.ts'
git commit -m "feat(bank): surface foundry's dc_api_offer through the issuance API

Verified: 2 new unit tests assert the offer is passed through verbatim and
that an absent dc_api_offer yields undefined rather than throwing. Not
verified: no call against a running foundry."
```

---

### Task 4: Bank issuance dialog uses the DC API

**Files:**
- Modify: `apps/bank/src/components/AddToWalletButton.tsx`
- Modify: `apps/bank/src/components/IssuanceDialog.tsx`

**Interfaces:**
- Consumes: `useDcApiSupport`, `prepareDcApiRequest`, `invokeDcCreate`, `isDcApiNotSupportedError`, `DC_API_ISSUANCE_PROTOCOL` from `@demo/ui` (Task 1); the `dcApiOffer` field on the `/api/cards/[id]/credential` response (Task 3).
- Produces: `IssuanceDialogProps` gains `dcApiOffer: unknown`.

Background: `AddToWalletButton` fetches the offer and only *then* mounts `IssuanceDialog` with `offerUri` as a prop. That means the DC API payload is already in the component before any click, which satisfies the transient-activation constraint with no restructuring — do not add a fetch inside the click handler.

There are **no unit tests in this task**: these are `.tsx` files, which vitest does not match, and jsdom is out of scope per the global constraints. Verification is by typecheck plus the headless-Chrome check in Task 8.

- [ ] **Step 1: Widen AddToWalletButton's session state**

In `apps/bank/src/components/AddToWalletButton.tsx`:

```tsx
interface Session {
  sessionId: string;
  offerUri: string;
  dcApiOffer: unknown;
}
```

In `start()`, change the state write:

```tsx
      const body = (await response.json()) as Session;
      setSession({
        sessionId: body.sessionId,
        offerUri: body.offerUri,
        dcApiOffer: body.dcApiOffer,
      });
```

And the render:

```tsx
        <IssuanceDialog
          sessionId={session.sessionId}
          offerUri={session.offerUri}
          dcApiOffer={session.dcApiOffer}
          onClose={() => setSession(null)}
        />
```

- [ ] **Step 2: Add the three-way waiting phase to IssuanceDialog**

In `apps/bank/src/components/IssuanceDialog.tsx`, extend the imports:

```tsx
import {
  DC_API_ISSUANCE_PROTOCOL,
  QrCanvas,
  invokeDcCreate,
  isDcApiNotSupportedError,
  prepareDcApiRequest,
  useDcApiSupport,
  useIsTouch,
  useStatusPoll,
} from "@demo/ui";
```

Extend the props:

```tsx
export interface IssuanceDialogProps {
  sessionId: string;
  offerUri: string;
  dcApiOffer: unknown;
  onClose: () => void;
}

export function IssuanceDialog({ sessionId, offerUri, dcApiOffer, onClose }: IssuanceDialogProps) {
```

Add state next to the existing `useIsTouch()` call:

```tsx
  const dcSupported = useDcApiSupport("create", DC_API_ISSUANCE_PROTOCOL);
  const [dcFailed, setDcFailed] = useState(false);
  const [dcMessage, setDcMessage] = useState<string | null>(null);
```

Add the click handler above the `return`:

```tsx
  // No `await` may execute before invokeDcCreate — Chrome consumes the click's
  // transient activation otherwise. dcApiOffer is already a prop, so nothing
  // needs fetching here.
  async function addViaDcApi() {
    try {
      await invokeDcCreate(prepareDcApiRequest(dcApiOffer, DC_API_ISSUANCE_PROTOCOL));
    } catch (err) {
      // English on purpose (spec D5): a browser-capability failure is a
      // technical signal, not customer copy.
      setDcMessage(
        isDcApiNotSupportedError(err)
          ? "This browser does not support the Digital Credentials API."
          : "The wallet handover was cancelled.",
      );
      setDcFailed(true);
    }
  }
```

- [ ] **Step 3: Replace the `isTouch` ternary in the waiting phase**

Replace the existing `{isTouch ? (...) : (...)}` block inside `phase === "waiting"` with:

```tsx
            {dcSupported === null ? (
              /* "Not yet known" is NOT "unavailable". Rendering the QR here
                 would flash it on Android before it disappears. */
              <p className="mt-6 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                Wird vorbereitet…
              </p>
            ) : dcSupported && !dcFailed ? (
              <>
                <button
                  type="button"
                  onClick={addViaDcApi}
                  className="btn btn-primary mt-6 px-5 py-3"
                >
                  Zum EUDI Wallet hinzufügen
                </button>
                <p className="mt-4 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                  Bestätigen Sie das Angebot in Ihrer EUDI Wallet App.
                </p>
              </>
            ) : isTouch ? (
              <>
                <a href={offerUri} className="btn btn-primary mt-6 px-5 py-3">
                  Im Wallet öffnen
                </a>
                <p className="mt-4 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                  Bestätigen Sie das Angebot in Ihrer EUDI Wallet App.
                </p>
              </>
            ) : (
              <>
                <div className="qr-frame mt-6 p-3">
                  <QrCanvas
                    value={offerUri}
                    size={220}
                    darkColor={QR_DARK}
                    ariaLabel="QR-Code für das Credential-Angebot"
                  />
                </div>
                <p className="mt-4 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                  Scannen Sie den Code mit Ihrer EUDI Wallet App.
                </p>
              </>
            )}

            {dcMessage ? (
              <p role="alert" className="mt-3 text-xs font-medium text-[var(--color-destructive)]">
                {dcMessage}
              </p>
            ) : null}
```

Note the fallback appears **immediately** on failure, with no intermediate button. That is correct and deliberately asymmetric with the merchant (Task 7): here `offerUri` and `dcApiOffer` are two renderings of one already-existing offer, so the fallback is free. On the merchant side it costs a whole new foundry verification request.

The poll and the `success` / `error` phases are untouched. Success still arrives as `offered → active`; foundry's issuance state machine does not know which transport delivered the credential.

- [ ] **Step 4: Verify it compiles and nothing regressed**

Run: `pnpm --filter @demo/bank typecheck && pnpm --filter @demo/bank test`
Expected: typecheck clean, 87 tests pass (unchanged from Task 3 — `.tsx` is not matched by vitest).

- [ ] **Step 5: Commit**

```bash
git add apps/bank/src/components/AddToWalletButton.tsx apps/bank/src/components/IssuanceDialog.tsx
git commit -m "feat(bank): offer DC API issuance when the browser supports it

The DC API button replaces the QR/deep link entirely when available; a
failure reveals the existing fallback immediately, since both are
renderings of the same offer.

Verified: typecheck clean, 87 bank tests still pass. Not verified: no
navigator.credentials.create() call is executed in this environment, and
.tsx files are not covered by vitest. Browser check follows in the final
task."
```

---

### Task 5: Merchant persists the chosen transport

**Files:**
- Modify: `apps/merchant/src/db/schema.ts`
- Create: `apps/merchant/drizzle/0002_*.sql` (generated, do not hand-write)
- Create: `apps/merchant/src/lib/transport.ts`
- Create: `apps/merchant/src/lib/transport.test.ts`
- Modify: `apps/merchant/src/lib/payment-sessions.ts`
- Modify: `apps/merchant/src/app/api/payment-sessions/route.ts`
- Test: `apps/merchant/src/lib/payment-sessions.test.ts`

**Interfaces:**
- Consumes: `CreateVerificationRequest.transport` and `CreateVerificationResponse.dc_api_request` (already typed in `@demo/foundry-client`).
- Produces:
  - `selectTransport(dcApiSupported: boolean | null): "dc_api" | "request_uri"` from `apps/merchant/src/lib/transport.js`
  - `startPaymentSession(db, client, orderId, merchantName, useDcApi?: boolean, now?: number)` — **`useDcApi` is inserted as the 5th parameter, `now` moves to 6th.** Verified: no existing caller passes `now` positionally.
  - `paymentSessions.transport` (`"request_uri" | "dc_api"`, NOT NULL, default `'request_uri'`) and `paymentSessions.dcApiRequestJson` (nullable TEXT).
  - The POST `/api/payment-sessions` body accepts an optional `dcApi: boolean`.

Background: under `transport: "dc_api"` foundry returns `dc_api_request` and **no** `openid4vp_uri` / `request_uri`, because `response_mode` becomes `dc_api.jwt` and the request object is inlined and unsigned. The row must record its own transport: it cannot be inferred from `openid4vp_uri IS NULL`, which is ambiguous against a foundry failure.

- [ ] **Step 1: Write the failing tests**

Create `apps/merchant/src/lib/transport.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { selectTransport } from "./transport.js";

describe("selectTransport", () => {
  it("chooses dc_api when the browser supports it", () => {
    expect(selectTransport(true)).toBe("dc_api");
  });

  it("chooses request_uri when the browser does not", () => {
    expect(selectTransport(false)).toBe("request_uri");
  });

  // `null` means detection has not resolved yet. Falling back to the QR
  // transport is the safe answer: it works everywhere.
  it("chooses request_uri when support is still unknown", () => {
    expect(selectTransport(null)).toBe("request_uri");
  });
});
```

Append to `apps/merchant/src/lib/payment-sessions.test.ts`, inside `describe("startPaymentSession", ...)`:

```ts
  const dcApiOk = () => ({
    status: 200,
    body: {
      verification_id: "ver_dc",
      dc_api_request: { client_id: "x509_hash:abc", nonce: "n1" },
    },
  });

  it("defaults to the request_uri transport and records it on the row", async () => {
    await startPaymentSession(db, stubClient(verificationOk), "ord_1", "Demo Shop");

    const row = db.select().from(paymentSessions).get();
    expect(row?.transport).toBe("request_uri");
    expect(row?.dcApiRequestJson).toBeNull();
  });

  it("asks foundry for the dc_api transport when told to", async () => {
    let sentBody: unknown = null;
    const client = stubClient((_url, init) => {
      sentBody = JSON.parse(String(init.body));
      return dcApiOk();
    });

    await startPaymentSession(db, client, "ord_1", "Demo Shop", true);

    expect(sentBody).toMatchObject({ transport: "dc_api" });
  });

  it("persists the inline dc_api_request and leaves both uris null", async () => {
    const result = await startPaymentSession(db, stubClient(dcApiOk), "ord_1", "Demo Shop", true);

    expect(result).toEqual({ ok: true, sessionId: expect.any(String), uri: "" });

    const row = db.select().from(paymentSessions).get();
    expect(row?.transport).toBe("dc_api");
    expect(row?.openid4vpUri).toBeNull();
    expect(row?.requestUri).toBeNull();
    expect(JSON.parse(row?.dcApiRequestJson ?? "null")).toEqual({
      client_id: "x509_hash:abc",
      nonce: "n1",
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @demo/merchant test`
Expected: FAIL — `Failed to resolve import "./transport.js"` and `Property 'transport' does not exist` on the row type.

- [ ] **Step 3: Write the implementation**

Create `apps/merchant/src/lib/transport.ts`:

```ts
/**
 * Which OpenID4VP transport to ask foundry for. Extracted from the component
 * so it is covered by vitest, which only matches `src/**‍/*.test.ts`.
 *
 * `null` means detection has not resolved yet (see useDcApiSupport). The QR
 * transport is the safe default: it works in every browser.
 */
export function selectTransport(dcApiSupported: boolean | null): "dc_api" | "request_uri" {
  return dcApiSupported === true ? "dc_api" : "request_uri";
}
```

In `apps/merchant/src/db/schema.ts`, add two columns to `paymentSessions`, after `requestUri`:

```ts
  /**
   * How this session's presentation was requested. Recorded rather than
   * inferred: `openid4vp_uri IS NULL` is ambiguous between a dc_api session
   * and a foundry failure.
   */
  transport: text("transport", { enum: ["request_uri", "dc_api"] })
    .notNull()
    .default("request_uri"),
  /** foundry's inline unsigned request object, verbatim. Only for dc_api. */
  dcApiRequestJson: text("dc_api_request_json"),
```

In `apps/merchant/src/lib/payment-sessions.ts`, change the signature and body:

```ts
export async function startPaymentSession(
  db: Db,
  client: FoundryClient,
  orderId: string,
  merchantName: string,
  useDcApi = false,
  now: number = Date.now(),
): Promise<StartPaymentSessionResult> {
```

Inside the `try`, replace the foundry call and the row update:

```ts
    const response = await client.createVerificationRequest({
      transport: useDcApi ? "dc_api" : "request_uri",
      dcql_query: buildDcqlQuery(),
      transaction_data: buildTransactionData(order.id, order.totalCents, merchantName),
    });

    // Under dc_api foundry returns neither uri — the request object is inlined
    // and unsigned because response_mode is dc_api.jwt.
    const uri = response.openid4vp_uri ?? response.request_uri ?? "";

    db.update(paymentSessions)
      .set({
        foundryVerificationId: response.verification_id,
        openid4vpUri: response.openid4vp_uri ?? null,
        requestUri: response.request_uri ?? null,
        transport: useDcApi ? "dc_api" : "request_uri",
        dcApiRequestJson:
          response.dc_api_request === undefined || response.dc_api_request === null
            ? null
            : JSON.stringify(response.dc_api_request),
      })
      .where(eq(paymentSessions.id, sessionId))
      .run();
```

In `apps/merchant/src/app/api/payment-sessions/route.ts`, widen the schema and the call:

```ts
const bodySchema = z.object({
  orderId: z.string().min(1),
  /** The browser's DC API detection result. Absent means "no". */
  dcApi: z.boolean().optional(),
});
```

```ts
  const result = await startPaymentSession(
    getDb(),
    getFoundry(),
    parsed.data.orderId,
    env.MERCHANT_NAME,
    parsed.data.dcApi ?? false,
  );
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @demo/merchant db:generate`
Expected: a new `apps/merchant/drizzle/0002_*.sql` adding both columns with `DEFAULT 'request_uri'` on `transport`. Read it and confirm it is `ALTER TABLE ... ADD COLUMN` only — never a table rebuild that drops rows.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @demo/merchant test && pnpm --filter @demo/merchant typecheck`
Expected: PASS. merchant test count goes 87 → 93.

- [ ] **Step 6: Verify the migration applies to an existing database**

```bash
pnpm migrate
```
Expected: exits 0. The `transport` default keeps every pre-existing row valid, so no data is lost.

- [ ] **Step 7: Commit**

```bash
git add apps/merchant/src/db/schema.ts apps/merchant/drizzle \
        apps/merchant/src/lib/transport.ts apps/merchant/src/lib/transport.test.ts \
        apps/merchant/src/lib/payment-sessions.ts apps/merchant/src/lib/payment-sessions.test.ts \
        apps/merchant/src/app/api/payment-sessions/route.ts
git commit -m "feat(merchant): choose and persist the verification transport

transport must be fixed at create time because it changes the OpenID4VP
wire, so the browser's detection result travels in the POST body.

Verified: 6 new unit tests cover selectTransport and the dc_api persistence
path against a stubbed foundry; pnpm migrate applies the additive migration
to an existing database. Not verified: no call against a running foundry."
```

---

### Task 6: Merchant relays the wallet's DC API response

**Files:**
- Create: `apps/merchant/src/lib/dc-api-relay.ts`
- Create: `apps/merchant/src/lib/dc-api-relay.test.ts`
- Create: `apps/merchant/src/app/api/payment-sessions/[id]/dc-api-response/route.ts`

**Interfaces:**
- Consumes: `FoundryClient.submitDcApiResponse` (Task 2); `paymentSessions.foundryVerificationId`.
- Produces: `relayDcApiResponse(db, client, sessionId, response): Promise<RelayResult>` where `RelayResult = { ok: true } | { ok: false; reason: "not_found" | "no_verification" | "foundry_unavailable" }`.

Background: foundry's `dc-api-response` endpoint is **admin-authenticated**, so the browser cannot call it — the merchant must proxy. The dynamic segment in this app is `[id]`, not `[sessionId]`; see the sibling `[id]/cancel/route.ts`. foundry returns a `VerificationResult` synchronously, but this route **discards it and returns 204**: the verdict reaches the UI through the poll that is already running, and adding a second render path would create two sources of truth for one state.

- [ ] **Step 1: Write the failing test**

Create `apps/merchant/src/lib/dc-api-relay.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FoundryClient } from "@demo/foundry-client";
import { createDb, type Db } from "../db/index.js";
import { orders, paymentSessions } from "../db/schema.js";
import { relayDcApiResponse } from "./dc-api-relay.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "merchant-relay-"));
  db = createDb(path.join(dir, "test.db"));
  db.insert(orders)
    .values({
      id: "ord_1",
      totalCents: 1_000,
      currency: "EUR",
      customerName: "Ada",
      customerEmail: "ada@example.com",
      status: "pending",
      createdAt: 1,
    })
    .run();
  db.insert(paymentSessions)
    .values({
      id: "sess_dc",
      orderId: "ord_1",
      state: "pending",
      foundryVerificationId: "ver_dc",
      transport: "dc_api",
      createdAt: 1,
    })
    .run();
  db.insert(paymentSessions)
    .values({
      id: "sess_orphan",
      orderId: "ord_1",
      state: "pending",
      foundryVerificationId: null,
      transport: "dc_api",
      createdAt: 1,
    })
    .run();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function stubClient(status: number, capture?: (url: string, init: RequestInit) => void) {
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    capture?.(String(input), init ?? {});
    return new Response(JSON.stringify({ verified: true, checks: [], claims: {} }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return new FoundryClient({ adminUrl: "http://f:9000", adminKey: "k", fetchImpl });
}

describe("relayDcApiResponse", () => {
  it("forwards the wallet's response to foundry for the session's verification", async () => {
    let seenUrl = "";
    let seenBody = "";
    const client = stubClient(200, (url, init) => {
      seenUrl = url;
      seenBody = String(init.body);
    });

    const result = await relayDcApiResponse(db, client, "sess_dc", "the.encrypted.jwe");

    expect(result).toEqual({ ok: true });
    expect(seenUrl).toBe("http://f:9000/admin/verification/requests/ver_dc/dc-api-response");
    expect(JSON.parse(seenBody)).toEqual({ response: "the.encrypted.jwe" });
  });

  it("reports not_found for an unknown session", async () => {
    const result = await relayDcApiResponse(db, stubClient(200), "sess_nope", "jwe");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("reports no_verification when the session never reached foundry", async () => {
    const result = await relayDcApiResponse(db, stubClient(200), "sess_orphan", "jwe");
    expect(result).toEqual({ ok: false, reason: "no_verification" });
  });

  it("reports foundry_unavailable on a non-2xx from foundry", async () => {
    const result = await relayDcApiResponse(db, stubClient(500), "sess_dc", "jwe");
    expect(result).toEqual({ ok: false, reason: "foundry_unavailable" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @demo/merchant test -- dc-api-relay`
Expected: FAIL — `Failed to resolve import "./dc-api-relay.js"`.

- [ ] **Step 3: Write the implementation**

Create `apps/merchant/src/lib/dc-api-relay.ts`:

```ts
import { eq } from "drizzle-orm";
import type { FoundryClient } from "@demo/foundry-client";
import type { Db } from "../db/index.js";
import { paymentSessions } from "../db/schema.js";

export type RelayResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "no_verification" | "foundry_unavailable" };

/**
 * Relays a browser Digital Credentials API response to foundry.
 *
 * This exists because foundry's dc-api-response endpoint is ADMIN
 * authenticated: the browser cannot call it without the admin key, and the
 * admin key must never leave the server.
 *
 * foundry verifies synchronously and returns a verdict, which is deliberately
 * DISCARDED. The transaction state foundry also writes is what the poll
 * already running in PaymentScreen reads — one state path, not two.
 */
export async function relayDcApiResponse(
  db: Db,
  client: FoundryClient,
  sessionId: string,
  response: string,
): Promise<RelayResult> {
  const row = db.select().from(paymentSessions).where(eq(paymentSessions.id, sessionId)).get();
  if (!row) return { ok: false, reason: "not_found" };
  if (!row.foundryVerificationId) return { ok: false, reason: "no_verification" };

  try {
    await client.submitDcApiResponse(row.foundryVerificationId, response);
    return { ok: true };
  } catch {
    return { ok: false, reason: "foundry_unavailable" };
  }
}
```

Create `apps/merchant/src/app/api/payment-sessions/[id]/dc-api-response/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/index.js";
import { getFoundry } from "@/lib/foundry.js";
import { relayDcApiResponse } from "@/lib/dc-api-relay.js";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ response: z.string().min(1) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { id } = await context.params;
  const result = await relayDcApiResponse(getDb(), getFoundry(), id, parsed.data.response);

  if (!result.ok) {
    const status = result.reason === "foundry_unavailable" ? 502 : 404;
    return NextResponse.json({ error: result.reason }, { status });
  }

  // 204: the verdict reaches the UI through the poll already running.
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @demo/merchant test && pnpm --filter @demo/merchant typecheck`
Expected: PASS. merchant test count goes 93 → 97.

- [ ] **Step 5: Commit**

```bash
git add apps/merchant/src/lib/dc-api-relay.ts apps/merchant/src/lib/dc-api-relay.test.ts \
        'apps/merchant/src/app/api/payment-sessions/[id]/dc-api-response/route.ts'
git commit -m "feat(merchant): relay the wallet's DC API response to foundry

Server-side by necessity: foundry's dc-api-response endpoint is admin
authenticated and the admin key must never reach a browser. The route
returns 204 and lets the existing poll deliver the verdict.

Verified: 4 unit tests cover the happy path, unknown session, a session
with no foundry verification, and a foundry 500. Not verified: no call
against a running foundry."
```

---

### Task 7: Merchant checkout and payment screen use the DC API

**Files:**
- Modify: `apps/merchant/src/components/CheckoutForm.tsx`
- Modify: `apps/merchant/src/app/pay/[sessionId]/page.tsx`
- Modify: `apps/merchant/src/components/PaymentScreen.tsx`

**Interfaces:**
- Consumes: `useDcApiSupport`, `prepareDcApiRequest`, `invokeDcGet`, `isDcApiNotSupportedError`, `DC_API_PRESENTATION_PROTOCOL` from `@demo/ui` (Task 1); `selectTransport` from `@/lib/transport.js` and the `dcApi` POST field (Task 5); the relay route (Task 6).
- Produces: `PaymentScreenProps` gains `transport: "request_uri" | "dc_api"` and `dcApiRequest: unknown`.

Background, and the reason this task is not three tasks: detection has to happen in `CheckoutForm` because `transport` is fixed when the session is created, but the *invocation* happens on `/pay/<id>` after a navigation. Those two files are one mechanism split across a page boundary; changing one without the other leaves the app broken.

`PaymentScreen` does **not** call `useDcApiSupport` and has no `null` phase — by the time it renders, the transport is a fact on the session row. Do not add a loading state there.

`.tsx` files are not covered by vitest. Verification is typecheck plus Task 8's browser check.

- [ ] **Step 1: Detect in CheckoutForm and send the result**

In `apps/merchant/src/components/CheckoutForm.tsx`, add the imports:

```tsx
import { DC_API_PRESENTATION_PROTOCOL, useDcApiSupport } from "@demo/ui";
import { selectTransport } from "@/lib/transport.js";
```

Inside the component, next to the existing `useState` calls:

```tsx
  // Detection must happen HERE, not on the pay page: `transport` changes the
  // OpenID4VP wire and is therefore fixed when the session is created.
  const dcApiSupported = useDcApiSupport("get", DC_API_PRESENTATION_PROTOCOL);
```

In `onSubmit`, change the session POST body:

```tsx
      const sessionResponse = await fetch("/api/payment-sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderId: order.orderId,
          dcApi: selectTransport(dcApiSupported) === "dc_api",
        }),
      });
```

- [ ] **Step 2: Pass the transport through the pay page**

In `apps/merchant/src/app/pay/[sessionId]/page.tsx`, extend the `<PaymentScreen>` props:

```tsx
      openid4vpUri={session.openid4vpUri ?? session.requestUri ?? ""}
      transport={session.transport}
      dcApiRequest={session.dcApiRequestJson ? JSON.parse(session.dcApiRequestJson) : null}
      initialState={session.state}
```

- [ ] **Step 3: Add the DC API branch to PaymentScreen**

In `apps/merchant/src/components/PaymentScreen.tsx`, extend the imports:

```tsx
import {
  DC_API_PRESENTATION_PROTOCOL,
  QrCanvas,
  invokeDcGet,
  isDcApiNotSupportedError,
  prepareDcApiRequest,
  useIsTouch,
  useStatusPoll,
} from "@demo/ui";
```

Extend the props interface and the destructuring:

```tsx
export interface PaymentScreenProps {
  sessionId: string;
  orderId: string;
  amountCents: number;
  merchantName: string;
  openid4vpUri: string;
  transport: "request_uri" | "dc_api";
  dcApiRequest: unknown;
  /** A session that was already terminal when the page rendered. */
  initialState: string;
  initialFailureReason?: string;
}
```

```tsx
export function PaymentScreen({
  sessionId,
  orderId,
  amountCents,
  merchantName,
  openid4vpUri,
  transport,
  dcApiRequest,
  initialState,
  initialFailureReason,
}: PaymentScreenProps) {
```

Add state next to `redirecting`:

```tsx
  const [dcFailed, setDcFailed] = useState(false);
  const [dcMessage, setDcMessage] = useState<string | null>(null);
  const [dcBusy, setDcBusy] = useState(false);
```

Gate the existing auto-redirect on the transport — under `dc_api` there is no URI to navigate to, and the gesture requirement forbids an on-mount action:

```tsx
  useEffect(() => {
    if (transport !== "request_uri") return;
    if (!isTouch || terminalAtRender || redirecting) return;
    setRedirecting(true);
    window.location.href = openid4vpUri;
  }, [transport, isTouch, terminalAtRender, redirecting, openid4vpUri]);
```

Add the two handlers next to `tryAgain`:

```tsx
  // No `await` may execute before invokeDcGet — Chrome consumes the click's
  // transient activation otherwise. dcApiRequest is already a prop.
  async function payViaDcApi() {
    setDcBusy(true);
    try {
      const data = await invokeDcGet(
        prepareDcApiRequest(dcApiRequest, DC_API_PRESENTATION_PROTOCOL),
      );
      await fetch(`/api/payment-sessions/${sessionId}/dc-api-response`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ response: data.response }),
      });
      // The poll already running picks up the verdict on its next tick.
    } catch (err) {
      setDcMessage(
        isDcApiNotSupportedError(err)
          ? "This browser does not support the Digital Credentials API."
          : "Could not open your wallet on this device.",
      );
      setDcFailed(true);
    } finally {
      setDcBusy(false);
    }
  }

  // A dc_api session cannot be re-rendered as a QR: it is bound to
  // response_mode dc_api.jwt with an inlined request object. Recovery means a
  // fresh request_uri session for the same still-pending order.
  async function showQrInstead() {
    setRetryError(null);
    try {
      const response = await fetch("/api/payment-sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId, dcApi: false }),
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
```

Finally, in the last `: (` branch of the render (the "Waiting for your wallet" block), replace the QR frame and its caption with a three-way choice. Keep the badge and the Cancel button exactly as they are:

```tsx
            {transport === "dc_api" && !dcFailed ? (
              <>
                <button
                  type="button"
                  onClick={payViaDcApi}
                  disabled={dcBusy}
                  className="eudipay-button eudipay-button-primary mt-6 py-3"
                >
                  {dcBusy ? "Opening your wallet…" : "Pay with your wallet"}
                </button>
                <p className="eudipay-muted mt-4 text-sm">
                  Approve the payment in your EUDI Wallet.
                </p>
              </>
            ) : transport === "dc_api" ? (
              <>
                <p role="alert" className="mt-6 text-sm font-medium text-[#b91c1c]">
                  {dcMessage}
                </p>
                <button
                  type="button"
                  onClick={showQrInstead}
                  className="eudipay-button eudipay-button-primary mt-4 py-3"
                >
                  Show QR code
                </button>
                {retryError ? (
                  <p role="alert" className="eudipay-muted mt-2 text-sm">
                    {retryError}
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <div className="eudipay-qr-frame mt-5 p-3">
                  <QrCanvas
                    value={openid4vpUri}
                    size={220}
                    darkColor={BRAND_BLUE}
                    ariaLabel="QR code for the payment request"
                  />
                </div>
                <p className="eudipay-muted mt-4 text-sm">
                  Scan this with your EUDI Wallet to approve the payment.
                </p>
              </>
            )}
```

- [ ] **Step 4: Verify it compiles and nothing regressed**

Run: `pnpm --filter @demo/merchant typecheck && pnpm --filter @demo/merchant test`
Expected: typecheck clean, 97 tests pass (unchanged from Task 6).

- [ ] **Step 5: Commit**

```bash
git add apps/merchant/src/components/CheckoutForm.tsx \
        'apps/merchant/src/app/pay/[sessionId]/page.tsx' \
        apps/merchant/src/components/PaymentScreen.tsx
git commit -m "feat(merchant): pay via the DC API when the browser supports it

Detection runs in CheckoutForm because transport is fixed at session-create
time. On failure the user gets an explicit 'Show QR code' button, which
creates a fresh request_uri session — a dc_api request cannot be re-rendered
as a QR.

Verified: typecheck clean, 97 merchant tests still pass. Not verified: no
navigator.credentials.get() call is executed in this environment, and .tsx
files are not covered by vitest."
```

---

### Task 8: Documentation and end-to-end verification

**Files:**
- Modify: `AGENTS.md`
- Modify: `apps/bank/AGENTS.md`
- Modify: `apps/merchant/AGENTS.md`

**Interfaces:**
- Consumes: everything from Tasks 1-7.
- Produces: no code.

- [ ] **Step 1: Run the full gate**

```bash
pnpm check
```
Expected: green, **210 tests** (87 bank + 97 merchant + 9 foundry-client + 27 ui). If the number differs, count what actually ran and use the real number everywhere below — never carry a number forward from a plan.

- [ ] **Step 2: Verify the fallback path in a real browser**

Headless Chrome exposes no `window.DigitalCredential`, so this verifies exactly one half — but it is the half most likely to regress.

```bash
pnpm dev   # in one shell; foundry must be running at ../foundry
node tools/cdp/cdp.mjs   # see the tool's own usage
```

Confirm, on the merchant at `http://localhost:3000`: add an item, check out, and the pay page shows the **QR code**, not the DC API button. Confirm no QR flicker on load. Then on the bank at `http://localhost:3001`: log in, "Zum EUDI Wallet hinzufügen", and the dialog shows the QR.

Record the actual observed result. If the DC API button appears in headless Chrome, detection is wrong — stop and fix it.

- [ ] **Step 3: Document the constraints in `AGENTS.md`**

Add to the "Hard-won constraints" section of the root `AGENTS.md`:

```markdown
### DC API

- **`packages/ui/src/dcApi.ts` injects browser globals on purpose.** All four
  vitest projects run `environment: "node"` with `include: ["src/**/*.test.ts"]`
  — there is no jsdom and `.tsx` is not matched. Reading `window` at module
  scope would make detection untestable. Keep decisions in `.ts`, rendering in
  `.tsx`.
- **No `await` may execute between a click handler starting and
  `navigator.credentials.get()` / `.create()`.** Chrome consumes the click's
  transient activation. This is why both apps have the DC API payload in the
  component as a prop before the click, rather than fetching it in the handler.
- **The `create` gate is lenient, the `get` gate is strict** —
  `packages/ui/src/dcApi.ts` skips `userAgentAllowsProtocol` for `create`.
  `openid4vci-v1` is a Chrome origin-trial identifier behind
  `chrome://flags/#web-identity-digital-credentials-creation`, not a shipped
  protocol, so a browser that can issue may still answer `false`. Not a bug.
- **`useDcApiSupport` returning `null` is not `false`.** It means "not yet
  known". Rendering the QR fallback on `null` flashes a QR on Android.
- **foundry needs `verifier.dc_api_expected_origins` to list the merchant
  origin.** Over the DC API transport the KB-JWT audience MUST be the
  browsing-context Origin. Unset, foundry accepts only an origin derived from
  its own `public_base_url`. Until this is configured, a merchant DC API
  payment fails `transaction_data_binding` *as a payment decline*, not as a
  transport error — nothing throws in the browser, so the "Show QR code"
  recovery never appears. `config.yaml` is gitignored in `../foundry`.
```

Update the test-count line in the root `AGENTS.md` from `**186 tests** (85 bank + 87 merchant + 7 foundry-client + 7 ui)` to whatever Step 1 actually measured, and note that the increase came from this work.

Add to the "Known-unverifiable" section:

```markdown
The DC API legs are unverified for the same reason as the wallet leg: no
`navigator.credentials.create()` or `.get()` call has been executed in this
environment. Whether Chrome's `userAgentAllowsProtocol('openid4vp-v1-unsigned')`
answers `true` on real Android hardware with the EUDI wallet installed is
unknown, and that answer is the entire premise of the strict `get` gate.
Headless Chrome verifies only the fallback path.
```

- [ ] **Step 4: Document the per-app details**

In `apps/bank/AGENTS.md`, note that issuance uses `openid4vci-v1` via
`navigator.credentials.create`, that a human testing it needs
`chrome://flags/#web-identity-digital-credentials-creation` enabled, that no
origin-trial token is embedded in markup by design, and that DC API diagnostic
strings are English while all other copy stays German.

In `apps/merchant/AGENTS.md`, replace the existing claim that the pay screen
"follows the `openid4vp://` deep link on a touch device" with the actual rule:
DC API wins wherever available; the deep link is now the *touch fallback*.
Record that `transport` is fixed at session-create time, that detection
therefore lives in `CheckoutForm`, and that a `dc_api` session can never be
re-rendered as a QR — recovery creates a new `request_uri` session.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md apps/bank/AGENTS.md apps/merchant/AGENTS.md
git commit -m "docs: record DC API constraints and the measured test baseline

Verified: pnpm check green at <N> tests, measured; headless Chrome shows the
QR fallback on both apps with no flicker. Not verified: no DC API
invocation has been executed anywhere, and foundry's
dc_api_expected_origins is still unset, so a real merchant DC API payment
would currently fail transaction_data_binding as a decline."
```

---

## Post-plan follow-ups (not tasks)

1. **A human must add the merchant origin to `../foundry/config.yaml`:**
   ```yaml
   verifier:
     dc_api_expected_origins: ["https://larder-shop.digitallabor.dev"]
   ```
   then `foundry config validate` and restart. Until then merchant DC API
   payments fail as declines.
2. **A human with an Android device and the EUDI wallet** runs both flows
   against the public origins and reports whether
   `userAgentAllowsProtocol('openid4vp-v1-unsigned')` answers `true`.
3. **If it answers `false` on real hardware,** revisit spec D4 and make the
   `get` gate lenient too.