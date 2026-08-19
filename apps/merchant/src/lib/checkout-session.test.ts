import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/index.js";
import { orders, paymentSessions } from "../db/schema.js";
import { seed } from "../db/seed.js";
import { loadCheckoutSession } from "./checkout-session.js";

let dir: string;
let db: Db;

const NOW = 1_700_000_000_000;

function insertOrder(id: string, totalCents: number): void {
  db.insert(orders)
    .values({
      id,
      totalCents,
      currency: "EUR",
      customerName: "Ada Lovelace",
      customerEmail: "ada@example.test",
      status: "pending",
      createdAt: NOW,
    })
    .run();
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "merchant-cs-"));
  db = createDb(path.join(dir, "test.db"));
  seed(db);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("loadCheckoutSession", () => {
  it("returns the sheet's props for a live request_uri session", () => {
    insertOrder("ord_1", 1747);
    db.insert(paymentSessions)
      .values({
        id: "sess_1",
        orderId: "ord_1",
        state: "pending",
        openid4vpUri: "openid4vp://?request_uri=https%3A%2F%2Ffoundry.test%2Fr%2F1",
        transport: "request_uri",
        namedQueryRef: "dpc",
        createdAt: NOW,
      })
      .run();

    expect(loadCheckoutSession(db, "sess_1")).toEqual({
      sessionId: "sess_1",
      orderId: "ord_1",
      amountCents: 1747,
      openid4vpUri: "openid4vp://?request_uri=https%3A%2F%2Ffoundry.test%2Fr%2F1",
      transport: "request_uri",
      ageRequested: false,
      dcApiRequest: null,
      initialState: "pending",
    });
  });

  it("reports ageRequested from the recorded named query", () => {
    insertOrder("ord_2", 899);
    db.insert(paymentSessions)
      .values({
        id: "sess_2",
        orderId: "ord_2",
        state: "pending",
        openid4vpUri: "openid4vp://x",
        transport: "request_uri",
        namedQueryRef: "dpc_av",
        createdAt: NOW,
      })
      .run();

    expect(loadCheckoutSession(db, "sess_2")?.ageRequested).toBe(true);
  });

  it("parses the stored dc_api request object and has no uri", () => {
    insertOrder("ord_3", 500);
    db.insert(paymentSessions)
      .values({
        id: "sess_3",
        orderId: "ord_3",
        state: "pending",
        transport: "dc_api",
        namedQueryRef: "dpc",
        dcApiRequestJson: JSON.stringify({ response_mode: "dc_api.jwt" }),
        createdAt: NOW,
      })
      .run();

    const loaded = loadCheckoutSession(db, "sess_3");
    expect(loaded?.transport).toBe("dc_api");
    expect(loaded?.openid4vpUri).toBe("");
    expect(loaded?.dcApiRequest).toEqual({ response_mode: "dc_api.jwt" });
  });

  it("carries a terminal state and its failure reason", () => {
    insertOrder("ord_4", 300);
    db.insert(paymentSessions)
      .values({
        id: "sess_4",
        orderId: "ord_4",
        state: "failed",
        failureReason: "insufficient_funds",
        transport: "request_uri",
        namedQueryRef: "dpc",
        createdAt: NOW,
      })
      .run();

    const loaded = loadCheckoutSession(db, "sess_4");
    expect(loaded?.initialState).toBe("failed");
    expect(loaded?.initialFailureReason).toBe("insufficient_funds");
  });

  it("returns null for an unknown session id", () => {
    expect(loadCheckoutSession(db, "sess_nope")).toBeNull();
  });
});