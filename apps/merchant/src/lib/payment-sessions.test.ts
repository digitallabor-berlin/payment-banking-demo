import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FoundryClient } from "@demo/foundry-client";
import { createDb, type Db } from "../db/index.js";
import { orderItems, orders, paymentSessions } from "../db/schema.js";
import { seed } from "../db/seed.js";
import {
  getPaymentSessionStatus,
  startPaymentSession,
} from "./payment-sessions.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "merchant-sess-"));
  db = createDb(path.join(dir, "test.db"));
  // Products are needed because order_items references them.
  seed(db);
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

/** Gives ord_1 a basket. Called per test so each can choose its contents. */
function stockOrder(...productIds: string[]): void {
  for (const productId of productIds) {
    db.insert(orderItems)
      .values({ orderId: "ord_1", productId, quantity: 1, unitPriceCents: 100 })
      .run();
  }
}

/** A FoundryClient whose HTTP layer is replaced by a scripted stub. */
function stubClient(
  handler: (
    url: string,
    init: RequestInit,
  ) => { status: number; body: unknown },
): FoundryClient {
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const { status, body } = handler(String(input), init ?? {});
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  return new FoundryClient({
    adminUrl: "http://f:9000",
    adminKey: "k",
    fetchImpl,
  });
}

const verificationOk = () => ({
  status: 200,
  body: {
    verification_id: "ver_1",
    openid4vp_uri: "openid4vp://?x=1",
    request_uri: "https://foundry.example/req/1",
  },
});

const dcApiOk = () => ({
  status: 200,
  body: {
    verification_id: "ver_dc",
    dc_api_request: { client_id: "x509_hash:abc", nonce: "n1" },
  },
});

describe("startPaymentSession", () => {
  it("creates a pending session and returns the presentation uri", async () => {
    const result = await startPaymentSession(
      db,
      stubClient(verificationOk),
      "ord_1",
      "Demo Shop",
      "Payee-id-123",
    );

    expect(result).toEqual({
      ok: true,
      sessionId: expect.any(String),
      uri: "openid4vp://?x=1",
      orderId: "ord_1",
      amountCents: 4_798,
      transport: "request_uri",
      ageRequested: false,
      dcApiRequest: null,
      state: "pending",
    });

    const row = db.select().from(paymentSessions).get();
    expect(row?.state).toBe("pending");
    expect(row?.orderId).toBe("ord_1");
    expect(row?.foundryVerificationId).toBe("ver_1");
  });

  it("asks for the dpc named query by reference, never an inline dcql_query", async () => {
    stockOrder("cheese");
    let sentBody: Record<string, unknown> = {};
    const client = stubClient((_url, init) => {
      sentBody = JSON.parse(String(init.body));
      return verificationOk();
    });

    await startPaymentSession(db, client, "ord_1", "Demo Shop", "Payee-id-123");

    expect(sentBody.named_query_ref).toBe("dpc");
    // Sending both would make foundry prefer the inline query and silently
    // ignore the named one.
    expect(sentBody.dcql_query).toBeUndefined();
  });

  it("escalates to dpc_av when the basket holds an age-restricted product", async () => {
    stockOrder("cheese", "beer");
    let sentBody: Record<string, unknown> = {};
    const client = stubClient((_url, init) => {
      sentBody = JSON.parse(String(init.body));
      return verificationOk();
    });

    await startPaymentSession(db, client, "ord_1", "Demo Shop", "Payee-id-123");

    expect(sentBody.named_query_ref).toBe("dpc_av");
  });

  it("records which named query was used, so the settle gate can trust it", async () => {
    stockOrder("wine");
    await startPaymentSession(
      db,
      stubClient(verificationOk),
      "ord_1",
      "Demo Shop",
      "Payee-id-123",
    );

    expect(db.select().from(paymentSessions).get()?.namedQueryRef).toBe(
      "dpc_av",
    );
  });

  it("records dpc_av even when foundry rejects the request", async () => {
    // The row is written before the call, so the attempted query has to be on
    // it already — otherwise a failed row would claim it asked for `dpc`.
    stockOrder("aperitif");
    await startPaymentSession(
      db,
      stubClient(() => ({ status: 500, body: {} })),
      "ord_1",
      "Demo Shop",
      "Payee-id-123",
    );

    const row = db.select().from(paymentSessions).get();
    expect(row?.state).toBe("failed");
    expect(row?.namedQueryRef).toBe("dpc_av");
  });

  it("sends the urn:eudi:sca:payment:1 transaction_data for this order", async () => {
    stockOrder("cheese");
    let sentBody: { transaction_data?: unknown[] } = {};
    const client = stubClient((_url, init) => {
      sentBody = JSON.parse(String(init.body));
      return verificationOk();
    });

    const started = await startPaymentSession(
      db,
      client,
      "ord_1",
      "Rock Legends",
      "Payee-id-123",
    );
    if (!started.ok) throw new Error("expected success");

    expect(sentBody.transaction_data).toEqual([
      {
        type: "urn:eudi:sca:payment:1",
        credential_ids: ["dpc"],
        transaction_data_hashes_alg: ["sha-256"],
        payload: {
          payee: { name: "Rock Legends", id: "Payee-id-123" },
          // The session id, not the order id: a retry of the same order is a
          // genuinely different authorization attempt.
          transaction_id: started.sessionId,
          amount_display: "€ 47.98",
        },
      },
    ]);
  });

  it("binds the amount to the dpc credential even under dpc_av", async () => {
    stockOrder("beer");
    let sentBody: { transaction_data?: Array<{ credential_ids: string[] }> } =
      {};
    const client = stubClient((_url, init) => {
      sentBody = JSON.parse(String(init.body));
      return verificationOk();
    });

    await startPaymentSession(db, client, "ord_1", "Demo Shop", "Payee-id-123");

    expect(sentBody.transaction_data?.[0]?.credential_ids).toEqual(["dpc"]);
  });

  it("defaults to the request_uri transport and records it on the row", async () => {
    await startPaymentSession(
      db,
      stubClient(verificationOk),
      "ord_1",
      "Demo Shop",
      "Payee-id-123",
    );

    const row = db.select().from(paymentSessions).get();
    expect(row?.transport).toBe("request_uri");
    expect(row?.dcApiRequestJson).toBeNull();
  });

  it("asks foundry for the dc_api transport when told to", async () => {
    let sentBody: unknown = null;
    const client = stubClient((_url, init) => {
      sentBody = JSON.parse(String(init.body));
      return dcApiOk();
    });

    await startPaymentSession(
      db,
      client,
      "ord_1",
      "Demo Shop",
      "Payee-id-123",
      true,
    );

    expect(sentBody).toMatchObject({ transport: "dc_api" });
  });

  it("persists the inline dc_api_request and leaves both uris null", async () => {
    const result = await startPaymentSession(
      db,
      stubClient(dcApiOk),
      "ord_1",
      "Demo Shop",
      "Payee-id-123",
      true,
    );

    // `uri` is null rather than "" under dc_api: foundry returns neither
    // openid4vp_uri nor request_uri, and null says "there is no URI" where an
    // empty string only says "the URI is blank".
    expect(result).toEqual({
      ok: true,
      sessionId: expect.any(String),
      uri: null,
      orderId: "ord_1",
      amountCents: 4_798,
      transport: "dc_api",
      ageRequested: false,
      dcApiRequest: { client_id: "x509_hash:abc", nonce: "n1" },
      state: "pending",
    });

    const row = db.select().from(paymentSessions).get();
    expect(row?.transport).toBe("dc_api");
    expect(row?.openid4vpUri).toBeNull();
    expect(row?.requestUri).toBeNull();
    expect(JSON.parse(row?.dcApiRequestJson ?? "null")).toEqual({
      client_id: "x509_hash:abc",
      nonce: "n1",
    });
  });

  it("refuses an unknown order", async () => {
    const result = await startPaymentSession(
      db,
      stubClient(verificationOk),
      "ord_nope",
      "Demo Shop",
      "Payee-id-123",
    );
    expect(result).toEqual({ ok: false, reason: "order_not_found" });
  });

  it("refuses an order that is not pending", async () => {
    const result = await startPaymentSession(
      db,
      stubClient(verificationOk),
      "ord_paid",
      "Demo Shop",
      "Payee-id-123",
    );
    expect(result).toEqual({ ok: false, reason: "order_not_pending" });
  });

  it("marks the row failed when foundry rejects the request", async () => {
    const client = stubClient(() => ({ status: 500, body: { error: "boom" } }));
    const result = await startPaymentSession(
      db,
      client,
      "ord_1",
      "Demo Shop",
      "Payee-id-123",
    );

    expect(result).toEqual({ ok: false, reason: "foundry_unavailable" });
    const row = db.select().from(paymentSessions).get();
    // The row is persisted BEFORE foundry is called, mirroring the bank's
    // issuance flow (Plan 1 Task 11) — the failure stays visible in the DB.
    expect(row?.state).toBe("failed");
    expect(row?.failureReason).toBe("foundry_unavailable");
  });
});

describe("startPaymentSession — the result the sheet is built from", () => {
  it("reports the amount from the order row, not from the caller", async () => {
    // The sheet shows this number and it must be the one bound into
    // transaction_data, so it can only come from the order.
    stockOrder("cheese");
    const result = await startPaymentSession(
      db,
      stubClient(verificationOk),
      "ord_1",
      "Larder",
      "PAYEE-1",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.amountCents).toBe(4_798);
    expect(result.orderId).toBe("ord_1");
    expect(result.state).toBe("pending");
  });

  it("reports a request_uri session with no dc_api payload", async () => {
    stockOrder("cheese");
    const result = await startPaymentSession(
      db,
      stubClient(verificationOk),
      "ord_1",
      "Larder",
      "PAYEE-1",
      false,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transport).toBe("request_uri");
    expect(result.dcApiRequest).toBeNull();
    expect(typeof result.uri).toBe("string");
  });

  it("reports a dc_api session with no uri", async () => {
    stockOrder("cheese");
    const result = await startPaymentSession(
      db,
      stubClient(dcApiOk),
      "ord_1",
      "Larder",
      "PAYEE-1",
      true,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transport).toBe("dc_api");
    expect(result.uri).toBeNull();
    expect(result.dcApiRequest).not.toBeNull();
  });

  it("reports ageRequested for an age-restricted basket", async () => {
    stockOrder("cheese", "wine");
    const result = await startPaymentSession(
      db,
      stubClient(verificationOk),
      "ord_1",
      "Larder",
      "PAYEE-1",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ageRequested).toBe(true);
  });

  it("reports ageRequested false for an ordinary basket", async () => {
    stockOrder("cheese");
    const result = await startPaymentSession(
      db,
      stubClient(verificationOk),
      "ord_1",
      "Larder",
      "PAYEE-1",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ageRequested).toBe(false);
  });
});

describe("getPaymentSessionStatus", () => {
  it("returns the current state without contacting foundry", async () => {
    const started = await startPaymentSession(
      db,
      stubClient(verificationOk),
      "ord_1",
      "Demo Shop",
      "Payee-id-123",
    );
    if (!started.ok) throw new Error("setup failed");

    expect(getPaymentSessionStatus(db, started.sessionId)).toEqual({
      state: "pending",
    });
  });

  it("returns null for an unknown session id", () => {
    expect(getPaymentSessionStatus(db, "sess_nope")).toBeNull();
  });

  it("includes checks and failureReason once a session has them", async () => {
    const started = await startPaymentSession(
      db,
      stubClient(verificationOk),
      "ord_1",
      "Demo Shop",
      "Payee-id-123",
    );
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
