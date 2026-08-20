# Age-Verification Credential Issuance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The bank can issue an age-verification credential (`credential_type_id: "av"`, claims `age_over_16` and `age_over_18`) into the user's EUDI wallet, from a new `Nachweise` section on the dashboard.

**Architecture:** `credentials` gains a `credentialTypeId` discriminator (defaulted to the DPC type) and drops `NOT NULL` from `cardId` and `credentialId`, so one table and one polling route serve both credential types. Issuance is a sibling function `startAvIssuance`, not a generalization of `startIssuance` — the DPC path joins accounts for an IBAN and builds two display arrays, neither of which an age credential has. All German copy and every rendering decision live in `.ts` modules, because every vitest project is `environment: "node"` with `include: ["src/**/*.test.ts"]` and `.tsx` is never covered.

**Tech Stack:** Next.js 15 (App Router, `src/app`), React 19, Tailwind v4 (`@theme` in `globals.css`), drizzle-orm + drizzle-kit + better-sqlite3 13.x, vitest 2, `jose`.

**Spec:** `docs/superpowers/specs/2026-08-20-av-credential-issuance-design.md`

## Global Constraints

- **`pnpm`, never `npm`.** Run everything from the repo root unless a task says otherwise.
- **`pnpm check` is the gate** (`typecheck && test` across all 4 projects). Baseline measured 2026-08-20: **329 tests** (120 bank + 167 merchant + 11 foundry-client + 31 ui). This plan projects **356**. Projections in this repo have been wrong repeatedly — one earlier plan projected 210 against an actual 218, another 294 against 295. **Measure and report the real number**, never restate 356.
- **`credential_type_id` is exactly `av`.** Not `age_verification`, not `eu.europa.ec.av.1`. That last string is the mdoc *docType*, configured on foundry's side; it is not the type id the admin API takes.
- **The claims are exactly `{"age_over_16": true, "age_over_18": true}`.** Booleans, not strings. No birthdate, no name, no `credential_id`.
- **Never send `offer_display` or `credential_response_display` for the `av` type.** `foundry-issuer/src/create_offer.rs` gates both on `ct.vct == "com.emvco.dpc.card"` and returns `invalid_request` otherwise. Sending them turns every AV issuance into a `failed` row.
- **Do not touch foundry's config**, locally or in the cluster. The operator adds the `av` credential type separately. Until then a real `POST` legitimately fails — that is the expected state, not a bug to work around.
- **Local imports are written `./foo.js` for a `./foo.ts` file.** Correct Node ESM form; required for vitest and tsc to agree.
- **TypeScript is strict with `noUnusedLocals` and `noUnusedParameters`.** An intentionally-unused parameter must be prefixed `_`.
- **`pnpm dev` is broken** (`Module not found: Can't resolve 'fs'`, edge-runtime `instrumentation.ts`). Anything needing a running server uses `pnpm build` then `pnpm --filter @demo/bank start`. See `AGENTS.md`.
- **German UI copy in the bank**, with one standing exception: the DC API diagnostic strings in `IssuanceDialog` stay English and are not touched by this work.
- **Nothing is drawn over the age credential's face** — no IBAN, no holder, no `EuStars`. The artwork already carries the wordmark and the issuer logo.
- **TDD.** Write the failing test, run it, confirm it fails for the right reason, then implement.
- **Commits** use conventional prefixes (`feat(bank):`, `refactor(bank):`, `docs:`), state what was *verified*, and state plainly what was not.

## File Structure

**Created:**

| Path | Responsibility |
| --- | --- |
| `apps/bank/src/lib/credential-types.ts` | `DPC_CREDENTIAL_TYPE_ID`, `AV_CREDENTIAL_TYPE_ID`, `CredentialTypeId` — bound to the schema enum by `satisfies`. |
| `apps/bank/src/lib/av-issuance.ts` | `startAvIssuance` — the age credential's offer. |
| `apps/bank/src/lib/av-issuance.test.ts` | Tests for the above. |
| `apps/bank/src/lib/credential-copy.ts` | `FACE_COPY` and `DIALOG_COPY`, keyed by credential type id. All German customer copy. |
| `apps/bank/src/lib/credential-copy.test.ts` | Tests for the above. |
| `apps/bank/src/app/api/credentials/av/route.ts` | `POST` — starts an age-credential issuance. |
| `apps/bank/src/components/AgeCredentialTile.tsx` | The age credential's tile. |
| `apps/bank/public/av-face.svg` | The age credential's artwork. |
| `apps/bank/drizzle/0001_*.sql` | Generated migration. |

**Modified:**

| Path | Change |
| --- | --- |
| `apps/bank/src/db/schema.ts` | `credentials`: `cardId` and `credentialId` nullable, `credentialTypeId` added. |
| `apps/bank/src/db/schema.test.ts` | New `describe` block for the credentials shape and the migration. |
| `apps/bank/src/lib/issuance.ts` | Re-export `DPC_CREDENTIAL_TYPE_ID` from the new module; set it explicitly on insert. |
| `apps/bank/src/lib/payments.ts` | Two guards: credential type, and null `cardId`. |
| `apps/bank/src/lib/payments.test.ts` | Two tests for those guards. |
| `apps/bank/src/lib/queries.ts` | `getAgeCredentialState`. |
| `apps/bank/src/lib/queries.test.ts` | Tests for it. |
| `apps/bank/src/lib/card-state.ts` | `STATE_COPY` becomes an alias of `FACE_COPY[DPC_CREDENTIAL_TYPE_ID]`. |
| `apps/bank/src/components/IssuanceDialog.tsx` | Takes a `copy: IssuanceCopy` prop; four hardcoded `Karte` strings removed. |
| `apps/bank/src/components/CardTile.tsx` | Passes the DPC dialog copy. |
| `apps/bank/src/app/globals.css` | `.card-object-av`. |
| `apps/bank/src/app/page.tsx` | The `Nachweise` section. |
| `AGENTS.md`, `apps/bank/AGENTS.md` | Test count, schema shape, the display-metadata prohibition, the open operator dependency. |

**Deliberately not modified:** `refreshIssuanceState`, `apps/bank/src/app/api/credentials/[id]/status/route.ts`, `apps/bank/src/db/seed.ts`, `packages/ui`, `packages/foundry-client`, the `Dockerfile`, anything under `apps/merchant`.

---

### Task 1: The credentials table learns about credential types

**Files:**

- Create: `apps/bank/src/lib/credential-types.ts`
- Modify: `apps/bank/src/db/schema.ts` (the `credentials` table)
- Modify: `apps/bank/src/lib/issuance.ts` (import site + explicit insert value)
- Create: `apps/bank/drizzle/0001_*.sql` (generated)
- Test: `apps/bank/src/db/schema.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `DPC_CREDENTIAL_TYPE_ID: "com.emvco.dpc.card"`, `AV_CREDENTIAL_TYPE_ID: "av"`, `type CredentialTypeId = "com.emvco.dpc.card" | "av"` from `@/lib/credential-types.js`. `credentials.cardId` and `credentials.credentialId` become `string | null` on select; `credentials.credentialTypeId` is `CredentialTypeId`.

- [ ] **Step 1: Write the failing tests**

First replace the `node:fs` import line at the top of `apps/bank/src/db/schema.test.ts` and add one more import:

```ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import Database from "better-sqlite3";
```

Then append to the end of the file:

```ts
/**
 * Applies the project's migrations to a raw better-sqlite3 handle, in journal
 * order, optionally stopping short of the last one. Drizzle separates
 * statements with `--> statement-breakpoint`, which better-sqlite3's exec()
 * does not understand, so they are split and run individually.
 */
function applyMigrations(sqlite: Database.Database, skipLast = false): string[] {
  const folder = path.join(process.cwd(), "drizzle");
  const journal = JSON.parse(
    readFileSync(path.join(folder, "meta", "_journal.json"), "utf8"),
  ) as { entries: { tag: string }[] };
  const tags = journal.entries.map((entry) => entry.tag);
  const applied = skipLast ? tags.slice(0, -1) : tags;
  for (const tag of applied) {
    const file = readFileSync(path.join(folder, `${tag}.sql`), "utf8");
    for (const statement of file.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) sqlite.exec(trimmed);
    }
  }
  return tags;
}

describe("credentials shape", () => {
  it("carries an existing row through the newest migration, defaulting its type", () => {
    // The point of this test: 0001 relaxes two NOT NULLs, which SQLite can only
    // do by rebuilding the table. A rebuild that drops rows, or that leaves
    // credential_type_id empty, would be silent.
    const sqlite = new Database(path.join(dir, "migrate.db"));
    const tags = applyMigrations(sqlite, true);
    expect(tags.length).toBeGreaterThan(1);

    sqlite.exec(`
      INSERT INTO users (id, username, password_hash, display_name)
        VALUES ('u1', 'u1', 'h', 'U One');
      INSERT INTO accounts (id, user_id, iban, currency, balance_cents)
        VALUES ('a1', 'u1', 'DE02120300000000202051', 'EUR', 1000);
      INSERT INTO cards (id, user_id, account_id, pan_last4, network, card_alias, created_at)
        VALUES ('c1', 'u1', 'a1', '4242', 'girocard', 'girocard', 1);
      INSERT INTO credentials (id, user_id, card_id, credential_id, foundry_tx_id, state, issued_at, created_at)
        VALUES ('cr1', 'u1', 'c1', 'dpc_legacy_1', 'tx1', 'active', 2, 1);
    `);

    applyMigrations(sqlite);

    const row = sqlite
      .prepare(`SELECT * FROM credentials WHERE id = 'cr1'`)
      .get() as Record<string, unknown>;
    expect(row.credential_id).toBe("dpc_legacy_1");
    expect(row.state).toBe("active");
    expect(row.credential_type_id).toBe("com.emvco.dpc.card");
    sqlite.close();
  });

  it("defaults credentialTypeId to the payment credential", () => {
    seed(db);
    db.insert(credentials)
      .values({
        id: "cred_default",
        userId: "user_anna",
        cardId: "card_anna",
        credentialId: "dpc_default_1",
        state: "offered",
        createdAt: 1,
      })
      .run();
    const row = db
      .select()
      .from(credentials)
      .where(eq(credentials.id, "cred_default"))
      .get();
    expect(row?.credentialTypeId).toBe("com.emvco.dpc.card");
  });

  it("accepts an age credential with no card and no credential id", () => {
    seed(db);
    db.insert(credentials)
      .values({
        id: "cred_av",
        userId: "user_anna",
        cardId: null,
        credentialTypeId: "av",
        credentialId: null,
        state: "offered",
        createdAt: 1,
      })
      .run();
    const row = db
      .select()
      .from(credentials)
      .where(eq(credentials.id, "cred_av"))
      .get();
    expect(row?.cardId).toBeNull();
    expect(row?.credentialId).toBeNull();
    expect(row?.credentialTypeId).toBe("av");
  });

  it("permits several rows with a null credential id", () => {
    // SQLite treats NULLs as distinct under a UNIQUE index. Two age credentials
    // must coexist even though neither has a join key.
    seed(db);
    for (const id of ["cred_av_1", "cred_av_2"]) {
      db.insert(credentials)
        .values({
          id,
          userId: "user_anna",
          cardId: null,
          credentialTypeId: "av",
          credentialId: null,
          state: "offered",
          createdAt: 1,
        })
        .run();
    }
    expect(db.select().from(credentials).all()).toHaveLength(2);
  });

  it("still rejects a duplicate credential id", () => {
    seed(db);
    const insert = (id: string) =>
      db
        .insert(credentials)
        .values({
          id,
          userId: "user_anna",
          cardId: "card_anna",
          credentialId: "dpc_dupe",
          state: "offered",
          createdAt: 1,
        })
        .run();
    insert("cred_a");
    expect(() => insert("cred_b")).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @demo/bank test src/db/schema.test.ts`
Expected: FAIL. The three `credentialTypeId` tests fail to typecheck or report `undefined`, and the migration test fails on `expect(tags.length).toBeGreaterThan(1)` because only `0000` exists.

- [ ] **Step 3: Create the credential-type constants**

Create `apps/bank/src/lib/credential-types.ts`:

```ts
import type { Credential } from "../db/schema.js";

/**
 * The credential type ids this bank issues, spelled exactly as foundry's admin
 * API names them.
 *
 * These live in their own module rather than in `issuance.ts` so `payments.ts`
 * can name the payment type without importing the issuance path, which would
 * drag in the foundry client, `env`, and the display-metadata builders — none
 * of which a debit has any business touching.
 *
 * `satisfies` binds each literal to the schema's enum, so widening the column
 * without updating these (or the reverse) is a compile error rather than a
 * branch that silently never runs.
 */
export type CredentialTypeId = Credential["credentialTypeId"];

/** The EMVCo Digital Payment Credential. */
export const DPC_CREDENTIAL_TYPE_ID = "com.emvco.dpc.card" satisfies CredentialTypeId;

/**
 * The age-verification attestation. NOT `eu.europa.ec.av.1` — that is the mdoc
 * docType configured on foundry's side; this is the credential type id the
 * admin API takes.
 */
export const AV_CREDENTIAL_TYPE_ID = "av" satisfies CredentialTypeId;
```

- [ ] **Step 4: Change the schema**

In `apps/bank/src/db/schema.ts`, replace the whole `credentials` table declaration and the comment block above it with:

```ts
/**
 * A digital credential instance issued into the user's wallet. One card may
 * yield several rows over time (re-issue after expiry); there is no `revoked`
 * state (spec 2). Not every credential has a card behind it — the age
 * attestation is issued to the person.
 */
export const credentials = sqliteTable("credentials", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  /** NULL for a credential with no payment instrument behind it. */
  cardId: text("card_id").references(() => cards.id),
  /**
   * Which credential type foundry issued. Defaulted to the payment credential
   * because that is the only thing this bank issued before age verification
   * existed, which also makes the 0001 migration's backfill automatic. An
   * insert that means something else must say so: `startAvIssuance` does.
   */
  credentialTypeId: text("credential_type_id", {
    enum: ["com.emvco.dpc.card", "av"],
  })
    .notNull()
    .default("com.emvco.dpc.card"),
  /**
   * The opaque value carried in the DPC credential — the loop's join key with
   * the merchant. NULL for an age credential, which has no payment join key and
   * discloses no identifier at all. SQLite treats NULLs as distinct under a
   * UNIQUE index, so the DPC uniqueness invariant is untouched, and
   * `processPayment`'s `credential_id = ?` lookup can never match a NULL row.
   */
  credentialId: text("credential_id").unique(),
  foundryTxId: text("foundry_tx_id"),
  state: text("state", { enum: ["offered", "active", "failed"] }).notNull(),
  issuedAt: integer("issued_at"),
  createdAt: integer("created_at").notNull(),
});
```

Leave every other table and the `export type` block at the bottom untouched.

- [ ] **Step 5: Name the type explicitly at the DPC insert site**

In `apps/bank/src/lib/issuance.ts`, add the import beside the existing `mintCredentialId` one:

```ts
import { DPC_CREDENTIAL_TYPE_ID } from "./credential-types.js";
```

Delete the local declaration:

```ts
/** The credential type id configured in foundry (spec 3). */
export const DPC_CREDENTIAL_TYPE_ID = "com.emvco.dpc.card";
```

and replace it with a re-export, so this module's public surface is unchanged:

```ts
export { DPC_CREDENTIAL_TYPE_ID } from "./credential-types.js";
```

Then in the `db.insert(credentials).values({...})` call, add one line immediately after `cardId: card.id,`:

```ts
      credentialTypeId: DPC_CREDENTIAL_TYPE_ID,
```

- [ ] **Step 6: Generate the migration**

Run: `pnpm --filter @demo/bank db:generate`

This is non-interactive for a column addition plus two `NOT NULL` relaxations. If drizzle-kit prompts about a rename, answer that nothing was renamed — a prompt means the Step 4 edit differs from what is written above.

Now **read** `apps/bank/drizzle/0001_*.sql` and confirm three things. Do not skip this; the Step 1 test checks the outcome, but this SQL is what ships:

1. It rebuilds the table (`__new_credentials`, `INSERT INTO … SELECT`, `DROP TABLE`, `ALTER TABLE … RENAME`). A bare `ALTER TABLE credentials ALTER COLUMN` would be invalid SQLite.
2. The new table declares `credential_id text UNIQUE` (or a separate unique index) and `credential_type_id text DEFAULT 'com.emvco.dpc.card' NOT NULL`.
3. The `INSERT … SELECT` lists every retained column, so no data is dropped.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @demo/bank test src/db/schema.test.ts`
Expected: PASS, every test in the file.

Then the whole bank suite, because the schema change touches all eight `insert(credentials)` call sites:

Run: `pnpm --filter @demo/bank test && pnpm --filter @demo/bank typecheck`
Expected: tests PASS. `typecheck` may now fail in `payments.ts` on `eq(cards.id, credential.cardId)` — that is expected and is Task 2's job. Note it and proceed; do not fix it here.

- [ ] **Step 8: Commit**

```bash
git add apps/bank/src/lib/credential-types.ts apps/bank/src/db/schema.ts \
        apps/bank/src/db/schema.test.ts apps/bank/src/lib/issuance.ts \
        apps/bank/drizzle
git commit -m "feat(bank): let a credential row exist without a card

credentials gains credential_type_id, defaulted to the payment credential
so the 0001 migration backfills itself and the eight existing insert sites
keep compiling. card_id and credential_id become nullable: an age
attestation is issued to the person, not to a payment instrument, and
discloses no join key at all.

Verified: the generated migration rebuilds the table and an existing
credential row survives it with its type intact, asserted by applying the
real migration files to a scratch database rather than by inspection."
```

---

### Task 2: An age credential cannot move money

**Files:**

- Modify: `apps/bank/src/lib/payments.ts`
- Test: `apps/bank/src/lib/payments.test.ts`

**Interfaces:**

- Consumes: `DPC_CREDENTIAL_TYPE_ID` from `@/lib/credential-types.js`; the nullable `credentials.cardId`.
- Produces: nothing new. `processPayment`'s signature and result union are unchanged.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe("processPayment", …)` block in `apps/bank/src/lib/payments.test.ts`:

```ts
  it("refuses to settle against an age credential", () => {
    // Deliberately given a non-null credential_id: nothing in the schema
    // forbids one, so this isolates the credential-type guard rather than
    // passing by accident on a NULL that could never have matched.
    db.insert(credentials)
      .values({
        id: "cred_av_active",
        userId: "user_anna",
        cardId: null,
        credentialTypeId: "av",
        credentialId: "av_pretending_to_be_a_card",
        state: "active",
        issuedAt: 1,
        createdAt: 1,
      })
      .run();

    const result = processPayment(db, {
      credentialId: "av_pretending_to_be_a_card",
      amountCents: 100,
      currency: "EUR",
      merchant: "Larder",
      reference: "order_1",
      idempotencyKey: "idem_av_1",
    });

    expect(result).toEqual({ ok: false, reason: "unknown_credential" });
    expect(
      db
        .select()
        .from(transactions)
        .where(eq(transactions.idempotencyKey, "idem_av_1"))
        .get(),
    ).toBeUndefined();
  });

  it("refuses to settle a payment credential that has no card", () => {
    db.insert(credentials)
      .values({
        id: "cred_orphan",
        userId: "user_anna",
        cardId: null,
        credentialId: "dpc_orphan_1",
        state: "active",
        issuedAt: 1,
        createdAt: 1,
      })
      .run();

    const result = processPayment(db, {
      credentialId: "dpc_orphan_1",
      amountCents: 100,
      currency: "EUR",
      merchant: "Larder",
      reference: "order_2",
      idempotencyKey: "idem_orphan_1",
    });

    expect(result).toEqual({ ok: false, reason: "unknown_credential" });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @demo/bank test src/lib/payments.test.ts`
Expected: FAIL. The first test settles the payment and returns `{ ok: true, … }`; the second does the same or throws from drizzle on a null `cards.id` comparison.

- [ ] **Step 3: Add the guards**

In `apps/bank/src/lib/payments.ts`, add the import:

```ts
import { DPC_CREDENTIAL_TYPE_ID } from "./credential-types.js";
```

then replace:

```ts
  if (!credential) return { ok: false, reason: "unknown_credential" };
  if (credential.state !== "active") return { ok: false, reason: "credential_not_active" };

  const card = db.select().from(cards).where(eq(cards.id, credential.cardId)).get();
```

with:

```ts
  if (!credential) return { ok: false, reason: "unknown_credential" };

  // An age attestation is not a payment instrument. Reported as
  // unknown_credential rather than as a distinct reason: this is a
  // server-to-server call behind a shared secret, and the merchant maps every
  // credential problem to one user-facing message anyway.
  if (credential.credentialTypeId !== DPC_CREDENTIAL_TYPE_ID) {
    return { ok: false, reason: "unknown_credential" };
  }

  if (credential.state !== "active") return { ok: false, reason: "credential_not_active" };

  // cardId is nullable since the age credential landed. The narrowing is what
  // the next line needs, and closing the same hole twice is deliberate: this
  // one is enforced by the compiler, the one above by the type id.
  if (!credential.cardId) return { ok: false, reason: "unknown_credential" };

  const card = db.select().from(cards).where(eq(cards.id, credential.cardId)).get();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @demo/bank test src/lib/payments.test.ts && pnpm --filter @demo/bank typecheck`
Expected: PASS, and typecheck clean — including the `payments.ts` error Task 1 left behind.

- [ ] **Step 5: Commit**

```bash
git add apps/bank/src/lib/payments.ts apps/bank/src/lib/payments.test.ts
git commit -m "feat(bank): refuse to settle a payment against a non-payment credential

Two guards in processPayment: the credential type must be the DPC, and the
credential must have a card. The second is compiler-forced now that cardId
is nullable; keeping both means the hole is closed semantically and
structurally. A third reason already exists for free -- an AV row's
credential_id is NULL, and SQL never matches NULL.

Verified: an active 'av' row carrying a deliberately non-null credential_id
is refused, and books no transaction."
```

---

### Task 3: Reading the age credential's state

**Files:**

- Modify: `apps/bank/src/lib/queries.ts`
- Test: `apps/bank/src/lib/queries.test.ts`

**Interfaces:**

- Consumes: `AV_CREDENTIAL_TYPE_ID` from `@/lib/credential-types.js`; the existing `CardCredentialState` type.
- Produces: `getAgeCredentialState(db: Db, userId: string): AgeCredentialDto`, where `interface AgeCredentialDto { state: CardCredentialState; credentialRowId: string | null }`.

- [ ] **Step 1: Write the failing tests**

Change the query import at the top of `apps/bank/src/lib/queries.test.ts`:

```ts
import {
  getAgeCredentialState,
  listAccounts,
  listCards,
  listTransactions,
} from "./queries.js";
```

Then append to the end of the file:

```ts
describe("getAgeCredentialState", () => {
  /** Inserts an age-credential row; `state` and `createdAt` are what vary. */
  function insertAv(
    id: string,
    state: "offered" | "active" | "failed",
    createdAt: number,
    userId = "user_anna",
  ) {
    db.insert(credentials)
      .values({
        id,
        userId,
        cardId: null,
        credentialTypeId: "av",
        credentialId: null,
        state,
        issuedAt: state === "active" ? createdAt : null,
        createdAt,
      })
      .run();
  }

  it("reports 'none' when the user has no age credential", () => {
    expect(getAgeCredentialState(db, "user_anna")).toEqual({
      state: "none",
      credentialRowId: null,
    });
  });

  it("reports 'offered' for an open offer", () => {
    insertAv("av_1", "offered", 10);
    expect(getAgeCredentialState(db, "user_anna")).toEqual({
      state: "offered",
      credentialRowId: "av_1",
    });
  });

  it("reports 'active' once the credential is issued", () => {
    insertAv("av_1", "active", 10);
    expect(getAgeCredentialState(db, "user_anna")).toEqual({
      state: "active",
      credentialRowId: "av_1",
    });
  });

  it("prefers the newest non-failed row, so a re-issue supersedes its predecessor", () => {
    insertAv("av_old", "active", 10);
    insertAv("av_new", "offered", 20);
    expect(getAgeCredentialState(db, "user_anna").credentialRowId).toBe("av_new");
  });

  it("ignores failed rows", () => {
    insertAv("av_failed", "failed", 30);
    expect(getAgeCredentialState(db, "user_anna")).toEqual({
      state: "none",
      credentialRowId: null,
    });
  });

  it("ignores payment credentials, however active they are", () => {
    db.insert(credentials)
      .values({
        id: "cred_dpc",
        userId: "user_anna",
        cardId: "card_anna",
        credentialId: "dpc_active_1",
        state: "active",
        issuedAt: 1,
        createdAt: 99,
      })
      .run();
    expect(getAgeCredentialState(db, "user_anna")).toEqual({
      state: "none",
      credentialRowId: null,
    });
  });

  it("never reports another user's age credential", () => {
    insertAv("av_ben", "active", 10, "user_ben");
    expect(getAgeCredentialState(db, "user_anna").state).toBe("none");
    expect(getAgeCredentialState(db, "user_ben").state).toBe("active");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @demo/bank test src/lib/queries.test.ts`
Expected: FAIL — `getAgeCredentialState is not a function`, or a TS error that it is not exported.

- [ ] **Step 3: Implement it**

In `apps/bank/src/lib/queries.ts`, add the import:

```ts
import { AV_CREDENTIAL_TYPE_ID } from "./credential-types.js";
```

add the DTO beside the others:

```ts
export interface AgeCredentialDto {
  state: CardCredentialState;
  credentialRowId: string | null;
}
```

and append the function:

```ts
/**
 * The user's age-verification credential, if any. One per user: there is no
 * per-card scoping because there is no card behind it.
 *
 * Same rule as `listCards` — newest non-failed row wins, because a re-issue
 * supersedes its predecessor and a failed attempt is not a credential.
 */
export function getAgeCredentialState(db: Db, userId: string): AgeCredentialDto {
  const credential = db
    .select()
    .from(credentials)
    .where(
      and(
        eq(credentials.userId, userId),
        eq(credentials.credentialTypeId, AV_CREDENTIAL_TYPE_ID),
        inArray(credentials.state, ["offered", "active"]),
      ),
    )
    .orderBy(desc(credentials.createdAt))
    .limit(1)
    .get();

  // The inArray predicate above guarantees the state is never "failed", but
  // Drizzle's inferred column type is still the full union — TS cannot see
  // through a SQL predicate. Same cast, same reason, as in listCards.
  return {
    state: credential ? (credential.state as "offered" | "active") : "none",
    credentialRowId: credential?.id ?? null,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @demo/bank test src/lib/queries.test.ts && pnpm --filter @demo/bank typecheck`
Expected: PASS, and typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/bank/src/lib/queries.ts apps/bank/src/lib/queries.test.ts
git commit -m "feat(bank): read the user's age-credential state

getAgeCredentialState mirrors listCards' newest-non-failed-wins rule,
scoped to credential_type_id 'av' and to the user.

Verified it ignores failed rows and an active payment credential alike, and
never crosses users."
```

---

### Task 4: The age credential's issuance offer

**Files:**

- Create: `apps/bank/src/lib/av-issuance.ts`
- Test: `apps/bank/src/lib/av-issuance.test.ts`

**Interfaces:**

- Consumes: `AV_CREDENTIAL_TYPE_ID`; `FoundryClient.createIssuanceOffer` from `@demo/foundry-client`; `credentials` from `../db/schema.js`.
- Produces: `startAvIssuance(db: Db, client: FoundryClient, userId: string, now?: number): Promise<StartAvIssuanceResult>` where `StartAvIssuanceResult = { ok: true; sessionId: string; offerUri: string; dcApiOffer: unknown } | { ok: false; reason: "foundry_unavailable" }`; also `AV_CLAIMS`.

- [ ] **Step 1: Write the failing test**

Create `apps/bank/src/lib/av-issuance.test.ts`:

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
import { startAvIssuance } from "./av-issuance.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bank-av-"));
  db = createDb(path.join(dir, "test.db"));
  seed(db);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** One recorded admin-API call, so a test can assert on the exact payload. */
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

const offerOk = {
  status: 200,
  body: {
    transaction_id: "tx_av_1",
    credential_offer_uri: "openid-credential-offer://?av=1",
    dc_api_offer: {
      credential_issuer: "https://foundry.example",
      credential_configuration_ids: ["av"],
    },
  },
};

describe("startAvIssuance", () => {
  it("returns the offer URI and the DC API rendering of the same offer", async () => {
    const result = await startAvIssuance(db, stubClient([], offerOk), "user_anna");
    expect(result).toEqual({
      ok: true,
      sessionId: expect.any(String),
      offerUri: "openid-credential-offer://?av=1",
      dcApiOffer: expect.any(Object),
    });
  });

  it("asks foundry for credential_type_id 'av'", async () => {
    const captures: Capture[] = [];
    await startAvIssuance(db, stubClient(captures, offerOk), "user_anna");
    expect(captures).toHaveLength(1);
    expect(captures[0]?.body.credential_type_id).toBe("av");
  });

  it("sends exactly the two age booleans and nothing else", async () => {
    const captures: Capture[] = [];
    await startAvIssuance(db, stubClient(captures, offerOk), "user_anna");
    expect(captures[0]?.body.claims).toEqual({
      age_over_16: true,
      age_over_18: true,
    });
  });

  it("sends no display metadata at all", async () => {
    // foundry rejects both display fields for any type whose vct is not the
    // DPC's (create_offer.rs). Sending them would turn every AV issuance into
    // a failed row, so their absence is a requirement, not a tidiness point.
    const captures: Capture[] = [];
    await startAvIssuance(db, stubClient(captures, offerOk), "user_anna");
    expect(captures[0]?.body).not.toHaveProperty("offer_display");
    expect(captures[0]?.body).not.toHaveProperty("credential_response_display");
  });

  it("writes an offered row with no card, no join key, and the av type", async () => {
    const result = await startAvIssuance(db, stubClient([], offerOk), "user_anna");
    if (!result.ok) throw new Error("expected the offer to succeed");
    const row = db
      .select()
      .from(credentials)
      .where(eq(credentials.id, result.sessionId))
      .get();
    expect(row?.userId).toBe("user_anna");
    expect(row?.cardId).toBeNull();
    expect(row?.credentialId).toBeNull();
    expect(row?.credentialTypeId).toBe("av");
    expect(row?.state).toBe("offered");
    expect(row?.issuedAt).toBeNull();
  });

  it("stores foundry's transaction id on the row", async () => {
    const result = await startAvIssuance(db, stubClient([], offerOk), "user_anna");
    if (!result.ok) throw new Error("expected the offer to succeed");
    const row = db
      .select()
      .from(credentials)
      .where(eq(credentials.id, result.sessionId))
      .get();
    expect(row?.foundryTxId).toBe("tx_av_1");
  });

  it("leaves a failed row when foundry rejects the offer", async () => {
    // The state a foundry with no 'av' credential type configured produces.
    const result = await startAvIssuance(
      db,
      stubClient([], { status: 400, body: { error: "unknown_credential_type" } }),
      "user_anna",
    );
    expect(result).toEqual({ ok: false, reason: "foundry_unavailable" });
    const rows = db.select().from(credentials).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe("failed");
    expect(rows[0]?.foundryTxId).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @demo/bank test src/lib/av-issuance.test.ts`
Expected: FAIL — `Cannot find module './av-issuance.js'`.

- [ ] **Step 3: Implement it**

Create `apps/bank/src/lib/av-issuance.ts`:

```ts
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FoundryClient } from "@demo/foundry-client";
import type { Db } from "../db/index.js";
import { credentials } from "../db/schema.js";
import { AV_CREDENTIAL_TYPE_ID } from "./credential-types.js";

/**
 * The claims the age credential carries. Booleans, and only these two: an age
 * attestation that also carried a birthdate would defeat its own purpose, and
 * it carries no identifier either, so nothing about it is correlatable.
 *
 * foundry's mdoc issuance path puts every flat key into one namespace equal to
 * the resolved docType, so these become `eu.europa.ec.av.1 -> { … }` — exactly
 * what the deployed `av` named query asks for.
 */
export const AV_CLAIMS = {
  age_over_16: true,
  age_over_18: true,
} as const;

export type StartAvIssuanceResult =
  | { ok: true; sessionId: string; offerUri: string; dcApiOffer: unknown }
  | { ok: false; reason: "foundry_unavailable" };

/**
 * Offers the user an age-verification credential.
 *
 * A deliberate sibling of `startIssuance` rather than a branch inside it. The
 * payment path joins `accounts` for an IBAN, derives `card.last_four`, builds
 * two display arrays and can fail with `card_not_found`; none of that exists
 * here. One function serving both would branch on nearly every line — the two
 * share a shape, not a body.
 *
 * Sends NO `offer_display` and NO `credential_response_display`. foundry gates
 * both on the DPC's vct (`create_offer.rs`) and rejects them outright for any
 * other credential type, so the wallet's rendering of this credential comes
 * entirely from foundry's own static `display:` config. `public/av-face.svg` is
 * the bank's own UI artwork and is never sent anywhere.
 *
 * The row is written BEFORE foundry is called, so a foundry outage — or a
 * foundry with no `av` credential type configured — leaves a visible `failed`
 * row rather than nothing at all.
 */
export async function startAvIssuance(
  db: Db,
  client: FoundryClient,
  userId: string,
  now: number = Date.now(),
): Promise<StartAvIssuanceResult> {
  const rowId = `cred_${randomUUID()}`;

  db.insert(credentials)
    .values({
      id: rowId,
      userId,
      // No card: this credential attests a property of the person.
      cardId: null,
      credentialTypeId: AV_CREDENTIAL_TYPE_ID,
      // No payment join key, and none is disclosed to anyone.
      credentialId: null,
      foundryTxId: null,
      state: "offered",
      issuedAt: null,
      createdAt: now,
    })
    .run();

  try {
    const offer = await client.createIssuanceOffer({
      credential_type_id: AV_CREDENTIAL_TYPE_ID,
      claims: { ...AV_CLAIMS },
    });

    db.update(credentials)
      .set({ foundryTxId: offer.transaction_id })
      .where(eq(credentials.id, rowId))
      .run();

    // Two renderings of ONE offer: the deep link and the DC API payload.
    // dcApiOffer is deliberately not persisted — the offer is already recorded
    // by foundryTxId, so a column would duplicate state.
    return {
      ok: true,
      sessionId: rowId,
      offerUri: offer.credential_offer_uri,
      dcApiOffer: offer.dc_api_offer,
    };
  } catch {
    db.update(credentials)
      .set({ state: "failed" })
      .where(eq(credentials.id, rowId))
      .run();
    return { ok: false, reason: "foundry_unavailable" };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @demo/bank test src/lib/av-issuance.test.ts && pnpm --filter @demo/bank typecheck`
Expected: PASS, and typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/bank/src/lib/av-issuance.ts apps/bank/src/lib/av-issuance.test.ts
git commit -m "feat(bank): offer an age-verification credential

startAvIssuance posts credential_type_id 'av' with exactly
{age_over_16: true, age_over_18: true} and no display metadata -- foundry
rejects both display fields for any type but the DPC's, so their absence is
a requirement. A sibling of startIssuance rather than a branch in it.

Verified against a capturing stub: the exact request body, that neither
display key is present, that the row is written before the call with a null
card and a null join key, and that a rejection leaves the row failed."
```

---

### Task 5: The route

**Files:**

- Create: `apps/bank/src/app/api/credentials/av/route.ts`

**Interfaces:**

- Consumes: `startAvIssuance`; `withSession` from `@/lib/api.js`; `getDb`, `getFoundry`.
- Produces: `POST /api/credentials/av` → `200 { sessionId, offerUri, dcApiOffer }`, `401 { error: "unauthenticated" }`, `502 { error: "foundry_unavailable" }`.

No unit test, deliberately: this app has no route tests at all, because a Next route handler needs the framework's request context to exercise and the logic it wraps is already covered. The endpoint is verified in the browser in Task 8.

- [ ] **Step 1: Write the route**

Create `apps/bank/src/app/api/credentials/av/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import { withSession } from "@/lib/api.js";
import { startAvIssuance } from "@/lib/av-issuance.js";
import { getFoundry } from "@/lib/foundry.js";

export const dynamic = "force-dynamic";

/**
 * Starts an age-credential issuance.
 *
 * Uses `withSession`, unlike the card route, which must call `requireSession`
 * directly because Next passes a `context` argument for its dynamic segment
 * that the wrapper does not forward. There is no segment here.
 *
 * The status poll is `GET /api/credentials/[id]/status`, shared verbatim with
 * the card: `refreshIssuanceState` reads only `foundryTxId` and `state`, so it
 * is already credential-type agnostic.
 */
export const POST = withSession(async (session) => {
  const result = await startAvIssuance(getDb(), getFoundry(), session.userId);

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 502 });
  }

  return NextResponse.json({
    sessionId: result.sessionId,
    offerUri: result.offerUri,
    dcApiOffer: result.dcApiOffer,
  });
});
```

- [ ] **Step 2: Verify it compiles and the suite is still green**

Run: `pnpm --filter @demo/bank typecheck && pnpm --filter @demo/bank test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/bank/src/app/api/credentials/av/route.ts
git commit -m "feat(bank): POST /api/credentials/av

Starts an age-credential issuance. No unit test -- this app has no route
tests; the logic it wraps is covered and the endpoint itself is verified in
the browser. The status poll is reused unchanged."
```

---

### Task 6: Copy for two credentials instead of one

**Files:**

- Create: `apps/bank/src/lib/credential-copy.ts`
- Create: `apps/bank/src/lib/credential-copy.test.ts`
- Modify: `apps/bank/src/lib/card-state.ts`
- Modify: `apps/bank/src/components/IssuanceDialog.tsx`
- Modify: `apps/bank/src/components/CardTile.tsx`

**Interfaces:**

- Consumes: `CardFaceState`, `CardFaceCopy` from `./card-state.js`; `CredentialTypeId` and both constants.
- Produces: `FACE_COPY: Record<CredentialTypeId, Record<CardFaceState, CardFaceCopy>>`, `DIALOG_COPY: Record<CredentialTypeId, IssuanceCopy>`, and `interface IssuanceCopy { title: string; successTitle: string; successBody: string; failureBody: string }` — all from `@/lib/credential-copy.js`. `IssuanceDialog` gains a required `copy: IssuanceCopy` prop. `card-state.ts` keeps exporting `STATE_COPY` with an unchanged type.

- [ ] **Step 1: Write the failing test**

Create `apps/bank/src/lib/credential-copy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { STATE_COPY } from "./card-state.js";
import { DIALOG_COPY, FACE_COPY } from "./credential-copy.js";
import {
  AV_CREDENTIAL_TYPE_ID,
  DPC_CREDENTIAL_TYPE_ID,
} from "./credential-types.js";

describe("FACE_COPY", () => {
  it("covers every face state for both credential types", () => {
    for (const type of [DPC_CREDENTIAL_TYPE_ID, AV_CREDENTIAL_TYPE_ID]) {
      for (const state of ["none", "offered", "active"] as const) {
        const copy = FACE_COPY[type][state];
        expect(copy.badge.length).toBeGreaterThan(0);
        expect(copy.badgeClass.length).toBeGreaterThan(0);
        expect(copy.explain.length).toBeGreaterThan(0);
      }
    }
  });

  it("is what card-state's STATE_COPY still exposes for the card", () => {
    // The card's copy moved here rather than changing; this guards the move.
    expect(STATE_COPY).toBe(FACE_COPY[DPC_CREDENTIAL_TYPE_ID]);
  });

  it("explains the two credentials differently in every state", () => {
    for (const state of ["none", "offered", "active"] as const) {
      expect(FACE_COPY[AV_CREDENTIAL_TYPE_ID][state].explain).not.toBe(
        FACE_COPY[DPC_CREDENTIAL_TYPE_ID][state].explain,
      );
    }
  });

  it("keeps the card's own copy verbatim", () => {
    expect(FACE_COPY[DPC_CREDENTIAL_TYPE_ID].none.explain).toBe(
      "Fügen Sie diese Karte Ihrem EUDI Wallet hinzu, um online zu bezahlen.",
    );
    expect(FACE_COPY[DPC_CREDENTIAL_TYPE_ID].active.badge).toBe("Im Wallet");
  });
});

describe("DIALOG_COPY", () => {
  it("keeps the card dialog's strings exactly as they were", () => {
    expect(DIALOG_COPY[DPC_CREDENTIAL_TYPE_ID]).toEqual({
      title: "Karte zum EUDI Wallet hinzufügen",
      successTitle: "Karte hinzugefügt",
      successBody: "Ihre Karte ist jetzt in Ihrem EUDI Wallet.",
      failureBody: "Die Karte konnte nicht hinzugefügt werden.",
    });
  });

  it("never calls the age credential a Karte", () => {
    // German gender is why this is a copy record and not a noun substitution:
    // "die Karte" but "der Altersnachweis".
    const av = DIALOG_COPY[AV_CREDENTIAL_TYPE_ID];
    const strings = [
      ...Object.values(av),
      ...(["none", "offered", "active"] as const).flatMap((state) => [
        FACE_COPY[AV_CREDENTIAL_TYPE_ID][state].badge,
        FACE_COPY[AV_CREDENTIAL_TYPE_ID][state].explain,
      ]),
    ];
    for (const value of strings) {
      expect(value.toLowerCase()).not.toContain("karte");
    }
    expect(av.failureBody).toBe(
      "Der Altersnachweis konnte nicht hinzugefügt werden.",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @demo/bank test src/lib/credential-copy.test.ts`
Expected: FAIL — `Cannot find module './credential-copy.js'`.

- [ ] **Step 3: Create the copy module**

Create `apps/bank/src/lib/credential-copy.ts`:

```ts
import type { CardFaceCopy, CardFaceState } from "./card-state.js";
import {
  AV_CREDENTIAL_TYPE_ID,
  DPC_CREDENTIAL_TYPE_ID,
  type CredentialTypeId,
} from "./credential-types.js";

/**
 * Every German string the two credentials show, in one place, keyed by
 * credential type id.
 *
 * It lives in a `.ts` module rather than inside the components for the reason
 * that governs this whole app: every vitest project is `environment: "node"`
 * with `include: ["src/**\/*.test.ts"]`, so a string decided in a `.tsx` file
 * is never covered by a test. A third credential type gets a third entry here
 * and no new component-level branching.
 */

/** The copy the issuance dialog needs, which differs by grammatical gender. */
export interface IssuanceCopy {
  title: string;
  successTitle: string;
  successBody: string;
  failureBody: string;
}

/** The tile's badge and explanation, per credential type and face state. */
export const FACE_COPY: Record<
  CredentialTypeId,
  Record<CardFaceState, CardFaceCopy>
> = {
  [DPC_CREDENTIAL_TYPE_ID]: {
    none: {
      badge: "Nicht im Wallet",
      badgeClass: "badge-neutral",
      explain:
        "Fügen Sie diese Karte Ihrem EUDI Wallet hinzu, um online zu bezahlen.",
    },
    offered: {
      badge: "Wird hinzugefügt…",
      badgeClass: "badge-wallet",
      explain: "Bestätigen Sie das Angebot in Ihrer Wallet-App.",
    },
    active: {
      badge: "Im Wallet",
      badgeClass: "badge-success",
      explain: "Diese Karte ist in Ihrem EUDI Wallet und für Zahlungen bereit.",
    },
  },
  [AV_CREDENTIAL_TYPE_ID]: {
    none: {
      badge: "Nicht im Wallet",
      badgeClass: "badge-neutral",
      explain:
        "Fügen Sie Ihren Altersnachweis Ihrem EUDI Wallet hinzu, um Ihr Alter online zu bestätigen.",
    },
    offered: {
      badge: "Wird hinzugefügt…",
      badgeClass: "badge-wallet",
      explain: "Bestätigen Sie das Angebot in Ihrer Wallet-App.",
    },
    active: {
      badge: "Im Wallet",
      badgeClass: "badge-success",
      explain: "Ihr Altersnachweis ist in Ihrem EUDI Wallet und einsatzbereit.",
    },
  },
};

/**
 * The issuance dialog's copy. A `subject: string` prop would not have worked:
 * German gender differs — "die Karte" against "der Altersnachweis" — so the
 * article and the possessive change with the noun, not just the noun.
 */
export const DIALOG_COPY: Record<CredentialTypeId, IssuanceCopy> = {
  [DPC_CREDENTIAL_TYPE_ID]: {
    title: "Karte zum EUDI Wallet hinzufügen",
    successTitle: "Karte hinzugefügt",
    successBody: "Ihre Karte ist jetzt in Ihrem EUDI Wallet.",
    failureBody: "Die Karte konnte nicht hinzugefügt werden.",
  },
  [AV_CREDENTIAL_TYPE_ID]: {
    title: "Altersnachweis zum EUDI Wallet hinzufügen",
    successTitle: "Altersnachweis hinzugefügt",
    successBody: "Ihr Altersnachweis ist jetzt in Ihrem EUDI Wallet.",
    failureBody: "Der Altersnachweis konnte nicht hinzugefügt werden.",
  },
};
```

- [ ] **Step 4: Point `card-state.ts` at it**

In `apps/bank/src/lib/card-state.ts`, add two imports at the top:

```ts
import { FACE_COPY } from "./credential-copy.js";
import { DPC_CREDENTIAL_TYPE_ID } from "./credential-types.js";
```

Then delete the entire `STATE_COPY` object literal — from `export const STATE_COPY: Record<CardFaceState, CardFaceCopy> = {` through its closing `};` — and put this in its place:

```ts
/**
 * The card's own face copy. Re-exported from `credential-copy.ts`, where it
 * sits beside the age credential's, so a second credential type did not mean a
 * second convention. `CardTile` and its tests consume this name unchanged.
 */
export const STATE_COPY: Record<CardFaceState, CardFaceCopy> =
  FACE_COPY[DPC_CREDENTIAL_TYPE_ID];
```

The two modules now import from each other, but only in one direction at runtime: `credential-copy.ts` imports `CardFaceCopy` and `CardFaceState` with `import type`, which is erased at compile time, so there is no runtime cycle. If `typecheck` or vitest nevertheless reports one, move `CardFaceState` and `CardFaceCopy` into `credential-copy.ts` and re-export them from `card-state.ts` instead — do not paper over it by duplicating the strings.

- [ ] **Step 5: Give the dialog its copy as a prop**

In `apps/bank/src/components/IssuanceDialog.tsx`, add the import:

```ts
import type { IssuanceCopy } from "@/lib/credential-copy.js";
```

Extend the props interface and the destructuring:

```ts
export interface IssuanceDialogProps {
  sessionId: string;
  offerUri: string;
  dcApiOffer: unknown;
  copy: IssuanceCopy;
  onClose: () => void;
}

export function IssuanceDialog({
  sessionId,
  offerUri,
  dcApiOffer,
  copy,
  onClose,
}: IssuanceDialogProps) {
```

Replace the `errorMessage` fallback — the line reading `: "Die Karte konnte nicht hinzugefügt werden.";` — with:

```ts
        : copy.failureBody;
```

Replace the overlay's label:

```tsx
      aria-label={copy.title}
```

Replace the waiting-phase heading:

```tsx
            <h2 className="panel-title">{copy.title}</h2>
```

And replace the success block's heading and body:

```tsx
            <h2 className="panel-title mt-4 text-[var(--color-success)]">
              {copy.successTitle}
            </h2>
            <p className="mt-1.5 text-sm text-[var(--color-muted-foreground)]">
              {copy.successBody}
            </p>
```

Leave the two English DC API diagnostic strings, the QR colour, the polling, the `Abbrechen` / `Schließen` buttons and every other string exactly as they are.

- [ ] **Step 6: Pass the card's copy from `CardTile`**

In `apps/bank/src/components/CardTile.tsx`, add two imports:

```ts
import { DIALOG_COPY } from "@/lib/credential-copy.js";
import { DPC_CREDENTIAL_TYPE_ID } from "@/lib/credential-types.js";
```

and add one prop to the `IssuanceDialog` element:

```tsx
        <IssuanceDialog
          sessionId={session.sessionId}
          offerUri={session.offerUri}
          dcApiOffer={session.dcApiOffer}
          copy={DIALOG_COPY[DPC_CREDENTIAL_TYPE_ID]}
          onClose={() => setSession(null)}
        />
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @demo/bank test && pnpm --filter @demo/bank typecheck`
Expected: PASS. `card-state.test.ts` must pass **unchanged** — if it does not, the copy was altered rather than moved, and the strings in `credential-copy.ts` need correcting to match the originals byte for byte.

- [ ] **Step 8: Commit**

```bash
git add apps/bank/src/lib/credential-copy.ts apps/bank/src/lib/credential-copy.test.ts \
        apps/bank/src/lib/card-state.ts apps/bank/src/components/IssuanceDialog.tsx \
        apps/bank/src/components/CardTile.tsx
git commit -m "refactor(bank): key credential copy by credential type

IssuanceDialog hardcoded 'Karte' in four strings. German gender rules out a
noun-substitution prop -- 'die Karte' but 'der Altersnachweis' -- so the
dialog takes a copy record and both call sites supply theirs. The card's
face copy moves beside it; card-state.ts still exports STATE_COPY.

Verified: card-state.test.ts passes unchanged, and a test asserts the card's
dialog strings are byte-identical to what shipped before, so the card path
has no user-visible change."
```

---

### Task 7: The tile and the section

**Files:**

- Create: `apps/bank/public/av-face.svg`
- Create: `apps/bank/src/components/AgeCredentialTile.tsx`
- Modify: `apps/bank/src/app/globals.css`
- Modify: `apps/bank/src/app/page.tsx`

**Interfaces:**

- Consumes: `getAgeCredentialState`, `FACE_COPY`, `DIALOG_COPY`, `AV_CREDENTIAL_TYPE_ID`, `cardFaceState`, `AddToWalletButton`, `IssuanceDialog`.
- Produces: `<AgeCredentialTile credentialState={CardCredentialState} />`.

- [ ] **Step 1: Install the artwork**

```bash
cp /Users/senexi/Downloads/av_cardart.svg apps/bank/public/av-face.svg
head -c 120 apps/bank/public/av-face.svg && echo && wc -c apps/bank/public/av-face.svg
```

Expected: an `<svg width="380" height="239" …>` opening tag, roughly 3.5 KB. No Dockerfile change is needed — line 70 already copies the bank's whole `public/`, added when the card artwork landed.

- [ ] **Step 2: Add the face style**

In `apps/bank/src/app/globals.css`, immediately after the `.card-object[data-state="none"]` rule and before the `/* ---- the ledger ---- */` banner, add:

```css
/*
 * The age credential's face. Only the image and the load-time fallback colour
 * differ from .card-object — geometry, radius, shadow and the not-yet-issued
 * desaturation are all inherited. #ff0000 is the artwork's OWN red, not
 * Sparkasse's --color-primary (#EA0016), so a missing asset degrades to the
 * right colour rather than a near-miss.
 *
 * Nothing is drawn over this face. The artwork already carries the
 * "Altersnachweis / Proof of Age" wordmark top-right and the Sparkasse logo
 * bottom-left — which is also why it gets no .card-stars: that class is
 * positioned into exactly the corner the wordmark occupies.
 */
.card-object-av {
  background-color: #ff0000;
  background-image: url("/av-face.svg");
}
```

- [ ] **Step 3: Write the tile**

Create `apps/bank/src/components/AgeCredentialTile.tsx`:

```tsx
"use client";

import { useState } from "react";
import { cardFaceState } from "@/lib/card-state.js";
import { DIALOG_COPY, FACE_COPY } from "@/lib/credential-copy.js";
import { AV_CREDENTIAL_TYPE_ID } from "@/lib/credential-types.js";
import type { CardCredentialState } from "@/lib/queries.js";
import { AddToWalletButton } from "./AddToWalletButton.js";
import { IssuanceDialog } from "./IssuanceDialog.js";

interface IssuanceSession {
  sessionId: string;
  offerUri: string;
  dcApiOffer: unknown;
}

/**
 * The age credential, drawn as an object the way the card is.
 *
 * Deliberately not a CardTile variant. This credential has no IBAN, no PAN and
 * no network, and nothing is drawn over its face — the artwork already carries
 * the wordmark and the issuer logo. It also gets no EU stars: .card-stars is
 * positioned top-right, which on this artwork is where the wordmark is printed,
 * so the active state is carried by the badge alone.
 *
 * The "Wird hinzugefügt…" state is scoped to this browser session and never
 * read back from the database — see lib/card-state.ts for why. It applies here
 * for exactly the same reason: nothing in this project ever clears an `offered`
 * row, so a persisted offer would pin the badge on forever.
 */
export function AgeCredentialTile({
  credentialState,
}: {
  credentialState: CardCredentialState;
}) {
  const [session, setSession] = useState<IssuanceSession | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const issuing = pending || session !== null;
  const faceState = cardFaceState(credentialState, issuing);
  const copy = FACE_COPY[AV_CREDENTIAL_TYPE_ID][faceState];

  async function start() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/credentials/av", { method: "POST" });
      if (!response.ok) {
        setError("Angebot konnte nicht erstellt werden.");
        return;
      }
      const body = (await response.json()) as IssuanceSession;
      setSession({
        sessionId: body.sessionId,
        offerUri: body.offerUri,
        dcApiOffer: body.dcApiOffer,
      });
    } catch {
      setError("Verbindung zum Server fehlgeschlagen.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="panel flex flex-col gap-6 p-5 sm:flex-row sm:items-center sm:gap-7">
      <div
        className="card-object card-object-av shrink-0"
        data-state={faceState}
      >
        {/* The only motion in the app, and only while something is happening. */}
        {faceState === "offered" ? <span className="card-sheen" /> : null}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* The face says this too, but .card-object is a CSS background with
              no alt text, so this heading is the credential's only accessible
              name. */}
          <h3 className="panel-title">Altersnachweis</h3>
          <span className={`badge ${copy.badgeClass} px-2.5 py-1`}>
            {copy.badge}
          </span>
        </div>

        <p className="mt-2 max-w-sm text-sm leading-relaxed text-[var(--color-muted-foreground)]">
          {copy.explain}
        </p>

        <div className="mt-4">
          <AddToWalletButton
            onStart={start}
            pending={pending}
            error={error}
            disabled={credentialState === "active"}
          />
        </div>
      </div>

      {session ? (
        <IssuanceDialog
          sessionId={session.sessionId}
          offerUri={session.offerUri}
          dcApiOffer={session.dcApiOffer}
          copy={DIALOG_COPY[AV_CREDENTIAL_TYPE_ID]}
          onClose={() => setSession(null)}
        />
      ) : null}
    </div>
  );
}
```

Note the face `div` carries no `p-5`, unlike `CardTile`'s: that padding exists to inset the IBAN and holder drawn inside the face, and this one draws nothing.

- [ ] **Step 4: Add the dashboard section**

In `apps/bank/src/app/page.tsx`, add the component import beside the others:

```ts
import { AgeCredentialTile } from "@/components/AgeCredentialTile.js";
```

change the queries import:

```ts
import {
  getAgeCredentialState,
  listAccounts,
  listCards,
  listTransactions,
} from "@/lib/queries.js";
```

read the state beside the others:

```ts
  const ageCredential = getAgeCredentialState(db, session.userId);
```

and insert a new `<section>` between the `Karten` section's closing tag and the `Letzte Umsätze` panel:

```tsx
        <section>
          <h2 className="eyebrow">Nachweise</h2>
          <div className="mt-3 space-y-4">
            <AgeCredentialTile credentialState={ageCredential.state} />
          </div>
        </section>
```

- [ ] **Step 5: Verify the build and the suite**

Run: `pnpm --filter @demo/bank typecheck && pnpm --filter @demo/bank test && pnpm --filter @demo/bank build`
Expected: PASS on all three. The build matters independently of the tests: `next build`'s webpack resolver needs the `extensionAlias` config for the `./foo.js` imports, so a green vitest run is not evidence that the app builds.

- [ ] **Step 6: Commit**

```bash
git add apps/bank/public/av-face.svg apps/bank/src/components/AgeCredentialTile.tsx \
        apps/bank/src/app/globals.css apps/bank/src/app/page.tsx
git commit -m "feat(bank): offer the age credential from a Nachweise section

A new dashboard section below Karten, holding the age credential drawn at
the same ID-1 proportions as the card. Its own section because an
attestation is not a card -- no IBAN, no PAN, no network.

Nothing is drawn over the face: the artwork already carries the
Altersnachweis / Proof of Age wordmark and the Sparkasse logo. No EU stars
either -- .card-stars is positioned into the corner the wordmark occupies.

Verified: typecheck, the bank suite, and next build."
```

---

### Task 8: Verify against reality, then write down what is true

**Files:**

- Modify: `AGENTS.md`
- Modify: `apps/bank/AGENTS.md`
- Modify: `docs/superpowers/specs/2026-08-20-av-credential-issuance-design.md` (its test-count line only, if it drifted)

- [ ] **Step 1: Run the full gate and record the real number**

Run: `pnpm check`
Expected: PASS. Record the four per-project counts. The projection is 356; if the real number differs, **the real number is what goes in the docs**.

- [ ] **Step 2: Exercise the failure path against a real foundry**

No foundry config declares an `av` credential type, so a real request must be *rejected*. That rejection is the only end-to-end behaviour this work can verify, which makes it worth verifying rather than assuming.

Restart foundry first. A long-running binary may predate a feature, and serde silently ignores unknown request members, so a `200` from a stale server is worthless as evidence:

```bash
pkill -f 'target/debug/foundry serve'
cd ../foundry && ./target/debug/foundry serve --config config.yaml &
```

Then drive the real code path with a scratch script — `tsx`, per `AGENTS.md`, not `node --experimental-strip-types` (which does not apply the `./foo.js` → `./foo.ts` mapping and dies on the transitive `../env.js` import):

```bash
cd apps/bank
cat > scratch.ts <<'TS'
import { createDb } from "./src/db/index.js";
import { credentials, users } from "./src/db/schema.js";
import { startAvIssuance } from "./src/lib/av-issuance.js";
import { getFoundry } from "./src/lib/foundry.js";

async function main() {
  const db = createDb(":memory:");
  db.insert(users)
    .values({ id: "u1", username: "u1", passwordHash: "h", displayName: "U" })
    .run();
  const result = await startAvIssuance(db, getFoundry(), "u1");
  console.log("result:", JSON.stringify(result));
  console.log("rows:", JSON.stringify(db.select().from(credentials).all()));
}

void main();
TS
pnpm exec tsx --env-file-if-exists=.env.local scratch.ts
rm -f scratch.ts
```

Expected: `{"ok":false,"reason":"foundry_unavailable"}` and one row with `"state":"failed"`, `"cardId":null`, `"credentialId":null`, `"credentialTypeId":"av"`. Capture foundry's own error text from its log — it should name the unknown credential type. Wrapped in `async function main()` rather than using top-level `await` on purpose: `apps/bank/package.json` deliberately has no `"type": "module"`.

If the offer instead *succeeds*, someone has added the `av` type to foundry's config. Say so plainly, and record the happy path you just got for free — including whether the returned `dc_api_offer` names `av` in its `credential_configuration_ids`.

- [ ] **Step 3: Verify the new section in a real browser**

`pnpm dev` is broken, so use a production server:

```bash
pnpm --filter @demo/bank build
pnpm --filter @demo/bank start &
node tools/cdp/cdp.mjs --help
```

Log in as `anna` / `demo1234`, then confirm:

1. The `Nachweise` section renders below `Karten`.
2. The face shows the artwork. A flat red face means the SVG 404'd — check the path, not the CSS.
3. The badge reads `Nicht im Wallet`.
4. Pressing `Zum EUDI Wallet hinzufügen` opens a dialog titled `Altersnachweis zum EUDI Wallet hinzufügen`. Because Step 2 established the offer is rejected, the expected end state is the failure panel reading `Der Altersnachweis konnte nicht hinzugefügt werden.` — which also proves the copy record is wired to the right credential.
5. The card tile is unchanged: same artwork, same badge, and its dialog still says `Karte zum EUDI Wallet hinzufügen`.

- [ ] **Step 4: Update the agent guides**

In the root `AGENTS.md`, update the test-count paragraph to the measured number, saying what the delta was and where it came from. Then add to **Hard-won constraints** the two things a future reader would otherwise rediscover the hard way:

- **Display metadata is DPC-only.** `create_offer.rs` gates `offer_display` and `credential_response_display` on `ct.vct == "com.emvco.dpc.card"` and rejects them for every other credential type, so a non-DPC credential's wallet appearance can come only from foundry's static `display:` config.
- **A `credentials` row needs neither a card nor a `credential_id`.** `credentialTypeId` is the discriminator and defaults to the DPC type; `processPayment` refuses anything that is not a DPC row with a card.

In `apps/bank/AGENTS.md`: update the `pnpm test` count, amend the **Schema** section for the three changed columns, and add an **Age-verification credential** section covering `startAvIssuance`, `POST /api/credentials/av`, the shared status poll, the no-display-metadata requirement, and — plainly — that the happy path has never run because no foundry config declares an `av` credential type.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md apps/bank/AGENTS.md docs/superpowers/specs/2026-08-20-av-credential-issuance-design.md
git commit -m "docs: record the age-credential issuance path and its open dependency

Measured test count, the credentials-table shape change, and the
display-metadata prohibition for non-DPC credential types.

Verified end to end only as a rejection: with no 'av' credential type in
any foundry config, a real POST fails and the row lands 'failed'. That is
the whole of what has been exercised. The happy path and the wallet leg
have never run."
```

---

## Self-Review

**Spec coverage.** §2 (payload) → Task 4 Steps 1 and 3. §3 (foundry out of scope) → Global Constraints, Task 8 Step 2. §4 (data model, including the default) → Task 1. §4.1 (payment guards) → Task 2. §4.2 (migration) → Task 1 Steps 6–7. §5 (issuance, the constants module, the reused polling route) → Tasks 1, 4, 5. §6 (UI, artwork, no stars, sheen, the accessible heading) → Task 7. §6.1 (copy) → Task 6. §7 (queries) → Task 3. §8 (seeding unchanged) → no task, correctly: there is nothing to do. §9 (testing) → distributed across Tasks 1–6. §10 (definition of done) → Task 8. §11 (not done) → Global Constraints.

**Placeholder scan.** No `TBD`, no "add error handling", no "similar to Task N", no "write tests for the above". Every code step carries the actual code. The one deliberate absence is a route test in Task 5, which states its reason rather than deferring.

**Type consistency.** `CredentialTypeId`, `DPC_CREDENTIAL_TYPE_ID` and `AV_CREDENTIAL_TYPE_ID` are defined in Task 1 and used under those exact names in Tasks 2, 3, 4, 6 and 7. `AgeCredentialDto` and `getAgeCredentialState` are defined in Task 3 and consumed in Task 7 as `ageCredential.state`. `StartAvIssuanceResult` (Task 4) is destructured in Task 5 as `result.ok` / `result.reason` / `result.sessionId` / `result.offerUri` / `result.dcApiOffer`, matching. `IssuanceCopy` and its four members (Task 6) are the exact members read in the dialog in Task 6 Step 5 and supplied in Task 7. `FACE_COPY[type][state]` yields `CardFaceCopy`, whose `badge` / `badgeClass` / `explain` are the three fields the tile reads. `cardFaceState(persisted, issuing)` keeps its existing two-argument signature.

**Task-count arithmetic.** 5 (Task 1) + 2 (Task 2) + 7 (Task 3) + 7 (Task 4) + 0 (Task 5) + 6 (Task 6) + 0 (Task 7) + 0 (Task 8) = **27** new tests against a measured baseline of 329, hence the 356 projection. The spec says "roughly 24" — that was written before Task 1 grew its migration test and Task 3 grew its cross-user test. Task 8 Step 5 covers correcting the spec if the measured number disagrees with either figure. Measure.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-08-20-av-credential-issuance.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — tasks executed in this session using executing-plans, batched with checkpoints for review.

**Which approach?**
