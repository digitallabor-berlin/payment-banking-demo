# Mobile Number Change Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in bank customer change their mobile number, approved in
the wallet by a Sparkassen Authenticator presentation that displays the old and
new number before they confirm.

**Architecture:** The account-limit-change flow with a different payload and a
different terminal write. A `phone_change_sessions` row is written before any
foundry traffic; an ad-hoc PaSO metadata JWT is minted *before* the verification
request and aborts the whole thing on failure; a four-gate poll drives
`pending → verified`; a separate POST applies the change under a guarded UPDATE
plus a compare-and-swap on the snapshot.

**Tech Stack:** Next.js 15 (App Router, `src/`), drizzle-orm + better-sqlite3,
zod, vitest (`environment: "node"`, `include: ["src/**/*.test.ts"]`),
`@demo/foundry-client`, `@demo/ui`.

**Spec:** `docs/superpowers/specs/2026-10-20-phone-change-design.md`

## Global Constraints

- All work is in `apps/bank`. Nothing in `apps/merchant` or `packages/` changes.
- `pnpm check` is the gate. Run it from the repo root. **Measure test counts;
  never project them.**
- Local imports are written `./foo.js` for a `./foo.ts` file.
- TypeScript is strict with `noUnusedLocals` / `noUnusedParameters`; an
  intentionally unused parameter is prefixed `_`.
- No `.tsx` file is covered by any vitest project here. Every decision lives in
  a `.ts` module with its own test; `.tsx` renders what those return.
- The transaction data type is exactly
  `urn:paso:sca:dev.digitallabor:phone-change:1`.
- Consent-screen locale tags are bare **`en`** and **`de`**. Never `en-US` /
  `de-DE`.
- **No `value_type` on any claim in this feature.** Plain text.
- `ttl_secs` on the ad-hoc mint is exactly `900`.
- `credential_ids` is `[SPARKASSEN_AUTH_QUERY_ID]` — the DCQL query id constant,
  not `SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID`.
- Consent-screen copy, verbatim: claim names `Current mobile number` /
  `Aktuelle Mobilnummer` and `New mobile number` / `Neue Mobilnummer`;
  `affirmative_action_label` `Confirm number` / `Nummer bestätigen`;
  `denial_action_label` `Cancel` / `Abbrechen`; `security_hint`
  `Sparkasse will never ask you to change your mobile number.` /
  `Die Sparkasse wird Sie niemals bitten, Ihre Mobilnummer zu ändern.`
- Commits use conventional prefixes and state what was *verified*, and plainly
  what was not.

## Review Focus

These five input classes are implied by the spec and are the ones most likely to
bite. Each has a test assigned to the task that owns the code.

1. **A number typed with stray or doubled whitespace** (`"  +49 171  5555555 "`).
   The column, the signed payload and the dashboard row must be the same
   collapsed string, or the artefact the holder signed disagrees with what the
   bank stored. → Task 3, Task 6.
2. **`phoneNumber` that is not a string** (number, `null`, object, array) from a
   `curl` caller. Must fail closed at 400 with no row written and no foundry
   traffic. → Task 3, Task 6, Task 10.
3. **The same number retyped in a different format** (`+491715555555` against a
   stored `+49 171 5555555`). Must be `phone_unchanged`, not a consent screen
   asking a human to approve a reformat. → Task 3, Task 6.
4. **A mint that answers HTTP 200 with no usable `jwt`** (`{}`, `null`, renamed
   field). Must abort with `metadata_unavailable` and create **no** verification
   request. → Task 6.
5. **A second apply of one session, and a number that moved underneath.**
   Exactly one write; the stale-snapshot refusal must leave the session
   claimable. → Task 8.

---

### Task 1: `users.phone_number`

**Files:**
- Modify: `apps/bank/src/db/schema.ts`
- Modify: `apps/bank/src/db/seed.ts`
- Create: `apps/bank/drizzle/<generated>.sql`
- Test: `apps/bank/src/db/schema.test.ts`, `apps/bank/src/db/seed.test.ts`

**Interfaces:**
- Produces: `users.phoneNumber` (column `phone_number`), and a `phoneNumber`
  member on the `Fixture` interface in `seed.ts`.

- [ ] **Step 1: Write the failing tests**

In `schema.test.ts`:
```ts
it("stores a phone number on a user", () => { /* insert a user with phoneNumber, read it back */ });
it("backfills phone_number on a user inserted without one", () => { /* omit it; expect the DEFAULT, a non-empty string starting with "+" */ });
```
In `seed.test.ts`:
```ts
it("gives every fixture a phone number in international form", () => { /* every seeded user: /^\+[0-9 ]+$/ */ });
it("gives the two fixtures different phone numbers", () => { /* anna's !== ben's */ });
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd apps/bank && pnpm vitest run src/db/schema.test.ts src/db/seed.test.ts`
Expected: FAIL — `phoneNumber` is not a column.

- [ ] **Step 3: Add the column**

In `schema.ts`, on `users`:
`phoneNumber: text("phone_number").notNull().default("+49 171 5555555"),`
Document it: a real migration (not a TypeScript-only widening); the DEFAULT only
backfills a developer's pre-existing rows because `seed()` re-inserts every user;
not an empty string, because a blank consent-screen row is the spec's first
anti-goal.

- [ ] **Step 4: Add `phoneNumber` to the fixtures**

Add the member to `Fixture` and to the insert. Anna: `"+49 171 5555555"`.
Ben: `"+49 160 2345678"`.

- [ ] **Step 5: Generate the migration and READ IT**

Run: `cd apps/bank && pnpm exec drizzle-kit generate`
Expected: a plain `ALTER TABLE \`users\` ADD \`phone_number\` text DEFAULT '+49 171 5555555' NOT NULL;`
**If drizzle-kit emits a table rebuild whose `INSERT … SELECT` names
`phone_number` on both sides, hand-edit it down to the plain ADD** — that SQL is
unrunnable and this repo has hit it twice.

- [ ] **Step 6: Apply it to a real database and verify**

Run: `cd /Users/senexi/dev/eudiw/payment-banking-demo && pnpm migrate && pnpm seed && pnpm seed`
Expected: both seeds succeed; `sqlite3` shows two users with the two distinct numbers.

- [ ] **Step 7: Run the tests**

Run: `cd apps/bank && pnpm vitest run src/db`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/bank/src/db apps/bank/drizzle
git commit -m "feat(bank): add users.phone_number with seeded fixtures"
```

---

### Task 2: `phone_change_sessions`

**Files:**
- Modify: `apps/bank/src/db/schema.ts`
- Modify: `apps/bank/src/db/seed.ts` (the `seedWithin` delete sequence)
- Create: `apps/bank/drizzle/<generated>.sql`
- Test: `apps/bank/src/db/schema.test.ts`, `apps/bank/src/db/seed.test.ts`

**Interfaces:**
- Produces: `phoneChangeSessions` table, `PhoneChangeSession` and
  `PhoneChangeSessionState` types exported from `schema.ts`.

Columns, per the spec's table: `id`, `startedByUserId` (NOT NULL → users),
`approvedByUserId` (NULL → users), `oldPhone` (NOT NULL), `newPhone` (NOT NULL),
`foundryVerificationId`, `state` (`pending | verified | applied | failed`,
default `pending`), `failureReason`, `openid4vpUri`, `requestUri`, `transport`
(`request_uri | dc_api | dc_api_signed`, default `request_uri`),
`dcApiRequestJson`, `dcApiProtocol`, `createdAt`. **No account id.**

- [ ] **Step 1: Write the failing tests**

In `schema.test.ts`:
```ts
it("inserts a pending phone-change session", () => { /* minimal row; state defaults to "pending", transport to "request_uri" */ });
it("refuses a phone-change session whose started_by_user_id is unknown", () => { /* expect(() => …).toThrow(/FOREIGN KEY/i) */ });
it("refuses a phone-change session with no old_phone", () => { /* expect(() => …).toThrow(/NOT NULL/i) */ });
```
In `seed.test.ts`:
```ts
it("reseeds after a phone-change session exists", () => { /* seed, insert a phone_change_sessions row, seed again, expect no throw and the fixtures intact */ });
```

> Note: the two `toThrow()` cases pass **vacuously** while the table is
> `undefined` — inserting on `undefined` throws too. Re-run them after Step 3
> and confirm they still pass against the real table before trusting them.

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd apps/bank && pnpm vitest run src/db`
Expected: FAIL — the reseed test throws `FOREIGN KEY constraint failed`.

- [ ] **Step 3: Add the table and the export types**

- [ ] **Step 4: Delete it in `seedWithin`, beside `limitChangeSessions`**

It references only `users`, so it may go anywhere before the `users` delete.
Add a comment saying why: `createDb` sets `foreign_keys = ON` and `seed()`
deletes `users`.

- [ ] **Step 5: Generate the migration and READ IT**

Expected: a plain `CREATE TABLE` with both FKs and **no CHECK** on `state` or
`transport`.

- [ ] **Step 6: Apply and reseed twice**

Run: `pnpm migrate && pnpm seed && pnpm seed`

- [ ] **Step 7: Run the tests, including the re-check from Step 1's note**

Run: `cd apps/bank && pnpm vitest run src/db`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/bank/src/db apps/bank/drizzle
git commit -m "feat(bank): add phone_change_sessions, cleared by seed()"
```

---

### Task 3: `lib/phone-validation.ts`

**Files:**
- Create: `apps/bank/src/lib/phone-validation.ts`
- Test: `apps/bank/src/lib/phone-validation.test.ts`

**Interfaces:**
- Produces:
  - `normalisePhoneNumber(input: unknown): string | null` — trims, collapses
    runs of whitespace to one space; `null` for a non-string.
  - `isValidPhoneNumber(input: unknown): boolean` — normalises, then one regex
    `^\+[0-9](?:[0-9 ]*[0-9])?$`, then 7–15 digits once spaces are removed.
  - `isSamePhoneNumber(a: string, b: string): boolean` — compares both with
    everything but `+` and digits stripped.

- [ ] **Step 1: Write the failing tests**

```ts
describe("normalisePhoneNumber", () => {
  it("trims and collapses internal whitespace", () => {
    expect(normalisePhoneNumber("  +49 171  5555555 ")).toBe("+49 171 5555555");
  });
  it("returns null for a non-string", () => { /* 49, null, undefined, {}, [] */ });
});

describe("isValidPhoneNumber", () => {
  it("accepts the design's two examples", () => { /* "+49 171 5555555", "+49 172 66666666" */ });
  it("accepts a number with no spaces at all", () => { /* "+491715555555" */ });
  it("requires a leading plus", () => { /* "0171 5555555" → false */ });
  it("rejects a second plus", () => { /* "++49171", "+49+171" → false */ });
  it("rejects letters, punctuation and parentheses", () => { /* "+49 (0)171-555", "+49 171 ABC" */ });
  it("rejects a trailing space inside the pattern", () => { /* "+49 171 " normalises away, but "+49 171 5555555 x" is false */ });
  it("rejects fewer than 7 digits", () => { /* "+49 171" → 5 digits → false */ });
  it("rejects more than 15 digits", () => { /* 16 digits → false */ });
  it("rejects a non-string", () => { /* 491715555555, null, {} */ });
});

describe("isSamePhoneNumber", () => {
  it("sees through formatting", () => {
    expect(isSamePhoneNumber("+49 171 5555555", "+491715555555")).toBe(true);
  });
  it("distinguishes different numbers", () => {
    expect(isSamePhoneNumber("+49 171 5555555", "+49 172 66666666")).toBe(false);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd apps/bank && pnpm vitest run src/lib/phone-validation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the three functions**

One regex over the normalised string; nothing is pre-stripped before it, for the
reason `parseAmountCents` documents. Document the `+` requirement as the
author's call and the three explicit non-goals (no country table, no carrier
lookup, no mobile-vs-landline check).

- [ ] **Step 4: Run and confirm pass**

- [ ] **Step 5: Commit**

```bash
git add apps/bank/src/lib/phone-validation.ts apps/bank/src/lib/phone-validation.test.ts
git commit -m "feat(bank): add phone number validation and normalisation"
```

---

### Task 4: `lib/phone-transaction-data.ts`

**Files:**
- Create: `apps/bank/src/lib/phone-transaction-data.ts`
- Test: `apps/bank/src/lib/phone-transaction-data.test.ts`

**Interfaces:**
- Consumes: `SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID`, `SPARKASSEN_AUTH_QUERY_ID`
  from `credential-types.js`; `LocalisedName`, `LocalisedValue` from
  `limit-transaction-data.js`.
- Produces:
  - `PHONE_CHANGE_TRANSACTION_DATA_TYPE = "urn:paso:sca:dev.digitallabor:phone-change:1"`
  - `PHONE_CHANGE_METADATA_TTL_SECS = 900`
  - `interface PhoneChangeAdHocMetadata` — a claims array whose element type has
    **no `value_type` member at all**, plus `ui_labels`.
  - `buildPhoneChangeAdHocMetadataRequest(): AdHocMetadataRequest`
  - `buildPhoneChangeTransactionData(input: { oldPhone: string; newPhone: string; metadataJwt: string }): unknown[]`

- [ ] **Step 1: Write the failing tests**

```ts
describe("buildPhoneChangeAdHocMetadataRequest", () => {
  it("binds the metadata to the entry's own type", () => { /* transaction_data_type === PHONE_CHANGE_TRANSACTION_DATA_TYPE */ });
  it("targets the Sparkassen Authenticator credential type", () => { /* credential_type_id === SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID */ });
  it("asks for a 900-second TTL", () => { /* ttl_secs === 900 */ });
  it("declares exactly two claims, old then new", () => { /* paths [["old_phone"], ["new_phone"]] in that order */ });
  it("declares NO value_type on either claim", () => {
    for (const claim of claims) expect(claim).not.toHaveProperty("value_type");
  });
  it("marks both claims mandatory", () => {});
  it("names both claims in English and German", () => { /* exact strings from Global Constraints */ });
  it("uses BARE locale tags everywhere", () => {
    /* every locale across claim displays and all ui_labels is "en" or "de" */
  });
  it("carries all four ui_labels", () => { /* transaction_title, affirmative_action_label, denial_action_label, security_hint */ });
  it("says Confirm number on the affirmative action", () => {});
  it("carries the security hint verbatim in both locales", () => {});
});

describe("buildPhoneChangeTransactionData", () => {
  it("returns exactly one entry", () => {});
  it("uses the DCQL query id, not the credential type id", () => {
    expect(entry.credential_ids).toEqual([SPARKASSEN_AUTH_QUERY_ID]);
  });
  it("states sha-256 explicitly", () => {});
  it("carries the two numbers verbatim in the payload", () => {
    expect(entry.payload).toEqual({ old_phone: "+49 171 5555555", new_phone: "+49 172 66666666" });
  });
  it("carries the minted jwt as metadata, unwrapped", () => {});
  it("has no payload member beyond the two numbers", () => {
    expect(Object.keys(entry.payload)).toEqual(["old_phone", "new_phone"]);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

- [ ] **Step 3: Implement both builders and the local interface**

Declare `PhoneChangeAdHocMetadata` here rather than reusing
`LimitChangeAdHocMetadata` — that one makes `value_type` **required**, which
would make the required absence untypeable. Import `LocalisedName` and
`LocalisedValue` from it; those two genuinely are the same shape. Document why
no `value_type`: PaSO View §3 makes an unknown one exclude the **entry**, not
the label, so an invented `phone_number` type refuses the whole presentation.

- [ ] **Step 4: Run and confirm pass**

- [ ] **Step 5: Commit**

```bash
git add apps/bank/src/lib/phone-transaction-data.ts apps/bank/src/lib/phone-transaction-data.test.ts
git commit -m "feat(bank): build the phone-change transaction_data entry and ad-hoc metadata"
```

---

### Task 5: `getProfile`

**Files:**
- Modify: `apps/bank/src/lib/queries.ts`
- Test: `apps/bank/src/lib/queries.test.ts`

**Interfaces:**
- Produces: `interface ProfileDto { username: string; phoneNumber: string }` and
  `getProfile(db: Db, userId: string): ProfileDto | null`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("getProfile", () => {
  it("returns the login username and the phone number", () => { /* anna → { username: "anna", phoneNumber: "+49 171 5555555" } */ });
  it("returns null for an unknown user", () => {});
  it("returns exactly two members", () => { expect(Object.keys(profile!)).toEqual(["username", "phoneNumber"]); });
});
```

- [ ] **Step 2: Run and confirm failure**

- [ ] **Step 3: Implement `getProfile`**

A plain scoped select. Document that `username` is the **login** name, not the
row id, and that neither value is carried in the session cookie on purpose — a
12-hour cookie would serve a stale number the moment this feature works.

- [ ] **Step 4: Run and confirm pass**

- [ ] **Step 5: Commit**

```bash
git add apps/bank/src/lib/queries.ts apps/bank/src/lib/queries.test.ts
git commit -m "feat(bank): add getProfile for the dashboard details panel"
```

---

### Task 6: `startPhoneChange`

**Files:**
- Create: `apps/bank/src/lib/phone-change-sessions.ts`
- Test: `apps/bank/src/lib/phone-change-sessions.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 4; `isDcApiTransport`, `resolveDcApiProtocol`,
  `PresentationTransport` from `transport.js`; `SPARKASSEN_AUTH_NAMED_QUERY`.
- Produces:
  - `PHONE_CHANGE_SESSION_TTL_MS = 5 * 60 * 1000`
  - `interface PhoneChangeSessionDto` — exactly as the spec's **The two DTOs**
    section: `sessionId, uri, transport, dcApiRequest, dcApiProtocol, state,
    oldPhone, newPhone`.
  - `type StartPhoneChangeResult = { ok: true; session: PhoneChangeSessionDto } | { ok: false; reason: "not_found" | "invalid_phone" | "phone_unchanged" | "metadata_unavailable" | "foundry_unavailable" }`
  - `startPhoneChange(db: Db, client: FoundryClient, input: { userId: string; phoneNumber: unknown; transport?: PresentationTransport }, now?: number): Promise<StartPhoneChangeResult>` — **return type written out, not inferred.**

Order: resolve the user → validate → `phone_unchanged` check → write the
`pending` row → mint → create the verification request → persist what foundry
served.

- [ ] **Step 1: Write the failing tests**

```ts
describe("startPhoneChange", () => {
  it("writes a pending row before calling foundry", () => {});
  it("stores the NORMALISED number, not the raw input", async () => {
    /* "  +49 172  66666666 " → row.newPhone === "+49 172 66666666" and the payload matches */
  });
  it("snapshots the user's current number as oldPhone", () => {});
  it("refuses an unknown user with not_found and writes nothing", () => {});
  it("refuses a malformed number with invalid_phone, before any write or traffic", () => {
    /* assert the client was never called AND no row exists */
  });
  it("refuses a non-string number with invalid_phone", () => { /* 49171, null, {} */ });
  it("refuses the same number in a different format with phone_unchanged", () => {
    /* stored "+49 171 5555555", submitted "+491715555555" */
  });
  it("mints the metadata BEFORE creating the verification request", () => { /* call order */ });
  it("creates NO verification request when the mint throws", () => {});
  it("creates NO verification request when the mint returns 200 with no jwt", () => {
    /* createAdHocMetadata resolves {}; createVerificationRequest is scripted as a
       perfectly good 200 so the ONLY thing that can stop it is the code */
  });
  it("fails the row with metadata_unavailable when the mint fails", () => {});
  it("sends the minted jwt as the entry's metadata", () => {});
  it("names the sparkassen_auth named query", () => {});
  it("records the transport foundry ACTUALLY served", () => {
    /* ask dc_api_signed, foundry answers a request_uri with no dc_api_request →
       row.transport === "request_uri" and dcApiProtocol === null */
  });
  it("records the ATTEMPTED transport on a failed row", () => {});
  it("returns a DTO with exactly the eight documented members", () => {
    expect(Object.keys(result.session)).toEqual([
      "sessionId", "uri", "transport", "dcApiRequest",
      "dcApiProtocol", "state", "oldPhone", "newPhone",
    ]);
  });
  it("fails with foundry_unavailable when the verification request throws", () => {});
  it("defaults to request_uri when no transport is given", () => {});
});
```

- [ ] **Step 2: Run and confirm failure**

- [ ] **Step 3: Implement `startPhoneChange`**

The jwt check is `typeof minted.jwt === "string" && minted.jwt.length > 0`,
explicitly, with the comment explaining that a 200 carrying `{}` leaves it
`undefined` and `JSON.stringify` then silently drops `metadata`.

- [ ] **Step 4: Run and confirm pass**

- [ ] **Step 5: Commit**

```bash
git add apps/bank/src/lib/phone-change-sessions.ts apps/bank/src/lib/phone-change-sessions.test.ts
git commit -m "feat(bank): open a phone-change presentation"
```

---

### Task 7: `refreshPhoneChangeState`

**Files:**
- Modify: `apps/bank/src/lib/phone-change-sessions.ts`
- Test: `apps/bank/src/lib/phone-change-sessions.test.ts`

**Interfaces:**
- Consumes: `extractAuthSubject`, `passedLoginBinding` from `login-checks.js`.
- Produces:
  - `interface PhoneChangeStatusDto { state: PhoneChangeSessionState; failureReason?: string; newPhone: string }`
  - `getPhoneChangeStatus(db: Db, userId: string, sessionId: string): PhoneChangeStatusDto | null`
  - `type RefreshPhoneChangeResult = { ok: true; status: PhoneChangeStatusDto } | { ok: false; reason: "not_found" }`
  - `refreshPhoneChangeState(db: Db, foundry: FoundryClient, input: { userId: string; sessionId: string }, now?: number): Promise<RefreshPhoneChangeResult>`

A private `loadSession(db, userId, sessionId)` scopes **two** ways — id and
`startedByUserId`. There is no account id in this flow.

- [ ] **Step 1: Write the failing tests**

```ts
describe("refreshPhoneChangeState", () => {
  it("answers not_found for another customer's session", () => {});
  it("answers not_found for a session that does not exist", () => {});
  it("makes no foundry call for an applied or failed session", () => {});
  it("fails with expired past the TTL, without calling foundry", () => {});
  it("makes no foundry call for a session already verified", () => {});
  it("stays pending when getVerificationStatus throws", () => { /* state unchanged, no failure reason */ });
  it("stays pending while foundry reports pending", () => {});
  it("fails with verification_failed when foundry reports failed", () => {});
  it("fails with verification_failed when verified is not true", () => {});
  it("fails with verification_failed when no credential answered", () => {});
  it("fails with transaction_data_binding_failed when the binding did not pass", () => {});
  it("gates the binding BEFORE resolving the sub", async () => {
    /* a sub NO credential carries, plus a failing binding — the only input where
       the two orderings differ. Expect transaction_data_binding_failed, not
       unknown_credential. */
  });
  it("fails with unknown_credential for a sub this bank cannot place", () => {});
  it("fails with wrong_customer for another customer's authenticator", () => {});
  it("verifies and records approvedByUserId on a good presentation", () => {});
  it("does not require the credential row to be active", () => {});
  it("carries newPhone on the status so the dialog can name it", () => {});
});
```

- [ ] **Step 2: Run and confirm failure**

- [ ] **Step 3: Implement the four gates in order**

Terminal → expiry → already-verified → foundry. Then: verified; `sub` read;
binding; resolve + ownership. Document that gate order and why ownership lives
here rather than in apply.

- [ ] **Step 4: Run and confirm pass**

- [ ] **Step 5: Commit**

```bash
git add apps/bank/src/lib/phone-change-sessions.ts apps/bank/src/lib/phone-change-sessions.test.ts
git commit -m "feat(bank): poll a phone-change presentation with the ownership gate"
```

---

### Task 8: `applyPhoneChange` and the DC API relay

**Files:**
- Modify: `apps/bank/src/lib/phone-change-sessions.ts`
- Test: `apps/bank/src/lib/phone-change-sessions.test.ts`

**Interfaces:**
- Produces:
  - `type ApplyPhoneChangeResult = { ok: true; phoneNumber: string } | { ok: false; reason: "not_found" | "not_verified" | "already_applied" | "expired" | "phone_changed" }`
  - `applyPhoneChange(db: Db, input: { userId: string; sessionId: string }, now?: number): ApplyPhoneChangeResult` — synchronous.
  - `type RelayPhoneChangeResult = { ok: true } | { ok: false; reason: "not_found" | "no_verification" | "foundry_unavailable" }`
  - `relayPhoneChangeDcApiResponse(db: Db, client: FoundryClient, input: { userId: string; sessionId: string; response: string }): Promise<RelayPhoneChangeResult>`

- [ ] **Step 1: Write the failing tests**

```ts
describe("applyPhoneChange", () => {
  it("writes the approved number and moves verified → applied", () => {});
  it("answers not_found for another customer's session", () => {});
  it("answers not_verified for a pending session", () => {});
  it("answers already_applied on a second call", () => {});
  it("answers expired past the TTL and fails the row", () => {});
  it("refuses phone_changed when the user's number moved underneath", () => {});
  it("leaves the session CLAIMABLE after a phone_changed refusal", () => {
    /* restore the number, apply again, expect ok */
  });
  it("writes the number exactly ONCE across two applies", () => {
    /* apply; set users.phone_number BACK to oldPhone; apply again; expect
       already_applied and the number NOT re-written. Restoring is what makes
       this fail if the guarded UPDATE is deleted. */
  });
  it("rolls both writes back together", () => {
    /* force the CAS to miss; expect session state and users.phone_number untouched */
  });
});

describe("relayPhoneChangeDcApiResponse", () => {
  it("submits the response for the session's verification", () => {});
  it("answers not_found for another customer's session", () => {});
  it("answers no_verification when the row has no foundry id", () => {});
  it("answers foundry_unavailable when submit throws", () => {});
  it("discards foundry's verdict", () => { /* no state write */ });
});
```

- [ ] **Step 2: Run and confirm failure**

- [ ] **Step 3: Implement both**

The stale-snapshot gate comes **before** the guarded UPDATE. The transition is a
guarded UPDATE on `(id, state = "verified")` whose `.changes` decides the winner,
and the user write is a CAS on `(id, phoneNumber = oldPhone)` whose zero-change
result throws a private `StaleSnapshotError` to roll the transaction back. Both
inside one `db.transaction`.

- [ ] **Step 4: Run and confirm pass**

- [ ] **Step 5: Commit**

```bash
git add apps/bank/src/lib/phone-change-sessions.ts apps/bank/src/lib/phone-change-sessions.test.ts
git commit -m "feat(bank): apply an approved phone change under a guarded write"
```

---

### Task 9: `lib/phone-dialog-state.ts`

**Files:**
- Create: `apps/bank/src/lib/phone-dialog-state.ts`
- Test: `apps/bank/src/lib/phone-dialog-state.test.ts`

**Interfaces:**
- Produces:
  - `type PhonePhase = "form" | "waiting" | "success" | "error"`
  - `type PhoneFailureKey = "expired" | "unknownCredential" | "phoneChanged" | "invalidPhone" | "phoneUnchanged" | "verificationFailed"`
  - `isPhoneTerminal(state: string): boolean`
  - `selectPhonePhase(state: string | null, applied: boolean, pollFailed: boolean): PhonePhase`
  - `phoneFailureKey(failureReason: string | undefined): PhoneFailureKey`
  - `canSubmitPhone(typed: string, current: string): boolean` — valid **and** not
    the same number.

`needsQrRecovery` and `selectLoginAffordance` are **imported** by the dialog from
`limit-dialog-state.js` / `login-dialog-state.js`. Do not copy them.

- [ ] **Step 1: Write the failing tests**

```ts
describe("isPhoneTerminal", () => {
  it("stops on verified, applied and failed", () => {});
  it("keeps polling on an unrecognised state", () => {});
});

describe("selectPhonePhase", () => {
  it("shows the form before a session exists", () => { expect(selectPhonePhase(null, false, false)).toBe("form"); });
  it("puts startFailed AHEAD of the null check", () => {
    expect(selectPhonePhase(null, false, true)).toBe("error");
  });
  it("keeps verified on waiting, not success", () => { expect(selectPhonePhase("verified", false, false)).toBe("waiting"); });
  it("shows success only once applied", () => {});
  it("lets a successful apply outrank a late poll failure", () => {
    expect(selectPhonePhase("failed", true, true)).toBe("success");
  });
});

describe("phoneFailureKey", () => {
  it("maps expired, unknown_credential, phone_changed, invalid_phone, phone_unchanged", () => {});
  it("falls wrong_customer through to the generic message", () => {
    expect(phoneFailureKey("wrong_customer")).toBe("verificationFailed");
  });
  it("falls metadata_unavailable and undefined through to the generic message", () => {});
});

describe("canSubmitPhone", () => {
  it("refuses the number already in force, in any format", () => {});
  it("refuses an empty or malformed entry", () => {});
  it("accepts a different, well-formed number", () => {});
});
```

- [ ] **Step 2: Run and confirm failure**

- [ ] **Step 3: Implement**

Document why `startFailed` outranks `state === null` (the limit change shipped
that bug once; locally it is every attempt) and why `verified` is still
`waiting`.

- [ ] **Step 4: Run and confirm pass**

- [ ] **Step 5: Commit**

```bash
git add apps/bank/src/lib/phone-dialog-state.ts apps/bank/src/lib/phone-dialog-state.test.ts
git commit -m "feat(bank): extract the phone-change dialog's decisions"
```

---

### Task 10: The four routes

**Files:**
- Create: `apps/bank/src/app/api/profile/phone-change/segments.ts`
- Create: `apps/bank/src/app/api/profile/phone-change/route.ts`
- Create: `apps/bank/src/app/api/profile/phone-change/[sessionId]/route.ts`
- Create: `apps/bank/src/app/api/profile/phone-change/[sessionId]/apply/route.ts`
- Create: `apps/bank/src/app/api/profile/phone-change/[sessionId]/dc-api-response/route.ts`
- Test: `apps/bank/src/app/api/profile/phone-change/route.test.ts`

**Interfaces:**
- Consumes: Tasks 6–8; `withSession` from `lib/api.js`.
- Produces: `sessionIdFromPoll(request: Request): string` (`.at(-1)`) and
  `sessionIdFromAction(request: Request): string` (`.at(-2)`) in `segments.ts`.

Segments are read by **plain string splitting**, never `new URL(...)`, which
throws — an unreadable id must fall through to the same 404, not a 500.

Start body: `z.object({ phoneNumber: z.string(), transport: z.enum(["request_uri","dc_api","dc_api_signed"]).optional() })`.
Note `phoneNumber` is `z.string()` here and `unknown` into `startPhoneChange`:
the deep check is `isValidPhoneNumber`, and the route must not duplicate it.

Status mapping — start: `not_found` 404, `invalid_phone` 400,
`phone_unchanged` 409, else 502. Apply: `not_found` 404,
`already_applied`/`expired` 410, else 409. Relay: `foundry_unavailable` 502,
else 404; success is **204**.

- [ ] **Step 1: Write the failing tests**

```ts
describe("POST /api/profile/phone-change", () => {
  it("answers 201 with the DTO straight through", async () => {
    expect(Object.keys(await res.json())).toEqual([
      "sessionId", "uri", "transport", "dcApiRequest",
      "dcApiProtocol", "state", "oldPhone", "newPhone",
    ]);
  });
  it("agrees member for member with what startPhoneChange returned", () => {});
  it("answers 400 for a missing body", () => {});
  it("answers 400 for a non-string phoneNumber", () => {});
  it("answers 400 for invalid_phone", () => {});
  it("answers 409 for phone_unchanged", () => {});
  it("answers 502 for metadata_unavailable", () => {});
  it("answers 502 for foundry_unavailable", () => {});
  it("rejects a bogus transport value with 400", () => {});
});

describe("GET /api/profile/phone-change/[sessionId]", () => {
  it("reads the session id from the last segment", () => {});
  it("answers 404 for another customer's session", () => {});
  it("never writes the number", () => { /* users row unchanged */ });
});

describe("POST …/[sessionId]/apply", () => {
  it("reads the session id from the second-to-last segment", () => {});
  it("answers 200 with the new number", () => {});
  it("answers 410 for already_applied and for expired", () => {});
  it("answers 409 for not_verified and for phone_changed", () => {});
});

describe("POST …/[sessionId]/dc-api-response", () => {
  it("answers 204 and no body on success", () => {});
  it("answers 400 for a missing response member", () => {});
  it("answers 502 for foundry_unavailable", () => {});
});
```

The exact-key-set assertion on the 201 is deliberately **not** a subset check:
`JSON.stringify` silently drops `undefined`, which no type can catch, and an
absent member is exactly the defect this repo shipped once.

- [ ] **Step 2: Run and confirm failure**

- [ ] **Step 3: Implement `segments.ts` and the four handlers**

The start route is `NextResponse.json(result.session, { status: 201 })` —
straight through, never re-assembled.

- [ ] **Step 4: Run and confirm pass**

- [ ] **Step 5: Commit**

```bash
git add apps/bank/src/app/api/profile
git commit -m "feat(bank): add the four phone-change routes"
```

---

### Task 11: Copy

**Files:**
- Modify: `apps/bank/src/lib/i18n/messages.ts`
- Test: `apps/bank/src/lib/i18n/messages.test.ts` (likely adds **zero** cases)

**Interfaces:**
- Produces: `MESSAGES[locale].dashboard.profile`, `MESSAGES[locale].profile`
  (`username`, `mobileNumber`), and `MESSAGES[locale].phones` keyed exactly as
  the spec's **Copy** section lists.

- [ ] **Step 1: Add the type members, then the two catalogs**

`pnpm typecheck` is the real gate here: a key present in one locale and absent
from the other is a compile error, not a test failure.

`phones` failure keys must be exactly `phoneFailureKey`'s six outputs.

- [ ] **Step 2: Fix the stale comment**

The block comment above `limits` claims the consent screen uses `en-US` /
`de-DE`. It does not, since 2026-10-19. Correct it rather than copying it.

- [ ] **Step 3: Run typecheck and the suite**

Run: `cd /Users/senexi/dev/eudiw/payment-banking-demo && pnpm check`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add apps/bank/src/lib/i18n
git commit -m "feat(bank): add profile and phone-change copy in both locales"
```

---

### Task 12: The three components

**Files:**
- Create: `apps/bank/src/components/ProfilePanel.tsx` (server)
- Create: `apps/bank/src/components/PhoneNumberRow.tsx` (`"use client"`)
- Create: `apps/bank/src/components/PhoneChangeDialog.tsx` (`"use client"`)
- Modify: `apps/bank/src/app/page.tsx`

**Interfaces:**
- Consumes: Tasks 5, 9, 11; `needsQrRecovery` from `limit-dialog-state.js`;
  `selectLoginAffordance` from `login-dialog-state.js`; `selectTransport`,
  `DcApiForm` from `transport.js`; `@demo/ui` hooks.

**No tests.** No vitest project here matches `.tsx`. These files render what
Tasks 5, 9 and 11 return and decide nothing; they rest entirely on Task 13.

- [ ] **Step 1: `ProfilePanel`**

Server component. Props `{ username, phoneNumber, locale, dcApiForm }`. One
`.panel p-6` holding two rows: Username (plain) and Mobile number (value plus
`<PhoneNumberRow>`). The number is rendered by the panel, not the row — it must
come off the server render or `router.refresh()` cannot update it.

- [ ] **Step 2: `PhoneNumberRow`**

The client boundary: a Change button styled like `AccountLimitRow`'s, and the
dialog. **Not suppressed** when the customer holds no authenticator.

- [ ] **Step 3: `PhoneChangeDialog`**

`LimitChangeDialog`'s structure with an `<input type="tel">` pre-filled with the
current number in place of the preset chips. Continue disabled unless
`canSubmitPhone`. Four phases from `selectPhonePhase`. Failure copy from
`phoneFailureKey(startError ?? applyError ?? value?.failureReason)`.

**`dcError` must NOT be cleared** when the QR-recovery session arrives.
No `await` may execute between the click handler starting and `invokeDcGet`.
Check `!relayed.ok` — `fetch` does not throw on a non-2xx.

- [ ] **Step 4: Wire it into `page.tsx`**

A new `<section>` **below Credentials, above Recent transactions**, with an
`h2.eyebrow` reading `t.dashboard.profile`. Read `getProfile(db, session.userId)`
beside the existing queries. Pass the `dcApiForm` the page already computes.

- [ ] **Step 5: Confirm the build**

Run: `cd /Users/senexi/dev/eudiw/payment-banking-demo && pnpm check && pnpm build`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add apps/bank/src/components apps/bank/src/app/page.tsx
git commit -m "feat(bank): add the Your details panel and phone-change dialog

Neither .tsx file is covered by any vitest project here; both rest on the
browser verification in the following commit."
```

---

### Task 13: Verification against real services

**Files:**
- No source changes expected. Scratch scripts are deleted before committing.

- [ ] **Step 1: Verify the request leg against the DEPLOYED foundry**

Port-forward the admin API to **9100**, not 9000 — a local foundry may own
`127.0.0.1:9000` while the forward binds only `[::1]:9000`, and you will
silently probe the wrong server.

```bash
kubectl -n foundry port-forward svc/foundry 9100:9000
kubectl -n foundry get secret foundry-admin -o jsonpath='{.data.admin-api-key}' | base64 -d
```

Use a scratch `.ts` file plus `pnpm exec tsx --env-file-if-exists=.env.local`.
Assert on the request object foundry **serves**, not on a 200:

1. the served `transaction_data` entry decodes byte-exact to what was sent;
2. `metadata` is present and equals the minted JWT;
3. the JWT is a 3-segment compact JWS, `typ: adhoc-transaction-metadata+jwt`,
   `transaction_data_type` equal to the entry's `type`, `exp - iat === 900`;
4. the echoed metadata has both claims in consent order, **no `value_type` on
   either**, bare `en`/`de` on every display and all four `ui_labels`, and the
   security hint verbatim in both;
5. a deliberately **bogus** `credential_ids` entry is **HTTP 400** — this is
   what makes the 200s evidence rather than serde dropping a field.

- [ ] **Step 2: Verify in a real browser**

`tools/cdp/cdp.mjs`, against a bank pointed at the deployed foundry. Confirm:
the panel renders below Credentials with both rows; Change opens the dialog
pre-filled; Continue is disabled until the number differs; the default transport
writes a `dc_api_signed` row with an inline signed request object and **no QR
canvas**; `?dcapi=unsigned` writes a `dc_api` row with a bare parameter object;
a number typed with stray spaces is stored collapsed. **Click the wallet
button** — this repo has mistaken "renders the button" for "the button works".
Record whether `navigator.credentials.get()` rejects or hangs; if it rejects,
confirm the QR count goes 0 → 1 and the recovery button withdraws itself.

- [ ] **Step 3: Run the full gate and measure**

Run: `cd /Users/senexi/dev/eudiw/payment-banking-demo && pnpm check`
Record the four project totals and the delta. **Measure; do not project.**

- [ ] **Step 4: Update `AGENTS.md`**

Add a `### The phone number change` block under **Hard-won constraints**
recording: the no-`value_type` rule and why; the verbatim storage decision and
its accepted cost; the digits-only `phone_unchanged` comparison; that
`phone_change_sessions` must be cleared in `seedWithin`; the measured test
delta with its per-file split; and a **Known-unverifiable** paragraph saying
plainly that no wallet has answered a phone-change presentation and that the
ownership gate, the binding gate and `applyPhoneChange` are exercised only by
the suite.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md
git commit -m "docs: record what the phone-change work verified, and what it did not"
```