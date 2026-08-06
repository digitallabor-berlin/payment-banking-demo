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