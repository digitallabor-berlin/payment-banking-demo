import { describe, expect, it } from "vitest";
import { FoundryClient, FoundryError } from "./client.js";

function stubFetch(
  status: number,
  body: unknown,
  capture?: (url: string, init: RequestInit) => void,
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    capture?.(String(input), init ?? {});
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

function makeClient(fetchImpl: typeof fetch): FoundryClient {
  return new FoundryClient({
    adminUrl: "http://foundry.test:9000",
    adminKey: "k-123",
    fetchImpl,
  });
}

describe("FoundryClient.createIssuanceOffer", () => {
  it("posts to /admin/issuance/offers with a bearer token and returns the offer", async () => {
    let seenUrl = "";
    let seenInit: RequestInit = {};
    const client = makeClient(
      stubFetch(
        200,
        {
          transaction_id: "tx_1",
          credential_offer_uri: "openid-credential-offer://x",
          dc_api_offer: {},
        },
        (url, init) => {
          seenUrl = url;
          seenInit = init;
        },
      ),
    );

    const res = await client.createIssuanceOffer({
      credential_type_id: "com.emvco.dpc.card",
      claims: { credential_id: "dpc_abc", network: "VISA" },
    });

    expect(seenUrl).toBe("http://foundry.test:9000/admin/issuance/offers");
    expect(seenInit.method).toBe("POST");
    const headers = new Headers(seenInit.headers);
    expect(headers.get("authorization")).toBe("Bearer k-123");
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(seenInit.body))).toEqual({
      credential_type_id: "com.emvco.dpc.card",
      claims: { credential_id: "dpc_abc", network: "VISA" },
    });
    expect(res.transaction_id).toBe("tx_1");
    expect(res.credential_offer_uri).toBe("openid-credential-offer://x");
  });

  it("strips a trailing slash from adminUrl so paths never double up", async () => {
    let seenUrl = "";
    const client = new FoundryClient({
      adminUrl: "http://foundry.test:9000/",
      adminKey: "k",
      fetchImpl: stubFetch(
        200,
        { transaction_id: "t", credential_offer_uri: "u" },
        (url) => {
          seenUrl = url;
        },
      ),
    });
    await client.createIssuanceOffer({ credential_type_id: "x" });
    expect(seenUrl).toBe("http://foundry.test:9000/admin/issuance/offers");
  });

  it("throws FoundryError carrying status and body on a non-2xx response", async () => {
    const client = makeClient(stubFetch(400, { error: "bad_request" }));
    await expect(
      client.createIssuanceOffer({ credential_type_id: "nope" }),
    ).rejects.toBeInstanceOf(FoundryError);

    try {
      await client.createIssuanceOffer({ credential_type_id: "nope" });
      expect.unreachable("should have thrown");
    } catch (err) {
      const e = err as FoundryError;
      expect(e.status).toBe(400);
      expect(e.body).toContain("bad_request");
    }
  });
});

describe("FoundryClient.getIssuanceStatus", () => {
  it("GETs the transaction and returns its state", async () => {
    let seenUrl = "";
    let seenInit: RequestInit = {};
    const client = makeClient(
      stubFetch(
        200,
        {
          transaction_id: "tx_1",
          credential_type_id: "com.emvco.dpc.card",
          state: "issued",
          created_at: 1,
        },
        (url, init) => {
          seenUrl = url;
          seenInit = init;
        },
      ),
    );

    const res = await client.getIssuanceStatus("tx_1");

    expect(seenUrl).toBe("http://foundry.test:9000/admin/issuance/offers/tx_1");
    expect(seenInit.method).toBe("GET");
    expect(res.state).toBe("issued");
  });

  it("percent-encodes the transaction id", async () => {
    let seenUrl = "";
    const client = makeClient(
      stubFetch(
        200,
        { transaction_id: "a/b", credential_type_id: "c", state: "offered", created_at: 1 },
        (url) => {
          seenUrl = url;
        },
      ),
    );
    await client.getIssuanceStatus("a/b");
    expect(seenUrl).toBe("http://foundry.test:9000/admin/issuance/offers/a%2Fb");
  });
});

describe("FoundryClient verification methods", () => {
  it("creates a verification request with the request_uri transport", async () => {
    let seenBody = "";
    const client = makeClient(
      stubFetch(
        200,
        { verification_id: "v_1", openid4vp_uri: "openid4vp://?x=1", request_uri: "http://r" },
        (_url, init) => {
          seenBody = String(init.body);
        },
      ),
    );

    const res = await client.createVerificationRequest({
      transport: "request_uri",
      dcql_query: { credentials: [] },
      transaction_data: [{ type: "payment" }],
    });

    expect(JSON.parse(seenBody).transport).toBe("request_uri");
    expect(res.verification_id).toBe("v_1");
    expect(res.openid4vp_uri).toBe("openid4vp://?x=1");
  });

  it("returns the verification verdict including per-check results", async () => {
    const client = makeClient(
      stubFetch(200, {
        id: "v_1",
        state: "verified",
        created_at: 1,
        result: {
          verified: true,
          checks: [{ check: "transaction_data_binding", passed: true }],
          claims: { credential_id: "dpc_abc" },
        },
      }),
    );

    const res = await client.getVerificationStatus("v_1");

    expect(res.state).toBe("verified");
    expect(res.result?.verified).toBe(true);
    expect(res.result?.checks[0]?.check).toBe("transaction_data_binding");
  });
});