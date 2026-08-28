# PaSO Proof Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The merchant receives foundry's verification-artifact webhook, assembles the PaSO Proof/Verify §4.1 package, and forwards it on the existing debit; the bank stores it against the transaction and shows it from the ledger.

**Architecture:** Events land in a merchant **inbox** table (`verifier_events`) because they can arrive before the merchant knows the `tx_id`. `refreshPaymentSessionState` reads the inbox after its existing gates pass and waits up to 6 s for a complete package before debiting. The package rides on `POST /api/payments` and is written inside `processPayment`'s existing SQL transaction. The bank stores only — it runs none of PaSO §3's checks — and the viewer decodes with a raw toggle.

**Tech Stack:** Next.js 15 (App Router), drizzle-orm + better-sqlite3, zod, vitest (`environment: "node"`), Node `crypto` for HMAC.

**Spec:** [`docs/superpowers/specs/2026-08-28-paso-proof-package-design.md`](../specs/2026-08-28-paso-proof-package-design.md)

## Global Constraints

- **`pnpm`, never `npm`.** Commands run from the repo root unless a task says otherwise.
- **The gate is `pnpm check`** (`typecheck && test` across all four projects). Baseline at the start of this plan: **756 tests**. **Do not project a total** — measure per-file `it()` deltas *and* the run's own total, and reconcile them. Every plan in this repo that projected a total was wrong.
- **TDD, strictly.** Write the failing test, run it, confirm it fails *for the right reason*, then implement.
- **Local imports are written `./foo.js` for a `./foo.ts` file.** Correct Node ESM; vitest and `tsc` both depend on it. Do not "fix" an import to drop the extension.
- **TypeScript is strict with `noUnusedLocals` / `noUnusedParameters`.** An intentionally unused parameter must be prefixed `_`.
- **Decisions live in `.ts`, rendering in `.tsx`.** All four vitest projects are `environment: "node"` with `include: ["src/**/*.test.ts"]` — a `.tsx` file is **never** covered. A branch or decode written inline in a component is untested by construction.
- **Read `drizzle-kit generate`'s output before committing it.** This repo has been bitten twice by a generated table rebuild whose `INSERT … SELECT` lists a newly-added column on both sides — unrunnable (`no such column`). A column addition must be a plain `ALTER TABLE … ADD`; a table addition a plain `CREATE TABLE`. Hand-edit otherwise, and apply to a real SQLite file before committing.
- **Adding a no-default env var means editing the root `Dockerfile`'s build-stage `ENV` block** (line ~43) **and that app's `vitest.config.ts` `test.env` block.** `env.ts` validates at import time; miss the first and `next build` fails remotely from its cause, miss the second and every test in the project fails.
- **The bank is bilingual.** New user-facing copy goes in **both** `apps/bank/src/lib/i18n/en.ts` and `de.ts`, declared on the `Messages` interface in `messages.ts`. A missing key is a compile error, which is the real gate — `messages.test.ts` needs no new cases.
- **The bank's copy must never claim it verified the package.** Design D4: the bank stores only.
- **Wire names are the spec's** — `signed_request`, `vp_token`, snake_case, inside the package object. Internal TypeScript is camelCase (`signedRequest`, `vpToken`). Do not blur the two.
- **Commits** use conventional prefixes and state what was *verified*, and plainly what was not.

---

### Task 1: Merchant — the `verifier_events` inbox table

**Files:**

- Modify: `apps/merchant/src/db/schema.ts`
- Create: `apps/merchant/drizzle/0005_*.sql` (generated)
- Test: `apps/merchant/src/db/schema.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `verifierEvents` drizzle table; `VerifierEventRow = typeof verifierEvents.$inferSelect`. Tasks 3 and 4 import the table.

- [ ] **Step 1: Write the failing test**

Append to `apps/merchant/src/db/schema.test.ts` (its `beforeEach` already builds `db` against a temp file and migrates). Extend the file's `./schema.js` import to include `verifierEvents`.

```ts
describe("verifier_events", () => {
  it("accepts a request event with no vp_token", () => {
    db.insert(verifierEvents)
      .values({
        txId: "ver_1",
        event: "presentation_request_delivered",
        transport: "request_uri",
        signedRequest: "eyJ0eXAi.eyJhdWQi.c2ln",
        vpTokenJson: null,
        receivedAt: 10,
      })
      .run();

    const rows = db.select().from(verifierEvents).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.vpTokenJson).toBeNull();
  });

  it("accepts a completion event with no signed request", () => {
    db.insert(verifierEvents)
      .values({
        txId: "ver_1",
        event: "verification_completed",
        transport: null,
        signedRequest: null,
        vpTokenJson: JSON.stringify({ dpc: ["eyJ..."] }),
        receivedAt: 11,
      })
      .run();

    expect(db.select().from(verifierEvents).all()[0]!.signedRequest).toBeNull();
  });

  it("keeps every delivery of the same transaction rather than replacing it", () => {
    // Design D6: `presentation_request_delivered` fires per FETCH and each copy
    // is different bytes. There is no unique constraint on tx_id, deliberately.
    for (const [i, jws] of ["a.b.c", "d.e.f"].entries()) {
      db.insert(verifierEvents)
        .values({
          txId: "ver_1",
          event: "presentation_request_delivered",
          transport: "request_uri",
          signedRequest: jws,
          vpTokenJson: null,
          receivedAt: 20 + i,
        })
        .run();
    }

    expect(db.select().from(verifierEvents).all()).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @demo/merchant exec vitest run src/db/schema.test.ts
```

Expected: FAIL to compile — `verifierEvents` is not exported from `./schema.js`.

- [ ] **Step 3: Add the table**

Append to `apps/merchant/src/db/schema.ts`, after `paymentSessions`:

```ts
/**
 * Verification events delivered by foundry's artifact webhook.
 *
 * An INBOX rather than columns on `payment_sessions`, for three reasons
 * (design D7):
 *
 * 1. `presentation_request_delivered` is dispatched INSIDE foundry's
 *    `create_verification_request`, so it can reach us before
 *    `startPaymentSession` has written `foundry_verification_id` onto the
 *    session row. A direct write would have nothing to write to.
 * 2. That event fires per DELIVERY, not per transaction — on `request_uri` it
 *    fires for every `GET /vp/request/:id`, and ECDSA signing is randomized, so
 *    each copy is genuinely different bytes. Rows accumulate; the reader picks.
 * 3. The grace period in `refreshPaymentSessionState` needs something to poll.
 *
 * Deliberately no unique constraint on `tx_id` — see reason 2. No foreign key
 * to `payment_sessions` either: reason 1 means the session row may not carry
 * that id yet, and a `presentation_request_delivered` for the BANK's wallet
 * login is stored too (it is a request object, not holder data).
 */
export const verifierEvents = sqliteTable("verifier_events", {
 id: integer("id").primaryKey({ autoIncrement: true }),
 /** foundry's `verification_id`. */
 txId: text("tx_id").notNull(),
 event: text("event", {
  enum: ["presentation_request_delivered", "verification_completed"],
 }).notNull(),
 /** From the request event only. NULL on a completion. */
 transport: text("transport"),
 /**
  * foundry's `request_object_jws` — the PaSO `signed_request`. NULL when
  * foundry's `verifier.webhook.include_raw_artifacts` is off, which is its
  * default: the event still fires, it just carries no artefact.
  */
 signedRequest: text("signed_request"),
 /** `JSON.stringify(vp_token)`. NULL for the same reason as above. */
 vpTokenJson: text("vp_token_json"),
 receivedAt: integer("received_at").notNull(),
});
```

Add beside the other type exports at the bottom of the file:

```ts
export type VerifierEventRow = typeof verifierEvents.$inferSelect;
```

- [ ] **Step 4: Generate and inspect the migration**

```bash
pnpm --filter @demo/merchant run db:generate
cat apps/merchant/drizzle/0005_*.sql
```

Expected: a plain `CREATE TABLE \`verifier_events\` (…)` and nothing else. If it touched another table, hand-edit it down.

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter @demo/merchant exec vitest run src/db/schema.test.ts
```

Expected: PASS, including the three new cases.

- [ ] **Step 6: Run the gate**

```bash
pnpm check
```

- [ ] **Step 7: Commit**

```bash
git add apps/merchant/src/db/schema.ts apps/merchant/src/db/schema.test.ts apps/merchant/drizzle
git commit -m "feat(merchant): add the verifier_events inbox table"
```

---

### Task 2: Merchant — event parsing and HMAC verification

**Files:**

- Create: `apps/merchant/src/lib/verifier-events.ts`
- Create: `apps/merchant/src/lib/verifier-events.test.ts`
- Modify: `apps/merchant/src/env.ts`, `apps/merchant/vitest.config.ts`, `Dockerfile`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `export type VerifierEvent = { event: "presentation_request_delivered"; txId: string; transport: string; signedRequest: string | null } | { event: "verification_completed"; txId: string; vpToken: unknown }`
  - `export function parseVerifierEvent(body: unknown): VerifierEvent | null`
  - `export function verifyWebhookSignature(rawBody: string, header: string | null, secret: string): boolean`
  - `env.FOUNDRY_WEBHOOK_SECRET: string`

  Task 3 consumes all four.

- [ ] **Step 1: Write the failing test**

Create `apps/merchant/src/lib/verifier-events.test.ts`:

```ts
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseVerifierEvent, verifyWebhookSignature } from "./verifier-events.js";

const SECRET = "s3cr3t";

/** Exactly what foundry's `sign_body` produces: `sha256=<lowercase hex>`. */
function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("verifyWebhookSignature", () => {
  it("accepts a signature over the exact body bytes", () => {
    const body = '{"event":"verification_completed","tx_id":"ver_1"}';
    expect(verifyWebhookSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("rejects a body that changed by one byte", () => {
    expect(verifyWebhookSignature('{"a":2}', sign('{"a":1}'), SECRET)).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    const body = '{"a":1}';
    expect(verifyWebhookSignature(body, sign(body, "other"), SECRET)).toBe(false);
  });

  it("rejects an absent header", () => {
    expect(verifyWebhookSignature('{"a":1}', null, SECRET)).toBe(false);
  });

  it("rejects a header without the sha256= prefix", () => {
    const body = '{"a":1}';
    expect(verifyWebhookSignature(body, sign(body).slice(7), SECRET)).toBe(false);
  });

  it("rejects a header of the wrong length without throwing", () => {
    // timingSafeEqual throws on a length mismatch; the wrapper must not.
    expect(verifyWebhookSignature('{"a":1}', "sha256=beef", SECRET)).toBe(false);
  });

  it("rejects a header that is not hex", () => {
    expect(verifyWebhookSignature('{"a":1}', `sha256=${"z".repeat(64)}`, SECRET)).toBe(false);
  });
});

describe("parseVerifierEvent", () => {
  it("reads a request event carrying a signed request", () => {
    expect(
      parseVerifierEvent({
        event: "presentation_request_delivered",
        tx_id: "ver_1",
        transport: "request_uri",
        request_object_jws: "a.b.c",
      }),
    ).toEqual({
      event: "presentation_request_delivered",
      txId: "ver_1",
      transport: "request_uri",
      signedRequest: "a.b.c",
    });
  });

  it("normalises an ABSENT request_object_jws to null", () => {
    // foundry uses `skip_serializing_if = Option::is_none`, so with
    // include_raw_artifacts off the KEY IS ABSENT rather than null. Both must
    // land as null so every reader downstream tests one shape.
    expect(
      parseVerifierEvent({
        event: "presentation_request_delivered",
        tx_id: "ver_1",
        transport: "dc_api",
      }),
    ).toEqual({
      event: "presentation_request_delivered",
      txId: "ver_1",
      transport: "dc_api",
      signedRequest: null,
    });
  });

  it("reads a completion event carrying a vp_token", () => {
    expect(
      parseVerifierEvent({
        event: "verification_completed",
        tx_id: "ver_1",
        state: "verified",
        result: { verified: true, checks: [], credentials: [] },
        vp_token: { dpc: ["eyJ..."] },
      }),
    ).toEqual({
      event: "verification_completed",
      txId: "ver_1",
      vpToken: { dpc: ["eyJ..."] },
    });
  });

  it("normalises an absent vp_token to null", () => {
    expect(
      parseVerifierEvent({
        event: "verification_completed",
        tx_id: "ver_1",
        state: "failed",
        result: { verified: false, checks: [], credentials: [] },
      }),
    ).toEqual({ event: "verification_completed", txId: "ver_1", vpToken: null });
  });

  it("ignores an event type it does not know", () => {
    // Forward compatibility: a later foundry may add events. An unknown one is
    // not an error, it is not ours.
    expect(parseVerifierEvent({ event: "something_new", tx_id: "ver_1" })).toBeNull();
  });

  it("rejects a body with no tx_id", () => {
    expect(parseVerifierEvent({ event: "verification_completed", state: "verified" })).toBeNull();
  });

  it("rejects a non-object body", () => {
    expect(parseVerifierEvent("nope")).toBeNull();
    expect(parseVerifierEvent(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @demo/merchant exec vitest run src/lib/verifier-events.test.ts
```

Expected: FAIL to compile — `./verifier-events.js` does not exist.

- [ ] **Step 3: Write the implementation**

Create `apps/merchant/src/lib/verifier-events.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * One event from foundry's verification-artifact webhook, normalised.
 *
 * Two normalisations happen here and nowhere else. foundry serialises absent
 * artefacts with `skip_serializing_if`, so a payload with
 * `include_raw_artifacts` off omits the KEY rather than sending null — both
 * become `null`. And the wire's snake_case becomes camelCase, so the spec's
 * names survive only where they are the spec's: inside the proof package.
 *
 * `result` and `state` are deliberately dropped. The merchant already has
 * foundry's verdict from its own poll of the admin API, and that poll is what
 * the settle gates read. A second copy arriving over an at-most-once channel
 * would be a second source of truth for the decision that moves money.
 */
export type VerifierEvent =
  | {
      event: "presentation_request_delivered";
      txId: string;
      transport: string;
      /** The PaSO `signed_request`. Null when foundry's artefact gate is off. */
      signedRequest: string | null;
    }
  | {
      event: "verification_completed";
      txId: string;
      /** The PaSO `vp_token`. Null when foundry's artefact gate is off. */
      vpToken: unknown;
    };

const SIGNATURE_PREFIX = "sha256=";

/**
 * Whether `header` is an HMAC-SHA256 of **exactly** `rawBody` under `secret`.
 *
 * `rawBody` must be the string from `request.text()`, never a re-serialised
 * `request.json()`: foundry signs the bytes it transmits, and parse-then-
 * stringify is not byte-preserving (key order, whitespace, number formatting).
 * This mirrors foundry's own constraint that its sink calls `.body(..)`.
 *
 * Every rejection returns false rather than throwing — including a length
 * mismatch, which `timingSafeEqual` throws on, and a non-hex header, which
 * `Buffer.from(_, "hex")` silently truncates. A malformed header from an
 * unauthenticated caller must not be able to produce a 500.
 */
export function verifyWebhookSignature(
  rawBody: string,
  header: string | null,
  secret: string,
): boolean {
  if (!header || !header.startsWith(SIGNATURE_PREFIX)) return false;
  const provided = header.slice(SIGNATURE_PREFIX.length);
  // `Buffer.from("zz", "hex")` yields an empty buffer rather than throwing, so
  // the hex shape is checked explicitly instead of inferred from the decode.
  if (!/^[0-9a-f]{64}$/.test(provided)) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(provided, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Reads one webhook body into a `VerifierEvent`, or `null` when it is not one
 * we act on.
 *
 * `null` covers three different situations on purpose, because the route treats
 * them identically — store nothing, answer 2xx: a malformed body, a body
 * missing `tx_id`, and an `event` a later foundry added. Distinguishing them
 * would only let the route return a status foundry does not read.
 */
export function parseVerifierEvent(body: unknown): VerifierEvent | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = body as Record<string, unknown>;

  const txId = asString(raw.tx_id);
  if (!txId) return null;

  if (raw.event === "presentation_request_delivered") {
    return {
      event: "presentation_request_delivered",
      txId,
      transport: asString(raw.transport) ?? "",
      signedRequest: asString(raw.request_object_jws),
    };
  }

  if (raw.event === "verification_completed") {
    return {
      event: "verification_completed",
      txId,
      vpToken: raw.vp_token === undefined ? null : raw.vp_token,
    };
  }

  return null;
}
```

- [ ] **Step 4: Add the env var in all three places**

`apps/merchant/src/env.ts`, after `BANK_API_KEY`:

```ts
 /**
  * Shared HMAC key for foundry's verification-artifact webhook, matching
  * `verifier.webhook.secret` / `secret_env` on the foundry that posts to
  * `/api/verifier-events`.
  *
  * Required with no default, like MERCHANT_PAYEE_ID and unlike MERCHANT_NAME.
  * An optional secret degrades that route to an unauthenticated endpoint that
  * accepts holder credentials from anyone, so a missing value must crash the
  * process at boot rather than quietly widen it.
  */
 FOUNDRY_WEBHOOK_SECRET: z.string().min(1),
```

`apps/merchant/vitest.config.ts`, in `test.env`:

```ts
      FOUNDRY_WEBHOOK_SECRET: "test-webhook-secret",
```

Root `Dockerfile`, build-stage `ENV` block (line ~43):

```dockerfile
ENV FOUNDRY_ADMIN_KEY=build-only \
    BANK_API_KEY=build-only \
    FOUNDRY_WEBHOOK_SECRET=build-only \
    MERCHANT_PAYEE_ID=build-only \
    SESSION_SECRET=build-only-secret-0123456789012345678901234567890123
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter @demo/merchant exec vitest run src/lib/verifier-events.test.ts
```

Expected: PASS, 14 tests.

- [ ] **Step 6: Run the gate**

```bash
pnpm check
```

Expected: green. If every merchant test now fails with an env validation error, `vitest.config.ts` was missed.

- [ ] **Step 7: Commit**

```bash
git add apps/merchant/src/lib/verifier-events.ts apps/merchant/src/lib/verifier-events.test.ts \
        apps/merchant/src/env.ts apps/merchant/vitest.config.ts Dockerfile
git commit -m "feat(merchant): parse and authenticate foundry verification events"
```

---

### Task 3: Merchant — the `/api/verifier-events` route

**Files:**

- Modify: `apps/merchant/src/lib/verifier-events.ts`, `apps/merchant/src/lib/verifier-events.test.ts`
- Create: `apps/merchant/src/app/api/verifier-events/route.ts`
- Create: `apps/merchant/src/app/api/verifier-events/route.test.ts`

**Interfaces:**

- Consumes: `parseVerifierEvent`, `verifyWebhookSignature`, `env.FOUNDRY_WEBHOOK_SECRET` (Task 2); `verifierEvents`, `paymentSessions` (Task 1).
- Produces: `export function recordVerifierEvent(db: Db, event: VerifierEvent, now: number): "stored" | "ignored"`.

- [ ] **Step 1: Write the failing unit tests**

Append to `apps/merchant/src/lib/verifier-events.test.ts`, adding these imports at the top of the file:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";
import { createDb, type Db } from "../db/index.js";
import { paymentSessions, verifierEvents } from "../db/schema.js";
import { recordVerifierEvent } from "./verifier-events.js";
```

```ts
describe("recordVerifierEvent", () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "merchant-events-"));
    db = createDb(path.join(dir, "test.db"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** A session that has already recorded its foundry verification id. */
  function knownSession(txId: string): void {
    db.insert(paymentSessions)
      .values({
        id: `sess_${txId}`,
        orderId: "ord_1",
        state: "pending",
        foundryVerificationId: txId,
        namedQueryRef: "payment",
        createdAt: 1,
      })
      .run();
  }

  it("stores a request event even for a transaction it has never heard of", () => {
    // The event is dispatched INSIDE foundry's create_verification_request, so
    // it can beat our own UPDATE that writes foundry_verification_id. Refusing
    // it would lose the signed request for every DC API payment.
    expect(
      recordVerifierEvent(
        db,
        {
          event: "presentation_request_delivered",
          txId: "ver_unknown",
          transport: "dc_api_signed",
          signedRequest: "a.b.c",
        },
        50,
      ),
    ).toBe("stored");

    const row = db.select().from(verifierEvents).all()[0]!;
    expect(row.txId).toBe("ver_unknown");
    expect(row.signedRequest).toBe("a.b.c");
    expect(row.vpTokenJson).toBeNull();
    expect(row.receivedAt).toBe(50);
  });

  it("stores a completion for a transaction it owns", () => {
    knownSession("ver_mine");

    expect(
      recordVerifierEvent(
        db,
        { event: "verification_completed", txId: "ver_mine", vpToken: { dpc: ["x"] } },
        60,
      ),
    ).toBe("stored");

    const row = db.select().from(verifierEvents).all()[0]!;
    expect(row.event).toBe("verification_completed");
    expect(JSON.parse(row.vpTokenJson!)).toEqual({ dpc: ["x"] });
  });

  it("DROPS a completion for a transaction it does not own", () => {
    // Design D8. One foundry serves both apps, and the bank verifies too. An
    // unmatched completion is the BANK's wallet-login vp_token — a holder
    // credential from a flow this app has nothing to do with.
    expect(
      recordVerifierEvent(
        db,
        {
          event: "verification_completed",
          txId: "ver_bank_login",
          vpToken: { sparkassen_auth: ["x"] },
        },
        70,
      ),
    ).toBe("ignored");

    expect(db.select().from(verifierEvents).all()).toHaveLength(0);
  });

  it("stores a completion carrying no vp_token as a NULL artefact", () => {
    knownSession("ver_mine");

    expect(
      recordVerifierEvent(
        db,
        { event: "verification_completed", txId: "ver_mine", vpToken: null },
        80,
      ),
    ).toBe("stored");

    expect(db.select().from(verifierEvents).all()[0]!.vpTokenJson).toBeNull();
  });
});
```

The `paymentSessions` insert has a foreign key to `orders`. Insert an `ord_1`
order in this block's `beforeEach`, matching the shape
`payment-sessions.test.ts` already uses.

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @demo/merchant exec vitest run src/lib/verifier-events.test.ts
```

Expected: FAIL to compile — `recordVerifierEvent` is not exported.

- [ ] **Step 3: Add `recordVerifierEvent`**

Append to `apps/merchant/src/lib/verifier-events.ts`, adding these imports at the top:

```ts
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { paymentSessions, verifierEvents } from "../db/schema.js";
```

```ts
/**
 * Writes one event to the inbox, or declines to.
 *
 * The two event types are stored under DIFFERENT rules, and the asymmetry is
 * the point (design D8). One foundry instance has one webhook URL, and the bank
 * verifies too — so this endpoint receives the bank's wallet-login events as
 * well as our own.
 *
 * A `presentation_request_delivered` is stored unconditionally. It carries a
 * request OBJECT, which is our own or the bank's public ask and holds no holder
 * data; and it can legitimately arrive before we know its `tx_id`, because
 * foundry dispatches it inside `create_verification_request` while
 * `startPaymentSession` is still awaiting that call.
 *
 * A `verification_completed` is stored only when a payment session already
 * claims that `tx_id`. An unmatched one is the bank's login `vp_token` — a
 * holder credential from a flow this app has nothing to do with. The timing is
 * safe in a way the other event's is not: a wallet cannot answer a request that
 * was never created, so by the time a completion exists our UPDATE has landed.
 */
export function recordVerifierEvent(
  db: Db,
  event: VerifierEvent,
  now: number,
): "stored" | "ignored" {
  if (event.event === "verification_completed") {
    const owned = db
      .select({ id: paymentSessions.id })
      .from(paymentSessions)
      .where(eq(paymentSessions.foundryVerificationId, event.txId))
      .get();
    if (!owned) return "ignored";

    db.insert(verifierEvents)
      .values({
        txId: event.txId,
        event: "verification_completed",
        transport: null,
        signedRequest: null,
        vpTokenJson: event.vpToken === null ? null : JSON.stringify(event.vpToken),
        receivedAt: now,
      })
      .run();
    return "stored";
  }

  db.insert(verifierEvents)
    .values({
      txId: event.txId,
      event: "presentation_request_delivered",
      transport: event.transport,
      signedRequest: event.signedRequest,
      vpTokenJson: null,
      receivedAt: now,
    })
    .run();
  return "stored";
}
```

- [ ] **Step 4: Write the failing route test**

Create `apps/merchant/src/app/api/verifier-events/route.test.ts`:

```ts
/**
 * The wire contract of `POST /api/verifier-events`.
 *
 * A route test and not only unit tests, because two of this route's rules live
 * in the handler and nowhere else: it verifies the signature over the RAW body
 * (so `request.json()` must never be called first), and it answers 2xx to
 * everything except a bad signature, since foundry never retries and reads no
 * status but its own log.
 */

import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "@/db/index.js";
import { paymentSessions, verifierEvents } from "@/db/schema.js";

const dbStub = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db/index.js")>()),
  getDb: () => dbStub.db,
}));

const { POST } = await import("./route.js");

/** Matches vitest.config.ts test.env. */
const SECRET = "test-webhook-secret";

function post(body: unknown, secret = SECRET): Request {
  const raw = JSON.stringify(body);
  const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  return new Request("http://m/api/verifier-events", {
    method: "POST",
    headers: { "content-type": "application/json", "x-foundry-signature": signature },
    body: raw,
  });
}

let db: Db;

beforeEach(() => {
  db = createDb(":memory:");
  dbStub.db = db;
});

describe("POST /api/verifier-events", () => {
  it("stores a signed request event and answers 204", async () => {
    const response = await POST(
      post({
        event: "presentation_request_delivered",
        tx_id: "ver_1",
        transport: "dc_api_signed",
        request_object_jws: "a.b.c",
      }),
    );

    expect(response.status).toBe(204);
    expect(db.select().from(verifierEvents).all()[0]!.signedRequest).toBe("a.b.c");
  });

  it("refuses a wrongly-signed body with 401 and stores nothing", async () => {
    const response = await POST(
      post({ event: "presentation_request_delivered", tx_id: "ver_1" }, "wrong-secret"),
    );

    expect(response.status).toBe(401);
    expect(db.select().from(verifierEvents).all()).toHaveLength(0);
  });

  it("refuses an unsigned body with 401", async () => {
    const response = await POST(
      new Request("http://m/api/verifier-events", {
        method: "POST",
        body: '{"event":"verification_completed","tx_id":"ver_1"}',
      }),
    );
    expect(response.status).toBe(401);
  });

  it("answers 204 to an event type it does not know, storing nothing", async () => {
    const response = await POST(post({ event: "something_new", tx_id: "ver_1" }));
    expect(response.status).toBe(204);
    expect(db.select().from(verifierEvents).all()).toHaveLength(0);
  });

  it("answers 204 to a completion for a foreign transaction, storing nothing", async () => {
    const response = await POST(
      post({
        event: "verification_completed",
        tx_id: "ver_bank_login",
        vp_token: { sparkassen_auth: ["x"] },
      }),
    );
    expect(response.status).toBe(204);
    expect(db.select().from(verifierEvents).all()).toHaveLength(0);
  });

  it("answers 204 to a correctly-signed body that is not JSON", async () => {
    const raw = "not json";
    const signature = `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}`;
    const response = await POST(
      new Request("http://m/api/verifier-events", {
        method: "POST",
        headers: { "x-foundry-signature": signature },
        body: raw,
      }),
    );
    // Authentication passed; there is simply nothing to store.
    expect(response.status).toBe(204);
  });
});
```

The "stores a completion it owns" case needs an `orders` row and a
`payment_sessions` row — add it following the same fixture shape as the unit
tests above, asserting the stored `vp_token_json` parses to what was sent.

- [ ] **Step 5: Run it to verify it fails**

```bash
pnpm --filter @demo/merchant exec vitest run src/app/api/verifier-events/route.test.ts
```

Expected: FAIL — `./route.js` does not exist.

- [ ] **Step 6: Write the route**

Create `apps/merchant/src/app/api/verifier-events/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import { env } from "@/env.js";
import {
  parseVerifierEvent,
  recordVerifierEvent,
  verifyWebhookSignature,
} from "@/lib/verifier-events.js";

export const dynamic = "force-dynamic";

/**
 * foundry's verification-artifact webhook.
 *
 * Public: foundry is a server, not a browser, and carries no session. The HMAC
 * IS the authentication.
 *
 * `request.text()` and never `request.json()`. foundry signs the exact bytes it
 * transmits — its own sink calls `.body(..)` for precisely this reason — and
 * parse-then-stringify is not byte-preserving. Verifying a re-serialised body
 * would reject every legitimate delivery whose key order or number formatting
 * differs from ours.
 *
 * Every path but a failed signature answers 2xx. foundry is fire-and-forget and
 * at-most-once: it never retries, and a non-2xx becomes a `warn` in its log and
 * nothing else. There is nothing to gain by reporting "I chose not to store
 * that" as a failure — but an unauthenticated caller offering us holder
 * credentials must be refused rather than believed.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("x-foundry-signature");

  if (!verifyWebhookSignature(raw, signature, env.FOUNDRY_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    // Authenticated but unreadable. Nothing to store and nothing to say.
    return new NextResponse(null, { status: 204 });
  }

  const event = parseVerifierEvent(body);
  if (event) recordVerifierEvent(getDb(), event, Date.now());

  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 7: Run both suites to verify they pass**

```bash
pnpm --filter @demo/merchant exec vitest run src/lib/verifier-events.test.ts src/app/api/verifier-events/route.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run the gate**

```bash
pnpm check
```

- [ ] **Step 9: Commit**

```bash
git add apps/merchant/src/lib/verifier-events.ts apps/merchant/src/lib/verifier-events.test.ts \
        apps/merchant/src/app/api/verifier-events
git commit -m "feat(merchant): receive foundry verification events at /api/verifier-events

Signature is verified over the raw body bytes, never a re-serialised one.
A verification_completed for a tx_id no payment session claims is dropped:
one foundry means this endpoint also receives the bank's wallet-login
vp_tokens. Not exercised against a real foundry — its webhook is unshipped."
```

---

### Task 4: Merchant — assembling the proof package

**Files:**

- Create: `apps/merchant/src/lib/proof-package.ts`
- Create: `apps/merchant/src/lib/proof-package.test.ts`

**Interfaces:**

- Consumes: `verifierEvents` (Task 1).
- Produces:
  - `export interface ProofPackage { signedRequest: string; vpToken: unknown }`
  - `export function proofPackageFor(db: Db, verificationId: string): ProofPackage | null`

  Task 6 consumes both.

- [ ] **Step 1: Write the failing test**

Create `apps/merchant/src/lib/proof-package.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/index.js";
import { verifierEvents } from "../db/schema.js";
import { proofPackageFor } from "./proof-package.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "merchant-proof-"));
  db = createDb(path.join(dir, "test.db"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function requestEvent(txId: string, jws: string | null, receivedAt: number): void {
  db.insert(verifierEvents)
    .values({
      txId,
      event: "presentation_request_delivered",
      transport: "request_uri",
      signedRequest: jws,
      vpTokenJson: null,
      receivedAt,
    })
    .run();
}

function completionEvent(txId: string, vpToken: unknown, receivedAt: number): void {
  db.insert(verifierEvents)
    .values({
      txId,
      event: "verification_completed",
      transport: null,
      signedRequest: null,
      vpTokenJson: vpToken === null ? null : JSON.stringify(vpToken),
      receivedAt,
    })
    .run();
}

describe("proofPackageFor", () => {
  it("returns null when nothing has arrived", () => {
    expect(proofPackageFor(db, "ver_1")).toBeNull();
  });

  it("returns null with only a signed request", () => {
    // PaSO §4.1 makes BOTH members REQUIRED. Half a package is not a package.
    requestEvent("ver_1", "a.b.c", 10);
    expect(proofPackageFor(db, "ver_1")).toBeNull();
  });

  it("returns null with only a vp_token", () => {
    completionEvent("ver_1", { dpc: ["x"] }, 10);
    expect(proofPackageFor(db, "ver_1")).toBeNull();
  });

  it("returns both members once both have arrived", () => {
    requestEvent("ver_1", "a.b.c", 10);
    completionEvent("ver_1", { dpc: ["x"] }, 11);

    expect(proofPackageFor(db, "ver_1")).toEqual({
      signedRequest: "a.b.c",
      vpToken: { dpc: ["x"] },
    });
  });

  it("prefers the NEWEST signed request when several were delivered", () => {
    // Design D6. On request_uri the event fires per fetch and ECDSA is
    // randomized, so each copy is different bytes. Nothing tells us which the
    // wallet consumed; the last one served is the closest thing to an answer.
    requestEvent("ver_1", "first.b.c", 10);
    requestEvent("ver_1", "second.b.c", 20);
    completionEvent("ver_1", { dpc: ["x"] }, 30);

    expect(proofPackageFor(db, "ver_1")!.signedRequest).toBe("second.b.c");
  });

  it("skips a request event that carried no artefact", () => {
    // foundry's include_raw_artifacts is off by default: the event still fires,
    // it just carries nothing. A NULL must not shadow a real JWS that arrived
    // earlier.
    requestEvent("ver_1", "real.b.c", 10);
    requestEvent("ver_1", null, 20);
    completionEvent("ver_1", { dpc: ["x"] }, 30);

    expect(proofPackageFor(db, "ver_1")!.signedRequest).toBe("real.b.c");
  });

  it("returns null when the completion carried no vp_token", () => {
    requestEvent("ver_1", "a.b.c", 10);
    completionEvent("ver_1", null, 20);

    expect(proofPackageFor(db, "ver_1")).toBeNull();
  });

  it("never mixes two transactions", () => {
    requestEvent("ver_1", "mine.b.c", 10);
    completionEvent("ver_2", { dpc: ["theirs"] }, 20);

    expect(proofPackageFor(db, "ver_1")).toBeNull();
    expect(proofPackageFor(db, "ver_2")).toBeNull();
  });

  it("returns null rather than throwing when the stored token is not JSON", () => {
    requestEvent("ver_1", "a.b.c", 10);
    db.insert(verifierEvents)
      .values({
        txId: "ver_1",
        event: "verification_completed",
        transport: null,
        signedRequest: null,
        vpTokenJson: "{ not json",
        receivedAt: 20,
      })
      .run();

    expect(proofPackageFor(db, "ver_1")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @demo/merchant exec vitest run src/lib/proof-package.test.ts
```

Expected: FAIL to compile — `./proof-package.js` does not exist.

- [ ] **Step 3: Write the implementation**

Create `apps/merchant/src/lib/proof-package.ts`:

```ts
import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { verifierEvents } from "../db/schema.js";

/**
 * The PaSO Proof/Verify §4.1 package, in this app's internal casing.
 *
 * The spec's wire names (`signed_request`, `vp_token`) appear only where the
 * package is actually serialised — see `BankClient.pay`. Both members are
 * REQUIRED by the spec, which is why this type has no optionals and why
 * `proofPackageFor` returns null rather than a half-filled object.
 */
export interface ProofPackage {
  /** The signed Authorization Request, compact JWS, verbatim. */
  signedRequest: string;
  /** The `vp_token` exactly as the wallet produced it. */
  vpToken: unknown;
}

/**
 * Assembles the package for one foundry verification from the event inbox, or
 * `null` if it is not complete.
 *
 * The two members come from two different events that arrive independently and
 * may never both arrive at all: foundry's delivery is best-effort and
 * at-most-once, and its `include_raw_artifacts` gate — off by default — makes
 * both artefacts NULL while still firing both events. "No package" is an
 * ordinary outcome, not an error.
 *
 * The signed request is the NEWEST non-NULL one (design D6). On `request_uri`
 * foundry re-signs per fetch, so several genuinely different JWSs may exist for
 * one transaction and nothing records which the wallet consumed. The newest is
 * the closest available answer; a future implementer of PaSO §3
 * `request_integrity` must read the design's §9 before trusting this value.
 */
export function proofPackageFor(
  db: Db,
  verificationId: string,
): ProofPackage | null {
  const request = db
    .select({ signedRequest: verifierEvents.signedRequest })
    .from(verifierEvents)
    .where(
      and(
        eq(verifierEvents.txId, verificationId),
        eq(verifierEvents.event, "presentation_request_delivered"),
        isNotNull(verifierEvents.signedRequest),
      ),
    )
    .orderBy(desc(verifierEvents.receivedAt), desc(verifierEvents.id))
    .get();
  if (!request?.signedRequest) return null;

  const completion = db
    .select({ vpTokenJson: verifierEvents.vpTokenJson })
    .from(verifierEvents)
    .where(
      and(
        eq(verifierEvents.txId, verificationId),
        eq(verifierEvents.event, "verification_completed"),
        isNotNull(verifierEvents.vpTokenJson),
      ),
    )
    .orderBy(desc(verifierEvents.receivedAt), desc(verifierEvents.id))
    .get();
  if (!completion?.vpTokenJson) return null;

  // The stored text came from our own JSON.stringify, so this cannot fail in
  // practice — but it is read back from a database that outlives the process
  // that wrote it, and a throw here would abort a payment that is otherwise
  // fine. No package is the correct degradation.
  let vpToken: unknown;
  try {
    vpToken = JSON.parse(completion.vpTokenJson);
  } catch {
    return null;
  }

  return { signedRequest: request.signedRequest, vpToken };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @demo/merchant exec vitest run src/lib/proof-package.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Run the gate**

```bash
pnpm check
```

- [ ] **Step 6: Commit**

```bash
git add apps/merchant/src/lib/proof-package.ts apps/merchant/src/lib/proof-package.test.ts
git commit -m "feat(merchant): assemble the PaSO proof package from the event inbox"
```

---

### Task 5: Merchant — `verified_at` and the grace period

**Files:**

- Modify: `apps/merchant/src/db/schema.ts`, `apps/merchant/src/db/schema.test.ts`
- Create: `apps/merchant/drizzle/0006_*.sql` (generated)
- Create: `apps/merchant/src/lib/proof-wait.ts`, `apps/merchant/src/lib/proof-wait.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `paymentSessions.verifiedAt` — `integer("verified_at")`, nullable
  - `export const PROOF_GRACE_MS = 6_000`
  - `export function shouldWaitForProof(hasPackage: boolean, verifiedAt: number | null, now: number): boolean`

  Task 6 consumes all three.

- [ ] **Step 1: Write the failing tests**

Create `apps/merchant/src/lib/proof-wait.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PROOF_GRACE_MS, shouldWaitForProof } from "./proof-wait.js";

describe("shouldWaitForProof", () => {
  it("does not wait once the package is here", () => {
    expect(shouldWaitForProof(true, 1_000, 1_000)).toBe(false);
  });

  it("waits while the package is missing and the window is open", () => {
    expect(shouldWaitForProof(false, 1_000, 1_000 + PROOF_GRACE_MS - 1)).toBe(true);
  });

  it("stops waiting exactly at the boundary", () => {
    expect(shouldWaitForProof(false, 1_000, 1_000 + PROOF_GRACE_MS)).toBe(false);
  });

  it("stops waiting after the window", () => {
    expect(shouldWaitForProof(false, 1_000, 1_000 + PROOF_GRACE_MS + 1)).toBe(false);
  });

  it("does not wait when there is no verified_at to measure from", () => {
    // Fail FORWARD. A row written before this column existed, or by a path that
    // never set it, has no window — and stalling a payment forever is a far
    // worse failure than settling without a proof package.
    expect(shouldWaitForProof(false, null, 999_999)).toBe(false);
  });

  it("does not wait when the clock appears to have gone backwards", () => {
    expect(shouldWaitForProof(false, 5_000, 1_000)).toBe(false);
  });

  it("has a grace window of six seconds", () => {
    // Pinned deliberately: three of the browser's ~2s polls. A reviewer
    // changing this should have to change a test that says why.
    expect(PROOF_GRACE_MS).toBe(6_000);
  });
});
```

Append to `apps/merchant/src/db/schema.test.ts`. This block needs an `orders`
row with id `ord_1` to satisfy the foreign key — insert one in its own
`beforeEach` if the file's shared setup does not already provide it.

```ts
describe("payment_sessions.verified_at", () => {
  it("defaults to null and accepts a timestamp", () => {
    db.insert(paymentSessions)
      .values({
        id: "sess_1",
        orderId: "ord_1",
        state: "pending",
        namedQueryRef: "payment",
        createdAt: 1,
      })
      .run();
    db.insert(paymentSessions)
      .values({
        id: "sess_2",
        orderId: "ord_1",
        state: "verified",
        namedQueryRef: "payment",
        createdAt: 1,
        verifiedAt: 42,
      })
      .run();

    const rows = db.select().from(paymentSessions).all();
    expect(rows.find((r) => r.id === "sess_1")!.verifiedAt).toBeNull();
    expect(rows.find((r) => r.id === "sess_2")!.verifiedAt).toBe(42);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @demo/merchant exec vitest run src/lib/proof-wait.test.ts src/db/schema.test.ts
```

Expected: FAIL — `./proof-wait.js` does not exist, and `verifiedAt` is not a column.

- [ ] **Step 3: Add the column**

In `apps/merchant/src/db/schema.ts`, add to `paymentSessions` after `bankTxId`:

```ts
 /**
  * When the settle gates passed and the row became `verified`.
  *
  * Exists solely to bound the proof-package grace period: the package arrives
  * over foundry's webhook, which races our own poll, and this is the clock the
  * wait is measured against. Nullable because a row written before this column
  * existed has no such moment — `shouldWaitForProof` treats null as "do not
  * wait", so an old row settles immediately rather than stalling.
  */
 verifiedAt: integer("verified_at"),
```

- [ ] **Step 4: Generate and inspect the migration**

```bash
pnpm --filter @demo/merchant run db:generate
cat apps/merchant/drizzle/0006_*.sql
```

Expected: a plain ``ALTER TABLE `payment_sessions` ADD `verified_at` integer;``

**If it emitted a table rebuild instead** — a `PRAGMA foreign_keys=OFF`, a
`__new_payment_sessions` table, and an `INSERT … SELECT` — read the `SELECT`
list. This repo has twice seen the generator list a newly-added column on both
sides, which is unrunnable (`no such column`). Hand-edit the file down to the
single `ALTER TABLE … ADD`, then apply it to a real SQLite file:

```bash
cd apps/merchant && rm -f /tmp/mig-check.db && \
  DATABASE_PATH=/tmp/mig-check.db pnpm exec tsx --env-file-if-exists=.env.local src/db/migrate.ts && \
  cd ../..
```

- [ ] **Step 5: Write `proof-wait.ts`**

Create `apps/merchant/src/lib/proof-wait.ts`:

```ts
/**
 * How long the settle path waits for a proof package before debiting without
 * one.
 *
 * Three of the browser's ~2s status polls. foundry's webhook is dispatched at
 * the moment the wallet's response is submitted, which is normally well before
 * our next poll observes `verified` — so this window is slack for an unlucky
 * ordering, not an expected delay. It is deliberately small: a shopper waiting
 * is a worse outcome than a transaction without an audit artefact.
 */
export const PROOF_GRACE_MS = 6_000;

/**
 * Whether the settle path should hold off debiting and let the next poll retry.
 *
 * Pure, and in `.ts`, because every vitest project here is
 * `environment: "node"` with a `src/**` `.test.ts` include — this decision
 * written inline in `refreshPaymentSessionState` would still be exercised, but
 * only through a database and a stubbed bank, which is how a boundary condition
 * goes unnoticed.
 *
 * Every branch except one fails FORWARD, i.e. toward settling. A missing
 * `verifiedAt` and a clock that appears to run backwards both mean "debit now":
 * the package is an audit artefact, and no artefact is worth a payment that
 * never completes.
 */
export function shouldWaitForProof(
  hasPackage: boolean,
  verifiedAt: number | null,
  now: number,
): boolean {
  if (hasPackage) return false;
  if (verifiedAt === null) return false;
  const elapsed = now - verifiedAt;
  if (elapsed < 0) return false;
  return elapsed < PROOF_GRACE_MS;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
pnpm --filter @demo/merchant exec vitest run src/lib/proof-wait.test.ts src/db/schema.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run the gate**

```bash
pnpm check
```

- [ ] **Step 8: Commit**

```bash
git add apps/merchant/src/db/schema.ts apps/merchant/src/db/schema.test.ts \
        apps/merchant/src/lib/proof-wait.ts apps/merchant/src/lib/proof-wait.test.ts \
        apps/merchant/drizzle
git commit -m "feat(merchant): record verified_at and bound the proof-package wait"
```

---

### Task 6: Merchant — wire the package into settlement

**Files:**

- Modify: `apps/merchant/src/lib/payment-sessions.ts`
- Modify: `apps/merchant/src/lib/bank.ts`
- Modify: `apps/merchant/src/lib/settle.test.ts`
- Modify: `apps/merchant/src/lib/payment-sessions.test.ts`

**Interfaces:**

- Consumes: `ProofPackage`, `proofPackageFor` (Task 4); `shouldWaitForProof`, `PROOF_GRACE_MS`, `paymentSessions.verifiedAt` (Task 5).
- Produces: `BankPayInput.proofPackage?: ProofPackage`, and the `proof_package` member of the `POST /api/payments` request body — consumed by Task 7.

- [ ] **Step 1: Write the failing tests**

Append to `apps/merchant/src/lib/settle.test.ts`, reusing that file's existing
foundry and bank stubs and its `verified` fixture. The session must carry
`foundryVerificationId: "ver_1"` and the foundry stub must answer `verified`
for it. `bankCalls` is a recording array — if the file stubs the bank by
replacing `BankClient`'s `fetchImpl`, push `{ url, init }` into an array inside
that stub rather than introducing a second mechanism.

```ts
it("sends the proof package on the debit once both events have arrived", async () => {
  db.insert(verifierEvents)
    .values({
      txId: "ver_1",
      event: "presentation_request_delivered",
      transport: "dc_api_signed",
      signedRequest: "hdr.pay.sig",
      vpTokenJson: null,
      receivedAt: 1,
    })
    .run();
  db.insert(verifierEvents)
    .values({
      txId: "ver_1",
      event: "verification_completed",
      transport: null,
      signedRequest: null,
      vpTokenJson: JSON.stringify({ dpc: ["eyJ..."] }),
      receivedAt: 2,
    })
    .run();

  await refreshPaymentSessionState(db, foundry, bank, "sess_1", 1_000);

  const body = JSON.parse(String(bankCalls[0]!.init.body));
  expect(body.proof_package).toEqual({
    signed_request: "hdr.pay.sig",
    vp_token: { dpc: ["eyJ..."] },
  });
});

it("does not debit while the grace window is open and no package has arrived", async () => {
  await refreshPaymentSessionState(db, foundry, bank, "sess_1", 1_000);

  // The gates passed, so the row is `verified` and verified_at is set — but
  // nothing has been sent to the bank.
  const row = db
    .select()
    .from(paymentSessions)
    .where(eq(paymentSessions.id, "sess_1"))
    .get()!;
  expect(row.state).toBe("verified");
  expect(row.verifiedAt).toBe(1_000);
  expect(bankCalls).toHaveLength(0);
});

it("debits without a package once the grace window has expired", async () => {
  await refreshPaymentSessionState(db, foundry, bank, "sess_1", 1_000);
  expect(bankCalls).toHaveLength(0);

  // A later poll, past the window. This one enters through the resume branch.
  await refreshPaymentSessionState(db, foundry, bank, "sess_1", 1_000 + PROOF_GRACE_MS);

  expect(bankCalls).toHaveLength(1);
  expect(JSON.parse(String(bankCalls[0]!.init.body))).not.toHaveProperty("proof_package");
  expect(
    db.select().from(paymentSessions).where(eq(paymentSessions.id, "sess_1")).get()!.state,
  ).toBe("completed");
});

it("sends a package that arrived during the wait, on a later poll", async () => {
  await refreshPaymentSessionState(db, foundry, bank, "sess_1", 1_000);
  expect(bankCalls).toHaveLength(0);

  db.insert(verifierEvents)
    .values({
      txId: "ver_1",
      event: "presentation_request_delivered",
      transport: "dc_api_signed",
      signedRequest: "late.pay.sig",
      vpTokenJson: null,
      receivedAt: 1_100,
    })
    .run();
  db.insert(verifierEvents)
    .values({
      txId: "ver_1",
      event: "verification_completed",
      transport: null,
      signedRequest: null,
      vpTokenJson: JSON.stringify({ dpc: ["late"] }),
      receivedAt: 1_100,
    })
    .run();

  await refreshPaymentSessionState(db, foundry, bank, "sess_1", 1_200);

  expect(bankCalls).toHaveLength(1);
  expect(
    JSON.parse(String(bankCalls[0]!.init.body)).proof_package.signed_request,
  ).toBe("late.pay.sig");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @demo/merchant exec vitest run src/lib/settle.test.ts
```

Expected: FAIL — the bank is called on the first poll and the body has no
`proof_package`.

- [ ] **Step 3: Extend `BankClient`**

In `apps/merchant/src/lib/bank.ts`, add the import:

```ts
import type { ProofPackage } from "./proof-package.js";
```

Add to `BankPayInput`:

```ts
  /**
   * The PaSO Proof/Verify §4.1 package, when one was assembled in time.
   *
   * Optional because it genuinely may not exist: foundry's webhook is
   * best-effort and at-most-once, and its `include_raw_artifacts` gate is off
   * by default, so a correctly configured system can still produce no package.
   * A debit must never depend on an audit artefact.
   */
  proofPackage?: ProofPackage;
```

In `pay`, extend the body. This is the one boundary where the spec's own names
are used:

```ts
        body: JSON.stringify({
          credential_id: input.credentialId,
          amount_cents: input.amountCents,
          currency: input.currency,
          merchant: input.merchant,
          reference: input.reference,
          idempotency_key: input.idempotencyKey,
          // PaSO Proof/Verify §4.1's member names, verbatim. The key is
          // OMITTED rather than sent as null when there is no package: the
          // bank's zod schema marks it `.optional()`, and an explicit null
          // would fail that while meaning the same thing.
          ...(input.proofPackage
            ? {
                proof_package: {
                  signed_request: input.proofPackage.signedRequest,
                  vp_token: input.proofPackage.vpToken,
                },
              }
            : {}),
        }),
```

- [ ] **Step 4: Wire the wait into `refreshPaymentSessionState`**

In `apps/merchant/src/lib/payment-sessions.ts`, add:

```ts
import { proofPackageFor, type ProofPackage } from "./proof-package.js";
import { shouldWaitForProof } from "./proof-wait.js";
```

`_now` is currently unused and prefixed for that reason — **rename it to `now`**
now that it is read.

In the `pending` branch, the update that writes `state: "verified"` gains the
timestamp:

```ts
    db.update(paymentSessions)
      .set({
        state: "verified",
        // Starts the proof-package grace window. Written in the same statement
        // as the state it belongs to, so a row can never be `verified` without
        // a clock to measure the wait against.
        verifiedAt: now,
        checksJson,
        disclosedClaimsJson: JSON.stringify(verdict.result.credentials ?? null),
      })
      .where(eq(paymentSessions.id, sessionId))
      .run();
```

Then, immediately **after** the `if (row.state === "pending") { … } else { … }`
block closes and **before** the `orders` lookup:

```ts
  // The proof package (PaSO Proof/Verify §4.1) arrives over foundry's webhook,
  // which races this poll. Hold the debit briefly rather than settle without it
  // — the demo's claim is that the bank holds the proof, and a payment that
  // silently lacks one undermines the thing being shown.
  //
  // `verifiedAt` is re-read off the row rather than taken from a local: on
  // every poll after the first, this function enters through the resume branch
  // above, which never writes it. The row is the only place that knows.
  const verifiedAt =
    row.state === "pending"
      ? now
      : (db
          .select({ verifiedAt: paymentSessions.verifiedAt })
          .from(paymentSessions)
          .where(eq(paymentSessions.id, sessionId))
          .get()?.verifiedAt ?? null);

  let proofPackage: ProofPackage | null = null;
  if (row.foundryVerificationId) {
    proofPackage = proofPackageFor(db, row.foundryVerificationId);
  }

  if (shouldWaitForProof(proofPackage !== null, verifiedAt, now)) {
    // Still `verified`. The browser's existing ~2s poll retries; the window
    // closes on wall-clock, so this cannot deadlock waiting for an event that
    // never comes.
    return { ok: true, status: getPaymentSessionStatus(db, sessionId)! };
  }
```

Finally, pass it to the bank:

```ts
  const payment = await bank.pay({
    credentialId,
    amountCents: order.totalCents,
    currency: order.currency,
    merchant: MERCHANT_REFERENCE_NAME,
    reference: `Order ${order.id}`,
    idempotencyKey: sessionId,
    ...(proofPackage ? { proofPackage } : {}),
  });
```

Update the JSDoc above `refreshPaymentSessionState` to name the new step: the
state chain is unchanged, but `verified` may now persist across several polls
while the package is awaited.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @demo/merchant exec vitest run src/lib/settle.test.ts src/lib/payment-sessions.test.ts
```

Expected: PASS. Existing settle tests that assert a debit happens on the first
poll will now fail — that is correct and expected. Fix each by either seeding
the inbox with a complete package (if the test is about settlement) or by
advancing `now` past `PROOF_GRACE_MS` (if it is not). **Do not** widen the
grace window to make an old test pass.

- [ ] **Step 6: Run the gate**

```bash
pnpm check
```

- [ ] **Step 7: Commit**

```bash
git add apps/merchant/src/lib/payment-sessions.ts apps/merchant/src/lib/bank.ts \
        apps/merchant/src/lib/settle.test.ts apps/merchant/src/lib/payment-sessions.test.ts
git commit -m "feat(merchant): forward the PaSO proof package on the debit

The settle path waits up to PROOF_GRACE_MS for both webhook events before
debiting, then debits without a package rather than stalling. Verified in
tests only: foundry's webhook does not exist yet, so no real package has
ever been assembled."
```

---

### Task 7: Bank — store the package with the debit

**Files:**

- Modify: `apps/bank/src/db/schema.ts`, `apps/bank/src/db/schema.test.ts`
- Create: `apps/bank/drizzle/0004_*.sql` (generated)
- Modify: `apps/bank/src/lib/payments.ts`, `apps/bank/src/lib/payments.test.ts`
- Modify: `apps/bank/src/app/api/payments/route.ts`

**Interfaces:**

- Consumes: the `proof_package` wire member (Task 6).
- Produces:
  - `transactionProofs` drizzle table; `TransactionProof = typeof transactionProofs.$inferSelect`
  - `ProcessPaymentInput.proofPackage?: { signedRequest: string; vpToken: unknown }`

  Task 8 consumes the table.

- [ ] **Step 1: Write the failing tests**

Append to `apps/bank/src/lib/payments.test.ts`, extending its `../db/schema.js`
import with `transactionProofs`. `dpc_abc` below stands for whatever active
payment credential the file's existing fixture already sets up — use that one
rather than inventing a second.

```ts
describe("processPayment with a proof package", () => {
  it("stores the package against the transaction it wrote", () => {
    const result = processPayment(db, {
      credentialId: "dpc_abc",
      amountCents: 1_000,
      currency: "EUR",
      merchant: "Larder",
      reference: "Order ord_1",
      idempotencyKey: "sess_1",
      proofPackage: { signedRequest: "hdr.pay.sig", vpToken: { dpc: ["eyJ..."] } },
    });

    expect(result.ok).toBe(true);
    const proofs = db.select().from(transactionProofs).all();
    expect(proofs).toHaveLength(1);
    expect(proofs[0]!.transactionId).toBe((result as { bankTxId: string }).bankTxId);
    expect(proofs[0]!.signedRequest).toBe("hdr.pay.sig");
    expect(JSON.parse(proofs[0]!.vpTokenJson)).toEqual({ dpc: ["eyJ..."] });
  });

  it("debits normally when no package is sent", () => {
    const result = processPayment(db, {
      credentialId: "dpc_abc",
      amountCents: 1_000,
      currency: "EUR",
      merchant: "Larder",
      reference: "Order ord_1",
      idempotencyKey: "sess_1",
    });

    expect(result.ok).toBe(true);
    expect(db.select().from(transactionProofs).all()).toHaveLength(0);
  });

  it("writes no proof when the debit is refused", () => {
    // Atomicity in the direction that matters: a package must never outlive a
    // transaction that was never created.
    const result = processPayment(db, {
      credentialId: "dpc_abc",
      amountCents: 999_999_999,
      currency: "EUR",
      merchant: "Larder",
      reference: "Order ord_1",
      idempotencyKey: "sess_broke",
      proofPackage: { signedRequest: "hdr.pay.sig", vpToken: {} },
    });

    expect(result).toEqual({ ok: false, reason: "insufficient_funds" });
    expect(db.select().from(transactionProofs).all()).toHaveLength(0);
  });

  it("leaves the original package alone on an idempotent replay", () => {
    const input = {
      credentialId: "dpc_abc",
      amountCents: 1_000,
      currency: "EUR",
      merchant: "Larder",
      reference: "Order ord_1",
      idempotencyKey: "sess_1",
    };
    processPayment(db, { ...input, proofPackage: { signedRequest: "first", vpToken: 1 } });
    processPayment(db, { ...input, proofPackage: { signedRequest: "second", vpToken: 2 } });

    const proofs = db.select().from(transactionProofs).all();
    expect(proofs).toHaveLength(1);
    expect(proofs[0]!.signedRequest).toBe("first");
  });
});
```

Append to `apps/bank/src/db/schema.test.ts`:

```ts
describe("transaction_proofs", () => {
  it("holds at most one package per transaction", () => {
    // Insert whatever account + transaction row this file's fixtures provide,
    // then reuse that transaction's id below in place of "tx_1".
    db.insert(transactionProofs)
      .values({
        transactionId: "tx_1",
        signedRequest: "a.b.c",
        vpTokenJson: '{"dpc":["x"]}',
        receivedAt: 5,
      })
      .run();

    expect(() =>
      db
        .insert(transactionProofs)
        .values({
          transactionId: "tx_1",
          signedRequest: "d.e.f",
          vpTokenJson: "{}",
          receivedAt: 6,
        })
        .run(),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @demo/bank exec vitest run src/lib/payments.test.ts src/db/schema.test.ts
```

Expected: FAIL to compile — `transactionProofs` is not exported and
`proofPackage` is not a member of `ProcessPaymentInput`.

- [ ] **Step 3: Add the table**

Append to `apps/bank/src/db/schema.ts`, after `transactions`:

```ts
/**
 * The PaSO Proof/Verify §4.1 proof package the merchant forwarded with a debit.
 *
 * A separate table rather than two more columns on `transactions`, because a
 * `vp_token` is kilobytes and `listTransactions` reads a page of twenty rows on
 * every dashboard render. The ledger query must not pay for an artefact only a
 * dialog reads.
 *
 * The primary key IS the transaction id: at most one package per transaction,
 * enforced by the database rather than by a convention in `processPayment`. A
 * replayed debit short-circuits before it can write a second one, and if that
 * ever changed the constraint would say so loudly.
 *
 * The bank STORES this and does not verify it (design D4). None of PaSO §3's
 * checks are run here — no signature verification, no `request_integrity`, no
 * `jti` replay cache — and no UI copy may imply otherwise.
 */
export const transactionProofs = sqliteTable("transaction_proofs", {
 transactionId: text("transaction_id")
  .primaryKey()
  .references(() => transactions.id),
 /** The signed Authorization Request, compact JWS, verbatim. */
 signedRequest: text("signed_request").notNull(),
 /** `JSON.stringify` of the `vp_token` exactly as the wallet produced it. */
 vpTokenJson: text("vp_token_json").notNull(),
 receivedAt: integer("received_at").notNull(),
});
```

Add beside the other type exports:

```ts
export type TransactionProof = typeof transactionProofs.$inferSelect;
```

- [ ] **Step 4: Generate and inspect the migration**

```bash
pnpm --filter @demo/bank run db:generate
cat apps/bank/drizzle/0004_*.sql
```

Expected: a plain ``CREATE TABLE `transaction_proofs` (…)`` with the foreign key
and nothing else. Hand-edit if the generator touched another table.

- [ ] **Step 5: Extend `processPayment`**

In `apps/bank/src/lib/payments.ts`, add `transactionProofs` to the
`../db/schema.js` import and add to `ProcessPaymentInput`:

```ts
  /**
   * The PaSO Proof/Verify §4.1 package, when the merchant had one.
   *
   * Optional, and its absence is ordinary rather than exceptional: it is
   * assembled from foundry's best-effort webhook, whose artefact gate is off by
   * default. The debit does not depend on it and no check reads it — the bank
   * stores this and does not verify it (design D4).
   */
  proofPackage?: { signedRequest: string; vpToken: unknown };
```

Inside the existing `db.transaction((tx) => { … })`, after the
`tx.insert(transactions)` call and before the `return`:

```ts
      // Same SQL transaction as the debit, deliberately: a package must never
      // outlive a transaction that was rolled back, and a transaction must
      // never lose a package that was sent with it.
      if (input.proofPackage) {
        tx.insert(transactionProofs)
          .values({
            transactionId: bankTxId,
            signedRequest: input.proofPackage.signedRequest,
            vpTokenJson: JSON.stringify(input.proofPackage.vpToken),
            receivedAt: now,
          })
          .run();
      }
```

The idempotency short-circuit at the top of the function is **not** touched. A
replayed debit returns the original result before reaching this code, so a
second call carrying a different package cannot rewrite the first one's — which
is the behaviour the fourth test above pins.

- [ ] **Step 6: Accept the package on the route**

In `apps/bank/src/app/api/payments/route.ts`, extend `bodySchema`:

```ts
  /**
   * PaSO Proof/Verify §4.1, member names verbatim from the spec.
   *
   * `.optional()` rather than `.nullable()`: the merchant omits the key when it
   * has no package (see `BankClient.pay`), and accepting an explicit null too
   * would admit a second spelling of the same fact.
   *
   * `vp_token` is `z.unknown()` — its shape is the wallet's, not ours, and
   * narrowing it here would reject a conformant token from a wallet we have
   * never seen. It is stored verbatim and decoded only for display.
   */
  proof_package: z
    .object({ signed_request: z.string().min(1), vp_token: z.unknown() })
    .optional(),
```

And pass it through:

```ts
  const result = processPayment(getDb(), {
    credentialId: parsed.data.credential_id,
    amountCents: parsed.data.amount_cents,
    currency: parsed.data.currency,
    merchant: parsed.data.merchant,
    reference: parsed.data.reference,
    idempotencyKey: parsed.data.idempotency_key,
    ...(parsed.data.proof_package
      ? {
          proofPackage: {
            signedRequest: parsed.data.proof_package.signed_request,
            vpToken: parsed.data.proof_package.vp_token,
          },
        }
      : {}),
  });
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
pnpm --filter @demo/bank exec vitest run src/lib/payments.test.ts src/db/schema.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run the gate**

```bash
pnpm check
```

- [ ] **Step 9: Commit**

```bash
git add apps/bank/src/db/schema.ts apps/bank/src/db/schema.test.ts \
        apps/bank/src/lib/payments.ts apps/bank/src/lib/payments.test.ts \
        apps/bank/src/app/api/payments/route.ts apps/bank/drizzle
git commit -m "feat(bank): store the PaSO proof package alongside the debit

Written inside processPayment's existing SQL transaction, so a package
cannot outlive a rolled-back debit. The bank stores and does not verify:
none of PaSO section 3's checks are run."
```

---

### Task 8: Bank — expose the package to the ledger

**Files:**

- Modify: `apps/bank/src/lib/queries.ts`, `apps/bank/src/lib/queries.test.ts`
- Create: `apps/bank/src/app/api/transactions/[id]/proof/route.ts`
- Create: `apps/bank/src/app/api/transactions/[id]/proof/route.test.ts`

**Interfaces:**

- Consumes: `transactionProofs` (Task 7).
- Produces:
  - `TransactionDto.hasProof: boolean`
  - `export interface TransactionProofBody { proofPackage: { signed_request: string; vp_token: unknown }; receivedAt: number }`
  - `export function getTransactionProof(db: Db, userId: string, transactionId: string): TransactionProofBody | null`

  Task 10 consumes `hasProof` and fetches the route.

- [ ] **Step 1: Write the failing tests**

Append to `apps/bank/src/lib/queries.test.ts`. `user_anna` stands for whatever
seeded user that file already uses.

```ts
describe("listTransactions hasProof", () => {
  it("is false for a transaction with no stored package", () => {
    const rows = listTransactions(db, "user_anna", 20, 0);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.hasProof === false)).toBe(true);
  });

  it("is true only for the transaction that has one", () => {
    const target = listTransactions(db, "user_anna", 20, 0)[0]!;
    db.insert(transactionProofs)
      .values({
        transactionId: target.id,
        signedRequest: "a.b.c",
        vpTokenJson: "{}",
        receivedAt: 1,
      })
      .run();

    const rows = listTransactions(db, "user_anna", 20, 0);
    expect(rows.filter((r) => r.hasProof).map((r) => r.id)).toEqual([target.id]);
  });
});

describe("getTransactionProof", () => {
  it("returns the package under the spec's member names", () => {
    const target = listTransactions(db, "user_anna", 20, 0)[0]!;
    db.insert(transactionProofs)
      .values({
        transactionId: target.id,
        signedRequest: "a.b.c",
        vpTokenJson: '{"dpc":["x"]}',
        receivedAt: 7,
      })
      .run();

    expect(getTransactionProof(db, "user_anna", target.id)).toEqual({
      proofPackage: { signed_request: "a.b.c", vp_token: { dpc: ["x"] } },
      receivedAt: 7,
    });
  });

  it("returns null for a transaction with no package", () => {
    const target = listTransactions(db, "user_anna", 20, 0)[0]!;
    expect(getTransactionProof(db, "user_anna", target.id)).toBeNull();
  });

  it("returns null for a transaction belonging to someone else", () => {
    // Ownership, not just existence. Guessing a transaction id must not be
    // enough to read another customer's wallet presentation.
    const target = listTransactions(db, "user_anna", 20, 0)[0]!;
    db.insert(transactionProofs)
      .values({
        transactionId: target.id,
        signedRequest: "a.b.c",
        vpTokenJson: "{}",
        receivedAt: 7,
      })
      .run();

    expect(getTransactionProof(db, "user_nobody", target.id)).toBeNull();
  });

  it("returns null rather than throwing when the stored token is not JSON", () => {
    const target = listTransactions(db, "user_anna", 20, 0)[0]!;
    db.insert(transactionProofs)
      .values({
        transactionId: target.id,
        signedRequest: "a.b.c",
        vpTokenJson: "{ not json",
        receivedAt: 7,
      })
      .run();

    expect(getTransactionProof(db, "user_anna", target.id)).toBeNull();
  });
});
```

Create `apps/bank/src/app/api/transactions/[id]/proof/route.test.ts`:

```ts
/**
 * The wire body of `GET /api/transactions/{id}/proof`.
 *
 * The exact-key-set assertion below is the point of this file. A route body is
 * a hand-maintained projection, and this repo has already shipped one bug where
 * a member existed everywhere except the `NextResponse.json` literal —
 * `dcApiProtocol`, fixed in 6e997da. A type cannot catch it, because
 * `JSON.stringify` silently drops `undefined`. Only parsing the response can.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "@/db/index.js";
import { transactionProofs } from "@/db/schema.js";
import { seed } from "@/db/seed.js";
import { listTransactions } from "@/lib/queries.js";

const dbStub = vi.hoisted(() => ({ db: null as unknown }));
const sessionStub = vi.hoisted(() => ({ userId: "user_anna" }));

vi.mock("@/db/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db/index.js")>()),
  getDb: () => dbStub.db,
}));

// withSession's guard is exercised by session.test.ts; this file is about the
// body's shape, so the session is supplied rather than minted.
vi.mock("@/lib/session.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session.js")>()),
  requireSession: async () => ({
    userId: sessionStub.userId,
    displayName: "Anna",
  }),
}));

const { GET } = await import("./route.js");

let db: Db;
let txId: string;

beforeEach(() => {
  db = createDb(":memory:");
  dbStub.db = db;
  seed(db);
  sessionStub.userId = "user_anna";
  txId = listTransactions(db, "user_anna", 20, 0)[0]!.id;
});

function get(id: string): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request(`http://b/api/transactions/${id}/proof`),
    { params: Promise.resolve({ id }) },
  ];
}

describe("GET /api/transactions/[id]/proof", () => {
  it("returns exactly the members the viewer reads", async () => {
    db.insert(transactionProofs)
      .values({
        transactionId: txId,
        signedRequest: "a.b.c",
        vpTokenJson: '{"dpc":["x"]}',
        receivedAt: 7,
      })
      .run();

    const response = await GET(...get(txId));
    expect(response.status).toBe(200);

    const body = (await response.json()) as Record<string, unknown>;
    // Exact, not a subset: the defect this guards against is an ABSENT member.
    expect(Object.keys(body).sort()).toEqual(["proofPackage", "receivedAt"]);
    expect(Object.keys(body.proofPackage as object).sort()).toEqual([
      "signed_request",
      "vp_token",
    ]);
    expect(body.proofPackage).toEqual({
      signed_request: "a.b.c",
      vp_token: { dpc: ["x"] },
    });
  });

  it("404s a transaction with no package", async () => {
    const response = await GET(...get(txId));
    expect(response.status).toBe(404);
  });

  it("404s a transaction owned by someone else", async () => {
    db.insert(transactionProofs)
      .values({
        transactionId: txId,
        signedRequest: "a.b.c",
        vpTokenJson: "{}",
        receivedAt: 7,
      })
      .run();
    sessionStub.userId = "user_nobody";

    const response = await GET(...get(txId));
    expect(response.status).toBe(404);
  });

  it("404s an id that does not exist", async () => {
    const response = await GET(...get("tx_nope"));
    expect(response.status).toBe(404);
  });
});
```

Adjust the seeded user id and the seed import to match what
`apps/bank/src/db/seed.ts` actually creates; if the seed writes no
transactions, insert an account and a transaction in the `beforeEach` instead.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @demo/bank exec vitest run src/lib/queries.test.ts "src/app/api/transactions/[id]/proof/route.test.ts"
```

Expected: FAIL — `hasProof` is not a member, `getTransactionProof` is not
exported, and `./route.js` does not exist.

- [ ] **Step 3: Add `hasProof` and `getTransactionProof`**

In `apps/bank/src/lib/queries.ts`, add `transactionProofs` to the schema import
and add to `TransactionDto`:

```ts
 /**
  * Whether a PaSO proof package was stored with this transaction.
  *
  * A boolean rather than the package itself: a `vp_token` is kilobytes and
  * this DTO is rendered twenty at a time. The viewer fetches the package by id
  * when it opens.
  */
 hasProof: boolean;
```

Rewrite the tail of `listTransactions` so the flag costs one extra query rather
than one per row:

```ts
 const rows = db
  .select()
  .from(transactions)
  .where(inArray(transactions.accountId, owned))
  .orderBy(desc(transactions.bookedAt))
  .limit(limit)
  .offset(offset)
  .all();

 // One IN query over the page, not a lookup per row. The page is at most a
 // hundred ids and this runs on every dashboard render.
 const withProof = new Set(
  rows.length === 0
   ? []
   : db
     .select({ id: transactionProofs.transactionId })
     .from(transactionProofs)
     .where(
      inArray(
       transactionProofs.transactionId,
       rows.map((row) => row.id),
      ),
     )
     .all()
     .map((row) => row.id),
 );

 return rows.map((row) => ({
  id: row.id,
  amountCents: row.amountCents,
  currency: row.currency,
  counterparty: row.counterparty,
  reference: row.reference,
  bookedAt: row.bookedAt,
  paidWithWallet: row.credentialId !== null,
  hasProof: withProof.has(row.id),
 }));
```

Then append the reader:

```ts
/**
 * The body of `GET /api/transactions/{id}/proof`.
 *
 * `proofPackage` holds the spec's own member names — `signed_request` and
 * `vp_token` — because it IS the PaSO Proof/Verify §4.1 package, and the viewer
 * shows it raw. Everything beside it is ours, and camelCase like every other
 * DTO here. Mixing the two casings in one object is deliberate: the boundary
 * between "the artefact" and "what we recorded about it" should be visible.
 *
 * Declared as a named type and used as `getTransactionProof`'s return
 * ANNOTATION rather than inferred. That annotation is the guard: this repo has
 * shipped a bug where a route's object literal silently omitted a member the
 * client read (`dcApiProtocol`, 6e997da), and only a written-out return type
 * turns that into a compile error.
 */
export interface TransactionProofBody {
 proofPackage: { signed_request: string; vp_token: unknown };
 receivedAt: number;
}

/**
 * The stored proof package for one transaction, scoped to its owner.
 *
 * Ownership is checked here rather than in the route, for the same reason
 * `listTransactions` scopes by account: a transaction id is guessable, and a
 * proof package contains a holder's wallet presentation. A transaction that
 * exists but belongs to someone else is indistinguishable from one that does
 * not exist — both are null.
 */
export function getTransactionProof(
 db: Db,
 userId: string,
 transactionId: string,
): TransactionProofBody | null {
 const owned = db
  .select({ id: accounts.id })
  .from(accounts)
  .where(eq(accounts.userId, userId))
  .all()
  .map((row) => row.id);
 if (owned.length === 0) return null;

 const transaction = db
  .select({ accountId: transactions.accountId })
  .from(transactions)
  .where(eq(transactions.id, transactionId))
  .get();
 if (!transaction || !owned.includes(transaction.accountId)) return null;

 const proof = db
  .select()
  .from(transactionProofs)
  .where(eq(transactionProofs.transactionId, transactionId))
  .get();
 if (!proof) return null;

 // Written by us, so this cannot fail in practice — but it is read back from a
 // database that outlives the process that wrote it, and a throw here would be
 // a 500 on a page that is otherwise fine.
 let vpToken: unknown;
 try {
  vpToken = JSON.parse(proof.vpTokenJson);
 } catch {
  return null;
 }

 return {
  proofPackage: { signed_request: proof.signedRequest, vp_token: vpToken },
  receivedAt: proof.receivedAt,
 };
}
```

- [ ] **Step 4: Write the route**

Create `apps/bank/src/app/api/transactions/[id]/proof/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import { withSession } from "@/lib/api.js";
import { getTransactionProof } from "@/lib/queries.js";

export const dynamic = "force-dynamic";

/**
 * The stored PaSO proof package for one transaction.
 *
 * The body is `getTransactionProof`'s return value passed straight through, NOT
 * re-assembled from its members. That function carries a written-out
 * `TransactionProofBody` annotation, so a member added there cannot be silently
 * dropped here — which is exactly how `dcApiProtocol` went missing from the
 * merchant's payment-session route (6e997da).
 *
 * Absent, unowned and nonexistent all answer 404. A transaction id is
 * guessable and this payload is a holder's wallet presentation, so
 * "this is not yours" must not be distinguishable from "this does not exist".
 */
export const GET = withSession(async (session, request) => {
 const id = new URL(request.url).pathname.split("/").at(-2) ?? "";
 const body = getTransactionProof(getDb(), session.userId, id);
 if (!body) return NextResponse.json({ error: "not_found" }, { status: 404 });
 return NextResponse.json(body);
});
```

`withSession` hands the handler `(session, request)` and nothing else, so the
dynamic segment is read from the URL rather than from a `params` argument. If
that reads badly, widen `withSession` to forward a second argument instead —
but do it in `api.ts` for every route, not with a bespoke wrapper here, and
update the route test's call signature to match.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @demo/bank exec vitest run src/lib/queries.test.ts "src/app/api/transactions/[id]/proof/route.test.ts"
```

Expected: PASS. Every existing `TransactionDto` assertion that compares a whole
object will now fail on the missing `hasProof` — add it to those fixtures
rather than loosening the assertions to `toMatchObject`.

- [ ] **Step 6: Run the gate**

```bash
pnpm check
```

- [ ] **Step 7: Commit**

```bash
git add apps/bank/src/lib/queries.ts apps/bank/src/lib/queries.test.ts \
        "apps/bank/src/app/api/transactions/[id]/proof"
git commit -m "feat(bank): expose the stored proof package to the ledger

hasProof is one IN query per page, not a lookup per row. The package
itself is fetched by id and scoped to its owner: unowned, absent and
nonexistent all answer 404."
```

---

### Task 9: Bank — decoding the package for display

**Files:**

- Create: `apps/bank/src/lib/proof-decode.ts`
- Create: `apps/bank/src/lib/proof-decode.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `export type DecodeFailure = { ok: false; reason: string }`
  - `export type JwsResult = { ok: true; header: unknown; payload: unknown; signature: string } | DecodeFailure`
  - `export function decodeJwsCompact(value: string): JwsResult`
  - `export type DisclosureResult = { ok: true; value: unknown } | DecodeFailure`
  - `export type PresentationView = { kind: "sd-jwt"; issuerJwt: JwsResult; disclosures: DisclosureResult[]; kbJwt: JwsResult | null } | { kind: "opaque"; value: string }`
  - `export type VpTokenView = { ok: true; entries: Array<{ queryId: string; presentations: PresentationView[] }> } | DecodeFailure`
  - `export function decodeVpToken(value: unknown): VpTokenView`

  Task 10 renders all of these.

- [ ] **Step 1: Write the failing tests**

Create `apps/bank/src/lib/proof-decode.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decodeJwsCompact, decodeVpToken } from "./proof-decode.js";

/** base64url with no padding, exactly as JOSE requires. */
function b64u(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function jws(header: unknown, payload: unknown, signature = "c2ln"): string {
  return `${b64u(header)}.${b64u(payload)}.${signature}`;
}

describe("decodeJwsCompact", () => {
  it("splits a compact JWS into header, payload and signature", () => {
    const token = jws({ alg: "ES256", typ: "dc+sd-jwt" }, { vct: "com.emvco.dpc.card" });

    expect(decodeJwsCompact(token)).toEqual({
      ok: true,
      header: { alg: "ES256", typ: "dc+sd-jwt" },
      payload: { vct: "com.emvco.dpc.card" },
      // Left encoded: it is a signature over bytes, not a document. Rendering
      // it as text would invite someone to read it as one.
      signature: "c2ln",
    });
  });

  it("fails on a token that is not three segments", () => {
    expect(decodeJwsCompact("a.b")).toEqual({ ok: false, reason: expect.any(String) });
    expect(decodeJwsCompact("a.b.c.d").ok).toBe(false);
    expect(decodeJwsCompact("").ok).toBe(false);
  });

  it("fails on a segment that is not base64url", () => {
    // Buffer.from(_, "base64url") SILENTLY SKIPS invalid characters rather than
    // throwing, so the alphabet has to be checked explicitly. Without that this
    // returns a plausible-looking wrong answer.
    expect(decodeJwsCompact(`${b64u({ a: 1 })}.not+base64url/.sig`).ok).toBe(false);
  });

  it("fails on base64url that is not JSON", () => {
    const notJson = Buffer.from("hello").toString("base64url");
    expect(decodeJwsCompact(`${notJson}.${b64u({ a: 1 })}.sig`).ok).toBe(false);
  });

  it("never throws on arbitrary input", () => {
    for (const input of ["~~~", "...", "🙂.🙂.🙂", "a".repeat(10_000)]) {
      expect(() => decodeJwsCompact(input)).not.toThrow();
    }
  });
});

describe("decodeVpToken", () => {
  const issuer = jws({ alg: "ES256", typ: "dc+sd-jwt" }, { vct: "sparkassencard" });
  const kb = jws({ alg: "ES256", typ: "kb+jwt" }, { aud: "x509_hash:abc" });
  const disclosure = Buffer.from(
    JSON.stringify(["c2FsdA", "psu_id", "psu-1"]),
  ).toString("base64url");

  it("keys presentations by their DCQL query id", () => {
    const view = decodeVpToken({ sparkassencard: [`${issuer}~${disclosure}~`] });
    expect(view.ok).toBe(true);
    if (!view.ok) return;

    expect(view.entries.map((e) => e.queryId)).toEqual(["sparkassencard"]);
    expect(view.entries[0]!.presentations).toHaveLength(1);
  });

  it("splits an SD-JWT into issuer JWT, disclosures and no KB-JWT", () => {
    // A TRAILING tilde means "no key binding". The last segment is empty, not
    // a JWT, and treating it as one is the classic SD-JWT parsing bug.
    const view = decodeVpToken({ dpc: [`${issuer}~${disclosure}~`] });
    if (!view.ok) throw new Error("expected ok");

    const p = view.entries[0]!.presentations[0]!;
    if (p.kind !== "sd-jwt") throw new Error("expected sd-jwt");
    expect(p.issuerJwt.ok).toBe(true);
    expect(p.disclosures).toEqual([{ ok: true, value: ["c2FsdA", "psu_id", "psu-1"] }]);
    expect(p.kbJwt).toBeNull();
  });

  it("reads a KB-JWT when the presentation carries one", () => {
    const view = decodeVpToken({ dpc: [`${issuer}~${disclosure}~${kb}`] });
    if (!view.ok) throw new Error("expected ok");

    const p = view.entries[0]!.presentations[0]!;
    if (p.kind !== "sd-jwt") throw new Error("expected sd-jwt");
    expect(p.kbJwt?.ok).toBe(true);
    expect(p.disclosures).toHaveLength(1);
  });

  it("handles an SD-JWT with no disclosures at all", () => {
    const view = decodeVpToken({ dpc: [issuer] });
    if (!view.ok) throw new Error("expected ok");

    const p = view.entries[0]!.presentations[0]!;
    if (p.kind !== "sd-jwt") throw new Error("expected sd-jwt");
    expect(p.disclosures).toEqual([]);
    expect(p.kbJwt).toBeNull();
  });

  it("reports a malformed disclosure without discarding the good ones", () => {
    const view = decodeVpToken({ dpc: [`${issuer}~${disclosure}~!!!~`] });
    if (!view.ok) throw new Error("expected ok");

    const p = view.entries[0]!.presentations[0]!;
    if (p.kind !== "sd-jwt") throw new Error("expected sd-jwt");
    expect(p.disclosures[0]!.ok).toBe(true);
    expect(p.disclosures[1]!.ok).toBe(false);
  });

  it("renders an mdoc presentation as opaque rather than guessing", () => {
    // An mso_mdoc presentation is base64url CBOR. It has no dots and is not
    // JSON, and a decoder that tried anyway would print convincing nonsense.
    const view = decodeVpToken({ av_mdoc: ["omdkb2NUeXBlZ2V1LmV1"] });
    if (!view.ok) throw new Error("expected ok");

    expect(view.entries[0]!.presentations[0]).toEqual({
      kind: "opaque",
      value: "omdkb2NUeXBlZ2V1LmV1",
    });
  });

  it("keeps two credentials apart", () => {
    const view = decodeVpToken({ dpc: [issuer], av_sdjwt: [issuer] });
    if (!view.ok) throw new Error("expected ok");
    expect(view.entries.map((e) => e.queryId).sort()).toEqual(["av_sdjwt", "dpc"]);
  });

  it("fails on a vp_token that is not an object keyed by query id", () => {
    expect(decodeVpToken(null).ok).toBe(false);
    expect(decodeVpToken("eyJ...").ok).toBe(false);
    expect(decodeVpToken([]).ok).toBe(false);
  });

  it("accepts an empty vp_token object", () => {
    const view = decodeVpToken({});
    expect(view).toEqual({ ok: true, entries: [] });
  });

  it("reports a non-array entry rather than throwing", () => {
    // OpenID4VP 1.0 makes each value an ARRAY of presentations. A wallet that
    // sent a bare string is wrong, and the viewer must say so rather than crash.
    const view = decodeVpToken({ dpc: issuer });
    expect(view.ok).toBe(false);
  });

  it("never throws on arbitrary input", () => {
    for (const input of [undefined, 0, true, { dpc: [null] }, { dpc: [{}] }]) {
      expect(() => decodeVpToken(input)).not.toThrow();
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @demo/bank exec vitest run src/lib/proof-decode.test.ts
```

Expected: FAIL to compile — `./proof-decode.js` does not exist.

- [ ] **Step 3: Write the implementation**

Create `apps/bank/src/lib/proof-decode.ts`:

```ts
/**
 * Reads a stored PaSO proof package into something a human can look at.
 *
 * Pure and total: every function returns a result value and NOTHING throws.
 * These artefacts came from a wallet the bank has never met, through a verifier
 * whose output the bank does not validate (design D4) — so "I could not read
 * this" is an ordinary answer, and a dialog that 500s on a malformed token is a
 * worse outcome than one that says so.
 *
 * In `.ts` rather than inside the dialog because vitest here is
 * `environment: "node"` and never matches `.tsx`. A decoder written in the
 * component would be untested by construction.
 *
 * Decoding is for DISPLAY ONLY. Nothing here verifies a signature, and no
 * caller may treat a successful decode as evidence of anything.
 */

export interface DecodeFailure {
  ok: false;
  /** Short, technical, and shown beside the raw bytes. Not user copy. */
  reason: string;
}

export interface JwsParts {
  ok: true;
  header: unknown;
  payload: unknown;
  /**
   * The signature segment, left base64url-encoded on purpose: it is a
   * signature over bytes, not a document, and rendering it as text would
   * invite someone to read it as one.
   */
  signature: string;
}

export type JwsResult = JwsParts | DecodeFailure;

/** base64url per RFC 4648 §5, unpadded — the only alphabet JOSE permits. */
const BASE64URL = /^[A-Za-z0-9_-]*$/;

function decodeSegment(segment: string): { ok: true; value: unknown } | DecodeFailure {
  // `Buffer.from(_, "base64url")` SILENTLY SKIPS characters outside the
  // alphabet rather than throwing, so an unchecked segment yields a
  // plausible-looking wrong answer. The alphabet is checked first, always.
  if (!BASE64URL.test(segment)) return { ok: false, reason: "not base64url" };
  let text: string;
  try {
    text = Buffer.from(segment, "base64url").toString("utf8");
  } catch {
    return { ok: false, reason: "could not decode base64url" };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, reason: "not JSON" };
  }
}

/** Splits a compact JWS into its decoded header and payload. */
export function decodeJwsCompact(value: string): JwsResult {
  const segments = value.split(".");
  if (segments.length !== 3) {
    return { ok: false, reason: `expected 3 segments, got ${segments.length}` };
  }
  const [rawHeader, rawPayload, signature] = segments as [string, string, string];

  const header = decodeSegment(rawHeader);
  if (!header.ok) return { ok: false, reason: `header: ${header.reason}` };
  const payload = decodeSegment(rawPayload);
  if (!payload.ok) return { ok: false, reason: `payload: ${payload.reason}` };

  return { ok: true, header: header.value, payload: payload.value, signature };
}

export type DisclosureResult = { ok: true; value: unknown } | DecodeFailure;

export interface SdJwtView {
  kind: "sd-jwt";
  issuerJwt: JwsResult;
  /** Each is `[salt, name, value]` or `[salt, value]` per SD-JWT §4.2. */
  disclosures: DisclosureResult[];
  /** Null when the presentation ends in a bare `~`, i.e. no key binding. */
  kbJwt: JwsResult | null;
}

export interface OpaqueView {
  kind: "opaque";
  /** Shown verbatim. An `mso_mdoc` presentation is base64url CBOR. */
  value: string;
}

export type PresentationView = SdJwtView | OpaqueView;

export interface VpTokenEntry {
  /** The DCQL credential query id this presentation answered. */
  queryId: string;
  presentations: PresentationView[];
}

export type VpTokenView = { ok: true; entries: VpTokenEntry[] } | DecodeFailure;

/**
 * Whether a presentation looks like an SD-JWT VC rather than an mdoc.
 *
 * The test is structural, never a claim about content: the part before the
 * first `~` must be a three-segment token whose header decodes to JSON. An
 * `mso_mdoc` presentation is base64url CBOR with no dots, so it fails this and
 * is shown opaque — which is the honest rendering. Guessing at CBOR would print
 * convincing nonsense, and this repo decodes for display only.
 */
function readPresentation(value: string): PresentationView {
  const parts = value.split("~");
  const issuerJwt = decodeJwsCompact(parts[0] ?? "");
  if (!issuerJwt.ok) return { kind: "opaque", value };

  const rest = parts.slice(1);
  // A TRAILING tilde means "no key binding": the final element is empty, not a
  // JWT. Treating it as one is the classic SD-JWT parsing bug.
  const hasKb = rest.length > 0 && rest[rest.length - 1] !== "";
  const kbSegment = hasKb ? rest[rest.length - 1]! : null;
  const disclosureSegments = rest.length > 0 ? rest.slice(0, -1) : [];

  return {
    kind: "sd-jwt",
    issuerJwt,
    disclosures: disclosureSegments.map((segment) => decodeSegment(segment)),
    kbJwt: kbSegment === null ? null : decodeJwsCompact(kbSegment),
  };
}

/**
 * Reads a `vp_token` into per-credential views.
 *
 * OpenID4VP 1.0 makes `vp_token` a JSON object keyed by DCQL credential query
 * id whose values are ARRAYS of presentations. Entries are never merged: two
 * credentials disclosing the same claim name would collide, which foundry's own
 * schema calls a correctness bug rather than a presentation choice.
 */
export function decodeVpToken(value: unknown): VpTokenView {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, reason: "vp_token must be an object keyed by query id" };
  }

  const entries: VpTokenEntry[] = [];
  for (const [queryId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(raw)) {
      return { ok: false, reason: `vp_token['${queryId}'] must be an array` };
    }
    entries.push({
      queryId,
      presentations: raw.map((item) =>
        typeof item === "string"
          ? readPresentation(item)
          : { kind: "opaque" as const, value: String(item) },
      ),
    });
  }

  return { ok: true, entries };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @demo/bank exec vitest run src/lib/proof-decode.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run the gate**

```bash
pnpm check
```

- [ ] **Step 6: Commit**

```bash
git add apps/bank/src/lib/proof-decode.ts apps/bank/src/lib/proof-decode.test.ts
git commit -m "feat(bank): decode a proof package for display

Total and pure: every function returns a result and nothing throws, because
these artefacts come from a wallet this repo has never observed. Decoding
is for display only — no signature is verified anywhere."
```

---

### Task 10: Bank — the ledger affordance and the viewer

**Files:**

- Modify: `apps/bank/src/lib/i18n/messages.ts`, `apps/bank/src/lib/i18n/en.ts`, `apps/bank/src/lib/i18n/de.ts`
- Create: `apps/bank/src/components/ProofDialog.tsx`
- Modify: `apps/bank/src/components/TransactionRow.tsx`

**Interfaces:**

- Consumes: `TransactionDto.hasProof`, `TransactionProofBody` (Task 8); every exported type of `proof-decode.ts` (Task 9); `Locale`, `MESSAGES`.
- Produces: nothing consumed by a later task.

- [ ] **Step 1: Add the copy**

There is no failing test to write first here: the gate for copy in this app is
`tsc`, because both catalogs are declared against one interface and a missing
key is a compile error. `messages.test.ts` needs no new cases — its invariants
(identical key sets, no empty leaf, no leaf byte-identical across locales)
already cover new leaves.

Add to the `Messages` interface in `apps/bank/src/lib/i18n/messages.ts`, after
the `issuance` block:

```ts
     /**
      * The PaSO proof package viewer.
      *
      * NOTHING here may claim the bank verified this package. It stores what
      * the merchant forwarded and runs none of PaSO §3's checks (design D4), so
      * `disclaimer` says so in as many words and no other string implies
      * otherwise. "Proof" here names the artefact, not a verdict.
      */
     proof: {
          /** Dialog title. */
          title: string;
          /** Accessible name of the ledger-row button. */
          open: string;
          /** States plainly that the bank stored this and did not check it. */
          disclaimer: string;
          /** Label for the `signed_request` member. */
          signedRequest: string;
          /** Label for the `vp_token` member. */
          vpToken: string;
          showRaw: string;
          showDecoded: string;
          copy: string;
          copied: string;
          close: string;
          loading: string;
          loadFailed: string;
          /** Shown beside an artefact the decoder could not read. */
          undecodable: string;
          credential: string;
          header: string;
          payload: string;
          signature: string;
          disclosures: string;
          keyBinding: string;
     };
```

`apps/bank/src/lib/i18n/en.ts`:

```ts
  proof: {
    title: "Payment proof",
    open: "Show payment proof",
    // The bank stores this package; it verifies nothing in it (design D4).
    disclaimer:
      "Stored exactly as the merchant sent it. The bank has not checked it.",
    signedRequest: "Signed request",
    vpToken: "Wallet response",
    showRaw: "Show raw",
    showDecoded: "Show decoded",
    copy: "Copy",
    copied: "Copied",
    close: "Close",
    loading: "Loading…",
    loadFailed: "The proof could not be loaded.",
    undecodable: "Could not be decoded — shown as received.",
    credential: "Credential",
    header: "Header",
    payload: "Payload",
    signature: "Signature",
    disclosures: "Disclosures",
    keyBinding: "Key binding",
  },
```

`apps/bank/src/lib/i18n/de.ts`:

```ts
  proof: {
    title: "Zahlungsnachweis",
    open: "Zahlungsnachweis anzeigen",
    disclaimer:
      "Unverändert so gespeichert, wie der Händler ihn gesendet hat. Die Bank hat ihn nicht geprüft.",
    signedRequest: "Signierte Anfrage",
    vpToken: "Wallet-Antwort",
    showRaw: "Rohdaten anzeigen",
    showDecoded: "Dekodiert anzeigen",
    copy: "Kopieren",
    copied: "Kopiert",
    close: "Schließen",
    loading: "Wird geladen…",
    loadFailed: "Der Nachweis konnte nicht geladen werden.",
    undecodable: "Konnte nicht dekodiert werden — Anzeige wie empfangen.",
    credential: "Nachweis",
    // NOT "Header". `messages.test.ts` fails any leaf that is byte-identical
    // across the two locales, and this is the one word in this block where the
    // English is also idiomatic German.
    header: "Kopfdaten",
    payload: "Nutzdaten",
    signature: "Signatur",
    disclosures: "Offengelegte Angaben",
    keyBinding: "Schlüsselbindung",
  },
```

- [ ] **Step 2: Run the catalog gate**

```bash
pnpm --filter @demo/bank run typecheck
pnpm --filter @demo/bank exec vitest run src/lib/i18n/messages.test.ts
```

Expected: both green. A key present in one catalog and missing from the other is
a `tsc` error; a leaf identical across locales is a `messages.test.ts` failure.
If `header` fails, you used "Header" in both — see the comment above.

- [ ] **Step 3: Write the dialog**

Create `apps/bank/src/components/ProofDialog.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import type { Locale } from "@/lib/i18n/locale.js";
import { MESSAGES } from "@/lib/i18n/messages.js";
import {
  decodeJwsCompact,
  decodeVpToken,
  type JwsResult,
  type PresentationView,
} from "@/lib/proof-decode.js";
// `import type` is fully erased, so this does NOT pull `queries.ts` — and with
// it better-sqlite3 — into the client bundle. Importing the producer's own type
// rather than re-declaring the shape here is the point: a hand-copied interface
// beside a hand-written route body is exactly the pair that lost
// `dcApiProtocol` in the merchant (6e997da).
import type { TransactionProofBody } from "@/lib/queries.js";

/**
 * Shows one stored PaSO proof package.
 *
 * Fetches on open rather than receiving the package as a prop: a `vp_token` is
 * kilobytes and the ledger renders twenty rows, so `TransactionDto` carries a
 * boolean and this component pays the cost only when a human asks.
 *
 * All decoding happens in `lib/proof-decode.ts`. Nothing in this file inspects
 * a token — vitest never matches `.tsx`, so a branch written here would be
 * untested by construction.
 */
export function ProofDialog({
  transactionId,
  locale,
  onClose,
}: {
  transactionId: string;
  locale: Locale;
  onClose: () => void;
}) {
  const t = MESSAGES[locale].proof;
  const [body, setBody] = useState<TransactionProofBody | null>(null);
  const [failed, setFailed] = useState(false);
  const [raw, setRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(
          `/api/transactions/${encodeURIComponent(transactionId)}/proof`,
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error(`status ${response.status}`);
        // `.json()` is untyped at runtime, so this cast is irreducible — but
        // the producer carries a written-out `TransactionProofBody` return
        // annotation and a route test asserts the exact key set, which is what
        // makes the cast safe rather than hopeful.
        const parsed = (await response.json()) as TransactionProofBody;
        if (!cancelled) setBody(parsed);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [transactionId]);

  const copy = useCallback((value: string) => {
    void navigator.clipboard?.writeText(value);
    setCopied(true);
  }, []);

  return (
    <div
      className="dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t.title}
    >
      <div className="dialog-card max-h-[85vh] overflow-y-auto px-7 py-8">
        <h2 className="text-lg font-semibold">{t.title}</h2>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
          {t.disclaimer}
        </p>

        {failed ? (
          <p className="mt-6 text-sm">{t.loadFailed}</p>
        ) : !body ? (
          <p className="mt-6 text-sm">{t.loading}</p>
        ) : (
          <>
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setRaw((value) => !value)}
              >
                {raw ? t.showDecoded : t.showRaw}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => copy(JSON.stringify(body.proofPackage, null, 2))}
              >
                {copied ? t.copied : t.copy}
              </button>
            </div>

            {raw ? (
              <Block label={t.title}>
                {JSON.stringify(body.proofPackage, null, 2)}
              </Block>
            ) : (
              <>
                <section className="mt-6">
                  <h3 className="text-sm font-semibold">{t.signedRequest}</h3>
                  <Jws
                    result={decodeJwsCompact(body.proofPackage.signed_request)}
                    raw={body.proofPackage.signed_request}
                    t={t}
                  />
                </section>

                <section className="mt-6">
                  <h3 className="text-sm font-semibold">{t.vpToken}</h3>
                  <VpToken value={body.proofPackage.vp_token} t={t} />
                </section>
              </>
            )}
          </>
        )}

        <div className="mt-8">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {t.close}
          </button>
        </div>
      </div>
    </div>
  );
}

type Copy = (typeof MESSAGES)[Locale]["proof"];

function Block({ label, children }: { label: string; children: string }) {
  return (
    <div className="mt-2">
      <p className="text-xs text-[var(--color-muted-foreground)]">{label}</p>
      <pre className="mt-1 max-h-64 overflow-auto rounded bg-black/5 p-3 text-xs break-all whitespace-pre-wrap">
        {children}
      </pre>
    </div>
  );
}

function Jws({ result, raw, t }: { result: JwsResult; raw?: string; t: Copy }) {
  if (!result.ok) {
    return (
      <>
        <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">
          {t.undecodable}
        </p>
        {/* Only the top-level signed request still has its raw bytes to hand.
            A nested KB-JWT does not, and an empty block would say nothing. */}
        {raw ? <Block label={t.signature}>{raw}</Block> : null}
      </>
    );
  }
  return (
    <>
      <Block label={t.header}>{JSON.stringify(result.header, null, 2)}</Block>
      <Block label={t.payload}>{JSON.stringify(result.payload, null, 2)}</Block>
      <Block label={t.signature}>{result.signature}</Block>
    </>
  );
}

function VpToken({ value, t }: { value: unknown; t: Copy }) {
  const view = decodeVpToken(value);
  if (!view.ok) {
    return (
      <>
        <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">
          {t.undecodable}
        </p>
        <Block label={t.vpToken}>{JSON.stringify(value, null, 2)}</Block>
      </>
    );
  }

  return (
    <>
      {view.entries.map((entry) => (
        <div key={entry.queryId} className="mt-4">
          <p className="text-xs font-semibold">
            {t.credential}: {entry.queryId}
          </p>
          {entry.presentations.map((presentation, index) => (
            <Presentation key={index} presentation={presentation} t={t} />
          ))}
        </div>
      ))}
    </>
  );
}

function Presentation({
  presentation,
  t,
}: {
  presentation: PresentationView;
  t: Copy;
}) {
  if (presentation.kind === "opaque") {
    return (
      <>
        <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">
          {t.undecodable}
        </p>
        <Block label={t.vpToken}>{presentation.value}</Block>
      </>
    );
  }

  return (
    <>
      <Jws result={presentation.issuerJwt} t={t} />
      {presentation.disclosures.length > 0 ? (
        <Block label={t.disclosures}>
          {presentation.disclosures
            .map((disclosure) =>
              disclosure.ok
                ? JSON.stringify(disclosure.value)
                : `— ${t.undecodable}`,
            )
            .join("\n")}
        </Block>
      ) : null}
      {presentation.kbJwt ? (
        <div className="mt-2">
          <p className="text-xs font-semibold">{t.keyBinding}</p>
          <Jws result={presentation.kbJwt} t={t} />
        </div>
      ) : null}
    </>
  );
}
```

If `btn btn-secondary` does not exist in `apps/bank/src/app/globals.css`, use
`btn` alone rather than inventing a class — check the file first and match what
the other dialogs use.

- [ ] **Step 4: Add the affordance to the ledger row**

`TransactionRow` is a server component and must stay one. Add a small client
child in the same file as the dialog or beside it, and mount it from the row.
Modify `apps/bank/src/components/TransactionRow.tsx`:

```tsx
        <p className="ledger-meta mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate">{transaction.reference}</span>
          {transaction.paidWithWallet ? (
            <span className="badge badge-wallet px-2 py-0.5">
              <EuStars className="h-3 w-3" />
              EUDI Wallet
            </span>
          ) : null}
          {/*
            Present only when a package was actually stored. Its absence is
            ordinary — foundry's webhook is best-effort and its artefact gate is
            off by default — so there is no "no proof" state to render.
          */}
          {transaction.hasProof ? (
            <ProofButton transactionId={transaction.id} locale={locale} />
          ) : null}
        </p>
```

Create the button as a client component beside the dialog (same file is fine —
one `"use client"` boundary, two exports):

```tsx
export function ProofButton({
  transactionId,
  locale,
}: {
  transactionId: string;
  locale: Locale;
}) {
  const t = MESSAGES[locale].proof;
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        // The accessible name is a catalog entry, never the glyph alone: this
        // is the only way a screen-reader user reaches the package at all.
        aria-label={t.open}
        title={t.open}
        className="inline-flex items-center rounded p-0.5 align-middle"
        onClick={() => setOpen(true)}
      >
        <ProofMark className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <ProofDialog
          transactionId={transactionId}
          locale={locale}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/**
 * A seal, not a tick.
 *
 * A checkmark would read as "the bank verified this", which is exactly what did
 * NOT happen (design D4). A document-with-a-seal says "there is a record here",
 * which is the true claim.
 */
function ProofMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M4 1.75h5l3 3v9.5H4z" strokeLinejoin="round" />
      <circle cx="8" cy="9" r="2" />
      <path d="M6.7 10.7 6.2 13l1.8-1 1.8 1-.5-2.3" strokeLinejoin="round" />
    </svg>
  );
}
```

- [ ] **Step 5: Verify in a real browser**

Neither the button nor the dialog is covered by vitest — `.tsx` is never
matched — so markup is not evidence here and neither is a passing suite. Seed a
package by hand and look at it:

```bash
cd apps/bank
cat > scratch.ts <<'TS'
import { createDb } from "./src/db/index.js";
import { transactionProofs, transactions } from "./src/db/schema.js";

const db = createDb(process.env.DATABASE_PATH ?? "./data/bank.db");
const tx = db.select().from(transactions).all()[0];
if (!tx) throw new Error("no transactions — run pnpm seed first");

const b64u = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
const issuer = `${b64u({ alg: "ES256", typ: "dc+sd-jwt" })}.${b64u({
  vct: "https://creds.digitallabor.dev/vct/sparkassencard",
  iss: "https://foundry.digitallabor.dev",
})}.c2ln`;
const disclosure = Buffer.from(
  JSON.stringify(["c2FsdA", "psu_id", "psu-1"]),
).toString("base64url");

db.insert(transactionProofs)
  .values({
    transactionId: tx.id,
    signedRequest: `${b64u({ alg: "ES256", typ: "oauth-authz-req+jwt" })}.${b64u({
      client_id: "x509_hash:abc",
      response_mode: "dc_api.jwt",
    })}.c2ln`,
    vpTokenJson: JSON.stringify({ sparkassencard: [`${issuer}~${disclosure}~`] }),
    receivedAt: Date.now(),
  })
  .run();
console.log("seeded proof on", tx.id);
TS
pnpm exec tsx --env-file-if-exists=.env.local scratch.ts
rm -f scratch.ts
cd ../..
```

Then run `pnpm dev`, sign in, and check all of it:

1. The row for that transaction shows the seal; every other row does not.
2. Clicking it opens the dialog, decoded, with the header and payload of both
   artefacts readable and the disclosure shown as `["c2FsdA","psu_id","psu-1"]`.
3. "Show raw" reveals `{ "signed_request": …, "vp_token": … }` and back again.
4. The German switcher translates every string in the dialog, including
   `Kopfdaten` and `Nutzdaten`.
5. Copy puts the raw package on the clipboard.
6. `tools/cdp/cdp.mjs` can drive this if a headless check is wanted, but a
   human looking at it is the point — this is the one part of the feature no
   test covers.

- [ ] **Step 6: Run the gate**

```bash
pnpm check
```

- [ ] **Step 7: Commit**

```bash
git add apps/bank/src/lib/i18n apps/bank/src/components
git commit -m "feat(bank): show the stored proof package from the ledger

Decoded by default with a raw toggle; a seal rather than a tick, because
the bank stored this package and did not verify it. Verified in a real
browser against a hand-seeded package — no wallet has produced one."
```

---

## Final Verification

- [ ] Run the gate one last time from the repo root and **record the total**:

```bash
pnpm check
```

Reconcile two numbers before believing either: the run's own total, and the sum
of per-file `it()` deltas you introduced. If they disagree, the baseline of 756
was wrong or a file changed without being counted — find out which. Do not
write a projected number anywhere.

- [ ] Confirm both migration sets apply to a clean database:

```bash
pnpm migrate
```

- [ ] Confirm the merchant still boots with the new required env var:

```bash
pnpm dev
```

Expected: both apps reach `✓ Ready`; `/api/health` answers 200 on both.
A missing `FOUNDRY_WEBHOOK_SECRET` must crash the merchant at boot with a named
error — check that by unsetting it once, deliberately.

- [ ] Exercise the webhook end to end against the running merchant, since
      foundry cannot yet do it for you:

```bash
BODY='{"event":"presentation_request_delivered","tx_id":"ver_probe","transport":"dc_api_signed","request_object_jws":"a.b.c"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$FOUNDRY_WEBHOOK_SECRET" -hex | sed 's/^.*= /sha256=/')
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/verifier-events \
  -H "x-foundry-signature: $SIG" -H 'content-type: application/json' -d "$BODY"
```

Expected: `204`, and a `verifier_events` row. Repeat with a deliberately wrong
signature and require `401`. That distinction is the whole of the endpoint's
authentication, and a 204 for both would mean the check is inert.

- [ ] Write the change record to
      `docs/superpowers/changes/2026-08-28-paso-proof-package.md`, stating
      plainly:
  - the measured test total and the per-file deltas;
  - that **no real proof package has ever existed**, because foundry's webhook
    is unimplemented — every claim in this work rests on tests and hand-seeded
    data;
  - the three operator dependencies from the design's §8, and that until they
    land every payment takes the full grace period and settles with no package;
  - that a `request_uri` payment's `signed_request` is the newest delivered
    copy and may not be the one the wallet consumed (design D6/§9).

- [ ] Update the root `AGENTS.md`:
  - the test-count paragraph, with the measured total and the per-file split;
  - a new bullet under **Credentials and credential types** or a new section for
    the proof package, recording: the merchant owns `/api/verifier-events`; the
    HMAC covers the raw body and `request.json()` must never be called first;
    `verification_completed` for an unknown `tx_id` is dropped because one
    foundry serves both apps; the grace period exists and why it fails forward;
    and that the bank stores without verifying.
  - the **Known-unverifiable** section, with the fact that no wallet, and indeed
    no foundry, has ever produced one of these packages.

---

## Notes for the executor

**Task order matters.** 1 → 2 → 3 → 4 → 5 → 6 on the merchant, then 7 → 8 → 9 →
10 on the bank. Task 6 depends on 4 and 5; Task 7 depends on 6's wire shape;
Task 10 depends on 8 and 9. Tasks 7–9 are independent of each other once 6 has
landed and could run in parallel if you are dispatching subagents.

**Two places will break existing tests, and both are correct.** Task 6 stops the
first poll from debiting, so every settle test that assumed an immediate debit
must be updated. Task 8 adds `hasProof` to `TransactionDto`, so every whole-object
assertion on that DTO must gain it. In both cases fix the fixture, never loosen
the assertion.

**The one thing no test covers** is the dialog itself. `.tsx` is outside every
vitest project's `include`, and this feature's whole visible surface is a button
and a modal. Task 10's Step 5 is not optional.
