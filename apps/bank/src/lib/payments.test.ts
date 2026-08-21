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

function baseInput(
  overrides: Partial<Parameters<typeof processPayment>[1]> = {},
) {
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
    const before = db
      .select()
      .from(accounts)
      .where(eq(accounts.id, "acc_anna"))
      .get();

    const result = processPayment(db, baseInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newBalanceCents).toBe((before?.balanceCents ?? 0) - 4_798);

    const row = db
      .select()
      .from(transactions)
      .where(eq(transactions.id, result.bankTxId))
      .get();
    expect(row?.amountCents).toBe(-4_798);
    expect(row?.credentialId).toBe("dpc_active_1");
    expect(row?.idempotencyKey).toBe("sess_1");
    expect(row?.counterparty).toBe("Demo Shop");
  });

  it("rejects an unknown credential without touching the balance", () => {
    const before = db
      .select()
      .from(accounts)
      .where(eq(accounts.id, "acc_anna"))
      .get();
    const result = processPayment(db, baseInput({ credentialId: "dpc_nope" }));
    expect(result).toEqual({ ok: false, reason: "unknown_credential" });
    const after = db
      .select()
      .from(accounts)
      .where(eq(accounts.id, "acc_anna"))
      .get();
    expect(after?.balanceCents).toBe(before?.balanceCents);
  });

  it("rejects a credential that is only 'offered', not 'active'", () => {
    const result = processPayment(
      db,
      baseInput({ credentialId: "dpc_offered_1" }),
    );
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

  it("refuses to settle against an age credential", () => {
    // Deliberately given a non-null credential_id: nothing in the schema
    // forbids one, so this isolates the credential-type guard rather than
    // passing by accident on a NULL that could never have matched.
    db.insert(credentials)
      .values({
        id: "cred_av_active",
        userId: "user_anna",
        cardId: null,
        credentialTypeId: "av-sparkasse",
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

  it("settles against a Sparkasse card credential", () => {
    // The girocard is issued in two formats and both authorize money to move.
    // The join key arrived in this row's credential_id column as a `psu_id`
    // rather than a `credential_id` claim, which the debit path never sees.
    db.insert(credentials)
      .values({
        id: "cred_sparkassencard",
        userId: "user_anna",
        cardId: "card_anna",
        credentialTypeId: "sparkassencard",
        credentialId: "9f1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d",
        state: "active",
        issuedAt: 1,
        createdAt: 1,
      })
      .run();

    const result = processPayment(
      db,
      baseInput({
        credentialId: "9f1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d",
        idempotencyKey: "idem_sk_1",
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newBalanceCents).toBeTypeOf("number");
    expect(
      db
        .select()
        .from(transactions)
        .where(eq(transactions.idempotencyKey, "idem_sk_1"))
        .get()?.credentialId,
    ).toBe("9f1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d");
  });

  it("still refuses a Sparkasse card credential that is not active", () => {
    // Widening the type guard must not have widened the state guard with it.
    db.insert(credentials)
      .values({
        id: "cred_sparkassencard_offered",
        userId: "user_anna",
        cardId: "card_anna",
        credentialTypeId: "sparkassencard",
        credentialId: "11111111-2222-4333-8444-555555555555",
        state: "offered",
        issuedAt: null,
        createdAt: 1,
      })
      .run();

    expect(
      processPayment(
        db,
        baseInput({
          credentialId: "11111111-2222-4333-8444-555555555555",
          idempotencyKey: "idem_sk_2",
        }),
      ),
    ).toEqual({ ok: false, reason: "credential_not_active" });
  });

  it("refuses a legacy 'av' row even though the column still holds the value", () => {
    db.insert(credentials)
      .values({
        id: "cred_av_legacy",
        userId: "user_anna",
        cardId: null,
        credentialTypeId: "av",
        credentialId: "legacy_av_join_key",
        state: "active",
        issuedAt: 1,
        createdAt: 1,
      })
      .run();

    expect(
      processPayment(
        db,
        baseInput({
          credentialId: "legacy_av_join_key",
          idempotencyKey: "idem_av_legacy",
        }),
      ),
    ).toEqual({ ok: false, reason: "unknown_credential" });
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
});
