/**
 * The wire contract of `POST /api/verifier-events`.
 *
 * A route test and not only unit tests, because two of this route's rules live
 * in the handler and nowhere else: it verifies the signature over the RAW body
 * (so `request.json()` must never be called first), and it answers 2xx to
 * everything except a bad signature, since foundry never retries and reads no
 * status but its own log.
 */

import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/index.js";
import { orders, paymentSessions, verifierEvents } from "@/db/schema.js";

const { POST } = await import("./route.js");

/** Matches vitest.config.ts test.env. */
const SECRET = "test-webhook-secret";

function post(body: unknown, secret = SECRET): Request {
  const raw = JSON.stringify(body);
  const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  return new Request("http://m/api/verifier-events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-foundry-signature": signature,
    },
    body: raw,
  });
}

// getDb() is memoized against DATABASE_PATH=":memory:", so every test in this
// file shares one connection. Rows are cleared rather than the db rebuilt.
beforeEach(() => {
  const db = getDb();
  db.delete(verifierEvents).run();
  db.delete(paymentSessions).run();
  db.delete(orders).run();
  db.insert(orders)
    .values({
      id: "ord_1",
      totalCents: 1_000,
      currency: "EUR",
      customerName: "Ada",
      customerEmail: "ada@example.com",
      status: "pending",
      createdAt: 1,
    })
    .run();
});

describe("POST /api/verifier-events", () => {
  it("stores a signed request event and answers 204", async () => {
    const response = await POST(
      post({
        event: "presentation_request_delivered",
        tx_id: "ver_1",
        transport: "dc_api_signed",
        request_object_jws: "a.b.c",
      }),
    );

    expect(response.status).toBe(204);
    expect(getDb().select().from(verifierEvents).all()[0]!.signedRequest).toBe(
      "a.b.c",
    );
  });

  it("stores a completion for a transaction a payment session claims", async () => {
    getDb()
      .insert(paymentSessions)
      .values({
        id: "sess_1",
        orderId: "ord_1",
        state: "pending",
        foundryVerificationId: "ver_1",
        namedQueryRef: "payment",
        createdAt: 1,
      })
      .run();

    const response = await POST(
      post({
        event: "verification_completed",
        tx_id: "ver_1",
        state: "verified",
        vp_token: { dpc: ["eyJ..."] },
      }),
    );

    expect(response.status).toBe(204);
    const row = getDb().select().from(verifierEvents).all()[0]!;
    expect(JSON.parse(row.vpTokenJson!)).toEqual({ dpc: ["eyJ..."] });
  });

  it("refuses a wrongly-signed body with 401 and stores nothing", async () => {
    const response = await POST(
      post(
        { event: "presentation_request_delivered", tx_id: "ver_1" },
        "wrong-secret",
      ),
    );

    expect(response.status).toBe(401);
    expect(getDb().select().from(verifierEvents).all()).toHaveLength(0);
  });

  it("refuses an unsigned body with 401", async () => {
    const response = await POST(
      new Request("http://m/api/verifier-events", {
        method: "POST",
        body: '{"event":"verification_completed","tx_id":"ver_1"}',
      }),
    );
    expect(response.status).toBe(401);
  });

  it("answers 204 to an event type it does not know, storing nothing", async () => {
    const response = await POST(
      post({ event: "something_new", tx_id: "ver_1" }),
    );
    expect(response.status).toBe(204);
    expect(getDb().select().from(verifierEvents).all()).toHaveLength(0);
  });

  it("answers 204 to a completion for a foreign transaction, storing nothing", async () => {
    const response = await POST(
      post({
        event: "verification_completed",
        tx_id: "ver_bank_login",
        vp_token: { sparkassen_auth: ["x"] },
      }),
    );
    expect(response.status).toBe(204);
    expect(getDb().select().from(verifierEvents).all()).toHaveLength(0);
  });

  it("answers 204 to a correctly-signed body that is not JSON", async () => {
    const raw = "not json";
    const signature = `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}`;
    const response = await POST(
      new Request("http://m/api/verifier-events", {
        method: "POST",
        headers: { "x-foundry-signature": signature },
        body: raw,
      }),
    );
    // Authentication passed; there is simply nothing to store.
    expect(response.status).toBe(204);
  });
});
