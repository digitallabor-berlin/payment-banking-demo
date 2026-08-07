import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FoundryClient } from "@demo/foundry-client";
import { createDb, type Db } from "../db/index.js";
import { orders, paymentSessions } from "../db/schema.js";
import { relayDcApiResponse } from "./dc-api-relay.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "merchant-relay-"));
  db = createDb(path.join(dir, "test.db"));
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
  db.insert(paymentSessions)
    .values({
      id: "sess_dc",
      orderId: "ord_1",
      state: "pending",
      foundryVerificationId: "ver_dc",
      transport: "dc_api",
      createdAt: 1,
    })
    .run();
  db.insert(paymentSessions)
    .values({
      id: "sess_orphan",
      orderId: "ord_1",
      state: "pending",
      foundryVerificationId: null,
      transport: "dc_api",
      createdAt: 1,
    })
    .run();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function stubClient(status: number, capture?: (url: string, init: RequestInit) => void) {
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    capture?.(String(input), init ?? {});
    return new Response(JSON.stringify({ verified: true, checks: [], claims: {} }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return new FoundryClient({ adminUrl: "http://f:9000", adminKey: "k", fetchImpl });
}

describe("relayDcApiResponse", () => {
  it("forwards the wallet's response to foundry for the session's verification", async () => {
    let seenUrl = "";
    let seenBody = "";
    const client = stubClient(200, (url, init) => {
      seenUrl = url;
      seenBody = String(init.body);
    });

    const result = await relayDcApiResponse(db, client, "sess_dc", "the.encrypted.jwe");

    expect(result).toEqual({ ok: true });
    expect(seenUrl).toBe("http://f:9000/admin/verification/requests/ver_dc/dc-api-response");
    expect(JSON.parse(seenBody)).toEqual({ response: "the.encrypted.jwe" });
  });

  it("reports not_found for an unknown session", async () => {
    const result = await relayDcApiResponse(db, stubClient(200), "sess_nope", "jwe");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("reports no_verification when the session never reached foundry", async () => {
    const result = await relayDcApiResponse(db, stubClient(200), "sess_orphan", "jwe");
    expect(result).toEqual({ ok: false, reason: "no_verification" });
  });

  it("reports foundry_unavailable on a non-2xx from foundry", async () => {
    const result = await relayDcApiResponse(db, stubClient(500), "sess_dc", "jwe");
    expect(result).toEqual({ ok: false, reason: "foundry_unavailable" });
  });
});