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