import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/index.js";
import { credentials, transactions } from "../db/schema.js";
import { seed } from "../db/seed.js";
import {
  getAgeCredentialState,
  listAccounts,
  listCards,
  listTransactions,
} from "./queries.js";

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
    expect(cards[0]?.network).toBe("girocard");
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

  /*
   * This used to assert the opposite -- newest non-failed row wins, full stop --
   * and that was only safe while the UI forbade a second issuance. Once an "add
   * again" button exists, one abandoned re-issue writes an `offered` row that
   * outranks the `active` one forever (nothing in this project ever clears an
   * offered row), and the card then claims "Not in wallet" while the credential
   * is demonstrably in the wallet. Observed in a real browser, not theorised.
   *
   * An issued credential is a fact; an offer is an intention. A re-issue only
   * supersedes its predecessor once it becomes active itself.
   */
  it("does not let a newer offer mask a credential already in the wallet", () => {
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
    expect(card?.credentialState).toBe("active");
    expect(card?.credentialRowId).toBe("cred_old");
  });

  it("prefers the newest credential among several in the wallet", () => {
    for (const [id, createdAt] of [
      ["cred_first", 10],
      ["cred_second", 20],
    ] as const) {
      db.insert(credentials)
        .values({
          id,
          userId: "user_anna",
          cardId: "card_anna",
          credentialId: `dpc_${id}`,
          state: "active",
          issuedAt: createdAt,
          createdAt,
        })
        .run();
    }
    expect(listCards(db, "user_anna")[0]?.credentialRowId).toBe("cred_second");
  });

  it("prefers the newest offer when nothing is in the wallet yet", () => {
    for (const [id, createdAt] of [
      ["cred_o1", 10],
      ["cred_o2", 20],
    ] as const) {
      db.insert(credentials)
        .values({
          id,
          userId: "user_anna",
          cardId: "card_anna",
          credentialId: `dpc_${id}`,
          state: "offered",
          issuedAt: null,
          createdAt,
        })
        .run();
    }
    const card = listCards(db, "user_anna")[0];
    expect(card?.credentialState).toBe("offered");
    expect(card?.credentialRowId).toBe("cred_o2");
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
    expect(
      listTransactions(db, "user_anna", 20, 0).every((r) => !r.paidWithWallet),
    ).toBe(true);
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

  // Same correction as listCards, for the same reason: an abandoned re-issue
  // must not make an issued age credential look absent.
  it("does not let a newer offer mask a credential already in the wallet", () => {
    insertAv("av_old", "active", 10);
    insertAv("av_new", "offered", 20);
    expect(getAgeCredentialState(db, "user_anna")).toEqual({
      state: "active",
      credentialRowId: "av_old",
    });
  });

  it("prefers the newest row within one state, so a re-issue does supersede", () => {
    insertAv("av_first", "active", 10);
    insertAv("av_second", "active", 20);
    expect(getAgeCredentialState(db, "user_anna").credentialRowId).toBe(
      "av_second",
    );
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
