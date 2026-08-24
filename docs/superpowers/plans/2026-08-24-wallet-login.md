# EUDI-Wallet Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a customer authenticate to the bank's online banking by presenting a `sparkassen_auth` credential from a wallet, as an alternative to typing a password.

**Architecture:** The bank becomes a verifier for the first time. A new `login_sessions` table mirrors the merchant's `payment_sessions`: a row is written before foundry is called, a browser poll drives `pending → verified`, and a separate `POST …/claim` exchanges a verified session for a `bank_session` cookie exactly once. The gate that resolves a presentation to a user is keyed by DCQL query id, never by claim name.

**Tech Stack:** Next.js 15 (App Router, `src/` layout), drizzle-orm + better-sqlite3, zod, jose, vitest (`environment: "node"`), `@demo/foundry-client`, `@demo/ui`.

**Spec:** `docs/superpowers/specs/2026-08-24-wallet-login-design.md` — read it before Task 1. The plan argues from the spec and does not restate its reasoning.

## Global Constraints

Copied verbatim from the spec and the repo's standing rules. **Every task's requirements implicitly include this section.**

- **Package manager is `pnpm`, never `npm`.** Run everything from the repo root unless a step says otherwise.
- **The gate is `pnpm check`** (`typecheck && test` across all four projects). Baseline before this work: **591 tests** (368 bank + 181 merchant + 11 foundry-client + 31 ui). **Do not project a new total — measure it.**
- **TDD, strictly.** Write the failing test, run it, confirm it fails *for the right reason*, then implement. A test that fails because of a typo has not been confirmed.
- **Local imports are written `./foo.js` for a `./foo.ts` file.** This is correct Node ESM form and is required so vitest and tsc agree.
- **TypeScript is strict with `noUnusedLocals` and `noUnusedParameters`.** An intentionally-unused parameter must be prefixed `_`.
- **vitest is `environment: "node"` with `include: ["src/**/*.test.ts"]`.** No jsdom, and `.tsx` is never matched. **Every decision must live in a `.ts` file**; `.tsx` files render and nothing else.
- **All decisions keyed by DCQL query id, never by claim name.** `sub` is a claim name that `sparkassencard` and `wero` also carry.
- **No new environment variables.** Adding one would also require editing the Dockerfile's build-stage `ENV` block.
- **No hardcoded URLs or secrets.**
- **`credential_type_id` and every other `text` enum has no CHECK constraint.** The drizzle `enum:` is a TypeScript claim about the data, not a database one.
- **Read `drizzle-kit generate`'s output before committing it.** It emitted an unrunnable `0001`.
- **Commits use conventional prefixes** (`feat(bank):`, `fix:`, `chore:`, `docs:`) and state what was *verified*, plainly stating what was not.
- **Proper nouns are hardcoded in components, never catalogued:** `Sparkasse`, `Musterstadt`, `IBAN`, `Wero`, `EUDI Wallet`, `Sparkassen Authenticator`. `IDENTICAL_BY_DESIGN` in `messages.ts` is empty and **must stay empty** — `messages.test.ts` forbids a catalog leaf that is byte-identical across the two locales.
- **Exact copy, fixed by the spec:** en `Login with EUDI-Wallet`, de `Mit EUDI-Wallet anmelden`.
- **TTL is 5 minutes.** `LOGIN_SESSION_TTL_MS = 5 * 60 * 1000`.
- **Session id shape is `login_${randomUUID()}`.**
- **Indentation:** match the surrounding file. `src/db/schema.ts`, `src/lib/queries.ts` and `src/lib/credential-types.ts` use **tabs**; everything else in `src/lib` and `src/components` uses **2 spaces**.

## File Structure

**Created:**

| Path | Responsibility |
| --- | --- |
| `apps/bank/src/lib/login-checks.ts` | Pure gate: find the authenticator credential by query id, extract `sub`. |
| `apps/bank/src/lib/login-checks.test.ts` | Its tests. |
| `apps/bank/src/lib/login-sessions.ts` | Session lifecycle: start, status, refresh, claim. |
| `apps/bank/src/lib/login-sessions.test.ts` | Its tests. |
| `apps/bank/src/lib/transport.ts` | `selectTransport` — which OpenID4VP transport to ask for. |
| `apps/bank/src/lib/transport.test.ts` | Its tests. |
| `apps/bank/src/lib/dc-api-relay.ts` | Relays a browser DC API response to foundry's admin endpoint. |
| `apps/bank/src/lib/dc-api-relay.test.ts` | Its tests. |
| `apps/bank/src/lib/login-dialog-state.ts` | The dialog's rendering decisions, extracted so vitest covers them. |
| `apps/bank/src/lib/login-dialog-state.test.ts` | Its tests. |
| `apps/bank/src/app/api/auth/wallet-login/route.ts` | `POST` — create a login session. |
| `apps/bank/src/app/api/auth/wallet-login/[id]/route.ts` | `GET` — poll. |
| `apps/bank/src/app/api/auth/wallet-login/[id]/claim/route.ts` | `POST` — mint the cookie, once. |
| `apps/bank/src/app/api/auth/wallet-login/[id]/dc-api-response/route.ts` | `POST` — relay. |
| `apps/bank/src/components/WalletLoginButton.tsx` | The button on `/login`. |
| `apps/bank/src/components/WalletLoginDialog.tsx` | The modal. |
| `apps/bank/drizzle/0002_*.sql` | Generated migration for `login_sessions`. |

**Modified:**

| Path | Change |
| --- | --- |
| `apps/bank/src/db/schema.ts` | Add `loginSessions` table + exported types. |
| `apps/bank/src/db/schema.test.ts` | Assert the new table's shape and defaults. |
| `apps/bank/src/lib/credential-types.ts` | Add `SPARKASSEN_AUTH_NAMED_QUERY` and `SPARKASSEN_AUTH_QUERY_ID`. |
| `apps/bank/src/lib/credential-types.test.ts` | Assert both, and that they are separate constants. |
| `apps/bank/src/lib/authenticator-issuance.ts` | Persist the minted `sub` into `credentials.credential_id`. |
| `apps/bank/src/lib/authenticator-issuance.test.ts` | Assert it is persisted and still sent. |
| `apps/bank/src/lib/i18n/messages.ts` | Widen the `Messages` interface. |
| `apps/bank/src/lib/i18n/en.ts`, `de.ts` | The new copy. |
| `apps/bank/src/app/login/page.tsx` | Render `WalletLoginButton`. |
| `AGENTS.md`, `apps/bank/AGENTS.md` | Corrections required by spec §4.3 and §2.2. |

---

### Task 1: `login_sessions` schema and migration

**Files:**

- Modify: `apps/bank/src/db/schema.ts`
- Modify: `apps/bank/src/db/schema.test.ts`
- Create: `apps/bank/drizzle/0002_*.sql` (name generated by drizzle-kit)

**Interfaces:**

- Consumes: nothing.
- Produces: `loginSessions` table object; `export type LoginSession = typeof loginSessions.$inferSelect;` and `export type LoginSessionState = LoginSession["state"];` — every later task imports these from `../db/schema.js`.

- [ ] **Step 1: Write the failing test**

Append to `apps/bank/src/db/schema.test.ts`. Add `loginSessions` to the existing import from `./schema.js`.

```ts
describe("login_sessions", () => {
  it("defaults a new row to pending / request_uri with no user", () => {
    db.insert(loginSessions)
      .values({ id: "login_1", createdAt: 1000 })
      .run();

    const row = db.select().from(loginSessions).get();
    expect(row?.state).toBe("pending");
    expect(row?.transport).toBe("request_uri");
    expect(row?.userId).toBeNull();
    expect(row?.foundryVerificationId).toBeNull();
    expect(row?.failureReason).toBeNull();
  });

  it("stores a resolved user and the dc_api transport", () => {
    seed(db);
    db.insert(loginSessions)
      .values({
        id: "login_2",
        state: "verified",
        transport: "dc_api",
        userId: "user_anna",
        dcApiRequestJson: '{"a":1}',
        createdAt: 2000,
      })
      .run();

    const row = db.select().from(loginSessions).get();
    expect(row?.state).toBe("verified");
    expect(row?.transport).toBe("dc_api");
    expect(row?.userId).toBe("user_anna");
    expect(row?.dcApiRequestJson).toBe('{"a":1}');
  });

  it("refuses a user_id that names no user", () => {
    expect(() =>
      db
        .insert(loginSessions)
        .values({ id: "login_3", userId: "nobody", createdAt: 3000 })
        .run(),
    ).toThrow();
  });
});
```

> If `user_anna` is not the seeded user id, read `apps/bank/src/db/seed.ts` and use the real one. Do not invent it.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/bank && pnpm exec vitest run src/db/schema.test.ts
```

Expected: FAIL — `loginSessions` is not an export of `./schema.js`.

- [ ] **Step 3: Add the table to `apps/bank/src/db/schema.ts`**

Append after the `transactions` table, before the `export type` block. **Tabs, matching the file.**

```ts
/**
 * One row per wallet-login attempt.
 *
 * `state` is a superset of foundry's own verification state, for the reason
 * the merchant's `payment_sessions` is: foundry knows pending/verified/failed
 * and cannot know WHOSE login this resolved to, nor whether a cookie has
 * already been minted from it.
 *
 * `consumed` is a distinct state from `verified` rather than a boolean beside
 * it, exactly as the merchant splits `verified` from `settling`: collapsing
 * them makes "the credential checked out" indistinguishable from "someone
 * already got a session out of this", and that distinction is the whole of
 * what makes a login session single-use.
 *
 * There is no `expired` state. Expiry is a FAILURE REASON on `failed`,
 * computed from `created_at` at read time — nothing in this project runs a
 * background sweep, so a fifth state would be one nothing could ever write.
 */
export const loginSessions = sqliteTable("login_sessions", {
 id: text("id").primaryKey(),
 foundryVerificationId: text("foundry_verification_id"),
 state: text("state", {
  enum: ["pending", "verified", "consumed", "failed"],
 })
  .notNull()
  .default("pending"),
 openid4vpUri: text("openid4vp_uri"),
 requestUri: text("request_uri"),
 /**
  * Recorded rather than inferred: `openid4vp_uri IS NULL` is ambiguous
  * between a dc_api session and a foundry failure.
  */
 transport: text("transport", { enum: ["request_uri", "dc_api"] })
  .notNull()
  .default("request_uri"),
 /** foundry's inline unsigned request object, verbatim. Only for dc_api. */
 dcApiRequestJson: text("dc_api_request_json"),
 /**
  * Resolved by the gate when the state becomes `verified`; NULL before.
  * `displayName` is deliberately NOT stored beside it — the claim re-reads
  * it from `users`, so a name edited mid-flow cannot be served stale.
  */
 userId: text("user_id").references(() => users.id),
 failureReason: text("failure_reason"),
 createdAt: integer("created_at").notNull(),
});
```

And extend the type exports at the bottom of the file:

```ts
export type LoginSession = typeof loginSessions.$inferSelect;
export type LoginSessionState = LoginSession["state"];
```

- [ ] **Step 4: Generate the migration and READ IT**

```bash
cd apps/bank && pnpm exec drizzle-kit generate
cat drizzle/0002_*.sql
```

Expected: a single `CREATE TABLE login_sessions (…)` with a foreign key to `users`. **There must be no `INSERT … SELECT` and no `DROP TABLE`** — this is a new table, not a rebuild. If drizzle-kit emitted a rebuild of any existing table, stop and report it; do not hand-edit past it silently.

- [ ] **Step 5: Run test to verify it passes**

```bash
cd apps/bank && pnpm exec vitest run src/db/schema.test.ts
```

Expected: PASS, including the three new tests.

- [ ] **Step 6: Commit**

```bash
git add apps/bank/src/db/schema.ts apps/bank/src/db/schema.test.ts apps/bank/drizzle/
git commit -m "feat(bank): add login_sessions table

A wallet-login attempt needs state foundry cannot hold: whose login it
resolved to, and whether a cookie has already been minted from it.

Verified: the generated 0002 is a plain CREATE TABLE with no table
rebuild, so it does not repeat 0001's unrunnable INSERT ... SELECT."
```

---

### Task 2: Persist the authenticator `sub`

**Files:**

- Modify: `apps/bank/src/lib/authenticator-issuance.ts`
- Modify: `apps/bank/src/lib/authenticator-issuance.test.ts`

**Interfaces:**

- Consumes: nothing from Task 1.
- Produces: the invariant every later task depends on — after a successful `startAuthenticatorIssuance`, the row's `credentialId` equals the `sub` sent to foundry.

- [ ] **Step 1: Write the failing test**

Append to `apps/bank/src/lib/authenticator-issuance.test.ts`, inside the existing top-level `describe` (or as a new one).

```ts
describe("persisting the subject", () => {
  it("stores the sub it sent, so a presentation can be resolved to a user", async () => {
    const captures: Capture[] = [];
    const client = stubClient(captures, OFFER_OK);

    const result = await startAuthenticatorIssuance(db, client, "user_anna");
    expect(result.ok).toBe(true);

    const row = db
      .select()
      .from(credentials)
      .where(eq(credentials.credentialTypeId, SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID))
      .get();

    const sent = (captures[0]?.body["claims"] as Record<string, unknown>)["sub"];
    expect(typeof sent).toBe("string");
    expect(row?.credentialId).toBe(sent);
  });

  it("mints a different sub per issuance, so two are not correlatable", async () => {
    const captures: Capture[] = [];
    const client = stubClient(captures, OFFER_OK);

    await startAuthenticatorIssuance(db, client, "user_anna");
    await startAuthenticatorIssuance(db, client, "user_anna");

    const rows = db
      .select()
      .from(credentials)
      .where(eq(credentials.credentialTypeId, SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID))
      .all();

    expect(rows).toHaveLength(2);
    expect(rows[0]?.credentialId).not.toBe(rows[1]?.credentialId);
    expect(rows[0]?.credentialId).not.toBeNull();
  });
});
```

> `OFFER_OK` and `stubClient` already exist in this file. If the stub replies with one fixed `transaction_id`, two issuances are still fine — the rows differ by `id` and by `sub`.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/bank && pnpm exec vitest run src/lib/authenticator-issuance.test.ts
```

Expected: FAIL on the first new test with `expected null to be '<uuid>'` — the row's `credentialId` is `null` because nothing writes it.

- [ ] **Step 3: Persist it**

In `apps/bank/src/lib/authenticator-issuance.ts`, the `sub` is currently minted inline where the claims are built. Hoist it above the insert and write it to the row:

```ts
  const rowId = `cred_${randomUUID()}`;
  // Minted here rather than at claim-building time because the row must carry
  // it: a presentation discloses this value and nothing else that identifies
  // the holder, so it is the ONLY way back from a vp_token to a customer.
  const subject = randomUUID();

  db.insert(credentials)
    .values({
      id: rowId,
      userId,
      cardId: null,
      credentialTypeId: SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID,
      credentialId: subject,
      foundryTxId: null,
      // ...the rest of the existing values, unchanged
    })
    .run();
```

and use `subject` in the claims sent to foundry, replacing the inline `randomUUID()`:

```ts
      claims: { sub: subject },
```

Then **replace the doc-comment paragraph** that begins "The claim set is ONE claim: a `sub` UUID, minted here, sent, and never persisted." with:

```
 * The claim set is ONE claim: a `sub` UUID, minted here, sent, AND PERSISTED
 * to this row's `credential_id`.
 *
 * It was deliberately not persisted until wallet login existed. Persisting it
 * is what lets a presentation resolve back to a customer, which is exactly
 * what logging in requires. The privacy property that choice protected
 * survives: the value is still fresh per issuance, so two of these credentials
 * still cannot be correlated to each other by anyone. What changes is that the
 * BANK can now link a presentation to the customer it issued to.
 *
 * Consequence, permanent and unfixable: any credential issued BEFORE this
 * change has an unrecoverable `sub` and cannot be used to log in. There is no
 * backfill, because the value was never stored.
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/bank && pnpm exec vitest run src/lib/authenticator-issuance.test.ts
```

Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add apps/bank/src/lib/authenticator-issuance.ts apps/bank/src/lib/authenticator-issuance.test.ts
git commit -m "feat(bank): persist the authenticator sub

A sparkassen_auth presentation discloses only \`sub\`, so without storing
it a verified presentation proves the holder has a credential this bank
issued and cannot say which customer. Login needs exactly that link.

Still per-issuance random, so two credentials remain uncorrelatable to
each other. NOT verified against a wallet: no device here."
```

---

### Task 3: Query-id constants and the gate

**Files:**

- Modify: `apps/bank/src/lib/credential-types.ts`
- Modify: `apps/bank/src/lib/credential-types.test.ts`
- Create: `apps/bank/src/lib/login-checks.ts`
- Create: `apps/bank/src/lib/login-checks.test.ts`

**Interfaces:**

- Consumes: `SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID` (already exists).
- Produces:
  - `export const SPARKASSEN_AUTH_NAMED_QUERY: "sparkassen_auth"`
  - `export const SPARKASSEN_AUTH_QUERY_ID: "sparkassen_auth"`
  - `export function findAuthenticatorCredential(credentials: PresentedCredential[] | undefined): PresentedCredential | null`
  - `export function extractAuthSubject(credentials: PresentedCredential[] | undefined): string | null`

- [ ] **Step 1: Write the failing tests**

Append to `apps/bank/src/lib/credential-types.test.ts`:

```ts
describe("sparkassen_auth query identifiers", () => {
  it("names the foundry named query", () => {
    expect(SPARKASSEN_AUTH_NAMED_QUERY).toBe("sparkassen_auth");
  });

  it("names the DCQL credential query id", () => {
    expect(SPARKASSEN_AUTH_QUERY_ID).toBe("sparkassen_auth");
  });

  it("keeps the named query and the DCQL query id as separate constants", () => {
    // They agree in the deployed config; nothing forces them to. Two
    // registries, two constants, so renaming either cannot silently
    // mis-key the other.
    expect(SPARKASSEN_AUTH_NAMED_QUERY).not.toBe(SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID + "!");
    expect(typeof SPARKASSEN_AUTH_QUERY_ID).toBe("string");
  });
});
```

Create `apps/bank/src/lib/login-checks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { PresentedCredential } from "@demo/foundry-client";
import { extractAuthSubject, findAuthenticatorCredential } from "./login-checks.js";

function credential(
  queryId: string,
  claims: unknown,
): PresentedCredential {
  return { query_id: queryId, format: "dc+sd-jwt", claims, checks: [] };
}

describe("findAuthenticatorCredential", () => {
  it("returns null for undefined", () => {
    expect(findAuthenticatorCredential(undefined)).toBeNull();
  });

  it("returns null for an empty array", () => {
    expect(findAuthenticatorCredential([])).toBeNull();
  });

  it("finds the credential whose query_id is sparkassen_auth", () => {
    const target = credential("sparkassen_auth", { sub: "s1" });
    expect(findAuthenticatorCredential([target])).toBe(target);
  });

  it("ignores a credential that merely carries a sub claim", () => {
    // sparkassencard and wero both declare `sub`. Keying on the claim name
    // rather than the query id would let a payment credential authenticate.
    expect(
      findAuthenticatorCredential([credential("sparkassencard", { sub: "s1" })]),
    ).toBeNull();
    expect(
      findAuthenticatorCredential([credential("wero", { sub: "s1" })]),
    ).toBeNull();
  });

  it("picks the authenticator out of a mixed verdict", () => {
    const target = credential("sparkassen_auth", { sub: "right" });
    const found = findAuthenticatorCredential([
      credential("wero", { sub: "wrong" }),
      target,
      credential("av_sdjwt", { age_over_18: true }),
    ]);
    expect(found).toBe(target);
  });
});

describe("extractAuthSubject", () => {
  it("returns the sub of the authenticator credential", () => {
    expect(
      extractAuthSubject([credential("sparkassen_auth", { sub: "abc" })]),
    ).toBe("abc");
  });

  it("returns null when no authenticator credential answered", () => {
    expect(extractAuthSubject([credential("wero", { sub: "abc" })])).toBeNull();
  });

  it("returns null for a missing sub", () => {
    expect(extractAuthSubject([credential("sparkassen_auth", {})])).toBeNull();
  });

  it("returns null for an empty sub", () => {
    expect(
      extractAuthSubject([credential("sparkassen_auth", { sub: "" })]),
    ).toBeNull();
  });

  it("returns null for a non-string sub", () => {
    expect(
      extractAuthSubject([credential("sparkassen_auth", { sub: 42 })]),
    ).toBeNull();
  });

  it("returns null when claims is not an object", () => {
    expect(extractAuthSubject([credential("sparkassen_auth", null)])).toBeNull();
    expect(
      extractAuthSubject([credential("sparkassen_auth", "nope")]),
    ).toBeNull();
  });

  it("never reads a sub from a neighbouring payment credential", () => {
    expect(
      extractAuthSubject([
        credential("sparkassencard", { sub: "payment-subject" }),
        credential("sparkassen_auth", {}),
      ]),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/bank && pnpm exec vitest run src/lib/login-checks.test.ts src/lib/credential-types.test.ts
```

Expected: FAIL — `login-checks.js` does not exist; `SPARKASSEN_AUTH_NAMED_QUERY` is not exported.

- [ ] **Step 3: Add the constants**

Append to `apps/bank/src/lib/credential-types.ts` (**tabs**), after `SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID`:

```ts
/**
 * The foundry NAMED QUERY the bank presents when authenticating a customer.
 *
 * Deliberately a separate constant from `SPARKASSEN_AUTH_QUERY_ID` below, even
 * though the deployed config spells both the same. A named query lives in
 * foundry's `named_queries` registry; a DCQL credential query id lives inside
 * that query's own `dcql.credentials[]`. Nothing makes them agree — the
 * merchant's `payment` query answers `dpc`, `sparkassencard` and `wero`, none
 * of which is its own name — so one constant serving both roles would make a
 * rename of either silently mis-key the other.
 */
export const SPARKASSEN_AUTH_NAMED_QUERY = "sparkassen_auth";

/**
 * The DCQL credential query id inside that named query — the value
 * `PresentedCredential.query_id` carries for an authenticator presentation.
 *
 * Every read of a login verdict is keyed by THIS, never by the presence of a
 * `sub` claim: `sparkassencard` and `wero` both declare `sub`, and a
 * claim-name collision must never decide who gets logged in.
 */
export const SPARKASSEN_AUTH_QUERY_ID = "sparkassen_auth";
```

- [ ] **Step 4: Write the gate**

Create `apps/bank/src/lib/login-checks.ts` (**2 spaces**):

```ts
import type { PresentedCredential } from "@demo/foundry-client";
import { SPARKASSEN_AUTH_QUERY_ID } from "./credential-types.js";

/**
 * The pure half of the login gate. A sibling of the merchant's `checks.ts` and
 * held to the same rule: everything is keyed by DCQL query id.
 *
 * Separated from `login-sessions.ts` so it is testable without a database and
 * without a foundry stub — every vitest project here is `environment: "node"`
 * with `include: ["src/**\/*.test.ts"]`, and a decision buried in an I/O
 * function is a decision with no test of its own.
 */

/**
 * The presented credential that answered the authenticator query, or null.
 *
 * A `find` on `query_id`, never `credentials[0]` and never "whichever one has
 * a `sub`". Today the query requests exactly one credential, so a laxer rule
 * would be observationally identical — it exists so that widening the query
 * later cannot silently promote a payment credential's `sub` into an
 * authentication subject.
 */
export function findAuthenticatorCredential(
  credentials: PresentedCredential[] | undefined,
): PresentedCredential | null {
  if (!credentials) return null;
  return (
    credentials.find(
      (credential) => credential.query_id === SPARKASSEN_AUTH_QUERY_ID,
    ) ?? null
  );
}

/**
 * The `sub` the authenticator credential disclosed, or null.
 *
 * Fails closed at every step: no credential, non-object claims, a missing
 * `sub`, an empty `sub` and a non-string `sub` all return null, and the caller
 * turns null into a failed login. The deployed foundry declares `sub` as
 * `required: true` with `selectively_disclosable: false`, so a verified
 * verdict should always carry one — but no wallet has ever been observed
 * answering this query, so the shape is enforced rather than trusted.
 */
export function extractAuthSubject(
  credentials: PresentedCredential[] | undefined,
): string | null {
  const credential = findAuthenticatorCredential(credentials);
  if (!credential) return null;

  const claims = credential.claims;
  if (typeof claims !== "object" || claims === null) return null;

  const subject = (claims as Record<string, unknown>)["sub"];
  return typeof subject === "string" && subject.length > 0 ? subject : null;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd apps/bank && pnpm exec vitest run src/lib/login-checks.test.ts src/lib/credential-types.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/bank/src/lib/login-checks.ts apps/bank/src/lib/login-checks.test.ts apps/bank/src/lib/credential-types.ts apps/bank/src/lib/credential-types.test.ts
git commit -m "feat(bank): add the wallet-login gate

Keyed by DCQL query id, never by claim name: sparkassencard and wero
both declare \`sub\`, so a claim-name match could let a payment
credential authenticate a customer.

Fails closed on every malformed shape. No wallet has been observed
answering this query, so the claim shape is enforced, not trusted."
```

---

### Task 4: `startLoginSession`

**Files:**

- Create: `apps/bank/src/lib/login-sessions.ts`
- Create: `apps/bank/src/lib/login-sessions.test.ts`

**Interfaces:**

- Consumes: `loginSessions` (Task 1), `SPARKASSEN_AUTH_NAMED_QUERY` (Task 3).
- Produces:
  - `export const LOGIN_SESSION_TTL_MS = 5 * 60 * 1000;`
  - `export type StartLoginSessionResult = { ok: true; sessionId: string; uri: string | null; transport: "request_uri" | "dc_api"; dcApiRequest: unknown; state: "pending" } | { ok: false; reason: "foundry_unavailable" }`
  - `export async function startLoginSession(db: Db, client: FoundryClient, useDcApi: boolean, now?: number): Promise<StartLoginSessionResult>`
  - `export interface LoginSessionStatusDto { state: LoginSessionState; failureReason?: string }`
  - `export function getLoginSessionStatus(db: Db, sessionId: string): LoginSessionStatusDto | null`

- [ ] **Step 1: Write the failing test**

Create `apps/bank/src/lib/login-sessions.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FoundryClient } from "@demo/foundry-client";
import { createDb, type Db } from "../db/index.js";
import { loginSessions } from "../db/schema.js";
import { seed } from "../db/seed.js";
import {
  getLoginSessionStatus,
  startLoginSession,
} from "./login-sessions.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bank-login-"));
  db = createDb(path.join(dir, "test.db"));
  seed(db);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface Capture {
  url: string;
  body: Record<string, unknown>;
}

function stubClient(
  captures: Capture[],
  reply: { status: number; body: unknown },
): FoundryClient {
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    captures.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  return new FoundryClient({
    adminUrl: "http://f:9000",
    adminKey: "k",
    fetchImpl,
  });
}

const REQUEST_URI_OK = {
  status: 200,
  body: {
    verification_id: "v_login_1",
    openid4vp_uri: "openid4vp://?request_uri=https%3A%2F%2Ff%2Freq%2F1",
    request_uri: "https://f/req/1",
  },
};

const DC_API_OK = {
  status: 200,
  body: {
    verification_id: "v_login_2",
    openid4vp_uri: null,
    request_uri: null,
    dc_api_request: { response_mode: "dc_api.jwt", nonce: "n" },
  },
};

describe("startLoginSession", () => {
  it("asks foundry for the sparkassen_auth named query", async () => {
    const captures: Capture[] = [];
    await startLoginSession(db, stubClient(captures, REQUEST_URI_OK), false);

    expect(captures[0]?.url).toBe(
      "http://f:9000/admin/verification/requests",
    );
    expect(captures[0]?.body["named_query_ref"]).toBe("sparkassen_auth");
    expect(captures[0]?.body["transport"]).toBe("request_uri");
  });

  it("sends no transaction_data — a login binds no amount", () => {
    // transaction_data binds an amount to a presentation. There is no amount
    // in a login, so sending one would hash a value that means nothing.
    const captures: Capture[] = [];
    return startLoginSession(db, stubClient(captures, REQUEST_URI_OK), false).then(
      () => {
        expect(captures[0]?.body).not.toHaveProperty("transaction_data");
      },
    );
  });

  it("sends no dcql_query alongside the named query", async () => {
    // foundry prefers an inline query and would silently ignore the named one.
    const captures: Capture[] = [];
    await startLoginSession(db, stubClient(captures, REQUEST_URI_OK), false);
    expect(captures[0]?.body).not.toHaveProperty("dcql_query");
  });

  it("returns the openid4vp uri under request_uri", async () => {
    const result = await startLoginSession(db, stubClient([], REQUEST_URI_OK), false);
    expect(result).toMatchObject({
      ok: true,
      transport: "request_uri",
      state: "pending",
      uri: "openid4vp://?request_uri=https%3A%2F%2Ff%2Freq%2F1",
      dcApiRequest: null,
    });
  });

  it("mints a login_-prefixed session id", async () => {
    const result = await startLoginSession(db, stubClient([], REQUEST_URI_OK), false);
    expect(result.ok && result.sessionId.startsWith("login_")).toBe(true);
  });

  it("returns the inline request object under dc_api and no uri", async () => {
    const captures: Capture[] = [];
    const result = await startLoginSession(db, stubClient(captures, DC_API_OK), true);

    expect(captures[0]?.body["transport"]).toBe("dc_api");
    expect(result).toMatchObject({
      ok: true,
      transport: "dc_api",
      uri: null,
      dcApiRequest: { response_mode: "dc_api.jwt", nonce: "n" },
    });
  });

  it("persists foundry's ids and the transport", async () => {
    const result = await startLoginSession(db, stubClient([], REQUEST_URI_OK), false);
    const row = db.select().from(loginSessions).get();

    expect(result.ok && row?.id).toBe(result.ok ? result.sessionId : null);
    expect(row?.foundryVerificationId).toBe("v_login_1");
    expect(row?.requestUri).toBe("https://f/req/1");
    expect(row?.transport).toBe("request_uri");
    expect(row?.state).toBe("pending");
    expect(row?.userId).toBeNull();
  });

  it("stores the inline request object as JSON under dc_api", async () => {
    await startLoginSession(db, stubClient([], DC_API_OK), true);
    const row = db.select().from(loginSessions).get();
    expect(JSON.parse(row?.dcApiRequestJson ?? "null")).toEqual({
      response_mode: "dc_api.jwt",
      nonce: "n",
    });
  });

  it("leaves a visible failed row when foundry refuses", async () => {
    const result = await startLoginSession(
      db,
      stubClient([], { status: 500, body: { error: "unknown named query" } }),
      false,
    );

    expect(result).toEqual({ ok: false, reason: "foundry_unavailable" });
    const row = db.select().from(loginSessions).get();
    expect(row?.state).toBe("failed");
    expect(row?.failureReason).toBe("foundry_unavailable");
  });

  it("records the requested transport even on a failed row", async () => {
    await startLoginSession(db, stubClient([], { status: 500, body: {} }), true);
    expect(db.select().from(loginSessions).get()?.transport).toBe("dc_api");
  });
});

describe("getLoginSessionStatus", () => {
  it("returns null for an unknown id", () => {
    expect(getLoginSessionStatus(db, "login_nope")).toBeNull();
  });

  it("returns the state with no failureReason when there is none", async () => {
    const result = await startLoginSession(db, stubClient([], REQUEST_URI_OK), false);
    const status = getLoginSessionStatus(db, result.ok ? result.sessionId : "");
    expect(status).toEqual({ state: "pending" });
  });

  it("returns the failure reason when the row carries one", async () => {
    await startLoginSession(db, stubClient([], { status: 500, body: {} }), false);
    const row = db.select().from(loginSessions).get();
    expect(getLoginSessionStatus(db, row?.id ?? "")).toEqual({
      state: "failed",
      failureReason: "foundry_unavailable",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/bank && pnpm exec vitest run src/lib/login-sessions.test.ts
```

Expected: FAIL — `./login-sessions.js` does not exist.

- [ ] **Step 3: Write the module**

Create `apps/bank/src/lib/login-sessions.ts` (**2 spaces**):

```ts
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FoundryClient } from "@demo/foundry-client";
import type { Db } from "../db/index.js";
import { loginSessions, type LoginSessionState } from "../db/schema.js";
import { SPARKASSEN_AUTH_NAMED_QUERY } from "./credential-types.js";

/**
 * How long a login session may be claimed for.
 *
 * Short on purpose: every route that touches a login session is necessarily
 * unauthenticated, so the session id is a bearer token — whoever holds a
 * verified one can take the cookie. Five minutes is long enough for a human to
 * find their phone and short enough that a leaked id is usually already dead.
 */
export const LOGIN_SESSION_TTL_MS = 5 * 60 * 1000;

export type StartLoginSessionResult =
  | {
      ok: true;
      sessionId: string;
      /** Null under dc_api — foundry inlines the request object instead. */
      uri: string | null;
      transport: "request_uri" | "dc_api";
      /** foundry's inline unsigned request object. Null under request_uri. */
      dcApiRequest: unknown;
      state: "pending";
    }
  | { ok: false; reason: "foundry_unavailable" };

export interface LoginSessionStatusDto {
  state: LoginSessionState;
  failureReason?: string;
}

/**
 * Opens a wallet-login presentation.
 *
 * The row is written BEFORE foundry is called, so a refused request leaves a
 * visible `failed` row rather than nothing at all — the property
 * `startIssuance` and the merchant's `startPaymentSession` both rely on. That
 * matters more here than usual: no local foundry declares the
 * `sparkassen_auth` named query, so a local run takes this path every time.
 *
 * Sends `named_query_ref` and nothing else. No `dcql_query`, because foundry
 * prefers an inline query and would silently ignore the named one; and no
 * `transaction_data`, because that binds an AMOUNT to a presentation and a
 * login has none.
 */
export async function startLoginSession(
  db: Db,
  client: FoundryClient,
  useDcApi: boolean,
  now: number = Date.now(),
): Promise<StartLoginSessionResult> {
  const sessionId = `login_${randomUUID()}`;
  const transport = useDcApi ? "dc_api" : "request_uri";

  db.insert(loginSessions)
    .values({ id: sessionId, state: "pending", transport, createdAt: now })
    .run();

  try {
    const response = await client.createVerificationRequest({
      transport,
      named_query_ref: SPARKASSEN_AUTH_NAMED_QUERY,
    });

    // Under dc_api foundry returns neither uri — the request object is inlined
    // and unsigned because response_mode is dc_api.jwt.
    const uri = response.openid4vp_uri ?? response.request_uri ?? null;
    const dcApiRequest = response.dc_api_request ?? null;

    db.update(loginSessions)
      .set({
        foundryVerificationId: response.verification_id,
        openid4vpUri: response.openid4vp_uri ?? null,
        requestUri: response.request_uri ?? null,
        dcApiRequestJson:
          dcApiRequest === null ? null : JSON.stringify(dcApiRequest),
      })
      .where(eq(loginSessions.id, sessionId))
      .run();

    return {
      ok: true,
      sessionId,
      uri,
      transport,
      dcApiRequest,
      state: "pending",
    };
  } catch {
    failLogin(db, sessionId, "foundry_unavailable");
    return { ok: false, reason: "foundry_unavailable" };
  }
}

/** A plain lookup. No foundry traffic — `refreshLoginSessionState` does that. */
export function getLoginSessionStatus(
  db: Db,
  sessionId: string,
): LoginSessionStatusDto | null {
  const row = db
    .select()
    .from(loginSessions)
    .where(eq(loginSessions.id, sessionId))
    .get();
  if (!row) return null;

  return {
    state: row.state,
    failureReason: row.failureReason ?? undefined,
  };
}

/** Terminal-with-a-reason. `expired` is a reason here, never a state. */
function failLogin(db: Db, sessionId: string, reason: string): void {
  db.update(loginSessions)
    .set({ state: "failed", failureReason: reason })
    .where(eq(loginSessions.id, sessionId))
    .run();
}
```

> `failLogin` is used by Task 5 and Task 6 as well. It stays private to this module.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/bank && pnpm exec vitest run src/lib/login-sessions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/bank/src/lib/login-sessions.ts apps/bank/src/lib/login-sessions.test.ts
git commit -m "feat(bank): open a wallet-login presentation

named_query_ref only: no inline dcql_query (foundry would prefer it and
ignore the named one) and no transaction_data (it binds an amount, and a
login has none).

The row is written before foundry is called, so the local case — where
no foundry declares this named query — leaves a visible failed row."
```

---

### Task 5: `refreshLoginSessionState`

**Files:**

- Modify: `apps/bank/src/lib/login-sessions.ts`
- Modify: `apps/bank/src/lib/login-sessions.test.ts`

**Interfaces:**

- Consumes: `extractAuthSubject` (Task 3), `SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID`, `credentials` table.
- Produces:
  - `export type RefreshLoginResult = { ok: true; status: LoginSessionStatusDto } | { ok: false; reason: "not_found" }`
  - `export async function refreshLoginSessionState(db: Db, foundry: FoundryClient, sessionId: string, now?: number): Promise<RefreshLoginResult>`

- [ ] **Step 1: Write the failing test**

Append to `apps/bank/src/lib/login-sessions.test.ts`. Extend the imports:

```ts
import { credentials } from "../db/schema.js";
import { SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID } from "./credential-types.js";
import {
  LOGIN_SESSION_TTL_MS,
  refreshLoginSessionState,
} from "./login-sessions.js";
```

Then append:

```ts
/** A foundry stub whose verification-status GET returns a fixed verdict. */
function verdictClient(verdict: unknown, status = 200): FoundryClient {
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/admin/verification/requests/")) {
      return new Response(JSON.stringify(verdict), {
        status,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(REQUEST_URI_OK.body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  return new FoundryClient({
    adminUrl: "http://f:9000",
    adminKey: "k",
    fetchImpl,
  });
}

function authVerdict(sub: unknown, verified = true) {
  return {
    id: "v_login_1",
    state: verified ? "verified" : "failed",
    created_at: 0,
    result: {
      verified,
      checks: [],
      credentials: [
        {
          query_id: "sparkassen_auth",
          format: "dc+sd-jwt",
          claims: { sub },
          checks: [],
        },
      ],
    },
  };
}

/** Issues an authenticator credential row for `user_anna` carrying `sub`. */
function giveAnnaAuthenticator(sub: string): void {
  db.insert(credentials)
    .values({
      id: `cred_${sub}`,
      userId: "user_anna",
      cardId: null,
      credentialTypeId: SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID,
      credentialId: sub,
      foundryTxId: null,
      state: "active",
      createdAt: 1,
    })
    .run();
}

/** Starts a session and returns its id, with foundry answering happily. */
async function openSession(): Promise<string> {
  const result = await startLoginSession(db, stubClient([], REQUEST_URI_OK), false);
  if (!result.ok) throw new Error("fixture failed to open a session");
  return result.sessionId;
}

describe("refreshLoginSessionState", () => {
  it("reports not_found for an unknown id", async () => {
    const result = await refreshLoginSessionState(
      db,
      verdictClient(authVerdict("s")),
      "login_nope",
    );
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("stays pending while foundry has no verdict", async () => {
    const id = await openSession();
    const result = await refreshLoginSessionState(
      db,
      verdictClient({ id: "v_login_1", state: "pending", created_at: 0 }),
      id,
    );
    expect(result).toMatchObject({ ok: true, status: { state: "pending" } });
  });

  it("stays pending when foundry is unreachable, so a later poll recovers", async () => {
    const id = await openSession();
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const client = new FoundryClient({
      adminUrl: "http://f:9000",
      adminKey: "k",
      fetchImpl,
    });

    const result = await refreshLoginSessionState(db, client, id);
    expect(result).toMatchObject({ ok: true, status: { state: "pending" } });
  });

  it("resolves a known subject to its user and verifies", async () => {
    giveAnnaAuthenticator("sub-anna");
    const id = await openSession();

    const result = await refreshLoginSessionState(
      db,
      verdictClient(authVerdict("sub-anna")),
      id,
    );

    expect(result).toMatchObject({ ok: true, status: { state: "verified" } });
    const row = db
      .select()
      .from(loginSessions)
      .where(eq(loginSessions.id, id))
      .get();
    expect(row?.userId).toBe("user_anna");
  });

  it("fails with unknown_credential when no row carries that sub", async () => {
    const id = await openSession();

    const result = await refreshLoginSessionState(
      db,
      verdictClient(authVerdict("never-issued")),
      id,
    );

    expect(result).toMatchObject({
      ok: true,
      status: { state: "failed", failureReason: "unknown_credential" },
    });
  });

  it("refuses a sub that belongs to a payment credential", async () => {
    // credential_id is one column carrying the DPC's id, psu_id AND sub. The
    // type predicate is what stops a payment join key authenticating.
    db.insert(credentials)
      .values({
        id: "cred_wero",
        userId: "user_anna",
        cardId: null,
        credentialTypeId: "wero",
        credentialId: "shared-value",
        foundryTxId: null,
        state: "active",
        createdAt: 1,
      })
      .run();

    const id = await openSession();
    const result = await refreshLoginSessionState(
      db,
      verdictClient(authVerdict("shared-value")),
      id,
    );

    expect(result).toMatchObject({
      ok: true,
      status: { state: "failed", failureReason: "unknown_credential" },
    });
  });

  it("logs in against a credential row that never reached active", async () => {
    // Nothing in this project clears an `offered` row, and foundry's verdict
    // is the authority that the credential is real. A stalled status poll must
    // not lock a customer out of a credential demonstrably in their wallet.
    db.insert(credentials)
      .values({
        id: "cred_offered",
        userId: "user_anna",
        cardId: null,
        credentialTypeId: SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID,
        credentialId: "sub-offered",
        foundryTxId: "tx",
        state: "offered",
        createdAt: 1,
      })
      .run();

    const id = await openSession();
    const result = await refreshLoginSessionState(
      db,
      verdictClient(authVerdict("sub-offered")),
      id,
    );

    expect(result).toMatchObject({ ok: true, status: { state: "verified" } });
  });

  it("fails when foundry says the presentation did not verify", async () => {
    giveAnnaAuthenticator("sub-anna");
    const id = await openSession();

    const result = await refreshLoginSessionState(
      db,
      verdictClient(authVerdict("sub-anna", false)),
      id,
    );

    expect(result).toMatchObject({
      ok: true,
      status: { state: "failed", failureReason: "verification_failed" },
    });
  });

  it("fails when the verdict carries no usable sub", async () => {
    const id = await openSession();
    const result = await refreshLoginSessionState(
      db,
      verdictClient(authVerdict(42)),
      id,
    );

    expect(result).toMatchObject({
      ok: true,
      status: { state: "failed", failureReason: "verification_failed" },
    });
  });

  it("fails when only a payment credential answered", async () => {
    const id = await openSession();
    const result = await refreshLoginSessionState(
      db,
      verdictClient({
        id: "v_login_1",
        state: "verified",
        created_at: 0,
        result: {
          verified: true,
          checks: [],
          credentials: [
            {
              query_id: "sparkassencard",
              format: "dc+sd-jwt",
              claims: { sub: "sub-anna" },
              checks: [],
            },
          ],
        },
      }),
      id,
    );

    expect(result).toMatchObject({
      ok: true,
      status: { state: "failed", failureReason: "verification_failed" },
    });
  });

  it("expires a session past its TTL without calling foundry", async () => {
    const id = await openSession();
    const fetchImpl = (async () => {
      throw new Error("foundry must not be called for an expired session");
    }) as unknown as typeof fetch;
    const client = new FoundryClient({
      adminUrl: "http://f:9000",
      adminKey: "k",
      fetchImpl,
    });

    const result = await refreshLoginSessionState(
      db,
      client,
      id,
      Date.now() + LOGIN_SESSION_TTL_MS + 1,
    );

    expect(result).toMatchObject({
      ok: true,
      status: { state: "failed", failureReason: "expired" },
    });
  });

  it("does no further work once the session is terminal", async () => {
    giveAnnaAuthenticator("sub-anna");
    const id = await openSession();
    await refreshLoginSessionState(db, verdictClient(authVerdict("sub-anna")), id);

    // A second poll on a verified session must not re-query foundry.
    const fetchImpl = (async () => {
      throw new Error("foundry must not be called again");
    }) as unknown as typeof fetch;
    const client = new FoundryClient({
      adminUrl: "http://f:9000",
      adminKey: "k",
      fetchImpl,
    });

    const result = await refreshLoginSessionState(db, client, id);
    expect(result).toMatchObject({ ok: true, status: { state: "verified" } });
  });
});
```

> `eq` must be imported from `drizzle-orm` in the test file. Add it if it is not already there.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/bank && pnpm exec vitest run src/lib/login-sessions.test.ts
```

Expected: FAIL — `refreshLoginSessionState` is not exported.

- [ ] **Step 3: Implement it**

Append to `apps/bank/src/lib/login-sessions.ts`, and extend its imports:

```ts
import { and, eq } from "drizzle-orm";
import { credentials, loginSessions, type LoginSessionState } from "../db/schema.js";
import {
  SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID,
  SPARKASSEN_AUTH_NAMED_QUERY,
} from "./credential-types.js";
import { extractAuthSubject } from "./login-checks.js";
```

```ts
export type RefreshLoginResult =
  | { ok: true; status: LoginSessionStatusDto }
  | { ok: false; reason: "not_found" };

/**
 * Polled by the browser roughly every 2s. Drives `pending → verified | failed`
 * and nothing else — minting the cookie is `claimLoginSession`'s job, on a
 * POST, because a GET that mints an authenticated session would be consumed by
 * any prefetch or double-poll.
 *
 * Order matters: terminal first (no traffic), then expiry (no traffic), then
 * already-verified (no traffic), and only then foundry. An abandoned session
 * therefore stops generating admin-API calls the moment its window closes.
 */
export async function refreshLoginSessionState(
  db: Db,
  foundry: FoundryClient,
  sessionId: string,
  now: number = Date.now(),
): Promise<RefreshLoginResult> {
  const row = db
    .select()
    .from(loginSessions)
    .where(eq(loginSessions.id, sessionId))
    .get();
  if (!row) return { ok: false, reason: "not_found" };

  const done = (): RefreshLoginResult => ({
    ok: true,
    status: getLoginSessionStatus(db, sessionId)!,
  });

  // Terminal: nothing left to learn.
  if (row.state === "consumed" || row.state === "failed") return done();

  // Expiry BEFORE the foundry call, so an abandoned tab stops costing traffic.
  // `expired` is a failure reason, not a fifth state.
  if (now - row.createdAt > LOGIN_SESSION_TTL_MS) {
    failLogin(db, sessionId, "expired");
    return done();
  }

  // Verified and waiting to be claimed. Re-polling foundry would tell us
  // nothing we have not already recorded.
  if (row.state === "verified") return done();

  if (!row.foundryVerificationId) {
    failLogin(db, sessionId, "verification_failed");
    return done();
  }

  let verdict;
  try {
    verdict = await foundry.getVerificationStatus(row.foundryVerificationId);
  } catch {
    // Transient. Stay pending so a later poll can recover; only the client's
    // consecutive-failure counter decides when to give up.
    return done();
  }

  if (verdict.state === "pending") return done();

  if (verdict.state === "failed" || verdict.result?.verified !== true) {
    failLogin(db, sessionId, "verification_failed");
    return done();
  }

  const subject = extractAuthSubject(verdict.result.credentials);
  if (!subject) {
    // Either no credential answered the authenticator query, or the one that
    // did disclosed no usable `sub`. Both are the wallet's answer being wrong,
    // not the customer being unknown — hence verification_failed, not
    // unknown_credential.
    failLogin(db, sessionId, "verification_failed");
    return done();
  }

  // The type predicate is redundant against the UNIQUE index on
  // `credential_id` — no psu_id can equal a sub AND both be stored — but it
  // makes the read state its intent instead of relying on that.
  const credential = db
    .select()
    .from(credentials)
    .where(
      and(
        eq(credentials.credentialId, subject),
        eq(credentials.credentialTypeId, SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID),
      ),
    )
    .get();

  if (!credential) {
    // A real, correctly-signed credential this bank cannot match to a
    // customer. Expected for anything issued before the sub was persisted.
    failLogin(db, sessionId, "unknown_credential");
    return done();
  }

  // Deliberately NOT gated on `credential.state === "active"`. foundry's
  // verdict is the authority that the credential is real, holder-bound and
  // unrevoked; this row only answers WHOSE. Nothing here ever clears an
  // `offered` row, so requiring `active` would lock a customer out of a
  // credential demonstrably in their wallet.
  db.update(loginSessions)
    .set({ state: "verified", userId: credential.userId })
    .where(eq(loginSessions.id, sessionId))
    .run();

  return done();
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/bank && pnpm exec vitest run src/lib/login-sessions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/bank/src/lib/login-sessions.ts apps/bank/src/lib/login-sessions.test.ts
git commit -m "feat(bank): resolve a wallet presentation to a customer

Terminal, then expiry, then already-verified, then foundry: an
abandoned session stops costing admin-API traffic when its window shuts.

Deliberately does not require the local credential row to be active.
foundry's verdict is the authority that the credential is real; the row
only answers whose. Nothing clears an offered row, so requiring active
would lock out a credential demonstrably in the wallet."
```

---

### Task 6: `claimLoginSession`

**Files:**

- Modify: `apps/bank/src/lib/login-sessions.ts`
- Modify: `apps/bank/src/lib/login-sessions.test.ts`

**Interfaces:**

- Consumes: `users` table.
- Produces:
  - `export type ClaimLoginResult = { ok: true; userId: string; displayName: string } | { ok: false; reason: "not_found" | "not_verified" | "already_consumed" | "expired" }`
  - `export function claimLoginSession(db: Db, sessionId: string, now?: number): ClaimLoginResult` — **synchronous**, because better-sqlite3 is.

- [ ] **Step 1: Write the failing test**

Append to `apps/bank/src/lib/login-sessions.test.ts`, extending the import with `claimLoginSession`:

```ts
describe("claimLoginSession", () => {
  /** Drives a session all the way to `verified` for Anna. */
  async function verifiedSession(): Promise<string> {
    giveAnnaAuthenticator("sub-anna");
    const id = await openSession();
    await refreshLoginSessionState(db, verdictClient(authVerdict("sub-anna")), id);
    return id;
  }

  it("reports not_found for an unknown id", () => {
    expect(claimLoginSession(db, "login_nope")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("refuses a session that is still pending", async () => {
    const id = await openSession();
    expect(claimLoginSession(db, id)).toEqual({
      ok: false,
      reason: "not_verified",
    });
  });

  it("refuses a failed session", async () => {
    const id = await openSession();
    await refreshLoginSessionState(
      db,
      verdictClient(authVerdict("never-issued")),
      id,
    );
    expect(claimLoginSession(db, id)).toEqual({
      ok: false,
      reason: "not_verified",
    });
  });

  it("returns the resolved user for a verified session", async () => {
    const id = await verifiedSession();
    const result = claimLoginSession(db, id);
    expect(result).toEqual({
      ok: true,
      userId: "user_anna",
      displayName: expect.any(String),
    });
  });

  it("marks the session consumed", async () => {
    const id = await verifiedSession();
    claimLoginSession(db, id);
    const row = db
      .select()
      .from(loginSessions)
      .where(eq(loginSessions.id, id))
      .get();
    expect(row?.state).toBe("consumed");
  });

  it("refuses a second claim — the session is single-use", async () => {
    const id = await verifiedSession();
    expect(claimLoginSession(db, id).ok).toBe(true);
    expect(claimLoginSession(db, id)).toEqual({
      ok: false,
      reason: "already_consumed",
    });
  });

  it("refuses a verified session past its TTL and records why", async () => {
    const id = await verifiedSession();
    const result = claimLoginSession(
      db,
      id,
      Date.now() + LOGIN_SESSION_TTL_MS + 1,
    );

    expect(result).toEqual({ ok: false, reason: "expired" });
    const row = db
      .select()
      .from(loginSessions)
      .where(eq(loginSessions.id, id))
      .get();
    expect(row?.state).toBe("failed");
    expect(row?.failureReason).toBe("expired");
  });

  it("reads the display name at claim time rather than from the session", async () => {
    const id = await verifiedSession();
    db.update(users)
      .set({ displayName: "Renamed Later" })
      .where(eq(users.id, "user_anna"))
      .run();

    expect(claimLoginSession(db, id)).toMatchObject({
      ok: true,
      displayName: "Renamed Later",
    });
  });
});
```

> Add `users` to the schema import in the test file.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/bank && pnpm exec vitest run src/lib/login-sessions.test.ts
```

Expected: FAIL — `claimLoginSession` is not exported.

- [ ] **Step 3: Implement it**

Append to `apps/bank/src/lib/login-sessions.ts`, adding `users` to the schema import:

```ts
export type ClaimLoginResult =
  | { ok: true; userId: string; displayName: string }
  | {
      ok: false;
      reason: "not_found" | "not_verified" | "already_consumed" | "expired";
    };

/**
 * Exchanges a verified login session for the identity a cookie will be signed
 * over. Consumes the session — it can never be claimed twice.
 *
 * Synchronous, because better-sqlite3 is. That is not incidental: the guarded
 * UPDATE below is the whole single-use mechanism, and it is only meaningful as
 * one statement rather than a read followed by a write.
 *
 * Deliberately does NOT sign the JWT or set the cookie. Those are the route's
 * job, so this stays testable without Next's request plumbing.
 */
export function claimLoginSession(
  db: Db,
  sessionId: string,
  now: number = Date.now(),
): ClaimLoginResult {
  const row = db
    .select()
    .from(loginSessions)
    .where(eq(loginSessions.id, sessionId))
    .get();
  if (!row) return { ok: false, reason: "not_found" };

  // Distinguished from `not_verified` so the caller can answer 410 rather than
  // 409: a consumed session is gone for good, a pending one might yet arrive.
  if (row.state === "consumed") return { ok: false, reason: "already_consumed" };
  if (row.state !== "verified" || !row.userId) {
    return { ok: false, reason: "not_verified" };
  }

  if (now - row.createdAt > LOGIN_SESSION_TTL_MS) {
    failLogin(db, sessionId, "expired");
    return { ok: false, reason: "expired" };
  }

  // A GUARDED WRITE, not a read-then-write. `.changes` is what decides whether
  // THIS call won the race to consume the session; checking the state above
  // and then updating unconditionally would let two concurrent claims both
  // mint a cookie.
  const consumed = db
    .update(loginSessions)
    .set({ state: "consumed" })
    .where(
      and(eq(loginSessions.id, sessionId), eq(loginSessions.state, "verified")),
    )
    .run();
  if (consumed.changes !== 1) return { ok: false, reason: "already_consumed" };

  // Read at claim time rather than stored on the session row, so a display
  // name edited between verification and claim cannot be served stale.
  const user = db
    .select()
    .from(users)
    .where(eq(users.id, row.userId))
    .get();
  if (!user) return { ok: false, reason: "not_verified" };

  return { ok: true, userId: user.id, displayName: user.displayName };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/bank && pnpm exec vitest run src/lib/login-sessions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/bank/src/lib/login-sessions.ts apps/bank/src/lib/login-sessions.test.ts
git commit -m "feat(bank): consume a verified login session exactly once

Single-use via a guarded UPDATE whose .changes decides the race, not a
read followed by a write. The session id is a bearer token on four
necessarily-unauthenticated routes, so this is the load-bearing guard."
```

---

### Task 7: Transport selection and the DC API relay

**Files:**

- Create: `apps/bank/src/lib/transport.ts`
- Create: `apps/bank/src/lib/transport.test.ts`
- Create: `apps/bank/src/lib/dc-api-relay.ts`
- Create: `apps/bank/src/lib/dc-api-relay.test.ts`

**Interfaces:**

- Consumes: `loginSessions` (Task 1).
- Produces:
  - `export function selectTransport(dcApiSupported: boolean | null): "dc_api" | "request_uri"`
  - `export type RelayResult = { ok: true } | { ok: false; reason: "not_found" | "no_verification" | "foundry_unavailable" }`
  - `export async function relayDcApiResponse(db: Db, client: FoundryClient, sessionId: string, response: string): Promise<RelayResult>`

- [ ] **Step 1: Write the failing tests**

Create `apps/bank/src/lib/transport.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { selectTransport } from "./transport.js";

describe("selectTransport", () => {
  it("asks for dc_api when the browser supports it", () => {
    expect(selectTransport(true)).toBe("dc_api");
  });

  it("asks for request_uri when the browser does not", () => {
    expect(selectTransport(false)).toBe("request_uri");
  });

  it("asks for request_uri while detection is still unresolved", () => {
    // null is "not yet known", NOT "unavailable". The QR transport is the safe
    // default because it works in every browser.
    expect(selectTransport(null)).toBe("request_uri");
  });
});
```

Create `apps/bank/src/lib/dc-api-relay.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FoundryClient } from "@demo/foundry-client";
import { createDb, type Db } from "../db/index.js";
import { loginSessions } from "../db/schema.js";
import { relayDcApiResponse } from "./dc-api-relay.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bank-relay-"));
  db = createDb(path.join(dir, "test.db"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface Capture {
  url: string;
  body: Record<string, unknown>;
}

function stub(captures: Capture[], status = 200): FoundryClient {
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    captures.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(JSON.stringify({ verified: true, checks: [], credentials: [] }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  return new FoundryClient({ adminUrl: "http://f:9000", adminKey: "k", fetchImpl });
}

describe("relayDcApiResponse", () => {
  it("reports not_found for an unknown session", async () => {
    const result = await relayDcApiResponse(db, stub([]), "login_nope", "jwe");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("reports no_verification when foundry never answered the create", async () => {
    db.insert(loginSessions).values({ id: "login_1", createdAt: 1 }).run();
    const result = await relayDcApiResponse(db, stub([]), "login_1", "jwe");
    expect(result).toEqual({ ok: false, reason: "no_verification" });
  });

  it("forwards the wallet's JWE to foundry's admin endpoint", async () => {
    db.insert(loginSessions)
      .values({ id: "login_1", foundryVerificationId: "v_1", createdAt: 1 })
      .run();

    const captures: Capture[] = [];
    const result = await relayDcApiResponse(db, stub(captures), "login_1", "the-jwe");

    expect(result).toEqual({ ok: true });
    expect(captures[0]?.url).toBe(
      "http://f:9000/admin/verification/requests/v_1/dc-api-response",
    );
    expect(captures[0]?.body).toEqual({ response: "the-jwe" });
  });

  it("reports foundry_unavailable on a non-2xx", async () => {
    db.insert(loginSessions)
      .values({ id: "login_1", foundryVerificationId: "v_1", createdAt: 1 })
      .run();

    const result = await relayDcApiResponse(db, stub([], 500), "login_1", "jwe");
    expect(result).toEqual({ ok: false, reason: "foundry_unavailable" });
  });
});
```

> If the exact admin path differs, read `packages/foundry-client/src/client.ts`'s `submitDcApiResponse` and use what it builds. Do not guess.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/bank && pnpm exec vitest run src/lib/transport.test.ts src/lib/dc-api-relay.test.ts
```

Expected: FAIL — neither module exists.

- [ ] **Step 3: Write both modules**

Create `apps/bank/src/lib/transport.ts`:

```ts
/**
 * Which OpenID4VP transport to ask foundry for. Extracted from the component
 * so vitest covers it — every project here is `environment: "node"` with
 * `include: ["src/**\/*.test.ts"]`, so a ternary in a `.tsx` file is untested.
 *
 * `null` means detection has not resolved yet (see `useDcApiSupport`), which is
 * NOT the same as "unsupported". The QR transport is the safe default: it works
 * in every browser.
 *
 * A deliberate twin of the merchant's `selectTransport` rather than a shared
 * export. `@demo/ui` holds behaviour with no app-specific meaning, the
 * merchant's copy is already tested where it lives, and a shared one-line
 * function across two apps is a coupling with no payoff.
 */
export function selectTransport(
  dcApiSupported: boolean | null,
): "dc_api" | "request_uri" {
  return dcApiSupported === true ? "dc_api" : "request_uri";
}
```

Create `apps/bank/src/lib/dc-api-relay.ts`:

```ts
import { eq } from "drizzle-orm";
import type { FoundryClient } from "@demo/foundry-client";
import type { Db } from "../db/index.js";
import { loginSessions } from "../db/schema.js";

export type RelayResult =
  | { ok: true }
  | {
      ok: false;
      reason: "not_found" | "no_verification" | "foundry_unavailable";
    };

/**
 * Relays a browser Digital Credentials API response to foundry.
 *
 * This exists because foundry's `dc-api-response` endpoint is ADMIN
 * authenticated: the browser cannot call it without the admin key, and the
 * admin key must never leave the server.
 *
 * foundry verifies synchronously and returns a verdict, which is deliberately
 * DISCARDED. The transaction state it also writes is what the poll already
 * running in the dialog reads — one state path, not two. Minting the session
 * here instead would give same-device and cross-device logins two different
 * paths to a cookie, and they would drift.
 */
export async function relayDcApiResponse(
  db: Db,
  client: FoundryClient,
  sessionId: string,
  response: string,
): Promise<RelayResult> {
  const row = db
    .select()
    .from(loginSessions)
    .where(eq(loginSessions.id, sessionId))
    .get();
  if (!row) return { ok: false, reason: "not_found" };
  if (!row.foundryVerificationId) {
    return { ok: false, reason: "no_verification" };
  }

  try {
    await client.submitDcApiResponse(row.foundryVerificationId, response);
    return { ok: true };
  } catch {
    return { ok: false, reason: "foundry_unavailable" };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/bank && pnpm exec vitest run src/lib/transport.test.ts src/lib/dc-api-relay.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/bank/src/lib/transport.ts apps/bank/src/lib/transport.test.ts apps/bank/src/lib/dc-api-relay.ts apps/bank/src/lib/dc-api-relay.test.ts
git commit -m "feat(bank): transport selection and the DC API relay

The relay returns nothing useful on purpose: foundry's verdict is
discarded so the verdict reaches the UI through the poll already
running, exactly as the merchant does it. One state path, not two."
```

---

### Task 8: The four routes

**Files:**

- Create: `apps/bank/src/app/api/auth/wallet-login/route.ts`
- Create: `apps/bank/src/app/api/auth/wallet-login/[id]/route.ts`
- Create: `apps/bank/src/app/api/auth/wallet-login/[id]/claim/route.ts`
- Create: `apps/bank/src/app/api/auth/wallet-login/[id]/dc-api-response/route.ts`

**Interfaces:**

- Consumes: everything from Tasks 4–7, plus `signSession` and `SESSION_COOKIE` from `@/lib/session.js`.
- Produces: the HTTP surface Task 11's components call.

> **No unit tests in this task.** Route handlers in this repo are not unit-tested — every existing one is a thin adapter over a tested `lib/` function, and this task adds no logic that is not already covered. Verification is Task 12's job.

- [ ] **Step 1: `POST /api/auth/wallet-login`**

Create `apps/bank/src/app/api/auth/wallet-login/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/index.js";
import { getFoundry } from "@/lib/foundry.js";
import { startLoginSession } from "@/lib/login-sessions.js";
import { selectTransport } from "@/lib/transport.js";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  /** The browser's DC API detection result. Absent means "no". */
  dcApi: z.boolean().optional(),
});

/**
 * Opens a wallet-login presentation.
 *
 * UNAUTHENTICATED by necessity — the caller is by definition not logged in.
 * The session id it returns is therefore a bearer token; see
 * `LOGIN_SESSION_TTL_MS` and `claimLoginSession` for what keeps that safe.
 *
 * An absent or unparseable body is treated as `{}` rather than a 400. Every
 * field is optional, so there is no request a caller could send that a 400
 * would usefully reject.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(
    await request.json().catch(() => ({})),
  );
  const dcApi = parsed.success ? (parsed.data.dcApi ?? false) : false;

  const result = await startLoginSession(
    getDb(),
    getFoundry(),
    selectTransport(dcApi) === "dc_api",
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 502 });
  }

  return NextResponse.json(
    {
      sessionId: result.sessionId,
      uri: result.uri,
      transport: result.transport,
      dcApiRequest: result.dcApiRequest,
      state: result.state,
    },
    { status: 201 },
  );
}
```

- [ ] **Step 2: `GET /api/auth/wallet-login/[id]`**

Create `apps/bank/src/app/api/auth/wallet-login/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import { getFoundry } from "@/lib/foundry.js";
import { refreshLoginSessionState } from "@/lib/login-sessions.js";

export const dynamic = "force-dynamic";

/**
 * The login poll. Drives the session's state and returns it.
 *
 * A GET rather than a POST even though it performs I/O, because it does not
 * mint anything: the cookie comes from `/claim`. That split is deliberate —
 * a GET that mints an authenticated session would be consumed by a prefetch,
 * a double-poll, or React StrictMode, with no user action at all.
 *
 * The response body is exactly `{ state, failureReason? }`. Never the URI,
 * never the disclosed claims, never the resolved user — the browser learns who
 * it is only by successfully claiming.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const result = await refreshLoginSessionState(getDb(), getFoundry(), id);

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 404 });
  }
  return NextResponse.json(result.status);
}
```

- [ ] **Step 3: `POST /api/auth/wallet-login/[id]/claim`**

Create `apps/bank/src/app/api/auth/wallet-login/[id]/claim/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import { claimLoginSession } from "@/lib/login-sessions.js";
import { SESSION_COOKIE, signSession } from "@/lib/session.js";

export const dynamic = "force-dynamic";

/**
 * Exchanges a verified login session for a `bank_session` cookie, once.
 *
 * The cookie options are copied from `/api/auth/login` deliberately and must
 * stay identical: a session minted here is indistinguishable from a password
 * session by design, so anything that differed would be a way to tell them
 * apart.
 *
 * The status codes carry the distinction `claimLoginSession` draws: 410 for a
 * session that is gone for good, 409 for one that might yet arrive. Neither
 * says WHY — the reason reaches the UI through the poll, which is the one path
 * that carries `failureReason`. This route's 409 exists to close the race
 * where the state changed after the poll read it; it is a guard, not a
 * channel.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const result = claimLoginSession(getDb(), id);

  if (!result.ok) {
    const status =
      result.reason === "not_found"
        ? 404
        : result.reason === "already_consumed"
          ? 410
          : 409;
    return NextResponse.json({ error: result.reason }, { status });
  }

  const token = await signSession({
    userId: result.userId,
    displayName: result.displayName,
  });

  const response = NextResponse.json({
    userId: result.userId,
    displayName: result.displayName,
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

- [ ] **Step 4: `POST /api/auth/wallet-login/[id]/dc-api-response`**

Create `apps/bank/src/app/api/auth/wallet-login/[id]/dc-api-response/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/index.js";
import { relayDcApiResponse } from "@/lib/dc-api-relay.js";
import { getFoundry } from "@/lib/foundry.js";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ response: z.string().min(1) });

/**
 * Relays the wallet's encrypted JWE to foundry.
 *
 * Exists only because foundry's `dc-api-response` endpoint is admin
 * authenticated and the admin key must never reach a browser.
 *
 * Returns 204 and discards foundry's verdict: the verdict reaches the UI
 * through the poll that is already running, so there is one state path rather
 * than two.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { id } = await context.params;
  const result = await relayDcApiResponse(
    getDb(),
    getFoundry(),
    id,
    parsed.data.response,
  );

  if (!result.ok) {
    const status = result.reason === "foundry_unavailable" ? 502 : 404;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 5: Typecheck**

```bash
cd apps/bank && pnpm typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/bank/src/app/api/auth/wallet-login/
git commit -m "feat(bank): wallet-login HTTP surface

Four routes, all unauthenticated by necessity. The poll is a GET that
mints nothing; the cookie comes from POST /claim, so no prefetch or
double-poll can consume a session.

Not unit-tested, like every other route here: each is a thin adapter
over a tested lib/ function."
```

---

### Task 9: Copy

**Files:**

- Modify: `apps/bank/src/lib/i18n/messages.ts`
- Modify: `apps/bank/src/lib/i18n/en.ts`
- Modify: `apps/bank/src/lib/i18n/de.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `Messages["login"]["walletSubmit"]`, `Messages["login"]["walletDivider"]`, and the whole `Messages["walletLogin"]` block. Task 11 reads these as `MESSAGES[locale].walletLogin.*`.

- [ ] **Step 1: Confirm the catalog tests are green first**

```bash
cd apps/bank && pnpm exec vitest run src/lib/i18n/messages.test.ts
```

Expected: PASS. This is the baseline. The catalog's own invariants — no empty leaf, no leaf byte-identical across locales, no German orthography in `en` — are what will catch a mistake in the next two steps, so they must be green before it.

- [ ] **Step 2: Widen the `Messages` interface**

In `apps/bank/src/lib/i18n/messages.ts`, add two keys to the existing `login` block and a new `walletLogin` block after it. **Match the file's existing indentation.**

Add inside `login`, after `failed`:

```ts
/** The wallet button on the login screen. */
walletSubmit: string;
/** Separates the password form from the wallet button. */
walletDivider: string;
```

Add a new block immediately after the `login` block closes:

```ts
/**
 * The wallet-login dialog.
 *
 * A block of its own rather than more keys under `login`, because it is a
 * modal with its own lifecycle rather than more of the login form — the same
 * reason `issuance` is separate from `credential`.
 *
 * The three failure strings are keyed by the `failure_reason` values
 * `login-sessions.ts` writes, so a new reason there is a compile error here
 * rather than a dialog that renders nothing.
 */
walletLogin: {
  title: string;
  /** While DC API detection is unresolved. NOT the QR fallback. */
  preparing: string;
  approve: string;
  confirmInApp: string;
  openInWallet: string;
  scanCode: string;
  qrAlt: string;
  waiting: string;
  cancel: string;
  close: string;
  successTitle: string;
  successBody: string;
  failedTitle: string;
  /** failure_reason `expired` */
  expired: string;
  /**
   * failure_reason `unknown_credential` — a real, correctly-signed
   * credential this bank cannot match to a customer. The commonest cause is
   * a credential issued before the subject was persisted, so this copy must
   * name the remedy: add it to the wallet again.
   */
  unknownCredential: string;
  /** failure_reason `verification_failed` and `foundry_unavailable` */
  verificationFailed: string;
};
```

- [ ] **Step 3: Add the English copy**

In `apps/bank/src/lib/i18n/en.ts`, add to `login` after `failed`:

```ts
walletSubmit: "Login with EUDI-Wallet",
walletDivider: "or",
```

and a new block after `login`:

```ts
walletLogin: {
  title: "Sign in with your wallet",
  preparing: "Preparing…",
  approve: "Open wallet",
  confirmInApp: "Confirm the request in your wallet app.",
  openInWallet: "Open in wallet",
  scanCode: "Scan this code with the wallet app on your phone.",
  qrAlt: "QR code for the sign-in request",
  waiting: "Waiting for your wallet…",
  cancel: "Cancel",
  close: "Close",
  successTitle: "Signed in",
  successBody: "Taking you to your accounts.",
  failedTitle: "Sign-in failed",
  expired: "The request expired. Please try again.",
  unknownCredential:
    "This credential is valid, but we cannot match it to a customer. Add the Sparkassen Authenticator to your wallet again from your overview, then try once more.",
  verificationFailed: "Your wallet's response could not be verified.",
},
```

- [ ] **Step 4: Add the German copy**

In `apps/bank/src/lib/i18n/de.ts`, add to `login` after `failed`:

```ts
walletSubmit: "Mit EUDI-Wallet anmelden",
walletDivider: "oder",
```

and a new block after `login`:

```ts
walletLogin: {
  title: "Mit Ihrer Wallet anmelden",
  preparing: "Wird vorbereitet…",
  approve: "Wallet öffnen",
  confirmInApp: "Bestätigen Sie die Anfrage in Ihrer Wallet-App.",
  openInWallet: "In Wallet öffnen",
  scanCode: "Scannen Sie diesen Code mit der Wallet-App auf Ihrem Telefon.",
  qrAlt: "QR-Code für die Anmeldeanfrage",
  waiting: "Warten auf Ihre Wallet…",
  cancel: "Abbrechen",
  close: "Schließen",
  successTitle: "Angemeldet",
  successBody: "Sie werden zu Ihren Konten weitergeleitet.",
  failedTitle: "Anmeldung fehlgeschlagen",
  expired: "Die Anfrage ist abgelaufen. Bitte versuchen Sie es erneut.",
  unknownCredential:
    "Dieser Nachweis ist gültig, kann aber keinem Kunden zugeordnet werden. Fügen Sie den Sparkassen Authenticator über Ihre Übersicht erneut zur Wallet hinzu und versuchen Sie es dann noch einmal.",
  verificationFailed: "Die Antwort Ihrer Wallet konnte nicht geprüft werden.",
},
```

> Every leaf above differs between the two locales, so `IDENTICAL_BY_DESIGN` stays empty. Do not add to it.

- [ ] **Step 5: Run the catalog tests**

```bash
cd apps/bank && pnpm exec vitest run src/lib/i18n/messages.test.ts && pnpm typecheck
```

Expected: PASS and a clean typecheck. A key present in one catalog and missing from the other is a **compile** error, not a test failure — so the typecheck is the real gate here.

- [ ] **Step 6: Commit**

```bash
git add apps/bank/src/lib/i18n/
git commit -m "feat(bank): wallet-login copy in both locales

Keyed by the failure_reason values login-sessions.ts writes, so a new
reason is a compile error rather than a dialog rendering nothing.

IDENTICAL_BY_DESIGN stays empty: every new leaf genuinely differs
between en and de."
```

---

### Task 10: The dialog's rendering decisions

**Files:**

- Create: `apps/bank/src/lib/login-dialog-state.ts`
- Create: `apps/bank/src/lib/login-dialog-state.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `export type LoginDcError = null | "unsupported" | "failed"`
  - `export type LoginAffordance = "preparing" | "dc-api" | "deep-link" | "qr"`
  - `export type LoginPhase = "waiting" | "success" | "error"`
  - `export type LoginFailureKey = "expired" | "unknownCredential" | "verificationFailed"`
  - `export function isLoginTerminal(state: string): boolean`
  - `export function selectLoginAffordance(dcSupported: boolean | null, dcError: LoginDcError, isTouch: boolean): LoginAffordance`
  - `export function selectLoginPhase(state: string | null, claimed: boolean, pollFailed: boolean): LoginPhase`
  - `export function loginFailureKey(failureReason: string | undefined): LoginFailureKey`

- [ ] **Step 1: Write the failing test**

Create `apps/bank/src/lib/login-dialog-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  isLoginTerminal,
  loginFailureKey,
  selectLoginAffordance,
  selectLoginPhase,
} from "./login-dialog-state.js";

describe("isLoginTerminal", () => {
  it("treats verified as terminal — the poll's job ends there", () => {
    // `verified` stops the poll because the CLAIM takes over from that point.
    // Polling on would just re-read a row nothing will change.
    expect(isLoginTerminal("verified")).toBe(true);
  });

  it("treats failed and consumed as terminal", () => {
    expect(isLoginTerminal("failed")).toBe(true);
    expect(isLoginTerminal("consumed")).toBe(true);
  });

  it("keeps polling while pending", () => {
    expect(isLoginTerminal("pending")).toBe(false);
  });

  it("keeps polling on a state it does not recognise", () => {
    // Fail open here, not closed: an unknown state must not silently end the
    // flow. The poll's own timeout is the backstop.
    expect(isLoginTerminal("something-new")).toBe(false);
  });
});

describe("selectLoginAffordance", () => {
  it("shows preparing while detection is unresolved", () => {
    // null is "not yet known". Rendering the QR here flashes it on Android.
    expect(selectLoginAffordance(null, null, false)).toBe("preparing");
    expect(selectLoginAffordance(null, null, true)).toBe("preparing");
  });

  it("offers the DC API button when the browser supports it", () => {
    expect(selectLoginAffordance(true, null, false)).toBe("dc-api");
  });

  it("falls back to the deep link on touch once the DC API failed", () => {
    expect(selectLoginAffordance(true, "failed", true)).toBe("deep-link");
    expect(selectLoginAffordance(true, "unsupported", true)).toBe("deep-link");
  });

  it("falls back to the QR on desktop once the DC API failed", () => {
    expect(selectLoginAffordance(true, "failed", false)).toBe("qr");
  });

  it("uses the deep link on touch without the DC API", () => {
    // The wallet is on this same phone, so a QR nobody can scan is useless.
    expect(selectLoginAffordance(false, null, true)).toBe("deep-link");
  });

  it("uses the QR on desktop without the DC API", () => {
    expect(selectLoginAffordance(false, null, false)).toBe("qr");
  });
});

describe("selectLoginPhase", () => {
  it("waits while pending", () => {
    expect(selectLoginPhase("pending", false, false)).toBe("waiting");
  });

  it("waits while verified but not yet claimed", () => {
    // The claim is in flight. Showing success before the cookie exists would
    // navigate to a page that redirects straight back to /login.
    expect(selectLoginPhase("verified", false, false)).toBe("waiting");
  });

  it("succeeds once the claim returned a cookie", () => {
    expect(selectLoginPhase("verified", true, false)).toBe("success");
  });

  it("errors on a failed session", () => {
    expect(selectLoginPhase("failed", false, false)).toBe("error");
  });

  it("errors when the poll itself gave up", () => {
    expect(selectLoginPhase("pending", false, true)).toBe("error");
  });

  it("waits when nothing is known yet", () => {
    expect(selectLoginPhase(null, false, false)).toBe("waiting");
  });

  it("prefers success over a poll failure", () => {
    // A claim that already succeeded must not be undone by a late poll error.
    expect(selectLoginPhase("verified", true, true)).toBe("success");
  });
});

describe("loginFailureKey", () => {
  it("maps expired", () => {
    expect(loginFailureKey("expired")).toBe("expired");
  });

  it("maps unknown_credential", () => {
    expect(loginFailureKey("unknown_credential")).toBe("unknownCredential");
  });

  it("maps verification_failed", () => {
    expect(loginFailureKey("verification_failed")).toBe("verificationFailed");
  });

  it("maps foundry_unavailable to the generic failure", () => {
    expect(loginFailureKey("foundry_unavailable")).toBe("verificationFailed");
  });

  it("falls back to the generic failure for an unknown reason", () => {
    expect(loginFailureKey("brand_new_reason")).toBe("verificationFailed");
    expect(loginFailureKey(undefined)).toBe("verificationFailed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/bank && pnpm exec vitest run src/lib/login-dialog-state.test.ts
```

Expected: FAIL — `./login-dialog-state.js` does not exist.

- [ ] **Step 3: Write the module**

Create `apps/bank/src/lib/login-dialog-state.ts` (**2 spaces**):

```ts
/**
 * Every branching decision the wallet-login dialog makes, extracted from the
 * component.
 *
 * vitest is `environment: "node"` with `include: ["src/**\/*.test.ts"]`, so a
 * ternary inside a `.tsx` file is never covered — and branching inside a
 * component is exactly how a defect in one state stays invisible from the
 * others. Same reasoning as the merchant's `sheet-state.ts` and the bank's
 * `card-state.ts`.
 */

/** How the browser's DC API attempt ended, if it was attempted at all. */
export type LoginDcError = null | "unsupported" | "failed";

/** What the dialog offers the holder while it waits. */
export type LoginAffordance = "preparing" | "dc-api" | "deep-link" | "qr";

export type LoginPhase = "waiting" | "success" | "error";

/** A key into `MESSAGES[locale].walletLogin`. */
export type LoginFailureKey =
  | "expired"
  | "unknownCredential"
  | "verificationFailed";

/**
 * Whether the poll should stop.
 *
 * `verified` counts as terminal even though the flow is not over: the CLAIM
 * takes over at that point, and polling on would only re-read a row nothing
 * will change.
 *
 * Fails OPEN on an unrecognised state — an unknown value keeps polling rather
 * than silently ending the flow, and the poll's own timeout is the backstop.
 */
export function isLoginTerminal(state: string): boolean {
  return state === "verified" || state === "failed" || state === "consumed";
}

/**
 * Which affordance to draw.
 *
 * `dcSupported === null` means detection has not resolved, which is NOT the
 * same as unsupported — rendering the QR there flashes it on Android before it
 * disappears. On touch the wallet lives on this same phone, so a deep link
 * beats a QR nobody can scan.
 */
export function selectLoginAffordance(
  dcSupported: boolean | null,
  dcError: LoginDcError,
  isTouch: boolean,
): LoginAffordance {
  if (dcSupported === null) return "preparing";
  if (dcSupported && dcError === null) return "dc-api";
  return isTouch ? "deep-link" : "qr";
}

/**
 * Which face the dialog wears.
 *
 * `verified` is deliberately still `waiting`: the claim is in flight and no
 * cookie exists yet, so showing success would navigate to a page that
 * redirects straight back to the login screen. Only `claimed` promotes it.
 *
 * A successful claim outranks a poll failure, so a late poll error cannot undo
 * a session that already exists.
 */
export function selectLoginPhase(
  state: string | null,
  claimed: boolean,
  pollFailed: boolean,
): LoginPhase {
  if (claimed) return "success";
  if (state === "failed") return "error";
  if (pollFailed) return "error";
  return "waiting";
}

/**
 * Maps a `failure_reason` written by `login-sessions.ts` to a copy key.
 *
 * Everything unrecognised — including `foundry_unavailable`, which is true but
 * not the holder's problem — falls back to the generic message. A reason the
 * holder cannot act on should not be spelled out to them.
 */
export function loginFailureKey(
  failureReason: string | undefined,
): LoginFailureKey {
  if (failureReason === "expired") return "expired";
  if (failureReason === "unknown_credential") return "unknownCredential";
  return "verificationFailed";
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/bank && pnpm exec vitest run src/lib/login-dialog-state.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/bank/src/lib/login-dialog-state.ts apps/bank/src/lib/login-dialog-state.test.ts
git commit -m "feat(bank): extract the wallet-login dialog's decisions

Kept in .ts because vitest only matches src/**/*.test.ts — a ternary in
a .tsx file is untested, and branching inside a component is how a
defect in one state stays invisible from the others.

verified is deliberately still 'waiting': the claim is in flight and no
cookie exists yet, so success would navigate to a page that bounces
straight back to /login."
```

---

### Task 11: The button, the dialog, and the login screen

**Files:**

- Create: `apps/bank/src/components/WalletLoginDialog.tsx`
- Create: `apps/bank/src/components/WalletLoginButton.tsx`
- Modify: `apps/bank/src/app/login/page.tsx`

**Interfaces:**

- Consumes: the four routes (Task 8), `MESSAGES[locale].login.walletSubmit` / `.walletDivider` and `MESSAGES[locale].walletLogin.*` (Task 9), every export of `login-dialog-state.ts` (Task 10), `selectTransport` (Task 7), and from `@demo/ui`: `DC_API_PRESENTATION_PROTOCOL`, `QrCanvas`, `invokeDcGet`, `isDcApiNotSupportedError`, `prepareDcApiRequest`, `useDcApiSupport`, `useIsTouch`, `useStatusPoll`.
- Produces: nothing other tasks consume.

> **No unit tests.** These are `.tsx` and vitest does not match them — that is exactly why Task 10 exists. Verification is Task 12's browser step.

- [ ] **Step 1: Write the dialog**

Create `apps/bank/src/components/WalletLoginDialog.tsx`. Model it on `IssuanceDialog.tsx`, which is the established shape for this app's modals.

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  DC_API_PRESENTATION_PROTOCOL,
  QrCanvas,
  invokeDcGet,
  isDcApiNotSupportedError,
  prepareDcApiRequest,
  useDcApiSupport,
  useIsTouch,
  useStatusPoll,
} from "@demo/ui";
import type { Locale } from "@/lib/i18n/locale.js";
import { MESSAGES } from "@/lib/i18n/messages.js";
import {
  isLoginTerminal,
  loginFailureKey,
  selectLoginAffordance,
  selectLoginPhase,
  type LoginDcError,
} from "@/lib/login-dialog-state.js";
import { AlertMark, CheckMark } from "./StatusMark.js";

/** Sparkasse red, matching --color-primary, for the QR's dark modules. */
const QR_DARK = "#ff0000";

export interface WalletLoginDialogProps {
  sessionId: string;
  /** Null under dc_api — foundry inlines the request object instead. */
  uri: string | null;
  dcApiRequest: unknown;
  locale: Locale;
  onClose: () => void;
}

interface PollState {
  state: string;
  failureReason?: string;
}

export function WalletLoginDialog({
  sessionId,
  uri,
  dcApiRequest,
  locale,
  onClose,
}: WalletLoginDialogProps) {
  const router = useRouter();
  const t = MESSAGES[locale].walletLogin;
  const isTouch = useIsTouch();
  const dcSupported = useDcApiSupport("get", DC_API_PRESENTATION_PROTOCOL);
  const [dcError, setDcError] = useState<LoginDcError>(null);
  const [claimed, setClaimed] = useState(false);

  const fetchOnce = useCallback<() => Promise<PollState>>(async () => {
    const response = await fetch(`/api/auth/wallet-login/${sessionId}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const body = (await response.json()) as {
      state?: unknown;
      failureReason?: unknown;
    };
    return {
      state: typeof body.state === "string" ? body.state : "pending",
      failureReason:
        typeof body.failureReason === "string" ? body.failureReason : undefined,
    };
  }, [sessionId]);

  const isTerminal = useCallback(
    (value: PollState) => isLoginTerminal(value.state),
    [],
  );

  const { value, outcome } = useStatusPoll<PollState>({ fetchOnce, isTerminal });

  // The claim is a SEPARATE request from the poll, and it is a POST. A GET
  // that minted a session would be consumed by a prefetch or a double-poll.
  useEffect(() => {
    if (value?.state !== "verified" || claimed) return;
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(
          `/api/auth/wallet-login/${sessionId}/claim`,
          { method: "POST" },
        );
        if (cancelled) return;
        if (!response.ok) {
          setDcError(null);
          return;
        }
        setClaimed(true);
        // Let the success state be seen, then land on the dashboard. The
        // cookie already exists at this point, so / will not bounce back.
        setTimeout(() => {
          router.replace("/");
          router.refresh();
        }, 1200);
      } catch {
        if (!cancelled) setDcError("failed");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [value, claimed, sessionId, router]);

  const pollFailed =
    outcome !== null &&
    outcome.status !== "aborted" &&
    outcome.status !== "terminal";

  const phase = selectLoginPhase(value?.state ?? null, claimed, pollFailed);
  const affordance = selectLoginAffordance(dcSupported, dcError, isTouch);
  const failureBody = t[loginFailureKey(value?.failureReason)];

  // No `await` may execute before invokeDcGet — Chrome consumes the click's
  // transient activation otherwise. dcApiRequest is already a prop.
  async function signInViaDcApi() {
    try {
      const data = await invokeDcGet(
        prepareDcApiRequest(dcApiRequest, DC_API_PRESENTATION_PROTOCOL),
      );
      await fetch(`/api/auth/wallet-login/${sessionId}/dc-api-response`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ response: data.response }),
      });
      // The poll already running picks up the verdict on its next tick.
    } catch (err) {
      setDcError(isDcApiNotSupportedError(err) ? "unsupported" : "failed");
    }
  }

  return (
    <div
      className="dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t.title}
    >
      <div className="dialog-card px-7 py-8">
        {phase === "waiting" ? (
          <>
            <h2 className="panel-title">{t.title}</h2>

            {affordance === "preparing" ? (
              <p className="mt-6 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                {t.preparing}
              </p>
            ) : null}

            {affordance === "dc-api" ? (
              <>
                <button
                  type="button"
                  onClick={signInViaDcApi}
                  className="btn btn-primary mt-6 px-5 py-3"
                >
                  {t.approve}
                </button>
                <p className="mt-4 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                  {t.confirmInApp}
                </p>
              </>
            ) : null}

            {affordance === "deep-link" && uri ? (
              <>
                <a href={uri} className="btn btn-primary mt-6 px-5 py-3">
                  {t.openInWallet}
                </a>
                <p className="mt-4 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                  {t.confirmInApp}
                </p>
              </>
            ) : null}

            {affordance === "qr" && uri ? (
              <>
                <div className="qr-frame mt-6 p-3">
                  <QrCanvas
                    value={uri}
                    size={220}
                    darkColor={QR_DARK}
                    ariaLabel={t.qrAlt}
                  />
                </div>
                <p className="mt-4 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                  {t.scanCode}
                </p>
              </>
            ) : null}

            <p className="eyebrow mt-4">{t.waiting}</p>

            <button
              type="button"
              onClick={onClose}
              className="btn btn-quiet mt-5 px-3 py-2"
            >
              {t.cancel}
            </button>
          </>
        ) : null}

        {phase === "success" ? (
          <>
            <CheckMark className="mx-auto h-12 w-12 text-[var(--color-success)]" />
            <h2 className="panel-title mt-4 text-[var(--color-success)]">
              {t.successTitle}
            </h2>
            <p className="mt-1.5 text-sm text-[var(--color-muted-foreground)]">
              {t.successBody}
            </p>
          </>
        ) : null}

        {phase === "error" ? (
          <>
            <AlertMark className="mx-auto h-12 w-12 text-[var(--color-destructive)]" />
            <h2 className="panel-title mt-4">{t.failedTitle}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
              {failureBody}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="btn btn-primary mt-6 px-5 py-2.5"
            >
              {t.close}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
```

> `AlertMark` / `CheckMark` and the `dialog-overlay` / `dialog-card` / `qr-frame` classes all already exist — `IssuanceDialog.tsx` uses them. Do not invent new ones.
>
> Note the `uri &&` guards on the deep-link and QR branches. Under `dc_api` there is no URI at all, and a `dc_api` session **can never be re-rendered as a QR** — it is bound to `response_mode: dc_api.jwt` with an inlined request object. If the DC API fails on a `dc_api` session, the holder cancels and presses the button again; detection has not changed, so nothing here silently produces a broken QR.

- [ ] **Step 2: Write the button**

Create `apps/bank/src/components/WalletLoginButton.tsx`:

```tsx
"use client";

import { useState } from "react";
import { DC_API_PRESENTATION_PROTOCOL, useDcApiSupport } from "@demo/ui";
import type { Locale } from "@/lib/i18n/locale.js";
import { MESSAGES } from "@/lib/i18n/messages.js";
import { selectTransport } from "@/lib/transport.js";
import { WalletLoginDialog } from "./WalletLoginDialog.js";

interface LoginSession {
  sessionId: string;
  uri: string | null;
  dcApiRequest: unknown;
}

/**
 * The wallet alternative to the password form.
 *
 * Detection happens HERE rather than in the dialog, because the transport is
 * fixed when the session is created: foundry returns either a URI or an inline
 * request object, never both, and that choice cannot be revisited afterwards.
 *
 * Creating the session on the click — before the dialog mounts — is also what
 * lets `dcApiRequest` be a prop by the time the dialog's own button is pressed.
 * Chrome consumes a click's transient activation, so no `await` may run between
 * that handler starting and `navigator.credentials.get()`.
 */
export function WalletLoginButton({ locale }: { locale: Locale }) {
  const t = MESSAGES[locale];
  const dcSupported = useDcApiSupport("get", DC_API_PRESENTATION_PROTOCOL);
  const [session, setSession] = useState<LoginSession | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/wallet-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dcApi: selectTransport(dcSupported) === "dc_api",
        }),
      });
      if (!response.ok) {
        setError(t.errors.offerNotCreated);
        return;
      }
      setSession((await response.json()) as LoginSession);
    } catch {
      setError(t.errors.connectionFailed);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="mt-6 flex items-center gap-3">
        <span className="h-px flex-1 bg-[var(--color-border)]" />
        <span className="eyebrow">{t.login.walletDivider}</span>
        <span className="h-px flex-1 bg-[var(--color-border)]" />
      </div>

      <button
        type="button"
        onClick={start}
        disabled={pending}
        className="btn btn-quiet mt-4 w-full py-3"
      >
        {t.login.walletSubmit}
      </button>

      {error ? (
        <p
          role="alert"
          className="mt-3 text-sm font-medium text-[var(--color-destructive)]"
        >
          {error}
        </p>
      ) : null}

      {session ? (
        <WalletLoginDialog
          sessionId={session.sessionId}
          uri={session.uri}
          dcApiRequest={session.dcApiRequest}
          locale={locale}
          onClose={() => setSession(null)}
        />
      ) : null}
    </>
  );
}
```

> `btn-quiet` rather than `btn-primary`: the password form's submit is the primary action on this screen and there must be exactly one. If `--color-border` is not a token in `globals.css`, read the file and use whatever the existing dividers use.

- [ ] **Step 3: Render it on the login screen**

In `apps/bank/src/app/login/page.tsx`, import `WalletLoginButton` and render it directly after `<LoginForm />`, inside the same `AuthCard`:

```tsx
      <LoginForm locale={locale} />
      <WalletLoginButton locale={locale} />
```

Nothing else on the page changes. `getSession()` still redirects an already-authenticated visitor away, and that now correctly covers a visitor who just logged in with a wallet.

- [ ] **Step 4: Typecheck and build**

```bash
cd apps/bank && pnpm typecheck && pnpm build
```

Expected: both clean. The build is the step that catches a `.tsx`-only mistake, since vitest never loads these files.

- [ ] **Step 5: Commit**

```bash
git add apps/bank/src/components/WalletLoginDialog.tsx apps/bank/src/components/WalletLoginButton.tsx apps/bank/src/app/login/page.tsx
git commit -m "feat(bank): Login with EUDI-Wallet on the login screen

A modal rather than a route, so the scrim dims the page it came from.

Detection lives in the button, not the dialog: the transport is fixed
when the session is created, and creating it on the click is what lets
dcApiRequest be a prop before the wallet button is pressed. Chrome
consumes a click's transient activation, so no await may run in
between."
```

---

### Task 12: Verify, document, and close

**Files:**

- Modify: `AGENTS.md`
- Modify: `apps/bank/AGENTS.md`

**Interfaces:**

- Consumes: everything.
- Produces: the measured test count and the verification record.

- [ ] **Step 1: Run the full gate and MEASURE**

```bash
cd /Users/senexi/dev/eudiw/payment-banking-demo && pnpm check
```

Expected: green. **Write down the actual per-project totals.** Do not reuse any number written in this plan or in any AGENTS.md — the baseline is 591 and every projection in this project's history has been wrong.

- [ ] **Step 2: Verify the request leg against the DEPLOYED foundry**

The local foundry declares neither the `sparkassen_auth` credential type nor the `sparkassen_auth` named query, so this cannot be done locally. Port-forward and read the real admin key:

```bash
kubectl -n foundry port-forward svc/foundry 9000:9000 &
ADMIN_KEY=$(kubectl -n foundry get secret foundry-admin -o jsonpath='{.data.admin-api-key}' | base64 -d)

curl -s -o /tmp/wl.json -w '%{http_code}\n' \
  -X POST http://127.0.0.1:9000/admin/verification/requests \
  -H "authorization: Bearer $ADMIN_KEY" \
  -H 'content-type: application/json' \
  -d '{"transport":"request_uri","named_query_ref":"sparkassen_auth"}'
cat /tmp/wl.json
```

Expected: **HTTP 200** with a `verification_id`, an `openid4vp://` `openid4vp_uri` and a `request_uri`.

Then prove the 200 is evidence rather than serde silently dropping the field — fetch the wallet-facing request object and confirm it names the right vct:

```bash
REQ=$(python3 -c "import json;print(json.load(open('/tmp/wl.json'))['request_uri'])")
curl -s "$REQ" | head -c 2000
```

Expected: a request object whose DCQL carries one credential query with
`vct_values: ["https://creds.digitallabor.dev/vct/sparkassen_auth"]` and a `sub` claim path.

**Control:** send a named query that does not exist and require a rejection, so a 200 above means something.

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST http://127.0.0.1:9000/admin/verification/requests \
  -H "authorization: Bearer $ADMIN_KEY" -H 'content-type: application/json' \
  -d '{"transport":"request_uri","named_query_ref":"definitely_not_a_query"}'
```

Expected: a non-2xx. If this also returns 200, the earlier 200 proves nothing — stop and report it.

Record the actual status codes and the returned URI. Kill the port-forward when done.

- [ ] **Step 3: Verify the browser leg up to the handover**

```bash
cd /Users/senexi/dev/eudiw/payment-banking-demo && pnpm dev
```

Then drive `http://localhost:3001/login` with `tools/cdp/cdp.mjs` and confirm, by observation rather than assumption:

1. The `Login with EUDI-Wallet` button renders under the password form.
2. Switching to German renders `Mit EUDI-Wallet anmelden`.
3. Clicking it against a **local** foundry shows the inline `offerNotCreated` error and **no dialog** — because the local config has no `sparkassen_auth` named query, `startLoginSession` returns `foundry_unavailable`, and the dialog only mounts on a 2xx. Confirm a `failed` `login_sessions` row was written with `failure_reason = 'foundry_unavailable'`.
4. Nothing throws in the console.

Point `FOUNDRY_ADMIN_URL` at the port-forwarded deployed foundry to see the dialog itself, the QR, and DC API detection resolving. **The wallet's answer cannot be produced here** — no device, no wallet app.

- [ ] **Step 4: Correct `apps/bank/AGENTS.md`**

Two things in it are now **false** and must be fixed in this change, not later:

1. The Sparkassen Authenticator section says its `sub` is "minted per issuance, sent, and never persisted". It is now persisted to `credential_id`. Rewrite it to say what is still true — the value is per-issuance random, so two of these credentials cannot be correlated **to each other by a third party** — and what changed: the bank can now link a presentation to a customer, which is what wallet login requires.
2. Anything asserting this credential is "in none of" the type lists should stay, but note that it is now the subject of `SPARKASSEN_AUTH_QUERY_ID` and `login-checks.ts`.

Then add a **Wallet login** section covering: the four routes and why they are unauthenticated; why the poll is a GET that mints nothing and the claim is a POST; why `verified` and `consumed` are separate states; that `expired` is a failure reason and not a fifth state; the guarded-UPDATE single-use rule; that the gate is keyed by DCQL query id; that it deliberately does not require the row to be `active`; and that a credential issued before this change **cannot log in, permanently**.

- [ ] **Step 5: Correct the root `AGENTS.md`**

1. **The 12-hour lifetime claim is wrong for this credential.** "No revocation anywhere. foundry exposes no revoke endpoint; credentials expire on their 12-hour lifetime" — the deployed config gives `sparkassen_auth` `validity_seconds: 31536000`, i.e. **365 days**, and enables a status list for it. Correct it.
2. The Sparkassen Authenticator bullet repeats the "never persisted" claim. Same fix as Step 4.
3. Update the test-count paragraph with the **measured** number and the per-file split, in the established style — what was added, what changed rather than being added, and any trap in the arithmetic.
4. Add the operator dependency: `dc_api_expected_origins` in `dl-infra-k8s/foundry/foundry_config.yml` must gain `https://sparkasse-musterstadt.digitallabor.dev` or same-device login declines silently.
5. Under **Known-unverifiable**, state plainly that no wallet has answered the `sparkassen_auth` query, so the disclosed-claim shape is pinned by foundry's config and not by observation.

- [ ] **Step 6: Final gate and commit**

```bash
cd /Users/senexi/dev/eudiw/payment-banking-demo && pnpm check && pnpm build
```

```bash
git add AGENTS.md apps/bank/AGENTS.md
git commit -m "docs: record wallet login and correct two false claims

Corrections, both of which this change made necessary:
- the authenticator sub is no longer 'never persisted'
- sparkassen_auth lives 365 days, not the 12h the root AGENTS.md
  claimed for credentials generally (validity_seconds: 31536000)

VERIFIED: pnpm check green at <N> tests (measured, not projected).
POST /admin/verification/requests with named_query_ref sparkassen_auth
returns <status> against the deployed foundry; an unknown named query
returns <status>, so the first is evidence. The request object served
at request_uri names vct .../sparkassen_auth.

NOT VERIFIED: no wallet has answered this query. No device here. The
disclosed-claim shape is pinned by foundry's config, not observation.
Same-device DC API login additionally needs the bank's origin added to
dc_api_expected_origins and will decline silently until then."
```

---

## Plan Self-Review

Run against the spec after writing. Findings and their resolutions:

**1. Spec coverage.** Every section maps to a task:

| Spec | Task |
| --- | --- |
| §3.2 claim-not-poll | 6, 8 |
| §3.3 state machine + computed expiry | 1, 5, 6 |
| §4.1 `login_sessions` | 1 |
| §4.2 `sub` in `credential_id` | 2 |
| §4.3 pre-existing credentials cannot log in | 5 (`unknown_credential`), 9 (copy), 12 (docs) |
| §5.2 the gate, keyed by query id | 3, 5 |
| §5.3 no `active` requirement, no `transaction_data` | 4, 5 |
| §6.1 four routes | 8 |
| §6.2 modules | 3, 4, 5, 6, 7, 10, 11 |
| §6.3 UI, modal, transient activation, `null` ≠ `false` | 10, 11 |
| §6.4 copy | 9 |
| §6.5 no auth-method surfaced | — (nothing to do; `SessionPayload` untouched) |
| §6.6 no new env vars | — (nothing to do) |
| §7 TTL, single-use, entropy | 4, 6 |
| §8.1 operator dependency | 12 |
| §8.2 verification | 12 |
| §10 definition of done | 12 |

**2. Placeholder scan.** No `TBD`, no "similar to Task N", no "add error handling". Every code step carries real code. Three steps deliberately say *read the file and use what is there* rather than inventing a value — the seeded user id (Task 1), the `submitDcApiResponse` path (Task 7), and the divider token (Task 11). Those are instructions to verify, not placeholders.

**3. Type consistency.** Checked across tasks:

- `LoginSessionState` (Task 1) → `LoginSessionStatusDto.state` (Task 4). Consistent.
- `failLogin` is defined once in Task 4 and used by Tasks 5 and 6 without redefinition. Flagged inline so an out-of-order implementer does not add a second one.
- `LOGIN_SESSION_TTL_MS` exported in Task 4, imported by the Task 5 tests. Consistent.
- `extractAuthSubject` signature identical in Tasks 3 and 5.
- `selectTransport` returns `"dc_api" | "request_uri"`; `startLoginSession` takes a `boolean`. Task 8's route bridges them with `selectTransport(dcApi) === "dc_api"` — deliberately redundant, so the *decision* stays in the tested function rather than being re-expressed as a bare boolean pass-through.
- Copy keys in Task 9 exactly match `LoginFailureKey` in Task 10 (`expired`, `unknownCredential`, `verificationFailed`) and the `walletLogin.*` reads in Task 11.
- `PollState` (Task 11) matches the `{ state, failureReason? }` body Task 8's GET returns.

**One inconsistency found and fixed inline:** an earlier draft had Task 10's `selectLoginPhase` take the poll outcome object directly, which would have made it depend on `@demo/ui`'s `PollOutcome` type and dragged a UI package into a pure decision module. It now takes a `pollFailed: boolean` that Task 11 derives at the call site.
