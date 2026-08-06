import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/index.js";
import { orders, paymentSessions } from "../db/schema.js";
import { getOrderView } from "./order-view.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "merchant-view-"));
  db = createDb(path.join(dir, "test.db"));
  db.insert(orders)
    .values({
      id: "ord_1",
      totalCents: 4_798,
      currency: "EUR",
      customerName: "Ada",
      customerEmail: "ada@example.com",
      status: "paid",
      createdAt: 1,
    })
    .run();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("getOrderView", () => {
  it("returns null for an unknown order", () => {
    expect(getOrderView(db, "ord_nope")).toBeNull();
  });

  it("returns the order with no payment state when no session exists", () => {
    const view = getOrderView(db, "ord_1");
    expect(view).toMatchObject({
      id: "ord_1",
      totalCents: 4_798,
      status: "paid",
      paymentState: null,
      bankTxId: null,
      checks: [],
    });
  });

  it("surfaces the session's state, bank transaction id, and parsed checks", () => {
    db.insert(paymentSessions)
      .values({
        id: "sess_1",
        orderId: "ord_1",
        state: "completed",
        bankTxId: "tx_bank_1",
        checksJson: JSON.stringify([
          { check: "dcql_match", passed: true },
          { check: "transaction_data_binding", passed: true, detail: "amount matched" },
        ]),
        createdAt: 1,
      })
      .run();

    expect(getOrderView(db, "ord_1")).toMatchObject({
      paymentState: "completed",
      bankTxId: "tx_bank_1",
      checks: [
        { check: "dcql_match", passed: true },
        { check: "transaction_data_binding", passed: true, detail: "amount matched" },
      ],
    });
  });

  it("prefers the newest session when an order was retried", () => {
    db.insert(paymentSessions)
      .values({
        id: "sess_old",
        orderId: "ord_1",
        state: "failed",
        failureReason: "bank_unreachable",
        createdAt: 10,
      })
      .run();
    db.insert(paymentSessions)
      .values({
        id: "sess_new",
        orderId: "ord_1",
        state: "completed",
        bankTxId: "tx_bank_2",
        createdAt: 20,
      })
      .run();

    expect(getOrderView(db, "ord_1")).toMatchObject({
      paymentState: "completed",
      bankTxId: "tx_bank_2",
    });
  });

  it("tolerates malformed checks json rather than throwing", () => {
    db.insert(paymentSessions)
      .values({
        id: "sess_bad",
        orderId: "ord_1",
        state: "completed",
        checksJson: "{not json",
        createdAt: 1,
      })
      .run();

    expect(getOrderView(db, "ord_1")?.checks).toEqual([]);
  });
});