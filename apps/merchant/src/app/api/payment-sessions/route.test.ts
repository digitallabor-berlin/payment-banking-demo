/**
 * The wire body of `POST /api/payment-sessions`.
 *
 * This app's FIRST route-handler test, and it exists because the projection
 * from `StartPaymentSessionResult` into JSON was the one part of the DC API
 * path nothing covered. `payment-sessions.test.ts` proves
 * `startPaymentSession` returns `dcApiProtocol`; nothing proved the route
 * forwarded it, and it did not. The shopper saw "This browser does not support
 * the Digital Credentials API" on the first attempt of every DC API payment —
 * from PaymentScreen's own `if (!dcApiProtocol)` guard, never from the browser
 * — and a reload fixed it, because a reload rebuilds the sheet from
 * `loadCheckoutSession` (which reads the column) instead of from this body.
 *
 * `CheckoutForm` casts this body with `as`, so a missing member is invisible to
 * `tsc`. Asserting on the parsed JSON is the only thing that can catch it.
 */

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db/index.js";
import { orders, paymentSessions } from "@/db/schema.js";

/**
 * `vi.hoisted` because the `vi.mock` factory below is lifted above the imports
 * and cannot close over an ordinary module-scope binding.
 */
const foundryStub = vi.hoisted(() => ({
  reply: null as null | { status: number; body: unknown },
}));

// The route reaches foundry through a memoized singleton pointed at a real
// admin listener. Replaced wholesale so no HTTP leaves this test.
vi.mock("@/lib/foundry.js", async () => {
  const { FoundryClient } = await import("@demo/foundry-client");
  const fetchImpl = (async (_input: unknown, _init?: RequestInit) => {
    const reply = foundryStub.reply;
    if (!reply) throw new Error("no foundry reply scripted for this test");
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  return {
    getFoundry: () =>
      new FoundryClient({
        adminUrl: "http://f:9000",
        adminKey: "k",
        fetchImpl,
      }),
  };
});

const { POST } = await import("./route.js");

/** The shapes foundry actually serves, copied from payment-sessions.test.ts. */
const requestUriOk = {
  status: 200,
  body: {
    verification_id: "ver_1",
    openid4vp_uri: "openid4vp://?x=1",
    request_uri: "https://foundry.example/req/1",
  },
};

const dcApiUnsignedOk = {
  status: 200,
  body: {
    verification_id: "ver_dc",
    protocol: "openid4vp-v1-unsigned",
    dc_api_request: { client_id: "x509_hash:abc", nonce: "n1" },
  },
};

const dcApiSignedOk = {
  status: 200,
  body: {
    verification_id: "ver_dcs",
    protocol: "openid4vp-v1-signed",
    dc_api_request: { request: "eyJ0eXAi.eyJhdWQi.c2ln" },
  },
};

// getDb() is memoized against DATABASE_PATH=":memory:", so every test in this
// file shares one connection. Rows are cleared rather than the db rebuilt.
beforeEach(() => {
  const db = getDb();
  db.delete(paymentSessions).run();
  db.delete(orders).run();
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
});

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/payment-sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/payment-sessions", () => {
  // The identifier and the `data` shape are two halves of one wire contract.
  // The sheet must hold BOTH as props before any click — Chrome consumes the
  // click's transient activation — so an absent identifier here is not a late
  // arrival the component can wait for, it is a dead button.
  it("returns foundry's protocol identifier for a signed session", async () => {
    foundryStub.reply = dcApiSignedOk;

    const response = await post({
      orderId: "ord_1",
      transport: "dc_api_signed",
    });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(body.transport).toBe("dc_api_signed");
    expect(body.dcApiProtocol).toBe("openid4vp-v1-signed");
    expect(body.dcApiRequest).toEqual({ request: "eyJ0eXAi.eyJhdWQi.c2ln" });
  });

  // Not a signed-only defect: `?dcapi=unsigned` takes this same route.
  it("returns foundry's protocol identifier for an unsigned session", async () => {
    foundryStub.reply = dcApiUnsignedOk;

    const response = await post({ orderId: "ord_1", transport: "dc_api" });
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.transport).toBe("dc_api");
    expect(body.dcApiProtocol).toBe("openid4vp-v1-unsigned");
  });

  // Null, not absent. `PaymentScreen` treats absent and null alike, but the
  // distinction is what makes the assertion above meaningful: a route that
  // omitted the member would pass a `toBeNull()` written as `toBeUndefined()`.
  it("returns a null protocol under request_uri", async () => {
    foundryStub.reply = requestUriOk;

    const response = await post({ orderId: "ord_1", transport: "request_uri" });
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.transport).toBe("request_uri");
    expect(body.dcApiProtocol).toBeNull();
    expect(Object.keys(body)).toContain("dcApiProtocol");
  });

  /**
   * The body IS a `SheetSession` — the sheet's own prop names, no renames — so
   * `CheckoutForm` can hand it straight to the sheet instead of re-mapping it.
   *
   * `sheetSessionFromStart`'s return annotation is now the primary guard: a
   * member added to `SheetSession` and forgotten here is a compile error. This
   * assertion is the second one, and it catches what a type cannot — that the
   * member survives `JSON.stringify`, which silently drops `undefined`. Pinned
   * as an exact set rather than a subset, because the defect being guarded
   * against is an ABSENT member and a subset assertion cannot see one.
   */
  it("answers a SheetSession under the sheet's own prop names", async () => {
    foundryStub.reply = dcApiSignedOk;

    const response = await post({
      orderId: "ord_1",
      transport: "dc_api_signed",
    });
    const body = (await response.json()) as Record<string, unknown>;

    expect(Object.keys(body).sort()).toEqual(
      [
        "ageRequested",
        "amountCents",
        "dcApiProtocol",
        "dcApiRequest",
        "initialState",
        "openid4vpUri",
        "orderId",
        "sessionId",
        "transport",
      ].sort(),
    );
    // The old names are gone rather than kept alongside the new ones: two
    // spellings of one value is exactly how the third hand-written mapping in
    // CheckoutForm came to exist, and with it the omission this file exists for.
    expect(body).not.toHaveProperty("uri");
    expect(body).not.toHaveProperty("state");
    expect(body.initialState).toBe("pending");
    // Empty string, not null: the sheet takes a string prop.
    expect(body.openid4vpUri).toBe("");
  });

  // Cheap proof the body is not a fiction: what it reports as the transport is
  // what got written, so a reload of the same session agrees with the first
  // attempt rather than silently correcting it.
  it("agrees with the row it wrote", async () => {
    foundryStub.reply = dcApiSignedOk;

    const response = await post({
      orderId: "ord_1",
      transport: "dc_api_signed",
    });
    const body = (await response.json()) as { sessionId: string };

    const row = getDb()
      .select()
      .from(paymentSessions)
      .where(eq(paymentSessions.id, body.sessionId))
      .get();

    expect(row?.transport).toBe("dc_api_signed");
    expect(row?.dcApiProtocol).toBe("openid4vp-v1-signed");
  });
});
