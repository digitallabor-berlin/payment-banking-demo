# Account Limit Change Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A logged-in bank customer can change an account's daily transfer limit, approving the change on their wallet's consent screen, which is rendered from a PaSO §5 ad-hoc transaction data metadata JWT the bank mints per request.

**Architecture:** A new `limit_change_sessions` table and `lib/limit-change-sessions.ts` modelled directly on the existing `login_sessions` / `lib/login-sessions.ts` pair — same three transports, same soft fallback, same "write the row before calling foundry" discipline. The new part is a mint step before the verification request (`POST /admin/paso/ad-hoc-metadata`), whose JWT rides in the `transaction_data` entry's `metadata` member, and an identity gate in the poll that requires the approving authenticator to belong to the customer who started the session. Pure decisions live in `.ts` modules with their own tests; `.tsx` holds rendering only.

**Tech Stack:** Next.js 15 (App Router, `src/app`), drizzle-orm + better-sqlite3, vitest (`environment: "node"`, `include: ["src/**/*.test.ts"]`), zod, `@demo/foundry-client`, `@demo/ui`.

**Spec:** `docs/superpowers/specs/2026-10-19-account-limit-change-design.md`

## Global Constraints

- `pnpm`, never `npm`. All commands from the repo root unless stated.
- `pnpm check` (typecheck + test across all 4 projects) must be green before any task is claimed done.
- **Measure the baseline test count at HEAD before Task 1 and record it.** `AGENTS.md` says 872 and has been wrong about the bank's figure twice. Do not project per-task totals; measure.
- All money is integer cents. Column names end in `_cents`. Never a float.
- The one exception is the `transaction_data` payload amount, a plain decimal string built with `toFixed`, **never `Intl`** — it is machine-read and hashed byte-for-byte.
- Local imports are written `./foo.js` for a `./foo.ts` file.
- Every vitest project is `environment: "node"` with `include: ["src/**/*.test.ts"]`. A `.tsx` file is never covered — branching decisions belong in `.ts`.
- TypeScript is strict with `noUnusedLocals` / `noUnusedParameters`; an intentionally unused parameter is prefixed `_`.
- TDD: write the failing test, run it, confirm it fails for the right reason, then implement.
- Conventional commits (`feat(bank):`, `fix:`, `chore:`, `docs:`). Commit messages state what was verified and state plainly what was not.
- Transaction data type identifier, exactly: `urn:paso:sca:dev.digitallabor:limit-change:1`
- `credential_ids` is `[SPARKASSEN_AUTH_QUERY_ID]` — the DCQL query id constant, not the credential type constant.
- `transaction_data_hashes_alg` is `["sha-256"]`, sent explicitly.
- Ad-hoc mint `ttl_secs` is `900`.
- JWT locale tags are **`en-US` and `de-DE`**. The app's own `Locale` is `en` / `de`. Never derive one from the other.
- Preset limits, in cents: `50_000`, `100_000`, `200_000`, `500_000`.
- `accounts.daily_limit_cents` DEFAULT is `100000`.
- Limit-change session TTL is 5 minutes (`LIMIT_CHANGE_SESSION_TTL_MS = 5 * 60 * 1000`).
- Exact consent-screen copy is fixed by the spec's "The ad-hoc metadata JWT" section and must be transcribed verbatim, both locales.
- Read `drizzle-kit generate`'s SQL output before committing it. This repo has twice had it emit an unrunnable table rebuild.

## Review Focus

Five failure modes the spec implies that no task's happy path exercises. Each has a test added to the owning task.

1. **A mint failure must not produce a verification request.** If `createAdHocMetadata` throws, `startLimitChange` fails the row and `createVerificationRequest` is never called — an entry with no `metadata` is the spec's worst case, not a degraded one. *(Task 6)*
2. **An apply against a stale snapshot must fail.** Two dialogs open on one account: the second approval's `old_limit_cents` no longer matches the account, so it must be refused rather than silently overwrite. *(Task 8)*
3. **A hand-crafted start body must be rejected.** The dialog cannot send a non-preset, equal, zero, negative or non-integer `newLimitCents`, but a logged-in caller with `curl` can. *(Task 4 for the predicate, Task 9 for the route's 400)*
4. **A session id for another user or another account must answer 404**, indistinguishable from nonexistent — the id is guessable and the flow writes to an account. *(Tasks 7, 8, 9)*
5. **A second apply must be a no-op.** The `verified → applied` write is guarded on state so two concurrent applies cannot both debit the change. *(Task 8)*

---

### Task 1: `accounts.daily_limit_cents`

**Files:**
- Modify: `apps/bank/src/db/schema.ts`
- Modify: `apps/bank/src/db/seed.ts`
- Modify: `apps/bank/src/lib/queries.ts`
- Create: `apps/bank/drizzle/0005_*.sql` (drizzle-kit names it)
- Test: `apps/bank/src/db/schema.test.ts`, `apps/bank/src/lib/queries.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `accounts.dailyLimitCents` column; `AccountDto.dailyLimitCents: number`.

- [ ] **Step 1: Record the baseline**

Run `pnpm check` at HEAD and write the four per-project counts into the task's notes. This is the number every later delta is measured against.

- [ ] **Step 2: Write the failing tests**

In `apps/bank/src/db/schema.test.ts`:

```ts
it("defaults daily_limit_cents to 100000", () => {
  // insert a user + an account without dailyLimitCents
  expect(row.dailyLimitCents).toBe(100_000);
});

it("stores an explicit daily_limit_cents", () => {
  expect(row.dailyLimitCents).toBe(200_000);
});
```

In `apps/bank/src/lib/queries.test.ts`, inside the existing `listAccounts` describe:

```ts
it("returns the account's daily limit", () => {
  expect(listAccounts(db, "user_a")[0]!.dailyLimitCents).toBe(100_000);
});
```

- [ ] **Step 3: Run them and confirm they fail**

Run: `pnpm --filter @demo/bank test -- schema queries`
Expected: FAIL — `dailyLimitCents` is not a property of the row / DTO.

- [ ] **Step 4: Add the column**

In `schema.ts`, on `accounts`: `dailyLimitCents: integer("daily_limit_cents").notNull().default(100_000)`. Document in a comment that this gates nothing — no transfer feature exists to enforce it against — and that it is per-account by requirement.

- [ ] **Step 5: Generate and READ the migration**

Run: `pnpm --filter @demo/bank db:generate`
Open the generated `drizzle/0005_*.sql`. It must be a plain `ALTER TABLE accounts ADD COLUMN ...`. If drizzle emitted a table rebuild whose `INSERT … SELECT` names `daily_limit_cents` on both sides, hand-edit it down to the plain ADD — that form is unrunnable (`no such column`).

- [ ] **Step 6: Apply it to a real database**

Run: `pnpm --filter @demo/bank migrate` against a real file (not `:memory:`), confirm no error, then `pnpm --filter @demo/bank seed`.

- [ ] **Step 7: Widen `AccountDto` and the seed**

Add `dailyLimitCents: number` to `AccountDto` in `queries.ts` and select `accounts.dailyLimitCents` in `listAccounts`. In `seed.ts`, add `dailyLimitCents: 100_000` to the `accounts` insert explicitly rather than relying on the DEFAULT, so the demo's starting number is visible in the fixtures.

- [ ] **Step 8: Run the tests**

Run: `pnpm --filter @demo/bank test`
Expected: PASS, with no other suite regressing.

- [ ] **Step 9: Commit**

```bash
git add apps/bank/src/db apps/bank/src/lib/queries.ts apps/bank/drizzle
git commit -m "feat(bank): give each account a daily transfer limit"
```

---

### Task 2: `limit_change_sessions` table

**Files:**
- Modify: `apps/bank/src/db/schema.ts`
- Create: `apps/bank/drizzle/0006_*.sql`
- Test: `apps/bank/src/db/schema.test.ts`

**Interfaces:**
- Consumes: `users`, `accounts` from Task 1.
- Produces: `limitChangeSessions` table; `export type LimitChangeSession = typeof limitChangeSessions.$inferSelect;` and `export type LimitChangeSessionState = LimitChangeSession["state"];`

- [ ] **Step 1: Write the failing tests**

In `schema.test.ts`:

```ts
it("defaults a limit-change session to pending over request_uri", () => {
  expect(row.state).toBe("pending");
  expect(row.transport).toBe("request_uri");
});

it("accepts the three transports", () => { /* request_uri, dc_api, dc_api_signed */ });

it("leaves approved_by_user_id null until the gate resolves it", () => {
  expect(row.approvedByUserId).toBeNull();
});

it("requires started_by_user_id, account_id and both limit snapshots", () => {
  // omitting any one throws
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm --filter @demo/bank test -- schema`
Expected: FAIL — `limitChangeSessions` is not exported.

- [ ] **Step 3: Add the table**

In `schema.ts`, `limitChangeSessions = sqliteTable("limit_change_sessions", {...})` with exactly the columns in the spec's Data section: `id`, `startedByUserId` (NOT NULL FK → users), `approvedByUserId` (nullable FK → users), `accountId` (NOT NULL FK → accounts), `oldLimitCents`, `newLimitCents`, `foundryVerificationId`, `state` enum `["pending","verified","applied","failed"]` default `pending`, `failureReason`, `openid4vpUri`, `requestUri`, `transport` enum `["request_uri","dc_api","dc_api_signed"]` default `request_uri`, `dcApiRequestJson`, `dcApiProtocol`, `createdAt`.

Carry the spec's reasoning into comments: why two user columns rather than one, why `verified` and `applied` are separate states, why there is no `expired` state, why `oldLimitCents` is a snapshot.

- [ ] **Step 4: Generate, read and apply the migration**

Run: `pnpm --filter @demo/bank db:generate`, read the SQL (a `CREATE TABLE`, no rebuild of neighbours), then `pnpm --filter @demo/bank migrate` against a real file.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @demo/bank test -- schema`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/bank/src/db/schema.ts apps/bank/drizzle
git commit -m "feat(bank): add limit_change_sessions"
```

---

### Task 3: foundry-client ad-hoc metadata mint

**Files:**
- Modify: `packages/foundry-client/src/types.ts`
- Modify: `packages/foundry-client/src/client.ts`
- Test: `packages/foundry-client/src/client.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
export interface AdHocMetadataRequest {
  credential_type_id: string;
  transaction_data_type: string;
  metadata?: unknown;
  ttl_secs?: number;
}
export interface AdHocMetadataResponse {
  jwt: string;
  exp: number;
}
// on FoundryClient:
async createAdHocMetadata(req: AdHocMetadataRequest): Promise<AdHocMetadataResponse>
```

- [ ] **Step 1: Write the failing tests**

In `client.test.ts`, following the existing stubbed-`fetch` pattern:

```ts
it("POSTs the mint request to /admin/paso/ad-hoc-metadata", async () => {
  // assert method, path, bearer header, and the body round-trips verbatim
});

it("returns the minted jwt and exp", async () => {
  expect(result).toEqual({ jwt: "a.b.c", exp: 1792427805 });
});

it("throws FoundryError on a non-2xx", async () => {
  await expect(/* 400 */).rejects.toBeInstanceOf(FoundryError);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm --filter @demo/foundry-client test`
Expected: FAIL — `createAdHocMetadata` is not a function.

- [ ] **Step 3: Implement `createAdHocMetadata`**

One more `this.request<AdHocMetadataResponse>("POST", "/admin/paso/ad-hoc-metadata", req)` method, beside `createVerificationRequest`. `metadata` is typed `unknown` for the same reason `offer_display` is `unknown[]`: foundry validates a shape this package should not re-declare.

Document on the type that the route is **admin-only** and lives on the admin listener — `foundry.digitallabor.dev/admin/*` 404s for every admin path, which reads as "endpoint missing" and is not.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @demo/foundry-client test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/foundry-client/src
git commit -m "feat(foundry-client): mint PaSO ad-hoc transaction data metadata"
```

---

### Task 4: Limit presets and validation

**Files:**
- Create: `apps/bank/src/lib/limit-presets.ts`
- Test: `apps/bank/src/lib/limit-presets.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
export const LIMIT_PRESETS_CENTS: readonly number[];      // [50_000, 100_000, 200_000, 500_000]
export function isSelectablePreset(presetCents: number, currentCents: number): boolean;
export function isValidNewLimit(value: unknown, currentCents: number): value is number;
```

- [ ] **Step 1: Write the failing tests**

```ts
it("offers 500, 1000, 2000 and 5000 euro", () => {
  expect(LIMIT_PRESETS_CENTS).toEqual([50_000, 100_000, 200_000, 500_000]);
});

it("does not offer the preset equal to the current limit", () => {
  expect(isSelectablePreset(100_000, 100_000)).toBe(false);
  expect(isSelectablePreset(200_000, 100_000)).toBe(true);
});

// Review Focus 3 — a hand-crafted request, not something the dialog can send
it.each([
  ["a non-preset amount", 150_000],
  ["the current limit", 100_000],
  ["zero", 0],
  ["a negative amount", -100_000],
  ["a fractional amount", 100_000.5],
  ["a numeric string", "200000"],
  ["null", null],
  ["NaN", Number.NaN],
])("rejects %s", (_label, value) => {
  expect(isValidNewLimit(value, 100_000)).toBe(false);
});

it("accepts a different preset", () => {
  expect(isValidNewLimit(200_000, 100_000)).toBe(true);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm --filter @demo/bank test -- limit-presets`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

`isValidNewLimit` is a type predicate and must fail closed on every non-`number`, non-integer and non-preset input — the route trusts it instead of writing its own guard. Document that the presets are **cents, not copy**: they are formatted at render through the existing `formatEuroCents`, so the catalog never holds an amount.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @demo/bank test -- limit-presets`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/bank/src/lib/limit-presets.ts apps/bank/src/lib/limit-presets.test.ts
git commit -m "feat(bank): add the daily-limit presets and their validation"
```

---

### Task 5: The `transaction_data` entry and its ad-hoc metadata

**Files:**
- Create: `apps/bank/src/lib/limit-transaction-data.ts`
- Test: `apps/bank/src/lib/limit-transaction-data.test.ts`

**Interfaces:**
- Consumes: `SPARKASSEN_AUTH_QUERY_ID`, `SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID` from `lib/credential-types.js`; `AdHocMetadataRequest` from `@demo/foundry-client` (Task 3 — this task does not compile without it).
- Produces:

```ts
export const LIMIT_CHANGE_TRANSACTION_DATA_TYPE: string;  // urn:paso:sca:dev.digitallabor:limit-change:1
export const LIMIT_CHANGE_METADATA_TTL_SECS: number;      // 900
export function limitAmountString(cents: number): string; // "EUR 1000.00"
export function buildLimitChangeAdHocMetadataRequest(): AdHocMetadataRequest;
export function buildLimitChangeTransactionData(input: {
  oldLimitCents: number;
  newLimitCents: number;
  metadataJwt: string;
}): unknown[];
```

- [ ] **Step 1: Write the failing tests**

```ts
it("names the limit-change type", () => {
  expect(LIMIT_CHANGE_TRANSACTION_DATA_TYPE)
    .toBe("urn:paso:sca:dev.digitallabor:limit-change:1");
});

it.each([
  [100_000, "EUR 1000.00"],
  [200_000, "EUR 2000.00"],
  [50_000, "EUR 500.00"],
  [99, "EUR 0.99"],
])("formats %i cents as %s", (cents, expected) => {
  expect(limitAmountString(cents)).toBe(expected);
});

it("never localises the amount", () => {
  // no thousands separator, no comma decimal — the string is hashed byte-for-byte
  expect(limitAmountString(1_234_567)).toBe("EUR 12345.67");
});

it("binds to the authenticator query and nothing else", () => {
  expect(entry.credential_ids).toEqual([SPARKASSEN_AUTH_QUERY_ID]);
});

it("states the hash algorithm explicitly", () => {
  expect(entry.transaction_data_hashes_alg).toEqual(["sha-256"]);
});

it("carries exactly old_limit and new_limit", () => {
  expect(entry.payload).toEqual({ old_limit: "EUR 1000.00", new_limit: "EUR 2000.00" });
});

it("carries the minted JWT verbatim in `metadata`", () => {
  expect(entry.metadata).toBe("a.b.c");
});

it("sends one entry", () => {
  expect(buildLimitChangeTransactionData({ ... })).toHaveLength(1);
});

// the mint request
it("mints against the authenticator credential type for this type id", () => {
  expect(req.credential_type_id).toBe(SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID);
  expect(req.transaction_data_type).toBe(LIMIT_CHANGE_TRANSACTION_DATA_TYPE);
  expect(req.ttl_secs).toBe(900);
});

it("describes both claims with region-tagged locales and a currency value type", () => {
  const paths = req.metadata.claims.map((c) => c.path.join("."));
  expect(paths).toEqual(["old_limit", "new_limit"]);
  for (const claim of req.metadata.claims) {
    expect(claim.value_type).toBe("iso_currency_amount");
    expect(claim.display.map((d) => d.locale)).toEqual(["en-US", "de-DE"]);
  }
});

it("supplies the consent screen's title, both actions and the security hint", () => {
  expect(Object.keys(req.metadata.ui_labels).sort()).toEqual([
    "affirmative_action_label", "denial_action_label", "security_hint", "transaction_title",
  ]);
});

it("uses the exact affirmative action the design fixes", () => {
  expect(req.metadata.ui_labels.affirmative_action_label).toEqual([
    { locale: "en-US", value: "Confirm Limit Change" },
    { locale: "de-DE", value: "Limitänderung bestätigen" },
  ]);
});

it("never uses this app's own locale tags", () => {
  // no bare "en" or "de" anywhere in the minted metadata
  expect(JSON.stringify(req.metadata)).not.toMatch(/"locale":"(en|de)"/);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm --filter @demo/bank test -- limit-transaction-data`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

`limitAmountString` is `` `EUR ${(cents / 100).toFixed(2)}` `` — `toFixed`, never `Intl`, because the string is hashed byte-for-byte and a localised separator would make the signed artefact depend on the browser's locale.

`buildLimitChangeAdHocMetadataRequest` returns the constant from the spec's "The ad-hoc metadata JWT" section, transcribed verbatim — both claims, all four `ui_labels`, both locales. It takes no arguments: nothing in it varies per request, and the payload amounts live in the `transaction_data` entry rather than in its metadata.

`buildLimitChangeTransactionData` returns one entry as **plain JSON** — foundry performs the OpenID4VP §8.4 base64url encoding itself, so a pre-encoded value would be double-encoded.

Carry the spec's reasoning into the docstrings: why `credential_ids` is the query-id constant, why the amount is locale-neutral, why `metadata` failing to mint must abort rather than degrade.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @demo/bank test -- limit-transaction-data`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/bank/src/lib/limit-transaction-data.ts apps/bank/src/lib/limit-transaction-data.test.ts
git commit -m "feat(bank): build the limit-change transaction_data entry"
```

---

### Task 6: `startLimitChange`

**Files:**
- Create: `apps/bank/src/lib/limit-change-sessions.ts`
- Test: `apps/bank/src/lib/limit-change-sessions.test.ts`

**Interfaces:**
- Consumes: Tasks 1–5; `isDcApiTransport`, `resolveDcApiProtocol`, `PresentationTransport` from `lib/transport.js`.
- Produces:

```ts
export const LIMIT_CHANGE_SESSION_TTL_MS: number;  // 5 * 60 * 1000

export interface LimitChangeSessionDto {
  sessionId: string;
  accountId: string;
  uri: string | null;
  transport: PresentationTransport;
  dcApiRequest: unknown;
  dcApiProtocol: string | null;
  state: LimitChangeSessionState;
  oldLimitCents: number;
  newLimitCents: number;
}

export type StartLimitChangeResult =
  | { ok: true; session: LimitChangeSessionDto }
  | { ok: false; reason: "not_found" | "invalid_limit" | "metadata_unavailable" | "foundry_unavailable" };

export async function startLimitChange(
  db: Db,
  client: FoundryClient,
  input: { userId: string; accountId: string; newLimitCents: unknown },
  now?: number,
): Promise<StartLimitChangeResult>;
```

- [ ] **Step 1: Write the failing tests**

```ts
it("refuses an account the user does not own", () => {
  expect(result).toEqual({ ok: false, reason: "not_found" });
});

it("refuses a nonexistent account with the same reason", () => { /* not_found */ });

it("refuses a new limit that is not a selectable preset", () => {
  // delegates to isValidNewLimit — one case here, the matrix is Task 4's
  expect(result).toEqual({ ok: false, reason: "invalid_limit" });
});

it("writes a pending row before calling foundry", async () => {
  // foundry stub throws; a `failed` row still exists naming the attempted transport
});

it("snapshots the account's current limit", () => {
  expect(row.oldLimitCents).toBe(100_000);
});

it("mints the metadata and passes the jwt into transaction_data", async () => {
  const entry = createVerificationRequest.mock.calls[0][0].transaction_data[0];
  expect(entry.metadata).toBe("minted.jwt.value");
});

// Review Focus 1 — the anti-goal made executable
it("creates NO verification request when the mint fails", async () => {
  // createAdHocMetadata rejects
  expect(createVerificationRequest).not.toHaveBeenCalled();
  expect(result).toEqual({ ok: false, reason: "metadata_unavailable" });
  expect(row.state).toBe("failed");
  expect(row.failureReason).toBe("metadata_unavailable");
});

it("records the transport foundry actually served", async () => {
  // asked dc_api_signed, foundry answered with a request_uri and no dc_api_request
  expect(row.transport).toBe("request_uri");
  expect(row.dcApiProtocol).toBeNull();
});

it("records dc_api_signed when foundry serves it", async () => { /* protocol persisted verbatim */ });

it("fails the row when foundry refuses the verification request", async () => {
  expect(result).toEqual({ ok: false, reason: "foundry_unavailable" });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm --filter @demo/bank test -- limit-change-sessions`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `startLimitChange`**

Order: resolve + own the account → `isValidNewLimit` → insert the `pending` row with the attempted transport → mint → `createVerificationRequest` with `named_query_ref: SPARKASSEN_AUTH_NAMED_QUERY` and the entry → persist what foundry served, with the same soft fallback `startLoginSession` uses.

The mint is inside the same `try` as the verification request but its failure gets its **own** reason, because "foundry is down" and "foundry will not describe this type" are different operator problems.

Session id is `limit_${randomUUID()}`.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @demo/bank test -- limit-change-sessions`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/bank/src/lib/limit-change-sessions.ts apps/bank/src/lib/limit-change-sessions.test.ts
git commit -m "feat(bank): open a limit-change presentation"
```

---

### Task 7: `refreshLimitChangeState` — the identity gate

**Files:**
- Modify: `apps/bank/src/lib/limit-change-sessions.ts`
- Test: `apps/bank/src/lib/limit-change-sessions.test.ts`

**Interfaces:**
- Consumes: `extractAuthSubject`, `passedLoginBinding` from `lib/login-checks.js` (both already scoped to the authenticator query and already fail closed).
- Produces:

```ts
export interface LimitChangeStatusDto {
  state: LimitChangeSessionState;
  failureReason?: string;
  newLimitCents: number;
}

export type RefreshLimitChangeResult =
  | { ok: true; status: LimitChangeStatusDto }
  | { ok: false; reason: "not_found" };

export function getLimitChangeStatus(db: Db, userId: string, accountId: string, sessionId: string): LimitChangeStatusDto | null;

export async function refreshLimitChangeState(
  db: Db,
  foundry: FoundryClient,
  input: { userId: string; accountId: string; sessionId: string },
  now?: number,
): Promise<RefreshLimitChangeResult>;
```

- [ ] **Step 1: Write the failing tests**

```ts
// Review Focus 4
it("answers not_found for another user's session", async () => { /* ok: false */ });
it("answers not_found for the right session under the wrong account", async () => { /* ok: false */ });
it("answers not_found for a nonexistent session", async () => { /* ok: false */ });

it("stops polling on a terminal state", async () => {
  expect(getVerificationStatus).not.toHaveBeenCalled();
});

it("fails an expired session without calling foundry", async () => {
  expect(status.failureReason).toBe("expired");
  expect(getVerificationStatus).not.toHaveBeenCalled();
});

it("stays pending when foundry is unreachable", async () => {
  expect(status.state).toBe("pending");
});

it("fails on an unverified verdict", async () => { /* verification_failed */ });

it("fails when no authenticator credential answered", async () => { /* verification_failed */ });

it("fails when the wallet did not sign over transaction_data", async () => {
  expect(status.failureReason).toBe("transaction_data_binding_failed");
});

it("fails when the sub matches no credential", async () => {
  expect(status.failureReason).toBe("unknown_credential");
});

// the gate this flow adds over wallet login
it("fails when the approving authenticator belongs to someone else", async () => {
  expect(status.failureReason).toBe("wrong_customer");
  expect(row.state).toBe("failed");
});

it("verifies and records who approved", async () => {
  expect(row.state).toBe("verified");
  expect(row.approvedByUserId).toBe("user_a");
});

it("writes no limit of its own", async () => {
  expect(account.dailyLimitCents).toBe(100_000);   // unchanged by the poll
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm --filter @demo/bank test -- limit-change-sessions`
Expected: FAIL

- [ ] **Step 3: Implement the poll**

Mirror `refreshLoginSessionState`'s ordering exactly: terminal → expiry → already-verified → foundry. Then the four gates in the spec's order — verified verdict, `passedLoginBinding`, `extractAuthSubject`, and the owner match against `startedByUserId`.

Keep the binding gate between *reading* the `sub` and *resolving* it, for the reason `login-sessions.ts` documents: reading a claim out of a JSON blob is inert; turning it into a customer is the act.

The owner mismatch gets its own reason (`wrong_customer`), distinct from `unknown_credential`, so an operator can tell a stranger's credential from an unregistered one. The holder sees the generic copy for both.

Document why this gate lives here and not in apply: otherwise a stranger's valid presentation drives the session to `verified` and the holder sees a success-shaped dialog that apply then rejects.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @demo/bank test -- limit-change-sessions`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/bank/src/lib/limit-change-sessions.ts apps/bank/src/lib/limit-change-sessions.test.ts
git commit -m "feat(bank): gate a limit change on the customer's own authenticator"
```

---

### Task 8: `applyLimitChange` and the DC API relay

**Files:**
- Modify: `apps/bank/src/lib/limit-change-sessions.ts`
- Test: `apps/bank/src/lib/limit-change-sessions.test.ts`

**Interfaces:**
- Consumes: Task 7.
- Produces:

```ts
export type ApplyLimitChangeResult =
  | { ok: true; dailyLimitCents: number }
  | { ok: false; reason: "not_found" | "not_verified" | "already_applied" | "expired" | "limit_changed" };

export function applyLimitChange(
  db: Db,
  input: { userId: string; accountId: string; sessionId: string },
  now?: number,
): ApplyLimitChangeResult;

export async function relayLimitChangeDcApiResponse(
  db: Db,
  client: FoundryClient,
  input: { userId: string; accountId: string; sessionId: string; response: string },
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "no_verification" | "foundry_unavailable" }>;
```

- [ ] **Step 1: Write the failing tests**

```ts
it("writes the new limit and consumes the session", () => {
  expect(result).toEqual({ ok: true, dailyLimitCents: 200_000 });
  expect(account.dailyLimitCents).toBe(200_000);
  expect(row.state).toBe("applied");
});

it("refuses a session that is still pending", () => { /* not_verified */ });

// Review Focus 5
it("refuses a second apply", () => {
  applyLimitChange(db, input);
  expect(applyLimitChange(db, input)).toEqual({ ok: false, reason: "already_applied" });
});

it("writes the limit exactly once", () => {
  // two applies, account still at 200_000, and the second did not re-write it
});

// Review Focus 2
it("refuses to apply against a stale snapshot", () => {
  // account's limit moved after the session was created
  expect(result).toEqual({ ok: false, reason: "limit_changed" });
  expect(account.dailyLimitCents).toBe(/* the value set underneath, untouched */);
});

it("refuses an expired session", () => { /* expired */ });

// Review Focus 4
it("refuses another user's session", () => { /* not_found */ });
it("refuses the right session under the wrong account", () => { /* not_found */ });

// relay
it("relays the wallet response to foundry", async () => {
  expect(submitDcApiResponse).toHaveBeenCalledWith("ver_1", "jwe");
});
it("refuses to relay another user's session", async () => { /* not_found */ });
it("reports foundry being unreachable", async () => { /* foundry_unavailable */ });
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm --filter @demo/bank test -- limit-change-sessions`
Expected: FAIL

- [ ] **Step 3: Implement both**

`applyLimitChange` is synchronous (better-sqlite3 is), and the `verified → applied` transition is a **guarded UPDATE** whose `.changes` decides whether this call won — a read-then-write would let two concurrent applies both proceed. Re-read the account inside the same path and refuse when `dailyLimitCents !== row.oldLimitCents`; that is the stale-snapshot gate and it must come before the guarded write so a refused apply leaves the session claimable.

Ownership is checked in this function, not in the route, for the same reason `getTransactionProof` checks it rather than its route.

`relayLimitChangeDcApiResponse` is `dc-api-relay.ts`'s shape with the ownership check added. Duplicated rather than generalised: the login relay is already tested where it lives and takes no owner, and a shared relay would need a table parameter to serve both.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @demo/bank test -- limit-change-sessions`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/bank/src/lib/limit-change-sessions.ts apps/bank/src/lib/limit-change-sessions.test.ts
git commit -m "feat(bank): apply an approved limit change exactly once"
```

---

### Task 9: The four routes

**Files:**
- Create: `apps/bank/src/app/api/accounts/[id]/limit-change/route.ts`
- Create: `apps/bank/src/app/api/accounts/[id]/limit-change/[sessionId]/route.ts`
- Create: `apps/bank/src/app/api/accounts/[id]/limit-change/[sessionId]/apply/route.ts`
- Create: `apps/bank/src/app/api/accounts/[id]/limit-change/[sessionId]/dc-api-response/route.ts`
- Test: `apps/bank/src/app/api/accounts/[id]/limit-change/route.test.ts`

**Interfaces:**
- Consumes: Tasks 6–8; `withSession` from `lib/api.js`.
- Produces: HTTP. The start route's 201 body **is** a `LimitChangeSessionDto`.

- [ ] **Step 1: Write the failing tests**

```ts
it("answers 201 with exactly the session's own prop names", async () => {
  expect(Object.keys(body).sort()).toEqual([
    "accountId", "dcApiProtocol", "dcApiRequest", "newLimitCents",
    "oldLimitCents", "sessionId", "state", "transport", "uri",
  ]);
});

it("agrees with the row it wrote", async () => {
  // body members equal the persisted columns, including dcApiProtocol
});

// Review Focus 3
it("answers 400 for a non-preset newLimitCents", async () => { expect(res.status).toBe(400); });
it("answers 400 for a missing body", async () => { expect(res.status).toBe(400); });

// Review Focus 4
it("answers 404 for an account the caller does not own", async () => { expect(res.status).toBe(404); });

it("answers 502 when foundry cannot be reached", async () => { expect(res.status).toBe(502); });
it("answers 502 when the metadata cannot be minted", async () => { expect(res.status).toBe(502); });

it("reads the session id from the path without throwing on a malformed url", async () => {
  // the poll route answers 404 rather than 500
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm --filter @demo/bank test -- limit-change/route`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement the routes**

All four are `withSession(...)`. `withSession` hands the handler `(session, request)` **and nothing else**, so every dynamic segment is read by plain string splitting off `request.url.split("?")[0]`, never `new URL(...)` — an unreadable id must fall through to a 404, not a 500. Segment offsets:

| route | accountId | sessionId |
| --- | --- | --- |
| `POST …/limit-change` | `.at(-2)` | — |
| `GET …/limit-change/{sessionId}` | `.at(-3)` | `.at(-1)` |
| `POST …/{sessionId}/apply` | `.at(-4)` | `.at(-2)` |
| `POST …/{sessionId}/dc-api-response` | `.at(-4)` | `.at(-2)` |

The start route's body is `NextResponse.json(result.session, { status: 201 })` — the DTO passed straight through, never re-assembled from its members. `startLimitChange` carries the written-out `LimitChangeSessionDto` annotation; that annotation is the guard. This repo lost `dcApiProtocol` at exactly this seam once already.

Status mapping: `not_found` → 404, `invalid_limit` → 400, `metadata_unavailable` / `foundry_unavailable` → 502. On apply: `already_applied` → 410, `not_verified` → 409, `limit_changed` → 409, `expired` → 410. The relay returns 204 and discards foundry's verdict, so the poll remains the single state path.

Zod-parse the start body as `z.object({ newLimitCents: z.number() })`; a missing or unparseable body is a 400 here, unlike the wallet-login route — every field is required, so there *is* a request a 400 usefully rejects.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @demo/bank test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "apps/bank/src/app/api/accounts/[id]"
git commit -m "feat(bank): expose the limit-change routes"
```

---

### Task 10: The dialog's decisions

**Files:**
- Create: `apps/bank/src/lib/limit-dialog-state.ts`
- Test: `apps/bank/src/lib/limit-dialog-state.test.ts`

**Interfaces:**
- Consumes: nothing. Deliberately a sibling of `login-dialog-state.ts`, not an extension of it — the phases differ.
- Produces:

```ts
export type LimitPhase = "choose" | "waiting" | "success" | "error";
export type LimitFailureKey = "expired" | "unknownCredential" | "limitChanged" | "verificationFailed";

export function isLimitTerminal(state: string): boolean;
export function selectLimitPhase(
  state: string | null,
  applied: boolean,
  pollFailed: boolean,
): LimitPhase;
export function limitFailureKey(failureReason: string | undefined): LimitFailureKey;
```

Affordance selection reuses `selectLoginAffordance` from `login-dialog-state.js` unchanged — the three transports and the touch rule are identical, and a second copy could only drift.

- [ ] **Step 1: Write the failing tests**

```ts
it("has not started until a session exists", () => {
  expect(selectLimitPhase(null, false, false)).toBe("choose");
});

it("keeps waiting on a verified session until the apply lands", () => {
  // same trap login has: success here would claim a limit that is not written yet
  expect(selectLimitPhase("verified", false, false)).toBe("waiting");
});

it("promotes to success only once applied", () => {
  expect(selectLimitPhase("verified", true, false)).toBe("success");
});

it("lets a successful apply outrank a late poll failure", () => {
  expect(selectLimitPhase("failed", true, true)).toBe("success");
});

it("reports a failed session as an error", () => {
  expect(selectLimitPhase("failed", false, false)).toBe("error");
});

it("stops polling on applied, verified and failed", () => {
  expect(isLimitTerminal("applied")).toBe(true);
  expect(isLimitTerminal("verified")).toBe(true);
  expect(isLimitTerminal("failed")).toBe(true);
  expect(isLimitTerminal("pending")).toBe(false);
});

it("keeps polling on an unrecognised state", () => {
  expect(isLimitTerminal("something_new")).toBe(false);
});

it.each([
  ["expired", "expired"],
  ["unknown_credential", "unknownCredential"],
  ["limit_changed", "limitChanged"],
  ["wrong_customer", "verificationFailed"],
  ["transaction_data_binding_failed", "verificationFailed"],
  ["metadata_unavailable", "verificationFailed"],
  [undefined, "verificationFailed"],
])("maps %s to %s", (reason, key) => {
  expect(limitFailureKey(reason)).toBe(key);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm --filter @demo/bank test -- limit-dialog-state`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

`isLimitTerminal` fails **open** on an unrecognised state (keep polling; the client's own timeout is the backstop). `limitFailureKey` falls everything it does not recognise through to `verificationFailed` — a reason the holder cannot act on should not be spelled out to them. Only `expired`, `unknownCredential` and `limitChanged` name a remedy.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @demo/bank test -- limit-dialog-state`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/bank/src/lib/limit-dialog-state.ts apps/bank/src/lib/limit-dialog-state.test.ts
git commit -m "feat(bank): extract the limit-change dialog's decisions"
```

---

### Task 11: Copy, both locales

**Files:**
- Modify: `apps/bank/src/lib/i18n/messages.ts`
- Modify: `apps/bank/src/lib/i18n/en.ts`
- Modify: `apps/bank/src/lib/i18n/de.ts`
- Test: `apps/bank/src/lib/i18n/messages.test.ts` (existing invariants cover new leaves; add nothing unless a leaf needs a named case)

**Interfaces:**
- Consumes: nothing.
- Produces: `Messages["limits"]`, with these keys:

```ts
limits: {
  /** The row's caption in the account panel. */
  dailyTransfer: string;
  change: string;
  dialogTitle: string;
  /** Sets the expectation before the wallet opens. */
  dialogLead: string;
  currentLimit: string;
  newLimit: string;
  continue: string;
  cancel: string;
  close: string;
  approveTitle: string;
  confirmInApp: string;
  openInWallet: string;
  scanCode: string;
  qrAlt: string;
  waiting: string;
  preparing: string;
  successTitle: string;
  /** Names the new amount. */
  successBody: (limit: string) => string;
  failedTitle: string;
  /** failure_reason `expired` */
  expired: string;
  /** failure_reason `unknown_credential` — names the remedy: add it again. */
  unknownCredential: string;
  /** failure_reason `limit_changed` — the limit moved; start again. */
  limitChanged: string;
  /** Everything else, including wrong_customer and metadata_unavailable. */
  verificationFailed: string;
};
```

- [ ] **Step 1: Run the existing catalog invariants and confirm they fail**

Add the `limits` block to `Messages` only. Run: `pnpm --filter @demo/bank typecheck`
Expected: FAIL — `en` and `de` are missing `limits`. **`tsc` is the real gate for copy here**, not vitest: a key present in one catalog and missing from the other is a compile error, and `messages.test.ts`'s invariants (identical key sets, no empty leaf, no leaf byte-identical across locales) cover new leaves without new cases.

- [ ] **Step 2: Write both catalogs**

Fill `en` and `de`. No leaf may be byte-identical across locales — `cancel`/`Abbrechen` and `close`/`Schließen` differ, but check `continue` does too.

Note: none of this copy is the wallet's. The consent screen's strings live in the ad-hoc metadata JWT (Task 5) with `en-US`/`de-DE` tags, and are chosen by the wallet. Two places hold limit-change copy; they answer to different authorities and must not be unified.

- [ ] **Step 3: Run typecheck and the catalog tests**

Run: `pnpm --filter @demo/bank typecheck && pnpm --filter @demo/bank test -- messages`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/bank/src/lib/i18n
git commit -m "feat(bank): add limit-change copy in both locales"
```

---

### Task 12: The account panel row and the dialog

**Files:**
- Create: `apps/bank/src/components/AccountLimitRow.tsx` (client)
- Create: `apps/bank/src/components/LimitChangeDialog.tsx` (client)
- Modify: `apps/bank/src/components/AccountPanel.tsx`
- Test: none new — every decision these render is already tested in Tasks 4, 10 and 11.

**Interfaces:**
- Consumes: Tasks 4, 9, 10, 11; `useDcApiSupport` from `@demo/ui`; `parseDcApiForm`, `presentationProtocolFor`, `selectTransport` from `lib/transport.js`; `selectLoginAffordance` from `lib/login-dialog-state.js`; `formatEuroCents` from `lib/format.js`.
- Produces: UI only.

- [ ] **Step 1: Add the row to `AccountPanel`**

Below the balance and its `available` caption, separated by a rule: the `dailyTransfer` caption, the amount via `formatEuroCents(account.dailyLimitCents, locale)`, and `AccountLimitRow` carrying the Change control. `AccountPanel` stays a server component; `AccountLimitRow` is the client boundary and receives `accountId`, `dailyLimitCents`, `locale` and `dcApiForm` as props.

- [ ] **Step 2: Build the dialog**

Three phases from `selectLimitPhase`, with `selectLoginAffordance` choosing between the wallet button, a deep link and a QR exactly as the login dialog does.

Two constraints that are not negotiable:

- **Detection and session creation happen on the click, before the dialog's own wallet button renders** — Chrome consumes a click's transient activation, so no `await` may run between that handler starting and `navigator.credentials.get()`. `dcApiRequest` must already be a prop by then. Copy `WalletLoginButton`'s structure.
- **A DC API session cannot be re-rendered as a QR.** Recovery creates a *new* `request_uri` session; that is what "show QR code" does.

The chip list comes from `LIMIT_PRESETS_CENTS` filtered by `isSelectablePreset`, so Continue can never send a no-op.

The poll stops on `isLimitTerminal`. On `verified` the client **POSTs `…/apply` once** and sets its own `applied` flag from the 2xx — the limit is not written until that call lands, which is why `selectLimitPhase("verified", false, …)` is still `waiting`. A non-2xx apply sets `pollFailed`, so the dialog reports an error rather than claiming a limit it did not write.

On `applied`, show `successBody(formatEuroCents(newLimitCents, locale))` and refresh the panel behind it (`router.refresh()`).

- [ ] **Step 3: Decide the no-credential case and say why**

The spec leaves this to you: either suppress the Change control when the customer holds no `sparkassen_auth` credential, or show it and let the flow fail with `unknown_credential` copy that names the remedy. Suppressing is friendlier; showing is more honest about what the demo needs. Pick one and state the reason in the commit message.

If you suppress, the check is a `getAuthenticatorCredentialState` read in `page.tsx` passed down as a prop — not a client fetch, which would flash the control before hiding it.

- [ ] **Step 4: Read `?dcapi=` server-side**

In `apps/bank/src/app/page.tsx`, read `searchParams` and pass `parseDcApiForm(...)` down. **Not** `useSearchParams` — a client read there would need a Suspense boundary and the button would not have the answer before the click.

- [ ] **Step 5: Verify it renders**

Run: `pnpm --filter @demo/bank build`
Expected: a clean production build. Then `pnpm check`.
Expected: green, with the baseline from Task 1 plus the measured delta.

- [ ] **Step 6: Commit**

```bash
git add apps/bank/src/components apps/bank/src/app/page.tsx
git commit -m "feat(bank): offer a daily-limit change from the account panel"
```

---

### Task 13: Verification against the deployed system

**Files:** none. This task produces evidence and an `AGENTS.md` entry.

**Interfaces:**
- Consumes: everything.
- Produces: the claims the final commit is allowed to make.

- [ ] **Step 1: Point the bank at the deployed foundry**

Set `FOUNDRY_ADMIN_URL=https://foundry-admin.digitallabor.dev` and the real `FOUNDRY_ADMIN_KEY` (`kubectl -n foundry get secret foundry-admin -o jsonpath='{.data.admin-api-key}' | base64 -d`) in `apps/bank/.env.local`.

The **local** foundry declares neither `sparkassen_auth` nor its named query, so none of this flow works against a stock `pnpm dev` — it takes `startLimitChange`'s failure path every time.

- [ ] **Step 2: Drive a real session and read the request object back**

Start a limit change over `request_uri`, then fetch the `request_uri` foundry served and decode its `transaction_data`. Confirm, byte-exact against what was sent:

- the entry's `type` is `urn:paso:sca:dev.digitallabor:limit-change:1`;
- `payload` is exactly `{ old_limit, new_limit }` with the `"EUR 0.00"` shape;
- **`metadata` is present and is the minted JWT** — foundry models `transaction_data` as raw JSON values so it should pass through, but "should" is not "did", and this is the one member the whole feature rests on;
- the DCQL query's only credential id is `sparkassen_auth`.

- [ ] **Step 3: Prove the 200 is evidence**

Send the same request with a deliberately bogus `credential_ids` entry. Expected: **HTTP 400** `transaction_data[0] references credential id '<id>' which is not present in the DCQL query`. Without this, a 200 could be serde silently dropping a field.

- [ ] **Step 4: Drive the browser**

With `tools/cdp/cdp.mjs`, open the dashboard, open the dialog, pick a preset, and **click** the wallet button. Confirm a `dc_api_signed` row is written with a signed JWS and that no QR canvas renders; then `?dcapi=unsigned` produces a `dc_api` row.

Note the trap this repo has already fallen into: "renders the wallet button" and "the wallet button works" are different claims, and only the second is the feature. Click it.

- [ ] **Step 5: Record what is still unverified**

Add an `AGENTS.md` entry under **Hard-won constraints** and extend **Known-unverifiable**. State plainly that no wallet has answered a limit-change presentation, that §5.3's signature check and trust-store check are unobserved, and that whether a wallet implements `iso_currency_amount` is unknown. Hand the operator `?dcapi=unsigned` as the diagnostic if a real wallet fails by default.

- [ ] **Step 6: Final check and commit**

Run: `pnpm check`
Expected: green. Record the measured total and the per-project deltas in the `AGENTS.md` entry — measured, not projected.

```bash
git add AGENTS.md
git commit -m "docs: record what the limit-change flow verifies and what it does not"
```