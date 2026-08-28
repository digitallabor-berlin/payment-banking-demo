/**
 * The wire body of `POST /api/payments`, as `BankClient.pay` serialises it.
 *
 * `settle.test.ts` stubs `pay` wholesale, so nothing there sees this body at
 * all — it asserts on the camelCase `BankPayInput`. This file is the other
 * half: the snake_case projection the bank's zod schema actually parses. That
 * seam is exactly the one this repo has already lost a member in
 * (`dcApiProtocol`, 6e997da), and a hand-written object literal cannot be
 * type-checked into correctness.
 */

import { describe, expect, it } from "vitest";
import { BankClient } from "./bank.js";

function clientRecording(calls: Array<{ url: string; init: RequestInit }>) {
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init: init! });
    return new Response(JSON.stringify({ bank_tx_id: "tx_1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return new BankClient({ baseUrl: "http://bank", apiKey: "k", fetchImpl });
}

const base = {
  credentialId: "dpc_abc",
  amountCents: 1_000,
  currency: "EUR",
  merchant: "Demo Shop",
  reference: "Order ord_1",
  idempotencyKey: "sess_1",
};

describe("BankClient.pay", () => {
  it("sends the proof package under PaSO's own member names", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    await clientRecording(calls).pay({
      ...base,
      proofPackage: {
        signedRequest: "hdr.pay.sig",
        vpToken: { dpc: ["eyJ..."] },
      },
    });

    const body = JSON.parse(String(calls[0]!.init.body)) as Record<
      string,
      unknown
    >;
    expect(body.proof_package).toEqual({
      signed_request: "hdr.pay.sig",
      vp_token: { dpc: ["eyJ..."] },
    });
  });

  it("OMITS the key entirely when there is no package", async () => {
    // The bank's schema marks it `.optional()`, not `.nullable()`. An explicit
    // null would fail that while meaning the same thing.
    const calls: Array<{ url: string; init: RequestInit }> = [];
    await clientRecording(calls).pay(base);

    const body = JSON.parse(String(calls[0]!.init.body)) as Record<
      string,
      unknown
    >;
    expect(body).not.toHaveProperty("proof_package");
  });

  it("still sends every other member under its own wire name", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    await clientRecording(calls).pay(base);

    const body = JSON.parse(String(calls[0]!.init.body)) as Record<
      string,
      unknown
    >;
    expect(Object.keys(body).sort()).toEqual([
      "amount_cents",
      "credential_id",
      "currency",
      "idempotency_key",
      "merchant",
      "reference",
    ]);
  });
});
