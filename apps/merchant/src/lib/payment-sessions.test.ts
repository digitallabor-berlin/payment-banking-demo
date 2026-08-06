import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FoundryClient } from "@demo/foundry-client";
import { createDb, type Db } from "../db/index.js";
import { orders, paymentSessions } from "../db/schema.js";
import { getPaymentSessionStatus, startPaymentSession } from "./payment-sessions.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "merchant-sess-"));
  db = createDb(path.join(dir, "test.db"));
  db.insert(orders)
    .values({
      id: "ord_1",
      totalCents: 4_798,
      currency: "EUR",
      customerName: "Ada",
      customerEmail: "ada@example.com",
      status: "pending",
      createdAt: 1,
    })
    .run();
  db.insert(orders)
    .values({
      id: "ord_paid",
      totalCents: 1_000,
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

/** A FoundryClient whose HTTP layer is replaced by a scripted stub. */
function stubClient(
  handler: (url: string, init: RequestInit) => { status: number; body: unknown },
): FoundryClient {
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const { status, body } = handler(String(input), init ?? {});
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  return new FoundryClient({ adminUrl: "http://f:9000", adminKey: "k", fetchImpl });
}

const verificationOk = () => ({
  status: 200,
  body: {
    verification_id: "ver_1",
    openid4vp_uri: "openid4vp://?x=1",
    request_uri: "https://foundry.example/req/1",
  },
});

describe("startPaymentSession", () => {
  it("creates a pending session and returns the presentation uri", async () => {
    const result = await startPaymentSession(db, stubClient(verificationOk), "ord_1", "Demo Shop");

    expect(result).toEqual({ ok: true, sessionId: expect.any(String), uri: "openid4vp://?x=1" });

    const row = db.select().from(paymentSessions).get();
    expect(row?.state).toBe("pending");
    expect(row?.orderId).toBe("ord_1");
    expect(row?.foundryVerificationId).toBe("ver_1");
  });

  it("sends the fixed DCQL query and this order's amount as transaction_data", async () => {
    let sentBody: unknown = null;
    const client = stubClient((_url, init) => {
      sentBody = JSON.parse(String(init.body));
      return verificationOk();
    });

    await startPaymentSession(db, client, "ord_1", "Demo Shop");

    expect(sentBody).toMatchObject({
      transport: "request_uri",
      dcql_query: { credentials: [{ id: "card" }] },
      transaction_data: [{ amount: "47.98", order_id: "ord_1", merchant: "Demo Shop" }],
    });
  });

  it("refuses an unknown order", async () => {
    const result = await startPaymentSession(
      db,
      stubClient(verificationOk),
      "ord_nope",
      "Demo Shop",
    );
    expect(result).toEqual({ ok: false, reason: "order_not_found" });
  });

  it("refuses an order that is not pending", async () => {
    const result = await startPaymentSession(
      db,
      stubClient(verificationOk),
      "ord_paid",
      "Demo Shop",
    );
    expect(result).toEqual({ ok: false, reason: "order_not_pending" });
  });

  it("marks the row failed when foundry rejects the request", async () => {
    const client = stubClient(() => ({ status: 500, body: { error: "boom" } }));
    const result = await startPaymentSession(db, client, "ord_1", "Demo Shop");

    expect(result).toEqual({ ok: false, reason: "foundry_unavailable" });
    const row = db.select().from(paymentSessions).get();
    // The row is persisted BEFORE foundry is called, mirroring the bank's
    // issuance flow (Plan 1 Task 11) — the failure stays visible in the DB.
    expect(row?.state).toBe("failed");
    expect(row?.failureReason).toBe("foundry_unavailable");
  });
});

describe("getPaymentSessionStatus", () => {
  it("returns the current state without contacting foundry", async () => {
    const started = await startPaymentSession(db, stubClient(verificationOk), "ord_1", "Demo Shop");
    if (!started.ok) throw new Error("setup failed");

    expect(getPaymentSessionStatus(db, started.sessionId)).toEqual({ state: "pending" });
  });

  it("returns null for an unknown session id", () => {
    expect(getPaymentSessionStatus(db, "sess_nope")).toBeNull();
  });

  it("includes checks and failureReason once a session has them", async () => {
    const started = await startPaymentSession(db, stubClient(verificationOk), "ord_1", "Demo Shop");
    if (!started.ok) throw new Error("setup failed");

    db.update(paymentSessions)
      .set({
        state: "failed",
        failureReason: "verification_failed",
        checksJson: JSON.stringify([{ check: "dcql_match", passed: false }]),
      })
      .where(eq(paymentSessions.id, started.sessionId))
      .run();

    expect(getPaymentSessionStatus(db, started.sessionId)).toEqual({
      state: "failed",
      failureReason: "verification_failed",
      checks: [{ check: "dcql_match", passed: false }],
    });
  });
});