import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/index.js";
import { credentials, transactions } from "../db/schema.js";
import { seed } from "../db/seed.js";
import { listAccounts, listCards, listTransactions } from "./queries.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bank-q-"));
  db = createDb(path.join(dir, "test.db"));
  seed(db);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("listAccounts", () => {
  it("returns only the requesting user's accounts", () => {
    const anna = listAccounts(db, "user_anna");
    expect(anna).toHaveLength(1);
    expect(anna[0]?.id).toBe("acc_anna");
    expect(anna[0]?.balanceCents).toBe(348_712);
  });

  it("returns an empty array for an unknown user", () => {
    expect(listAccounts(db, "user_nobody")).toEqual([]);
  });

  it("never leaks another user's account", () => {
    expect(listAccounts(db, "user_ben").map((a) => a.id)).toEqual(["acc_ben"]);
  });
});

describe("listCards", () => {
  it("reports credentialState 'none' when no credential exists", () => {
    const cards = listCards(db, "user_anna");
    expect(cards).toHaveLength(1);
    expect(cards[0]?.credentialState).toBe("none");
    expect(cards[0]?.credentialRowId).toBeNull();
    expect(cards[0]?.panLast4).toBe("4242");
    expect(cards[0]?.network).toBe("VISA");
  });

  it("reports 'offered' while issuance is pending", () => {
    db.insert(credentials)
      .values({
        id: "cred_1",
        userId: "user_anna",
        cardId: "card_anna",
        credentialId: "dpc_1",
        foundryTxId: "tx_1",
        state: "offered",
        issuedAt: null,
        createdAt: 1,
      })
      .run();
    const cards = listCards(db, "user_anna");
    expect(cards[0]?.credentialState).toBe("offered");
    expect(cards[0]?.credentialRowId).toBe("cred_1");
  });

  it("reports 'active' once issued", () => {
    db.insert(credentials)
      .values({
        id: "cred_2",
        userId: "user_anna",
        cardId: "card_anna",
        credentialId: "dpc_2",
        foundryTxId: "tx_2",
        state: "active",
        issuedAt: 100,
        createdAt: 50,
      })
      .run();
    expect(listCards(db, "user_anna")[0]?.credentialState).toBe("active");
  });

  it("prefers the newest credential when a card has several", () => {
    db.insert(credentials)
      .values({
        id: "cred_old",
        userId: "user_anna",
        cardId: "card_anna",
        credentialId: "dpc_old",
        state: "active",
        issuedAt: 10,
        createdAt: 10,
      })
      .run();
    db.insert(credentials)
      .values({
        id: "cred_new",
        userId: "user_anna",
        cardId: "card_anna",
        credentialId: "dpc_new",
        state: "offered",
        issuedAt: null,
        createdAt: 20,
      })
      .run();
    const card = listCards(db, "user_anna")[0];
    expect(card?.credentialRowId).toBe("cred_new");
    expect(card?.credentialState).toBe("offered");
  });

  it("ignores 'failed' credentials so a failed attempt shows as 'none'", () => {
    db.insert(credentials)
      .values({
        id: "cred_bad",
        userId: "user_anna",
        cardId: "card_anna",
        credentialId: "dpc_bad",
        state: "failed",
        issuedAt: null,
        createdAt: 99,
      })
      .run();
    expect(listCards(db, "user_anna")[0]?.credentialState).toBe("none");
  });
});

describe("listTransactions", () => {
  it("returns the newest transactions first", () => {
    const rows = listTransactions(db, "user_anna", 5, 0);
    expect(rows).toHaveLength(5);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.bookedAt).toBeGreaterThanOrEqual(rows[i]!.bookedAt);
    }
  });

  it("honours limit and offset", () => {
    const first = listTransactions(db, "user_anna", 3, 0);
    const second = listTransactions(db, "user_anna", 3, 3);
    expect(first).toHaveLength(3);
    expect(second).toHaveLength(3);
    expect(first.map((r) => r.id)).not.toEqual(second.map((r) => r.id));
  });

  it("marks seeded history as not wallet-paid", () => {
    expect(listTransactions(db, "user_anna", 20, 0).every((r) => !r.paidWithWallet)).toBe(
      true,
    );
  });

  it("marks a transaction with a credential_id as wallet-paid", () => {
    db.insert(transactions)
      .values({
        id: "tx_wallet",
        accountId: "acc_anna",
        amountCents: -4_798,
        currency: "EUR",
        counterparty: "Demo Shop",
        reference: "Order #1",
        bookedAt: Date.now() + 1000,
        credentialId: "dpc_1",
        idempotencyKey: "sess_1",
      })
      .run();
    const newest = listTransactions(db, "user_anna", 1, 0)[0];
    expect(newest?.id).toBe("tx_wallet");
    expect(newest?.paidWithWallet).toBe(true);
  });

  it("never returns another user's transactions", () => {
    const ids = listTransactions(db, "user_ben", 50, 0).map((r) => r.id);
    expect(ids.every((id) => id.startsWith("tx_user_ben"))).toBe(true);
  });
});