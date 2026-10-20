# Send Money Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a bank customer send money to an external IBAN, with the amount, recipient, IBAN and purpose approved in their EUDI wallet via the Sparkassen Authenticator before the account is debited.

**Architecture:** A fourth wallet-approval flow in `apps/bank`, modelled directly on the existing limit change: a `transfer_sessions` row, a bank-owned `transaction_data` type rendered through a freshly minted PaSO §5 ad-hoc metadata JWT, a poll that gates on the presenting credential belonging to the signed-in customer, and a POST that writes the debit and the ledger row in one database transaction.

**Tech Stack:** Next.js 15 (App Router), TypeScript strict, drizzle-orm + better-sqlite3, vitest (`environment: "node"`), zod, Tailwind v4, `@demo/foundry-client`.

**Spec:** `docs/superpowers/specs/2026-10-20-send-money-design.md`

## Global Constraints

- **Amount string sent to the wallet is `"250.00 EUR"`** — decimal number, one space, ISO 4217 Alpha-3 code, **amount first**. `toFixed(2)`, **never** `Intl`. It is hashed byte-for-byte.
- **Locale tags in the minted JWT are bare `en` and `de`.** Never `en-US`/`de-DE`. Both locales always sent, regardless of UI locale.
- **`value_type: "iso_currency_amount"` on the `amount` claim only.** The other three claims carry no `value_type` at all (PaSO Proof Metadata §3.1: omitted ⇒ plain text).
- **`ttl_secs: 900`** in every ad-hoc mint request, stated explicitly.
- **`TRANSFER_SESSION_TTL_MS = 5 * 60 * 1000`.**
- **`transaction_data` is sent as plain JSON.** foundry does the OpenID4VP §8.4 base64url encoding; the minted JWT rides verbatim in `metadata`, never re-wrapped.
- **`credential_ids: [SPARKASSEN_AUTH_QUERY_ID]`** — the DCQL query id constant, not `SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID`.
- **All money is integer cents.** Column names end in `_cents`. Debits are **negative** `amount_cents` in `transactions`.
- **Local imports are written `./foo.js` for a `./foo.ts` file.**
- **Decisions live in `.ts`.** vitest is `environment: "node"`, `include: ["src/**/*.test.ts"]` — `.tsx` is covered by nothing.
- **`pnpm check` must be green.** Baseline at the start of this work: **1050** tests (710 bank + 287 merchant + 16 foundry-client + 37 ui). Measure the new total; never project it.
- **Commits** use conventional prefixes and state what was *verified*, and plainly what was not.

## Review Focus

Five input classes the spec implies that no task's happy path exercises. Each has its test added to the task that owns the code.

1. **A German-typed amount, `250,00`** — must parse to `25000`; and `1.250,00` (grouping separators) must be **rejected**, not silently parsed as `1.25`. → Task 3.
2. **An IBAN with one transposed digit** — passes the shape regex, fails mod-97. Must be refused; this is the exact typo the consent screen exists to catch. → Task 3.
3. **An amount exactly equal to the daily limit, and exactly equal to the balance** — the boundary decides whether a customer can send their whole balance. Both gates are `>`, so equal is **allowed**. → Tasks 5 and 7.
4. **A second apply of an already-applied session** (double-submitted POST) — must debit exactly once. Both the guarded UPDATE and the unique `idempotency_key` must hold. → Task 7.
5. **A limit change that lowers the limit while a transfer waits in the wallet** — apply must refuse and leave the session `verified` (claimable), not consume it. → Task 7.

---

## File Structure

**Created**

| File | Responsibility |
| --- | --- |
| `apps/bank/src/lib/iso-currency-amount.ts` | The one place integer cents become a PaSO `iso_currency_amount` string. |
| `apps/bank/src/lib/transfer-validation.ts` | Amount parsing, IBAN normalisation + mod-97, field limits. No database, no network. |
| `apps/bank/src/lib/transfer-transaction-data.ts` | The type constant, the ad-hoc metadata request, the `transaction_data` entry. Builds what is **sent**. |
| `apps/bank/src/lib/transfer-sessions.ts` | Start, poll, apply, relay. Reads what came **back**. |
| `apps/bank/src/lib/transfer-dialog-state.ts` | Every branch the dialog makes. |
| `apps/bank/src/components/SendMoneyDialog.tsx` | The modal. |
| `apps/bank/src/components/SendMoneyRow.tsx` | The client boundary inside `AccountPanel`. |
| `apps/bank/src/app/api/accounts/[id]/transfer/segments.ts` | Dynamic-segment reads. |
| `apps/bank/src/app/api/accounts/[id]/transfer/route.ts` | `POST` start. |
| `apps/bank/src/app/api/accounts/[id]/transfer/[sessionId]/route.ts` | `GET` poll. |
| `apps/bank/src/app/api/accounts/[id]/transfer/[sessionId]/apply/route.ts` | `POST` apply. |
| `apps/bank/src/app/api/accounts/[id]/transfer/[sessionId]/dc-api-response/route.ts` | `POST` relay. |

Each `lib/*.ts` gets a sibling `*.test.ts`; the start route gets `route.test.ts`.

**Modified:** `apps/bank/src/db/schema.ts`, `apps/bank/src/db/seed.ts`, `apps/bank/src/lib/limit-transaction-data.ts`, `apps/bank/src/lib/i18n/messages.ts`, `en.ts`, `de.ts`, `apps/bank/src/components/AccountPanel.tsx`, plus one new file under `apps/bank/drizzle/`.

---

## Task 1: Extract the ISO currency amount string

**Files:**
- Create: `apps/bank/src/lib/iso-currency-amount.ts`
- Create: `apps/bank/src/lib/iso-currency-amount.test.ts`
- Modify: `apps/bank/src/lib/limit-transaction-data.ts`

**Interfaces:**
- Produces: `isoCurrencyAmountString(cents: number): string`

- [ ] **Step 1: Write the failing test** in `iso-currency-amount.test.ts`

```ts
it("puts the amount first and the currency code last", () => {
  expect(isoCurrencyAmountString(100_000)).toBe("1000.00 EUR");
});
it("always carries two fractional digits", () => {
  expect(isoCurrencyAmountString(5)).toBe("0.05 EUR");
  expect(isoCurrencyAmountString(250_000)).toBe("2500.00 EUR");
});
it("never groups thousands, in any locale", () => {
  expect(isoCurrencyAmountString(1_234_567)).toBe("12345.67 EUR");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @demo/bank exec vitest run src/lib/iso-currency-amount.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `isoCurrencyAmountString(cents: number): string`**

Body is `` `${(cents / 100).toFixed(2)} EUR` ``. Move `limitAmountString`'s entire doc comment here — it is the record of why this is amount-first and why `Intl` is forbidden, and it must travel with the code.

- [ ] **Step 4: Re-point `limit-transaction-data.ts`**

Delete `limitAmountString`'s body; `export const limitAmountString = isoCurrencyAmountString;` or replace its two call sites and drop the export, whichever leaves `limit-transaction-data.test.ts` compiling **unmodified**.

- [ ] **Step 5: Run both suites**

Run: `pnpm --filter @demo/bank exec vitest run src/lib/iso-currency-amount.test.ts src/lib/limit-transaction-data.test.ts`
Expected: PASS, and `limit-transaction-data.test.ts` **unedited**. If it needed editing, the extraction was not behaviour-preserving — revert and redo.

- [ ] **Step 6: Commit**

```bash
git add apps/bank/src/lib/iso-currency-amount.ts apps/bank/src/lib/iso-currency-amount.test.ts apps/bank/src/lib/limit-transaction-data.ts
git commit -m "refactor(bank): extract isoCurrencyAmountString from limit-transaction-data"
```

---

## Task 2: `transfer_sessions` table, migration and seed

**Files:**
- Modify: `apps/bank/src/db/schema.ts`
- Modify: `apps/bank/src/db/seed.ts`
- Modify: `apps/bank/src/db/schema.test.ts`
- Create: one file under `apps/bank/drizzle/`

**Interfaces:**
- Produces: `transferSessions` drizzle table; `TransferSessionState = "pending" | "verified" | "applied" | "failed"`

Columns exactly as the spec's §7.1 table. `id` is `transfer_<uuid>`. `startedByUserId` NOT NULL → `users`; `approvedByUserId` nullable → `users`; `accountId` NOT NULL → `accounts`; `payeeName`, `payeeIban`, `purpose` text NOT NULL; `amountCents` integer NOT NULL; `foundryVerificationId`, `failureReason`, `openid4vpUri`, `requestUri`, `dcApiRequestJson`, `dcApiProtocol` nullable text; `transport` text with the three-value enum, default `"request_uri"`, NOT NULL; `transactionId` nullable → `transactions`; `createdAt` integer NOT NULL.

- [ ] **Step 1: Write the failing tests** in `db/schema.test.ts`

```ts
it("rejects a transfer session with no started_by_user_id", ...)   // toThrow
it("rejects a transfer session with no account_id", ...)           // toThrow
it("rejects a transfer session whose account_id is not an account", ...) // toThrow
it("defaults state to pending and transport to request_uri", ...)
it("accepts a null approved_by_user_id and a null transaction_id", ...)
it("stores amount_cents as an integer and the three text fields verbatim", ...)
```

Note: a `toThrow()` assertion passes **vacuously** while the table is `undefined`, because inserting on `undefined` throws too. Re-run these against the real table in Step 4 and treat a green Step 2 on those three as no signal.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @demo/bank exec vitest run src/db/schema.test.ts`
Expected: FAIL on the non-throwing cases — `transferSessions` is not exported.

- [ ] **Step 3: Add `transferSessions` to `schema.ts`**

Carry a doc comment that says what `limit_change_sessions`' does about the two user columns, and adds: there is no amount snapshot, because everything the holder signed is already a column.

- [ ] **Step 4: Re-run the schema tests against the real table**

Run: `pnpm --filter @demo/bank exec vitest run src/db/schema.test.ts`
Expected: PASS, all six.

- [ ] **Step 5: Write the failing seed test** in `db/seed.test.ts`

```ts
it("re-seeds cleanly with a transfer session present", () => {
  seed(db, NOW);
  db.insert(transferSessions).values({ /* minimal valid row */ }).run();
  expect(() => seed(db, NOW)).not.toThrow();
  expect(db.select().from(transactions).all().length).toBeGreaterThan(0);
});
```

The balance assertion is the point: `seed()` is atomic, so a throw partway must not leave the demo with accounts and nothing else.

- [ ] **Step 6: Run to verify it fails**

Expected: FAIL — foreign key constraint, inside `seedWithin`.

- [ ] **Step 7: Delete `transferSessions` first in `seedWithin`**

Before `limitChangeSessions`, in the children-before-parents block.

- [ ] **Step 8: Generate and hand-check the migration**

Run: `pnpm --filter @demo/bank exec drizzle-kit generate`
**Read the emitted SQL.** This repo has twice received an unrunnable table rebuild whose `INSERT … SELECT` names a column the old table does not have. A new table should be a plain `CREATE TABLE`; if it is not, hand-edit it.

- [ ] **Step 9: Apply it to a real SQLite file**

Run: `pnpm migrate && pnpm seed`
Expected: both succeed; run `pnpm seed` a **second** time and expect success again.

- [ ] **Step 10: Run the suite and commit**

```bash
pnpm --filter @demo/bank exec vitest run
git add apps/bank/src/db apps/bank/drizzle
git commit -m "feat(bank): add transfer_sessions table"
```

---

## Task 3: Transfer input validation

**Files:**
- Create: `apps/bank/src/lib/transfer-validation.ts`
- Create: `apps/bank/src/lib/transfer-validation.test.ts`

**Interfaces:**
- Produces:
  - `parseAmountCents(input: unknown): number | null`
  - `normaliseIban(input: string): string`
  - `isValidIban(input: unknown): boolean`
  - `MAX_PAYEE_NAME_LENGTH = 70`, `MAX_PURPOSE_LENGTH = 140`, `MAX_AMOUNT_CENTS = 100_000_000`
  - `type TransferInput = { payeeName: string; payeeIban: string; amountCents: number; purpose: string }`
  - `validateTransferInput(input: { payeeName: unknown; payeeIban: unknown; amount: unknown; purpose: unknown }): TransferInput | null`

`validateTransferInput` returns the **normalised** values: `payeeName` and `purpose` trimmed, `payeeIban` normalised (whitespace stripped, upper-cased), `amountCents` an integer.

- [ ] **Step 1: Write the failing tests**

```ts
describe("parseAmountCents", () => {
  it("accepts a dot decimal separator", () => expect(parseAmountCents("250.00")).toBe(25_000));
  it("accepts a German comma decimal separator", () => expect(parseAmountCents("250,00")).toBe(25_000));
  it("accepts a whole number with no separator", () => expect(parseAmountCents("250")).toBe(25_000));
  it("accepts one fractional digit", () => expect(parseAmountCents("0.5")).toBe(50));
  it("rejects grouping separators", () => expect(parseAmountCents("1.250,00")).toBeNull());
  it("rejects more than two fractional digits", () => expect(parseAmountCents("1.005")).toBeNull());
  it("rejects zero and negatives", () => {
    expect(parseAmountCents("0")).toBeNull();
    expect(parseAmountCents("-5.00")).toBeNull();
  });
  it("rejects a non-string, NaN and Infinity", () => {
    for (const bad of [null, undefined, 250, {}, "abc", "NaN", "Infinity"]) {
      expect(parseAmountCents(bad)).toBeNull();
    }
  });
  it("rejects an amount above the ceiling", () =>
    expect(parseAmountCents("1000000.01")).toBeNull());
});

describe("isValidIban", () => {
  it("accepts a correct German IBAN, spaced or not", () => {
    expect(isValidIban("DE89 3704 0044 0532 0130 00")).toBe(true);
    expect(isValidIban("DE89370400440532013000")).toBe(true);
  });
  it("accepts lower case", () => expect(isValidIban("de89370400440532013000")).toBe(true));
  it("rejects one transposed digit", () =>
    expect(isValidIban("DE89370400440532013100")).toBe(false));   // mod-97 fails
  it("rejects a wrong shape", () => {
    for (const bad of ["", "DE", "1234567890", "DEXX370400440532013000", "DE89-3704"]) {
      expect(isValidIban(bad)).toBe(false);
    }
  });
  it("rejects a non-string", () => expect(isValidIban(42)).toBe(false));
});

describe("validateTransferInput", () => {
  it("returns normalised values", () => {
    expect(validateTransferInput({
      payeeName: "  Max Mustermann ", payeeIban: "de89 3704 0044 0532 0130 00",
      amount: "250,00", purpose: " Rent October ",
    })).toEqual({
      payeeName: "Max Mustermann", payeeIban: "DE89370400440532013000",
      amountCents: 25_000, purpose: "Rent October",
    });
  });
  it("rejects an empty name or purpose after trimming", ...);
  it("rejects a name over 70 or a purpose over 140 characters", ...);
  it("fails closed on every non-string field", ...);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @demo/bank exec vitest run src/lib/transfer-validation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

`parseAmountCents`: accept `^\d+([.,]\d{1,2})?$` on the trimmed string only — that single regex is what rejects grouping separators, three decimals and sign characters at once, so do not pre-strip anything. Convert via integer arithmetic on the two halves, never `parseFloat` (a float round-trip is how `1.005` becomes `100`).

`isValidIban`: normalise, test `^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$`, then ISO 13616 — move the first four characters to the end, map `A`–`Z` to `10`–`35`, and take mod 97 **chunk-wise over the digit string** (nine digits at a time), which avoids any big-number type. Must equal 1.

- [ ] **Step 4: Run to verify it passes**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/bank/src/lib/transfer-validation.ts apps/bank/src/lib/transfer-validation.test.ts
git commit -m "feat(bank): add transfer input validation"
```

---

## Task 4: The transfer `transaction_data` and its metadata

**Files:**
- Create: `apps/bank/src/lib/transfer-transaction-data.ts`
- Create: `apps/bank/src/lib/transfer-transaction-data.test.ts`

**Interfaces:**
- Consumes: `isoCurrencyAmountString` (Task 1); `formatIban` from `lib/format.js`; `SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID`, `SPARKASSEN_AUTH_QUERY_ID` from `lib/credential-types.js`
- Produces:
  - `TRANSFER_TRANSACTION_DATA_TYPE = "urn:paso:sca:dev.digitallabor:transfer:1"`
  - `TRANSFER_METADATA_TTL_SECS = 900`
  - `buildTransferAdHocMetadataRequest(): AdHocMetadataRequest`
  - `buildTransferTransactionData(input: { payeeName: string; payeeIban: string; amountCents: number; purpose: string; metadataJwt: string }): unknown[]`

`payeeIban` arrives **normalised** and is rendered through `formatIban` into the payload.

- [ ] **Step 1: Write the failing tests**

```ts
describe("buildTransferTransactionData", () => {
  it("sends one entry of the transfer type", ...);
  it("names the DCQL query id in credential_ids", () =>
    expect(entry.credential_ids).toEqual(["sparkassen_auth"]));
  it("states transaction_data_hashes_alg explicitly", () =>
    expect(entry.transaction_data_hashes_alg).toEqual(["sha-256"]));
  it("carries exactly the four payload claims", () =>
    expect(Object.keys(entry.payload).sort())
      .toEqual(["amount", "payee_iban", "payee_name", "purpose"]));
  it("formats the amount as amount-first", () =>
    expect(entry.payload.amount).toBe("250.00 EUR"));
  it("groups the IBAN in fours for a human to read", () =>
    expect(entry.payload.payee_iban).toBe("DE89 3704 0044 0532 0130 00"));
  it("carries the minted JWT verbatim in metadata", ...);
  it("survives JSON.stringify with metadata intact", () =>
    expect(JSON.parse(JSON.stringify(entry)).metadata).toBe(JWT));
});

describe("buildTransferAdHocMetadataRequest", () => {
  it("binds the override to the entry's own type", () =>
    expect(req.transaction_data_type).toBe(TRANSFER_TRANSACTION_DATA_TYPE));
  it("names the authenticator credential type", () =>
    expect(req.credential_type_id).toBe("sparkassen_auth"));
  it("asks for 900 seconds", () => expect(req.ttl_secs).toBe(900));
  it("declares exactly the four claims in consent order", () =>
    expect(req.metadata.claims.map((c) => c.path[0]))
      .toEqual(["amount", "payee_name", "payee_iban", "purpose"]));
  it("puts iso_currency_amount on amount and value_type on NOTHING else", () => {
    expect(claimFor("amount").value_type).toBe("iso_currency_amount");
    for (const path of ["payee_name", "payee_iban", "purpose"]) {
      expect(claimFor(path)).not.toHaveProperty("value_type");
    }
  });
  it("uses BARE locale tags on every display array", () =>
    for each claim: expect(c.display.map((d) => d.locale)).toEqual(["en", "de"]));
  it("uses BARE locale tags on every ui_label", ...);
  it("carries all four ui_labels", () =>
    expect(Object.keys(req.metadata.ui_labels).sort()).toEqual([
      "affirmative_action_label", "denial_action_label",
      "security_hint", "transaction_title",
    ]));
  it("warns about transfers to a new account in both locales", () =>
    expect(hint("en")).toBe("Sparkasse will never ask you to transfer money to a new account."));
  it("marks every claim mandatory", ...);
});
```

The `not.toHaveProperty("value_type")` assertions are the load-bearing ones: PaSO View §3 says a wallet **shall exclude** an entry whose declared `value_type` it does not support, so an invented type for the IBAN refuses the whole presentation rather than degrading one label.

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Mirror `limit-transaction-data.ts`'s structure, including its `LocalisedName` / `LocalisedValue` / local metadata interface (import those three types from it rather than redeclaring). Claim display names and `ui_labels` verbatim from the spec's §7.2 tables.

- [ ] **Step 4: Run to verify it passes**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/bank/src/lib/transfer-transaction-data.ts apps/bank/src/lib/transfer-transaction-data.test.ts
git commit -m "feat(bank): add transfer transaction_data and ad-hoc metadata"
```

---

## Task 5: `startTransfer`

**Files:**
- Create: `apps/bank/src/lib/transfer-sessions.ts`
- Create: `apps/bank/src/lib/transfer-sessions.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 4; `resolveDcApiProtocol` and `isDcApiTransport` from `lib/transport.js`
- Produces:
  - `TRANSFER_SESSION_TTL_MS = 5 * 60 * 1000`
  - `type TransferSessionState = "pending" | "verified" | "applied" | "failed"`
  - `interface TransferSessionDto { sessionId; accountId; uri: string | null; transport: PresentationTransport; dcApiRequest: unknown; dcApiProtocol: string | null; state: TransferSessionState; payeeName: string; payeeIban: string; amountCents: number; purpose: string }`
  - `type StartTransferResult = { ok: true; session: TransferSessionDto } | { ok: false; reason: "not_found" | "invalid_request" | "limit_exceeded" | "insufficient_funds" | "metadata_unavailable" | "foundry_unavailable" }`
  - `startTransfer(db: Db, client: FoundryClient, input: { userId: string; accountId: string; payeeName: unknown; payeeIban: unknown; amount: unknown; purpose: unknown; transport?: PresentationTransport }, now?: number): Promise<StartTransferResult>`

- [ ] **Step 1: Write the failing tests**

```ts
it("refuses an account belonging to another customer with not_found", ...);
it("refuses invalid input with invalid_request and writes NO row", ...);
it("refuses an amount above the daily limit with limit_exceeded", ...);
it("ALLOWS an amount exactly equal to the daily limit", ...);      // Review Focus 3
it("refuses an amount above the balance with insufficient_funds", ...);
it("ALLOWS an amount exactly equal to the balance", ...);          // Review Focus 3
it("checks the limit and the balance BEFORE minting", () => {
  // mint stub throws if called
});
it("mints metadata BEFORE creating the verification request", ...);
it("creates NO verification request when the mint fails", () => {
  // verification stub returns a perfectly good 200; only the code can stop it
});
it("fails the session with metadata_unavailable when the mint returns no jwt", () => {
  // 200 with {} — typeof check, not a thrown error
});
it("fails with metadata_unavailable when the mint throws", ...);
it("stores the normalised IBAN, not the typed one", ...);
it("records the transport foundry SERVED, not the one requested", ...);
it("records request_uri when dc_api_signed came back without an inline request", ...);
it("returns a DTO whose members match the row it wrote", ...);
it("fails with foundry_unavailable when the verification request throws", ...);
```

`creates NO verification request when the mint fails` is load-bearing, not belt-and-braces: foundry accepts an entry with no `metadata` at HTTP 200 (measured), so the bank's own ordering is the only thing standing between this demo and its anti-goal. Script the verification stub as a success so the only thing that can stop the call is the code.

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `startTransfer`**

Order, and the order is the design: resolve the account scoped by `(id, userId)` → `validateTransferInput` → limit gate → balance gate → insert the `pending` row recording the **requested** transport → mint (abort on failure, writing `metadata_unavailable`) → `createVerificationRequest` → correct the row to what was **served**.

Check the mint with `typeof minted.jwt === "string" && minted.jwt.length > 0`. A 2xx is not a successful mint.

The return annotation `: Promise<StartTransferResult>` must be **written out**; the DTO is returned whole and never re-assembled.

- [ ] **Step 4: Run to verify it passes**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/bank/src/lib/transfer-sessions.ts apps/bank/src/lib/transfer-sessions.test.ts
git commit -m "feat(bank): add startTransfer"
```

---

## Task 6: `refreshTransferState` and the ownership gate

**Files:**
- Modify: `apps/bank/src/lib/transfer-sessions.ts`
- Modify: `apps/bank/src/lib/transfer-sessions.test.ts`

**Interfaces:**
- Consumes: `extractAuthSubject`, `passedLoginBinding` from `lib/login-checks.js`
- Produces:
  - `interface TransferStatusDto { state: TransferSessionState; failureReason?: string; amountCents: number; payeeName: string }`
  - `getTransferStatus(db, userId, accountId, sessionId): TransferStatusDto | null`
  - `type RefreshTransferResult = { ok: true; status: TransferStatusDto } | { ok: false; reason: "not_found" }`
  - `refreshTransferState(db, client, input: { userId; accountId; sessionId }, now?): Promise<RefreshTransferResult>`

The status carries `amountCents` and `payeeName` because the dialog's success copy names them and by then it holds only a session id.

- [ ] **Step 1: Write the failing tests**

```ts
it("makes no foundry call for an applied or failed session", ...);
it("makes no foundry call once verified", ...);
it("fails with expired past the TTL, without calling foundry", ...);
it("stays pending while foundry says pending", ...);
it("fails with verification_failed when foundry says not verified", ...);
it("fails with verification_failed when no authenticator answered", ...);
it("fails with transaction_data_binding_failed when the binding did not pass", ...);
it("gates the binding BEFORE resolving the sub", () => {
  // a sub NO credential carries, with the binding also failing:
  // the two orderings give DIFFERENT answers, so this pins the order
});
it("fails with unknown_credential for a sub this bank cannot place", ...);
it("fails with wrong_customer for another customer's authenticator", ...);
it("verifies and records approvedByUserId when the owner approved", ...);
it("fails with foundry_unavailable when the status call throws", ...);
```

`gates the binding BEFORE resolving the sub` must use a `sub` **no credential carries**. Using the signed-in customer's own `sub` fails the binding check under either ordering and therefore pins nothing.

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL.

- [ ] **Step 3: Implement**

Mirror `refreshLimitChangeState` exactly: terminal → expiry → already-verified → foundry → `verified` check → `extractAuthSubject` → `passedLoginBinding` → resolve the `sub` against `credentials` where `credentialId = sub` and `credentialTypeId = SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID` → compare `credential.userId` to `row.startedByUserId`.

The resolution query is written inline here, as it already is in both `login-sessions.ts` and `limit-change-sessions.ts`. Do **not** gate on `credential.state === "active"`: foundry's verdict is the authority that the credential is real; this row only answers *whose*.

- [ ] **Step 4: Run to verify it passes**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/bank/src/lib/transfer-sessions.ts apps/bank/src/lib/transfer-sessions.test.ts
git commit -m "feat(bank): poll transfer sessions with an ownership gate"
```

---

## Task 7: `applyTransfer` and the DC API relay

**Files:**
- Modify: `apps/bank/src/lib/transfer-sessions.ts`
- Modify: `apps/bank/src/lib/transfer-sessions.test.ts`

**Interfaces:**
- Produces:
  - `type ApplyTransferResult = { ok: true; transactionId: string; newBalanceCents: number } | { ok: false; reason: "not_found" | "not_verified" | "already_applied" | "expired" | "limit_exceeded" | "insufficient_funds" }`
  - `applyTransfer(db: Db, input: { userId: string; accountId: string; sessionId: string }, now?: number): ApplyTransferResult`
  - `type RelayTransferResult = { ok: true } | { ok: false; reason: "not_found" | "no_verification" | "foundry_unavailable" }`
  - `relayTransferDcApiResponse(db, client, input: { userId; accountId; sessionId; response: string }): Promise<RelayTransferResult>`

`applyTransfer` is **synchronous** — better-sqlite3 is, and the guarded UPDATE is only meaningful as one statement. It never talks to foundry.

- [ ] **Step 1: Write the failing tests**

```ts
it("refuses another customer's session with not_found", ...);
it("refuses a pending session with not_verified", ...);
it("refuses an applied session with already_applied", ...);
it("refuses past the TTL with expired", ...);
it("refuses with limit_exceeded when the limit dropped under it", ...);   // Review Focus 5
it("leaves the session VERIFIED after a limit_exceeded refusal", ...);    // Review Focus 5
it("refuses with insufficient_funds when the balance dropped under it", ...);
it("leaves the session VERIFIED after an insufficient_funds refusal", ...);
it("ALLOWS an amount exactly equal to the current limit and balance", ...); // Review Focus 3
it("debits the account by the amount", ...);
it("books a NEGATIVE transaction carrying the name and the purpose", () => {
  expect(tx.amountCents).toBe(-25_000);
  expect(tx.counterparty).toBe("Max Mustermann");
  expect(tx.reference).toBe("Rent October");
  expect(tx.idempotencyKey).toBe(sessionId);
});
it("records the approving sub as the transaction's credential_id", ...);
it("writes transaction_id onto the session in the same transaction", ...);
it("debits exactly ONCE across two applies", () => {            // Review Focus 4
  // restore the account to its pre-apply balance between the two calls,
  // so the money gates cannot be what refuses the second
});
it("writes NOTHING when the transaction insert throws", ...);

describe("relayTransferDcApiResponse", () => {
  it("refuses another customer's session with not_found", ...);
  it("answers no_verification before foundry exists", ...);
  it("forwards the response to foundry and discards the verdict", ...);
  it("answers foundry_unavailable when the submit throws", ...);
});
```

`debits exactly ONCE` must restore the balance between the two calls. Leaving the account short means the money gate refuses the replay, and the test would pass with the guarded UPDATE deleted.

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL.

- [ ] **Step 3: Implement `applyTransfer`**

Load scoped by `(userId, accountId, sessionId)` — ownership belongs with the read, not in the route. Then: `applied` → `already_applied`; not `verified` → `not_verified`; expiry → `expired`; re-read the account and re-check **limit then balance**, both with `>` so equality passes; then one `db.transaction` over the guarded `verified → applied` UPDATE (`.changes !== 1` ⇒ `already_applied`), the balance decrement, the `transactions` insert with `idempotencyKey: sessionId`, and the `transactionId` write back onto the session.

A money-gate refusal returns **before** the transaction, leaving the session claimable.

- [ ] **Step 4: Implement `relayTransferDcApiResponse`**

`dc-api-relay.ts`'s shape with the ownership scope added, duplicated rather than generalised — exactly as the limit change's own relay is. foundry's verdict is deliberately discarded; the poll is the one state path.

- [ ] **Step 5: Run to verify it passes**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/bank/src/lib/transfer-sessions.ts apps/bank/src/lib/transfer-sessions.test.ts
git commit -m "feat(bank): apply an approved transfer as a debit"
```

---

## Task 8: Routes

**Files:**
- Create: `apps/bank/src/app/api/accounts/[id]/transfer/segments.ts`
- Create: `apps/bank/src/app/api/accounts/[id]/transfer/route.ts`
- Create: `apps/bank/src/app/api/accounts/[id]/transfer/[sessionId]/route.ts`
- Create: `apps/bank/src/app/api/accounts/[id]/transfer/[sessionId]/apply/route.ts`
- Create: `apps/bank/src/app/api/accounts/[id]/transfer/[sessionId]/dc-api-response/route.ts`
- Create: `apps/bank/src/app/api/accounts/[id]/transfer/route.test.ts`

**Interfaces:**
- Consumes: `withSession` from `lib/api.js`; Tasks 5–7
- Produces: `accountIdFromStart`, `fromPoll`, `fromSessionAction` — same three names and offsets as the limit-change `segments.ts`, which this file copies verbatim apart from its doc comment

All four handlers use `withSession`. Segments are read by **plain string splitting**, never `new URL(…)`, which throws — an unreadable id must fall through to the same 404, never a 500.

- [ ] **Step 1: Write the failing route tests**

```ts
it("answers 201 with the session DTO", ...);
it("returns EXACTLY the DTO's keys", () =>
  expect(Object.keys(body).sort()).toEqual([...]));     // not a subset check
it("agrees member for member with the row it wrote", ...);
it("answers 400 for an unparseable body", ...);
it("answers 400 for invalid_request", ...);
it("answers 409 for limit_exceeded and for insufficient_funds", ...);
it("answers 404 for not_found", ...);
it("answers 502 for metadata_unavailable and foundry_unavailable", ...);
```

The exact key-set assertion catches what a type cannot: `JSON.stringify` silently drops an `undefined` member. It is deliberately not a subset check, because the defect class is an **absent** member.

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL.

- [ ] **Step 3: Implement the start route**

zod body: `payeeName`, `payeeIban`, `amount`, `purpose` all `z.string()`; `transport: z.enum(["request_uri","dc_api","dc_api_signed"]).optional()`. zod checks the wire shape; `validateTransferInput` checks the meaning — the two are split deliberately, as `newLimitCents` and `isValidNewLimit` already are.

Return `NextResponse.json(result.session, { status: 201 })` — the DTO passed straight through.

Status mapping: `not_found` → 404; `invalid_request` → 400; `limit_exceeded`, `insufficient_funds` → 409; everything else → 502.

- [ ] **Step 4: Implement the poll, apply and relay routes**

Poll: `GET`, returns the status DTO, 404 on `not_found`.
Apply: `POST`, 200 on success; `already_applied` → 410; `not_verified` → 409; `expired`, `limit_exceeded`, `insufficient_funds` → 409 with the reason as `error`; `not_found` → 404.
Relay: `POST`, body `{ response: z.string() }`, 204 on success, 404 / 502 otherwise.

Every route carries `export const dynamic = "force-dynamic"`.

- [ ] **Step 5: Run to verify it passes**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "apps/bank/src/app/api/accounts/[id]/transfer"
git commit -m "feat(bank): add transfer routes"
```

---

## Task 9: Dialog state and copy

**Files:**
- Create: `apps/bank/src/lib/transfer-dialog-state.ts`
- Create: `apps/bank/src/lib/transfer-dialog-state.test.ts`
- Modify: `apps/bank/src/lib/i18n/messages.ts`, `en.ts`, `de.ts`

**Interfaces:**
- Consumes: `selectLoginAffordance`, `needsQrRecovery` from `lib/login-dialog-state.js` and `lib/limit-dialog-state.js` respectively — imported, never copied
- Produces:
  - `type TransferPhase = "form" | "waiting" | "success" | "error"`
  - `type TransferFailureKey = "expired" | "unknownCredential" | "limitExceeded" | "insufficientFunds" | "verificationFailed"`
  - `isTransferTerminal(state: string): boolean`
  - `selectTransferPhase(state: string | null, applied: boolean, startFailed: boolean): TransferPhase`
  - `transferFailureKey(reason: string | undefined): TransferFailureKey`

- [ ] **Step 1: Write the failing tests**

```ts
describe("isTransferTerminal", () => {
  it("stops on verified, applied and failed", ...);
  it("keeps polling on pending and on anything unrecognised", ...); // fails OPEN
});
describe("selectTransferPhase", () => {
  it("shows the form before a session exists", () =>
    expect(selectTransferPhase(null, false, false)).toBe("form"));
  it("shows error for a FAILED START, not the form again", () =>
    expect(selectTransferPhase(null, false, true)).toBe("error"));
  it("keeps verified on waiting — the money is not moved until apply returns", () =>
    expect(selectTransferPhase("verified", false, false)).toBe("waiting"));
  it("shows success only once applied", ...);
  it("lets a successful apply outrank a late poll failure", () =>
    expect(selectTransferPhase("failed", true, true)).toBe("success"));
});
describe("transferFailureKey", () => {
  it("names the four reasons a holder can act on", ...);
  it("falls everything else through to verificationFailed", () => {
    for (const r of ["wrong_customer", "metadata_unavailable",
                     "transaction_data_binding_failed", "foundry_unavailable",
                     undefined, "nonsense"]) {
      expect(transferFailureKey(r)).toBe("verificationFailed");
    }
  });
});
```

`shows error for a FAILED START` is the bug the limit change shipped once: checking `state === null` first made a failed start render the chooser again, with no message anywhere.

`wrong_customer` falling through to the generic copy is deliberate — spelling it out would tell whoever holds the phone that their presentation was valid but for somebody else's account.

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL.

- [ ] **Step 3: Implement `transfer-dialog-state.ts`**

- [ ] **Step 4: Add the `transfers` block to `Messages` and both catalogs**

Keys: `sendMoney`, `dialogTitle`, `dialogLead`, `recipientName`, `recipientIban`, `amount`, `purpose`, `send`, `cancel`, `close`, `invalidAmount`, `invalidIban`, `invalidName`, `invalidPurpose`, `approveTitle`, `confirmInApp`, `openInWallet`, `scanCode`, `qrAlt`, `waiting`, `preparing`, `walletUnavailable`, `showQrCode`, `successTitle`, `successBody: (amount: string, payee: string) => string`, `failedTitle`, plus the five `TransferFailureKey` values.

German is a real translation, not a gloss. Note `messages.test.ts` will add **zero** tests against these — its invariants cover new leaves without new cases, so `pnpm typecheck` is the actual gate for copy here.

- [ ] **Step 5: Run typecheck and the suite**

Run: `pnpm --filter @demo/bank typecheck && pnpm --filter @demo/bank exec vitest run`
Expected: PASS. A key in one catalog and not the other is a **compile** error.

- [ ] **Step 6: Commit**

```bash
git add apps/bank/src/lib/transfer-dialog-state.ts apps/bank/src/lib/transfer-dialog-state.test.ts apps/bank/src/lib/i18n
git commit -m "feat(bank): add transfer dialog state and copy"
```

---

## Task 10: The dialog and the control

**Files:**
- Create: `apps/bank/src/components/SendMoneyDialog.tsx`
- Create: `apps/bank/src/components/SendMoneyRow.tsx`
- Modify: `apps/bank/src/components/AccountPanel.tsx`

**Interfaces:**
- Consumes: Tasks 8, 9; `useDcApiSupport`, `QrCanvas` from `@demo/ui`; `DcApiForm` from `lib/transport.js`
- Produces: `<SendMoneyRow accountId dailyLimitCents balanceCents locale dcApiForm />`

**Nothing in this task is covered by any test.** `environment: "node"` matches no `.tsx`. Step 5 is the only verification these two files get.

- [ ] **Step 1: Build `SendMoneyDialog.tsx`**

Four fields in entry order — recipient name, IBAN, amount, purpose — then Send. Every branch comes from `transfer-dialog-state.ts`; no ternary in this file decides a phase, an affordance or a failure message.

The DC API payload must be a prop **before** the click: no `await` may execute between the handler starting and `navigator.credentials.get()`, or Chrome consumes the transient activation.

- [ ] **Step 2: Wire the QR recovery**

When `needsQrRecovery(dcError, uri)` is true, offer a button that POSTs a fresh session with `transport: "request_uri"`. **Do not clear `dcError`** when it arrives — clearing it sends the affordance straight back to the wallet button the holder just watched fail. `needsQrRecovery` goes false on its own once the new session carries a URI.

- [ ] **Step 3: Build `SendMoneyRow.tsx` and mount it**

The client boundary, mirroring `AccountLimitRow`. The control is **not** suppressed when the customer holds no authenticator — `getAuthenticatorCredentialState` cannot tell a usable credential from an unusable one, so suppression would hide it from people who could use it.

- [ ] **Step 4: Run the gate**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 5: Verify in a real browser**

Use `tools/cdp/cdp.mjs` against `pnpm dev`. Confirm, and write down what you saw:

- the dialog opens and Send is disabled until all four fields are valid
- a bad IBAN and a bad amount each show their own message
- an over-limit amount is refused with the limit message
- against a **local** foundry every attempt fails visibly with copy — the local config declares no `sparkassen_auth`, so this is the error path, and seeing it is the point
- the default transport writes a `dc_api_signed` row with an inline request object and **no QR canvas**; `?dcapi=unsigned` writes a `dc_api` row
- clicking the wallet button does something visible

"Renders the wallet button" and "the wallet button works" are different claims. This repo has mistaken one for the other before — click it.

- [ ] **Step 6: Commit**

```bash
git add apps/bank/src/components
git commit -m "feat(bank): add the send money dialog"
```

---

## Task 11: Verify against the deployed foundry, then document

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Run the gate and record the real number**

Run: `pnpm check`
Record the measured total and the per-project split. Do not project it.

- [ ] **Step 2: Port-forward the deployed admin API to a distinct port**

```bash
kubectl -n foundry port-forward svc/foundry 9100:9000
```

Port **9100**, not 9000 — a local foundry may own `127.0.0.1:9000` while the forward binds only `[::1]:9000`, and a curl to `127.0.0.1:9000` then silently hits the local server and answers 401, which reads as a bad key.

- [ ] **Step 3: Verify the request leg**

Drive `startTransfer` against the deployed foundry and assert on the **request object foundry serves**, not on a 200:

- the `transaction_data` entry decodes byte-exact to the payload sent, with `metadata` present as a 3-segment compact JWS
- the minted JWT's `transaction_data_type` equals the entry's `type`; `exp - iat` is 900; both `en`/`de` pairs survive in every `display` and every `ui_label`; `value_type` appears on `amount` and on nothing else
- a deliberately bogus `credential_ids` is **HTTP 400** — so the 200 is evidence rather than serde dropping a field
- an entry with `metadata` deliberately omitted is accepted at **200** — confirming the bank's own ordering is the only thing preventing the anti-goal

- [ ] **Step 4: Update `AGENTS.md`**

Add a **The send money transfer** section under Hard-won constraints, and amend the two statements this feature falsifies:

- `daily_limit_cents` "GATES NOTHING" is now **false** — both in `AGENTS.md` and in `schema.ts`'s own doc comment.
- The test count, with the measured split and what it hides (the two `.tsx` files covered by nothing; `messages.test.ts` adding zero).

Record in Known-unverifiable: no wallet has answered a transfer presentation; the ownership gate, `applyTransfer` and the whole `verified → applied` path are unexercised outside the suite.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md apps/bank/src/db/schema.ts
git commit -m "docs: record send money constraints and what remains unverified"
```

---

## Self-review

**Spec coverage.** §7.1 → Task 2. §7.2 → Task 4. §7.3 → Task 3. §7.4 → Tasks 5 and 7. §7.5 → Task 6. §7.6 → Task 7. §7.7 → Tasks 1–10. §7.8 → Task 9. §7.9 → Task 10. §6.1 → Task 1. §6.2/§6.3/§6.4 → Task 4. §6.5 → Tasks 5 and 10. §6.6 → Tasks 9 and 10. §6.7 → Task 2. §6.8 → Task 8. §8 → Tasks 10 and 11. §9 → Task 11. No gaps.

**Type consistency.** `TransferSessionDto`, `TransferStatusDto`, `TransferSessionState`, `TransferPhase`, `TransferFailureKey`, `validateTransferInput`, `isoCurrencyAmountString`, `TRANSFER_TRANSACTION_DATA_TYPE` are each defined in exactly one task and referenced by the same spelling thereafter. `transferFailureKey`'s five return values are the same five keys Task 9 adds to both catalogs.

**Review Focus coverage.** (1) and (2) → Task 3 Step 1. (3) → Task 5 Step 1 and Task 7 Step 1. (4) → Task 7 Step 1, with the balance restored between applies. (5) → Task 7 Step 1, both the refusal and the still-claimable session.

**Proportion.** The plan is shorter than the design it implements. No task carries a function body except where the signature and tests leave the algorithm open (`parseAmountCents`'s regex, the mod-97 chunking).